import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { makeThumbnail, THUMBNAIL_SIZE } from './index.js';
import { parse3mf, parseModel, parseObj, parseStl, UnreadableFile, type TriangleMesh } from './parse.js';
import { renderMesh } from './render.js';

const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const CUBE_FACES = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
  [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
];

function binaryStl(triangles: number[][][]): Uint8Array {
  const bytes = Buffer.alloc(84 + triangles.length * 50);
  bytes.write('solid but actually binary', 0);
  bytes.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, t) => triangle.flat().forEach((value, k) => bytes.writeFloatLE(value, 84 + t * 50 + 12 + k * 4)));
  return bytes;
}
const cubeTriangles = () => CUBE_FACES.map((face) => face.map((index) => CUBE_CORNERS[index]!));

/** Reads back a PNG's size and RGBA pixels (it's our own encoder: filter 0 on every row). */
function decodePng(png: Uint8Array) {
  const buffer = Buffer.from(png);
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const idat = buffer.indexOf('IDAT');
  const raw = inflateSync(buffer.subarray(idat + 4, idat + 4 + buffer.readUInt32BE(idat - 4)));
  const alphaAt = (x: number, y: number) => raw[y * (width * 4 + 1) + 1 + x * 4 + 3]!;
  return { width, height, alphaAt };
}

describe('parsing model files', () => {
  it('reads binary STL, even with a header that starts with "solid"', () => {
    const mesh = parseStl(binaryStl(cubeTriangles()));
    expect(mesh.indices.length).toBe(36);
    // The first triangle is corners 0, 2, 1; its second vertex is (1, 1, 0).
    expect([...mesh.positions.subarray(3, 6)]).toEqual([1, 1, 0]);
    expect(mesh.zUp).toBe(true);
  });

  it('reads ASCII STL', () => {
    const text = `solid cube\n${cubeTriangles()
      .map((triangle) => `facet normal 0 0 0\nouter loop\n${triangle.map((point) => `vertex ${point.join(' ')}`).join('\n')}\nendloop\nendfacet`)
      .join('\n')}\nendsolid cube`;
    expect(parseStl(strToU8(text)).indices.length).toBe(36);
  });

  it('rejects files that are not STL', () => {
    expect(() => parseStl(strToU8('not a model'))).toThrow(UnreadableFile);
  });

  it('reads OBJ quads and negative indices', () => {
    const mesh = parseObj('# a square\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nf 1/1 2/1 3/1 4/1\nf -4 -3 -2\n');
    expect([...mesh.indices]).toEqual([0, 1, 2, 0, 2, 3, 0, 1, 2]);
    expect(mesh.zUp).toBe(false);
  });

  it('reads 3MF objects placed by components and build transforms', () => {
    const vertices = CUBE_CORNERS.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('');
    const triangles = CUBE_FACES.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('');
    const model = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>
    <object id="2" type="model"><components><component objectid="1"/><component objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></components></object>
  </resources>
  <build><item objectid="2" transform="2 0 0 0 2 0 0 0 2 0 0 0"/></build>
</model>`;
    const mesh = parse3mf(zipSync({ '3D/3dmodel.model': strToU8(model), '[Content_Types].xml': strToU8('<Types/>') }));
    expect(mesh.indices.length).toBe(72);
    // The second cube is moved 10 along x, then everything is doubled.
    expect(Math.max(...mesh.positions.filter((_, index) => index % 3 === 0))).toBe(22);
  });

  it('reads STEP and IGES through OpenCascade', async () => {
    const testFiles = join(dirname(createRequire(import.meta.url).resolve('occt-import-js/package.json')), 'test', 'testfiles');
    const step = await parseModel(readFileSync(join(testFiles, 'simple-basic-cube', 'cube.stp')), 'step');
    expect(step.indices.length).toBeGreaterThanOrEqual(36);
    const iges = await parseModel(readFileSync(join(testFiles, 'cube-10x10mm', 'Cube 10x10.igs')), 'iges');
    expect(iges.indices.length).toBeGreaterThanOrEqual(36);
    await expect(parseModel(strToU8('ISO-10303-21; nonsense'), 'step')).rejects.toThrow(UnreadableFile);
  });
});

describe('rendering thumbnails', () => {
  it('draws the model in the middle on a transparent background', async () => {
    const { width, height, alphaAt } = decodePng(await makeThumbnail(binaryStl(cubeTriangles()), 'stl'));
    expect([width, height]).toEqual([THUMBNAIL_SIZE, THUMBNAIL_SIZE]);
    expect(alphaAt(THUMBNAIL_SIZE / 2, THUMBNAIL_SIZE / 2)).toBe(255);
    expect(alphaAt(2, 2)).toBe(0);
    expect(alphaAt(THUMBNAIL_SIZE - 3, THUMBNAIL_SIZE - 3)).toBe(0);
  });

  it('frames tiny and huge models the same way', () => {
    const scaled = (factor: number): TriangleMesh => {
      const mesh = parseStl(binaryStl(cubeTriangles()));
      return { ...mesh, positions: mesh.positions.map((value) => value * factor) };
    };
    const coverage = (pixels: Uint8Array) => pixels.filter((_, index) => index % 4 === 3 && pixels[index]! > 0).length;
    const small = coverage(renderMesh(scaled(0.001), 64));
    expect(small).toBeGreaterThan(64 * 64 * 0.3);
    expect(Math.abs(coverage(renderMesh(scaled(1e5), 64)) - small)).toBeLessThan(64 * 64 * 0.01);
  });

  it('draws the ink edges darker than the faces', () => {
    const pixels = renderMesh(parseStl(binaryStl(cubeTriangles())), 128);
    let darkest = 255;
    let lightest = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] !== 255) continue;
      darkest = Math.min(darkest, pixels[index]!);
      lightest = Math.max(lightest, pixels[index]!);
    }
    expect(darkest).toBeLessThan(90);
    expect(lightest).toBeGreaterThan(200);
  });
});
