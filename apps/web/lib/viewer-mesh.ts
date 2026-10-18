import { BufferAttribute, BufferGeometry, EdgesGeometry, Mesh } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { read3mf } from './viewer-3mf';
import { EDGE_TRIANGLE_LIMIT, transferables, type MeshReply, type MeshRequest, type PreparedMesh, type RawMesh } from './viewer-protocol';

// The mesh worker's work, kept apart from the worker itself so it can be tested.

/** Edges between faces meeting at more than this angle are drawn, so curved faces stay clean. */
const EDGE_ANGLE = 30;

/** Parses an STL, OBJ or 3MF file into raw triangles. Throws on files the parsers can't read. */
export function parseMeshFile(bytes: ArrayBuffer, format: 'stl' | 'obj' | '3mf'): RawMesh[] {
  if (format === 'stl') {
    const geometry = new STLLoader().parse(bytes);
    // Many exporters write zero normals, so they're always derived from the triangles.
    return [{ position: geometry.getAttribute('position').array as Float32Array }];
  }
  if (format === '3mf') return read3mf(new Uint8Array(bytes));
  const object = new OBJLoader().parse(new TextDecoder().decode(bytes));
  const meshes: RawMesh[] = [];
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = (child.geometry as BufferGeometry).clone().applyMatrix4(child.matrixWorld);
    const normal = geometry.getAttribute('normal');
    meshes.push({ position: geometry.getAttribute('position').array as Float32Array, normal: normal ? (normal.array as Float32Array) : undefined });
  });
  return meshes;
}

const triangleCount = (mesh: RawMesh) => (mesh.index ? mesh.index.length : mesh.position.length / 3) / 3;

/**
 * Adds normals, bounds and, below EDGE_TRIANGLE_LIMIT triangles in all, the sharp edges.
 * Meshes without normals are split into separate triangles first, so flat faces shade flat
 * rather than smoothed across shared vertices.
 */
export function prepareMeshes(raw: readonly RawMesh[], edgeLimit = EDGE_TRIANGLE_LIMIT): PreparedMesh[] {
  const meshes = raw.filter((mesh) => triangleCount(mesh) >= 1);
  const outline = meshes.reduce((sum, mesh) => sum + triangleCount(mesh), 0) <= edgeLimit;
  return meshes.map((mesh) => {
    let geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh.position, 3));
    if (mesh.index) geometry.setIndex(new BufferAttribute(mesh.index, 1));
    if (mesh.normal && mesh.normal.length === mesh.position.length) geometry.setAttribute('normal', new BufferAttribute(mesh.normal, 3));
    else {
      if (geometry.index) geometry = geometry.toNonIndexed();
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const { min, max } = geometry.boundingBox!;
    const { center, radius } = geometry.boundingSphere!;
    return {
      position: geometry.getAttribute('position').array as Float32Array,
      normal: geometry.getAttribute('normal').array as Float32Array,
      index: geometry.index ? (geometry.index.array as Uint32Array) : undefined,
      edges: outline ? (new EdgesGeometry(geometry, EDGE_ANGLE).getAttribute('position').array as Float32Array) : undefined,
      box: [min.x, min.y, min.z, max.x, max.y, max.z],
      sphere: [center.x, center.y, center.z, radius],
    };
  });
}

/** Answers one request to the mesh worker, with the buffers to transfer back. */
export function handleMeshRequest(request: MeshRequest, edgeLimit = EDGE_TRIANGLE_LIMIT): { reply: MeshReply; transfer: ArrayBuffer[] } {
  let meshes: PreparedMesh[];
  try {
    meshes = prepareMeshes(request.kind === 'file' ? parseMeshFile(request.bytes, request.format) : request.meshes, edgeLimit);
  } catch {
    return { reply: { type: 'failed', problem: 'unreadable' }, transfer: [] };
  }
  if (meshes.length === 0) return { reply: { type: 'failed', problem: 'no-geometry' }, transfer: [] };
  // Garbage read as a binary STL comes out as NaN coordinates, which would leave the stage blank.
  if (!meshes.every((mesh) => mesh.sphere.every(Number.isFinite))) return { reply: { type: 'failed', problem: 'unreadable' }, transfer: [] };
  return { reply: { type: 'done', meshes }, transfer: transferables(meshes) };
}
