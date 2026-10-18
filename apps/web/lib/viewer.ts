import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PreviewError, contentProblem, type PreviewFormat } from './preview';
import { FIELD_OF_VIEW, fitDistance } from './viewer-camera';
import {
  CAD_READER_LOAD_TIMEOUT_MS,
  cadReadTimeout,
  readCadReply,
  transferables,
  type MeshReply,
  type MeshRequest,
  type PreparedMesh,
  type RawMesh,
} from './viewer-protocol';

// Drawn like the site's part line art: a pale solid with ink edges on a Paper background.
const PAPER = '#F5F5F7';
const MIST = '#EBEBED';
const INK = '#0A2922';
/** Each zoom step, by button or key, moves the camera this much closer or farther. */
const ZOOM_STEP = 0.8;

export interface ModelView {
  /** The model's bounding box, in the file's own units. */
  readonly size: { readonly width: number; readonly depth: number; readonly height: number };
  /** Half the bounding box's diagonal: what the camera frames. */
  readonly radius: number;
  /** Frames the camera for a model this big, so two models side by side show at the same scale. */
  frame(radius: number): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Frames the whole model again, as when it first showed. */
  reset(): void;
  /** Frees the WebGL context and removes this view's canvas, leaving the container's other children. */
  release(): void;
}

export interface ShowModelOptions {
  /** Aborting stops the work wherever it is and terminates the workers. */
  signal?: AbortSignal;
  /** Reports each stage: "Loading the CAD reader…", then "Building the model…". */
  onStatus?: (status: string) => void;
}

const aborted = (signal: AbortSignal | undefined) => signal?.reason ?? new DOMException('The preview was closed.', 'AbortError');

/** Runs `listen` against a worker until it settles, terminating the worker then, or when `signal` aborts. */
function talkTo<T>(
  worker: Worker,
  signal: AbortSignal | undefined,
  listen: (resolve: (value: T) => void, reject: (error: unknown) => void) => (() => void) | void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let cleanup: (() => void) | void;
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      cleanup?.();
    };
    const onAbort = () => {
      finish();
      reject(aborted(signal));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    cleanup = listen(
      (value) => {
        finish();
        resolve(value);
      },
      (error) => {
        finish();
        reject(error);
      },
    );
  });
}

/**
 * STEP and IGES go through OpenCascade (WebAssembly) in public/cad-reader-worker.js. It reports
 * when the reader has loaded, and gives up if loading or reading stops responding.
 */
function readCadFile(bytes: ArrayBuffer, format: 'step' | 'iges', signal: AbortSignal | undefined, onReady: () => void): Promise<RawMesh[]> {
  const worker = new Worker('/cad-reader-worker.js');
  return talkTo<RawMesh[]>(worker, signal, (resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => reject(new PreviewError('reader-timeout')), ms);
    };
    const readTimeout = cadReadTimeout(bytes.byteLength);
    wait(CAD_READER_LOAD_TIMEOUT_MS);
    worker.onerror = (event) => {
      event.preventDefault();
      reject(new PreviewError('reader'));
    };
    worker.onmessageerror = () => reject(new PreviewError('unreadable'));
    worker.onmessage = (event) => {
      const reply = readCadReply(event.data);
      if (reply.kind === 'ready') {
        onReady();
        wait(readTimeout);
      } else if (reply.kind === 'meshes') resolve(reply.meshes);
      else reject(new PreviewError(reply.problem));
    };
    worker.postMessage({ format, buffer: new Uint8Array(bytes) }, [bytes]);
    return () => clearTimeout(timer);
  });
}

/** Parsing, normals and edges run in lib/mesh-worker.ts, so a large mesh doesn't freeze the page. */
function buildMeshes(request: MeshRequest, signal: AbortSignal | undefined): Promise<PreparedMesh[]> {
  const worker = new Worker(new URL('./mesh-worker.ts', import.meta.url), { type: 'module' });
  return talkTo<PreparedMesh[]>(worker, signal, (resolve, reject) => {
    worker.onerror = (event) => {
      event.preventDefault();
      reject(new PreviewError('viewer'));
    };
    worker.onmessageerror = () => reject(new PreviewError('unreadable'));
    worker.onmessage = (event: MessageEvent<MeshReply>) => {
      if (event.data.type === 'done') resolve(event.data.meshes);
      else reject(new PreviewError(event.data.problem));
    };
    worker.postMessage(request, request.kind === 'file' ? [request.bytes] : transferables(request.meshes));
  });
}

async function meshesFor(bytes: ArrayBuffer, format: PreviewFormat, signal: AbortSignal | undefined, status: (text: string) => void) {
  const problem = contentProblem(new Uint8Array(bytes), format);
  if (problem) throw problem;
  if (format === 'step' || format === 'iges') {
    status('Loading the CAD reader…');
    const raw = await readCadFile(bytes, format, signal, () => status('Building the model…'));
    return buildMeshes({ kind: 'meshes', meshes: raw }, signal);
  }
  status('Building the model…');
  return buildMeshes({ kind: 'file', format, bytes }, signal);
}

/**
 * Renders a model into `container` with orbit controls, redrawing only on interaction. The
 * container gets the arrow keys (pan, or orbit with Shift), + and - (zoom) and 0 (reset view).
 * `bytes` is handed to a worker, so it can't be read again afterwards.
 */
