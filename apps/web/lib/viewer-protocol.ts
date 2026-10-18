// What the 3D viewer and its two workers say to each other. Kept free of three.js so the page
// and the tests can use it without loading the parsers.

/** Triangles as a parser or the CAD reader gives them, before normals and edges. */
export interface RawMesh {
  position: Float32Array;
  normal?: Float32Array;
  index?: Uint32Array;
}

/** A mesh ready to draw: built in the mesh worker, so the page only uploads it. */
export interface PreparedMesh {
  position: Float32Array;
  normal: Float32Array;
  index?: Uint32Array;
  /** Line segments along sharp edges, or none for meshes too dense to outline. */
  edges?: Float32Array;
  /** min x, y, z, then max x, y, z. */
  box: [number, number, number, number, number, number];
  /** centre x, y, z, then radius. */
  sphere: [number, number, number, number];
}

/** To the mesh worker: a mesh file to parse, or the CAD reader's triangles to finish. */
export type MeshRequest = { kind: 'file'; format: 'stl' | 'obj' | '3mf'; bytes: ArrayBuffer } | { kind: 'meshes'; meshes: RawMesh[] };

export type MeshReply = { type: 'done'; meshes: PreparedMesh[] } | { type: 'failed'; problem: 'unreadable' | 'no-geometry' };

/** Above this many triangles in all, edges are skipped: finding them takes longer than the model is worth outlining. */
export const EDGE_TRIANGLE_LIMIT = 200_000;

/** How long the CAD reader may take to load before the preview gives up on it. */
export const CAD_READER_LOAD_TIMEOUT_MS = 90_000;

/** How long the CAD reader may take to read a file: 90 seconds, plus a second for each MB. */
export function cadReadTimeout(byteLength: number): number {
  return 90_000 + Math.ceil(byteLength / (1024 * 1024)) * 1000;
}

export type CadReply = { kind: 'ready' } | { kind: 'meshes'; meshes: RawMesh[] } | { kind: 'failed'; problem: 'reader' | 'unreadable' };

/** Reads a message from public/cad-reader-worker.js. Anything unexpected counts as an unreadable file. */
export function readCadReply(data: unknown): CadReply {
  const message = (data ?? {}) as { type?: unknown; stage?: unknown; meshes?: unknown };
  if (message.type === 'ready') return { kind: 'ready' };
  if (message.type === 'failed') return { kind: 'failed', problem: message.stage === 'load' ? 'reader' : 'unreadable' };
  if (message.type === 'result' && Array.isArray(message.meshes)) {
    const meshes = (message.meshes as Partial<RawMesh>[]).filter((mesh): mesh is RawMesh => mesh.position instanceof Float32Array);
    return { kind: 'meshes', meshes };
  }
  return { kind: 'failed', problem: 'unreadable' };
}

/** The buffers in a request or reply, moved to the other side rather than copied. */
export function transferables(meshes: readonly (RawMesh | PreparedMesh)[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const mesh of meshes) {
    for (const array of [mesh.position, mesh.normal, mesh.index, 'edges' in mesh ? mesh.edges : undefined]) {
      if (array && array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
    }
  }
  return [...buffers];
}
