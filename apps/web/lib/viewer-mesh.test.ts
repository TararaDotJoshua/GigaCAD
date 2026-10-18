import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js';
import { describe, expect, it } from 'vitest';
import { handleMeshRequest, parseMeshFile, prepareMeshes } from './viewer-mesh';

/** A unit cube as an ASCII STL: 12 triangles. */
function cubeStl(): ArrayBuffer {
  const corners = (x: number, y: number, z: number) => `vertex ${x} ${y} ${z}`;
  const quads = [
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]],
    [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]],
    [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]],
    [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
  ];
  const facets = quads.flatMap(([a, b, c, d]) =>
    [
      [a, b, c],
      [a, c, d],
    ].map((tri) => `facet normal 0 0 0\nouter loop\n${tri.map((p) => corners(p![0]!, p![1]!, p![2]!)).join('\n')}\nendloop\nendfacet`),
  );
  return new TextEncoder().encode(`solid cube\n${facets.join('\n')}\nendsolid cube\n`).buffer as ArrayBuffer;
}

/** A unit square in 3MF, as indexed triangles sharing two corners. */
function square3mf(): ArrayBuffer {
  const xml = `<?xml version="1.0"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
    <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="1" y="1" z="0"/><vertex x="0" y="1" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="3"/></triangles></mesh></object>
  </resources><build><item objectid="1"/></build></model>`;
  return zipSync({ '3D/3dmodel.model': strToU8(xml) }).buffer as ArrayBuffer;
}

describe('parseMeshFile', () => {
  it('reads STL, dropping the file’s normals', () => {
    const [mesh] = parseMeshFile(cubeStl(), 'stl');
    expect(mesh!.position).toHaveLength(12 * 9);
    expect(mesh!.normal).toBeUndefined();
  });

  it('reads OBJ', () => {
    const obj = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n').buffer as ArrayBuffer;
    const [mesh] = parseMeshFile(obj, 'obj');
    expect([...mesh!.position]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('reads 3MF without DOMParser', () => {
    const [mesh] = parseMeshFile(square3mf(), '3mf');
    expect(mesh!.index).toHaveLength(6);
  });
});

describe('prepareMeshes', () => {
  it('splits indexed meshes without normals, so flat faces shade flat', () => {
    const [mesh] = prepareMeshes(parseMeshFile(square3mf(), '3mf'));
    expect(mesh!.index).toBeUndefined();
    expect(mesh!.position).toHaveLength(2 * 9);
    // Every vertex of the flat square faces straight up, with no smoothing toward neighbours.
    for (let i = 0; i < mesh!.normal.length; i += 3) expect([...mesh!.normal.slice(i, i + 3)].map(Math.abs)).toEqual([0, 0, 1]);
  });

  it('keeps the CAD reader’s own normals and index', () => {
    const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normal = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const index = new Uint32Array([0, 1, 2]);
    const [mesh] = prepareMeshes([{ position, normal, index }]);
    expect(mesh!.normal).toBe(normal);
    expect(mesh!.index).toBe(index);
  });

  it('outlines a cube’s twelve edges and gives its bounds', () => {
    const [mesh] = prepareMeshes(parseMeshFile(cubeStl(), 'stl'));
    expect(mesh!.edges).toHaveLength(12 * 2 * 3);
    expect(mesh!.box).toEqual([0, 0, 0, 1, 1, 1]);
    expect(mesh!.sphere[3]).toBeCloseTo(Math.sqrt(3) / 2);
  });

  it('skips edges above the triangle limit', () => {
    const [mesh] = prepareMeshes(parseMeshFile(cubeStl(), 'stl'), 11);
    expect(mesh!.edges).toBeUndefined();
    expect(mesh!.normal).toHaveLength(12 * 9);
  });

  it('drops meshes with no triangles', () => {
    expect(prepareMeshes([{ position: new Float32Array(0) }])).toEqual([]);
  });
});

describe('handleMeshRequest', () => {
  it('returns the meshes with their buffers to transfer', () => {
    const { reply, transfer } = handleMeshRequest({ kind: 'file', format: 'stl', bytes: cubeStl() });
    expect(reply.type).toBe('done');
    if (reply.type !== 'done') return;
    expect(transfer).toContain(reply.meshes[0]!.position.buffer);
    expect(transfer).toContain(reply.meshes[0]!.normal.buffer);
    expect(transfer).toContain(reply.meshes[0]!.edges!.buffer);
    expect(new Set(transfer).size).toBe(transfer.length);
  });

  it('reports damaged files instead of throwing', () => {
    // A binary STL header that promises a thousand triangles and holds none.
    const truncated = new Uint8Array(84);
    new DataView(truncated.buffer).setUint32(80, 1000, true);
    expect(handleMeshRequest({ kind: 'file', format: 'stl', bytes: truncated.buffer }).reply).toEqual({ type: 'failed', problem: 'unreadable' });
    expect(handleMeshRequest({ kind: 'file', format: '3mf', bytes: new ArrayBuffer(10) }).reply).toEqual({ type: 'failed', problem: 'unreadable' });
  });

  it('reports files with nothing to draw', () => {
    const name = 'an empty part with a name long enough to pass the binary check';
    const empty = new TextEncoder().encode(`solid ${name}\nendsolid ${name}\n`).buffer as ArrayBuffer;
    expect(handleMeshRequest({ kind: 'file', format: 'stl', bytes: empty }).reply).toEqual({ type: 'failed', problem: 'no-geometry' });
    expect(handleMeshRequest({ kind: 'meshes', meshes: [] }).reply).toEqual({ type: 'failed', problem: 'no-geometry' });
  });
});
