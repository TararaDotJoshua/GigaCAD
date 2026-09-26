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

/**
 * Renders a model into `container` with orbit controls, redrawing only on interaction.
 * Returns a function that frees the WebGL context.
 */
export async function showModel(container: HTMLElement, bytes: ArrayBuffer, format: PreviewFormat): Promise<() => void> {
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
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, 1e-6);
  model.position.sub(center);
  const camera = new PerspectiveCamera(35, 1, radius / 100, radius * 100);
  const direction = new Vector3(1, 0.8, 1).normalize();
  camera.position.copy(direction.multiplyScalar(radius / Math.sin((35 * Math.PI) / 360)));
  key.position.copy(camera.position);

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

  return () => {
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
  };
}
