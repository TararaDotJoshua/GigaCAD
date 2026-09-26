import { createRequire } from 'node:module';
import { strFromU8, unzipSync } from 'fflate';

/** Model files drawn from their geometry. */
export type MeshFormat = 'stl' | 'obj' | '3mf' | 'step' | 'iges';

/** Triangles as positions (xyz per vertex) and indices (three per triangle). */
export interface TriangleMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** OBJ is Y-up; the CAD formats are Z-up and get turned upright before drawing. */
  readonly zUp: boolean;
}

export class UnreadableFile extends Error {}

export async function parseModel(bytes: Uint8Array, format: MeshFormat): Promise<TriangleMesh> {
  switch (format) {
    case 'stl':
      return parseStl(bytes);
    case 'obj':
      return parseObj(new TextDecoder().decode(bytes));
    case '3mf':
      return parse3mf(bytes);
    case 'step':
    case 'iges':
      return parseCad(bytes, format);
  }
}

function sequential(count: number): Uint32Array {
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  return indices;
}

export function parseStl(bytes: Uint8Array): TriangleMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Binary STL is an 80-byte header, a triangle count, and 50 bytes per triangle. Some
  // binary files start their header with "solid" too, so the size decides.
  const count = bytes.byteLength >= 84 ? view.getUint32(80, true) : -1;
  if (count >= 0 && 84 + count * 50 === bytes.byteLength) {
    const positions = new Float32Array(count * 9);
    for (let t = 0; t < count; t++) {
      const offset = 84 + t * 50 + 12;
      for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(offset + k * 4, true);
    }
    return { positions, indices: sequential(count * 3), zUp: true };
  }
  const text = new TextDecoder().decode(bytes);
  const values: number[] = [];
  for (const match of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) values.push(Number(match[1]), Number(match[2]), Number(match[3]));
  if (values.length === 0 || values.length % 9 !== 0 || values.some((value) => !Number.isFinite(value))) {
    throw new UnreadableFile('This STL file couldn’t be read.');
  }
  return { positions: Float32Array.from(values), indices: sequential(values.length / 3), zUp: true };
}

export function parseObj(text: string): TriangleMesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      vertices.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const count = vertices.length / 3;
      // "f 1/2/3 4//6 -1": the first number is the vertex; negatives count back from the end.
      const corners = parts.slice(1).map((part) => {
        const index = Number.parseInt(part, 10);
        return index < 0 ? count + index : index - 1;
      });
      if (corners.some((corner) => !(corner >= 0 && corner < count))) continue;
      for (let i = 1; i + 1 < corners.length; i++) indices.push(corners[0]!, corners[i]!, corners[i + 1]!);
    }
  }
  if (indices.length === 0 || vertices.some((value) => !Number.isFinite(value))) throw new UnreadableFile('This OBJ file has no faces to show.');
  return { positions: Float32Array.from(vertices), indices: Uint32Array.from(indices), zUp: false };
}

type Matrix = readonly number[];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** 3MF transforms are 3x4, applied to row vectors: x' = x*m00 + y*m10 + z*m20 + m30. */
function parseMatrix(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  const numbers = value.trim().split(/\s+/).map(Number);
  return numbers.length === 12 && numbers.every(Number.isFinite) ? numbers : IDENTITY;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  // Apply a, then b.
  const out: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = row === 3 ? b[9 + col]! : 0;
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k]! * b[k * 3 + col]!;
      out.push(sum);
    }
  }
  return out;
}

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