export async function showModel(container: HTMLElement, bytes: ArrayBuffer, format: PreviewFormat, options: ShowModelOptions = {}): Promise<ModelView> {
  const { signal, onStatus } = options;
  const meshes = await meshesFor(bytes, format, signal, (text) => {
    if (!signal?.aborted) onStatus?.(text);
  });
  if (signal?.aborted) throw aborted(signal);

  const scene = new Scene();
  scene.background = new Color(PAPER);
  const model = new Group();
  // Both sides are drawn, so meshes with reversed triangles still read as solid.
  const surface = new MeshStandardMaterial({ color: MIST, roughness: 0.85, metalness: 0, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edges = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.7 });
  const geometries: BufferGeometry[] = [];
  for (const mesh of meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh.position, 3));
    geometry.setAttribute('normal', new BufferAttribute(mesh.normal, 3));
    if (mesh.index) geometry.setIndex(new BufferAttribute(mesh.index, 1));
    // Bounds came from the worker, so three.js doesn't walk every vertex again here.
    const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.box;
    const [x, y, z, sphereRadius] = mesh.sphere;
    geometry.boundingBox = new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
    geometry.boundingSphere = new Sphere(new Vector3(x, y, z), sphereRadius);
    geometries.push(geometry);
    model.add(new Mesh(geometry, surface));
    if (mesh.edges) {
      const lines = new BufferGeometry();
      lines.setAttribute('position', new BufferAttribute(mesh.edges, 3));
      geometries.push(lines);
      model.add(new LineSegments(lines, edges));
    }
  }
  // CAD files are usually Z-up; turn them to three.js's Y-up.
  if (format !== 'obj') model.rotation.x = -Math.PI / 2;
  scene.add(model);
  scene.add(new HemisphereLight('#ffffff', '#b8c2bf', 2.2));
  const key = new DirectionalLight('#ffffff', 1.4);
  scene.add(key);

  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  const extent = box.getSize(new Vector3());
  const radius = Math.max(extent.length() / 2, 1e-6);
  // What the camera frames: this model, or a larger one it's compared with.
  let framed = radius;
  model.position.sub(center);
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, radius / 100, radius * 100);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  container.append(canvas);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minDistance = radius / 50;
  controls.maxDistance = radius * 40;
  controls.listenToKeyEvents(container);

  const render = () => {
    key.position.copy(camera.position);
    renderer.render(scene, camera);
  };
  // Framed from an isometric angle, like the line art, and framed again on resize until the user moves the view.
  let moved = false;
  const direction = new Vector3(1, 0.8, 1).normalize();
  const frame = () => {
    camera.near = framed / 100;
    camera.far = framed * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    camera.position.copy(direction).multiplyScalar(fitDistance(framed, camera.aspect));
    controls.update();
    controls.saveState();
  };
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = container;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!moved) frame();
    render();
  };
  const zoom = (closer: boolean) => {
    moved = true;
    if (closer) controls.dollyIn(ZOOM_STEP);
    else controls.dollyOut(ZOOM_STEP);
  };
  const reset = () => {
    moved = false;
    frame();
    render();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === '+' || event.key === '=') zoom(true);
    else if (event.key === '-' || event.key === '_') zoom(false);
    else if (event.key === '0') reset();
    else if (event.key.startsWith('Arrow')) moved = true;
    else return;
    event.preventDefault();
  };
  const onStart = () => {
    moved = true;
  };
  frame();
  container.addEventListener('keydown', onKey);
  controls.addEventListener('start', onStart);
  controls.addEventListener('change', render);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  // Forced colors (Windows High Contrast) swap the Paper stage for the system's own colors.
  const contrast = window.matchMedia('(forced-colors: active)');
  const repaint = () => {
    paint(container, scene, surface, edges, contrast.matches);
    render();
  };
  contrast.addEventListener('change', repaint);
  repaint();

  return {
    // The model is turned Y-up, so its height is along Y and its depth along Z.
    size: { width: extent.x, depth: extent.z, height: extent.y },
    radius,
    frame: (frameRadius) => {
      framed = frameRadius;
      reset();
    },
    zoomIn: () => zoom(true),
    zoomOut: () => zoom(false),
    reset,
    release: () => {
      contrast.removeEventListener('change', repaint);
      observer.disconnect();
      container.removeEventListener('keydown', onKey);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('change', render);
      controls.stopListenToKeyEvents();
      controls.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      surface.dispose();
      edges.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

/** A model's size in words, like "40 × 40 × 12 mm". STEP, IGES, and 3MF are in millimeters; STL and OBJ carry no units. */
export function sizeText(size: ModelView['size'], format: PreviewFormat): string {
  const number = (value: number) => Number(value.toPrecision(3)).toLocaleString('en-US');
  const units = format === 'step' || format === 'iges' || format === '3mf' ? 'mm' : 'units';
  return `${number(size.width)} × ${number(size.depth)} × ${number(size.height)} ${units} (W × D × H)`;
}

/** The stage in Paper, Mist and Ink, or in the system's Canvas and CanvasText under forced colors. */
function paint(container: HTMLElement, scene: Scene, surface: MeshStandardMaterial, edges: LineBasicMaterial, forced: boolean) {
  if (!forced) {
    scene.background = new Color(PAPER);
    surface.color.set(MIST);
    edges.color.set(INK);
    edges.opacity = 0.7;
    return;
  }
  const probe = document.createElement('span');
  probe.style.cssText = 'display: none; color: CanvasText; background-color: Canvas';
  container.append(probe);
  const { color, backgroundColor } = getComputedStyle(probe);
  probe.remove();
  const canvas = new Color(backgroundColor);
  const text = new Color(color);
  scene.background = canvas;
  surface.color.copy(canvas).lerp(text, 0.25);
  edges.color.copy(text);
  edges.opacity = 1;
}
