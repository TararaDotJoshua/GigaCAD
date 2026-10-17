import {
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { PreviewFormat } from './preview';

// Drawn like the site's part line art: a pale solid with ink edges on a Paper background.
const PAPER = '#F5F5F7';
const MIST = '#EBEBED';
const INK = '#0A2922';
/** Edges between faces meeting at more than this angle are drawn, so curved faces stay clean. */
const EDGE_ANGLE = 30;

interface OcctMesh {
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index?: { array: number[] };
}

/** STEP and IGES go through OpenCascade (WebAssembly) in a worker, so the page stays responsive. */
function readCadFile(bytes: ArrayBuffer, format: 'step' | 'iges'): Promise<BufferGeometry[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/vendor/occt/occt-import-js-worker.js');
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The CAD reader failed to load.'));
    };
    worker.onmessage = (event: MessageEvent<{ success: boolean; meshes: OcctMesh[] }>) => {
      worker.terminate();
      if (!event.data.success) return reject(new Error(`This ${format.toUpperCase()} file couldn't be read.`));
      resolve(
        event.data.meshes.map((mesh) => {
          const geometry = new BufferGeometry();
          geometry.setAttribute('position', new Float32BufferAttribute(mesh.attributes.position.array, 3));
          if (mesh.attributes.normal) geometry.setAttribute('normal', new Float32BufferAttribute(mesh.attributes.normal.array, 3));
          if (mesh.index) geometry.setIndex(mesh.index.array);
          if (!mesh.attributes.normal) geometry.computeVertexNormals();
          return geometry;
        }),
      );
    };
    worker.postMessage({ format, buffer: new Uint8Array(bytes), params: null });
  });
}

async function geometriesFor(bytes: ArrayBuffer, format: PreviewFormat): Promise<BufferGeometry[]> {
  if (format === 'step' || format === 'iges') return readCadFile(bytes, format);
  if (format === 'stl') {
    // Many exporters write zero normals, so always derive them from the triangles.
    const geometry = new STLLoader().parse(bytes);
    geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();
    return [geometry];
  }
  const object: Object3D = format === 'obj' ? new OBJLoader().parse(new TextDecoder().decode(bytes)) : new ThreeMFLoader().parse(bytes);
  const geometries: BufferGeometry[] = [];
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = (child.geometry as BufferGeometry).clone().applyMatrix4(child.matrixWorld);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      geometries.push(geometry);
    }
  });
  return geometries;
}

export interface ShownModel {
  /** Frees the WebGL context. */
  readonly dispose: () => void;
  /** The model's bounding box, in the file's own units. */
  readonly size: { readonly width: number; readonly depth: number; readonly height: number };
  /** Half the bounding box's diagonal: what the camera frames. */
  readonly radius: number;
  /** Frames the camera for a model this big, so two models side by side show at the same scale. */
  readonly frame: (radius: number) => void;
}

/** Renders a model into `container` with orbit controls, redrawing only on interaction. */
export async function showModel(container: HTMLElement, bytes: ArrayBuffer, format: PreviewFormat): Promise<ShownModel> {
  const geometries = await geometriesFor(bytes, format);
  if (geometries.length === 0) throw new Error('This file has no geometry to show.');

  const scene = new Scene();
  scene.background = new Color(PAPER);
  const model = new Group();
  const surface = new MeshStandardMaterial({ color: MIST, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edges = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.7 });
  for (const geometry of geometries) {
    model.add(new Mesh(geometry, surface));
    model.add(new LineSegments(new EdgesGeometry(geometry, EDGE_ANGLE), edges));
  }
  // CAD files are usually Z-up; turn them to three.js's Y-up.
  if (format !== 'obj') model.rotation.x = -Math.PI / 2;
  scene.add(model);
  scene.add(new HemisphereLight('#ffffff', '#b8c2bf', 2.2));
  const key = new DirectionalLight('#ffffff', 1.4);
  scene.add(key);

  // Frame the model from an isometric angle, like the line art.
  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  const extent = box.getSize(new Vector3());
  const radius = Math.max(extent.length() / 2, 1e-6);
  model.position.sub(center);
  const camera = new PerspectiveCamera(35, 1, radius / 100, radius * 100);
  const direction = new Vector3(1, 0.8, 1).normalize();
  const place = (frameRadius: number) => {
    camera.near = frameRadius / 100;
    camera.far = frameRadius * 100;
    camera.position.copy(direction.clone().multiplyScalar(frameRadius / Math.sin((35 * Math.PI) / 360)));
    camera.updateProjectionMatrix();
    key.position.copy(camera.position);
  };
  place(radius);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.replaceChildren(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;

  const render = () => {
    key.position.copy(camera.position);
    renderer.render(scene, camera);
  };
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = container;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  controls.addEventListener('change', render);
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
      place(frameRadius);
      controls.target.set(0, 0, 0);
      controls.update();
      render();
    },
    dispose: () => {
      contrast.removeEventListener('change', repaint);
      observer.disconnect();
      controls.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      model.traverse((child) => {
        if (child instanceof LineSegments) child.geometry.dispose();
      });
      surface.dispose();
      edges.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      container.replaceChildren();
    },
  };
}

/** A model's size in words, like "40 × 40 × 12 mm". STEP, IGES, and 3MF are in millimeters; STL and OBJ carry no units. */
export function sizeText(size: ShownModel['size'], format: PreviewFormat): string {
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