export function parse3mf(bytes: Uint8Array): TriangleMesh {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name.toLowerCase().endsWith('.model') });
  } catch {
    throw new UnreadableFile('This 3MF file couldn’t be opened.');
  }
  const modelName = Object.keys(files).find((name) => name.toLowerCase() === '3d/3dmodel.model') ?? Object.keys(files)[0];
  if (!modelName) throw new UnreadableFile('This 3MF file has no model in it.');
  const xml = strFromU8(files[modelName]!);

  interface ObjectDef {
    vertices: number[];
    triangles: number[];
    components: { id: string; transform: Matrix }[];
  }
  const objects = new Map<string, ObjectDef>();
  // Tags may carry a namespace prefix, like <m:object>.
  for (const match of xml.matchAll(/<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/g)) {
    const id = attribute(match[1]!, 'id');
    if (!id) continue;
    const body = match[2]!;
    const vertices: number[] = [];
    for (const vertex of body.matchAll(/<(?:\w+:)?vertex\b([^>]*)\/?>/g)) {
      vertices.push(Number(attribute(vertex[1]!, 'x')), Number(attribute(vertex[1]!, 'y')), Number(attribute(vertex[1]!, 'z')));
    }
    const triangles: number[] = [];
    for (const triangle of body.matchAll(/<(?:\w+:)?triangle\b([^>]*)\/?>/g)) {
      triangles.push(Number(attribute(triangle[1]!, 'v1')), Number(attribute(triangle[1]!, 'v2')), Number(attribute(triangle[1]!, 'v3')));
    }
    const components = [...body.matchAll(/<(?:\w+:)?component\b([^>]*)\/?>/g)].flatMap((component) => {
      const target = attribute(component[1]!, 'objectid');
      return target ? [{ id: target, transform: parseMatrix(attribute(component[1]!, 'transform')) }] : [];
    });
    objects.set(id, { vertices, triangles, components });
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const place = (id: string, transform: Matrix, depth: number) => {
    const object = objects.get(id);
    if (!object || depth > 16) return;
    const base = positions.length / 3;
    const count = object.vertices.length / 3;
    for (let i = 0; i < count; i++) {
      const [x, y, z] = [object.vertices[i * 3]!, object.vertices[i * 3 + 1]!, object.vertices[i * 3 + 2]!];
      positions.push(
        x * transform[0]! + y * transform[3]! + z * transform[6]! + transform[9]!,
        x * transform[1]! + y * transform[4]! + z * transform[7]! + transform[10]!,
        x * transform[2]! + y * transform[5]! + z * transform[8]! + transform[11]!,
      );
    }
    for (let i = 0; i + 2 < object.triangles.length; i += 3) {
      const [a, b, c] = [object.triangles[i]!, object.triangles[i + 1]!, object.triangles[i + 2]!];
      if (a < count && b < count && c < count && a >= 0 && b >= 0 && c >= 0) indices.push(base + a, base + b, base + c);
    }
    for (const component of object.components) place(component.id, multiply(component.transform, transform), depth + 1);
  };

  const build = /<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/.exec(xml)?.[1] ?? '';
  const items = [...build.matchAll(/<(?:\w+:)?item\b([^>]*)\/?>/g)];
  if (items.length > 0) {
    for (const item of items) {
      const id = attribute(item[1]!, 'objectid');
      if (id) place(id, parseMatrix(attribute(item[1]!, 'transform')), 0);
    }
  } else {
    for (const id of objects.keys()) place(id, IDENTITY, 0);
  }
  if (indices.length === 0 || positions.some((value) => !Number.isFinite(value))) throw new UnreadableFile('This 3MF file has no geometry to show.');
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), zUp: true };
}

interface OcctResult {
  success: boolean;
  meshes: { attributes: { position: { array: number[] } }; index?: { array: number[] } }[];
}
interface Occt {
  ReadStepFile(bytes: Uint8Array, params: null): OcctResult;
  ReadIgesFile(bytes: Uint8Array, params: null): OcctResult;
}

let occt: Promise<Occt> | undefined;

/** STEP and IGES are tessellated by OpenCascade (WebAssembly), loaded on first use. */
async function parseCad(bytes: Uint8Array, format: 'step' | 'iges'): Promise<TriangleMesh> {
  occt ??= (createRequire(import.meta.url)('occt-import-js') as () => Promise<Occt>)();
  const reader = await occt;
  const result = format === 'step' ? reader.ReadStepFile(bytes, null) : reader.ReadIgesFile(bytes, null);
  if (!result.success) throw new UnreadableFile(`This ${format.toUpperCase()} file couldn’t be read.`);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const mesh of result.meshes) {
    const base = positions.length / 3;
    const points = mesh.attributes.position.array;
    for (const value of points) positions.push(value);
    const order = mesh.index?.array ?? [...Array(points.length / 3).keys()];
    for (const index of order) indices.push(base + index);
  }
  if (indices.length === 0) throw new UnreadableFile(`This ${format.toUpperCase()} file has no solid geometry to show.`);
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), zUp: true };
}
