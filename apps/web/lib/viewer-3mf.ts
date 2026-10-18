import { unzipSync } from 'three/addons/libs/fflate.module.js';
import type { RawMesh } from './viewer-protocol';

// A 3MF reader for the mesh worker. three.js's ThreeMFLoader needs DOMParser, which workers
// don't have, so this scans the model XML itself. It reads what a preview needs: each object's
// mesh, components (also from other model parts, as Bambu and Prusa files use), the build items
// and their transforms. Colours and materials are ignored, since the viewer draws one material.

/** A 3MF transform: m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32, applied to row vectors. */
type Transform = number[];

const IDENTITY: Transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

interface Component {
  objectId: string;
  path?: string;
  transform: Transform;
}

interface ModelObject {
  vertices: number[];
  triangles: number[];
  components: Component[];
}

interface ModelPart {
  objects: Map<string, ModelObject>;
  items: Component[];
}

/** `a` then `b`, as one transform. */
export function combine(a: Transform, b: Transform): Transform {
  const out = new Array<number>(12);
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = row === 3 ? b[9 + column]! : 0;
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k]! * b[k * 3 + column]!;
      out[row * 3 + column] = sum;
    }
  }
  return out;
}

function parseTransform(value: string | undefined): Transform {
  if (!value) return IDENTITY;
  const numbers = value.trim().split(/\s+/).map(Number);
  return numbers.length === 12 && numbers.every(Number.isFinite) ? numbers : IDENTITY;
}

const ATTRIBUTE = /([\w.-]+(?::[\w.-]+)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributes(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(ATTRIBUTE)) {
    // Drop any namespace prefix: "p:path" is the production extension's path.
    result[match[1]!.replace(/^[\w.-]+:/, '')] = match[2] ?? match[3] ?? '';
  }
  return result;
}

/** Reads one model part's objects and build items. Element names are matched without their namespace prefix. */
export function parseModel(xml: string): ModelPart {
  const objects = new Map<string, ModelObject>();
  const items: Component[] = [];
  let object: ModelObject | null = null;
  let inMesh = false;
  const tag = /<(\/?)(?:[\w.-]+:)?([\w.-]+)([^>]*)>/g;
  for (let match = tag.exec(xml); match; match = tag.exec(xml)) {
    const [, closing, name, rest = ''] = match;
    if (closing) {
      if (name === 'object') object = null;
      else if (name === 'mesh') inMesh = false;
      continue;
    }
    if (name === 'vertex' && object && inMesh) {
      const { x, y, z } = attributes(rest);
      object.vertices.push(Number(x), Number(y), Number(z));
    } else if (name === 'triangle' && object && inMesh) {
      const { v1, v2, v3 } = attributes(rest);
      object.triangles.push(Number(v1), Number(v2), Number(v3));
    } else if (name === 'object') {
      const { id } = attributes(rest);
      object = { vertices: [], triangles: [], components: [] };
      if (id !== undefined) objects.set(id, object);
      if (rest.trimEnd().endsWith('/')) object = null;
    } else if (name === 'mesh') {
      inMesh = !rest.trimEnd().endsWith('/');
    } else if (name === 'component' && object) {
      const { objectid, path, transform } = attributes(rest);
      if (objectid !== undefined) object.components.push({ objectId: objectid, path, transform: parseTransform(transform) });
    } else if (name === 'item') {
      const { objectid, path, transform } = attributes(rest);
      if (objectid !== undefined) items.push({ objectId: objectid, path, transform: parseTransform(transform) });
    }
  }
  return { objects, items };
}

/** The archive's root model part: the one its relationships name, else the first in 3D/. */
function rootModelPath(files: Record<string, Uint8Array>, decoder: TextDecoder): string | undefined {
  const rels = Object.keys(files).find((name) => /^_rels\/\.rels$/i.test(name));
  if (rels) {
    for (const match of decoder.decode(files[rels]).matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)>/g)) {
      const { Target: target, Type: type } = attributes(match[1] ?? '');
      if (target && (/3dmodel$/i.test(type ?? '') || /\.model$/i.test(target))) {
        const path = target.replace(/^\//, '');
        if (files[path]) return path;
      }
    }
  }
  return Object.keys(files).find((name) => /^3D\/[^/]+\.model$/i.test(name)) ?? Object.keys(files).find((name) => /\.model$/i.test(name));
}

/** Reads a 3MF archive into one mesh per placed object, in the build's coordinates (millimetres, Z up). */
export function read3mf(bytes: Uint8Array): RawMesh[] {
  // Only the model parts and relationships are inflated; thumbnails and textures are skipped.
  const files = unzipSync(bytes, { filter: (file) => /\.(model|rels)$/i.test(file.name) });
  const decoder = new TextDecoder();
  const root = rootModelPath(files, decoder);
  if (!root) throw new Error('This archive has no 3D model.');
  const parts = new Map<string, ModelPart>();
  const part = (path: string) => {
    const name = path.replace(/^\//, '');
    let model = parts.get(name);
    if (!model) {
      const file = files[name];
      model = file ? parseModel(decoder.decode(file)) : { objects: new Map(), items: [] };
      parts.set(name, model);
    }
    return model;
  };

  const meshes: RawMesh[] = [];
  const place = (path: string, objectId: string, transform: Transform, depth: number) => {
    const object = part(path).objects.get(objectId);
    if (!object || depth > 16) return;
    if (object.triangles.length > 0) meshes.push(placeMesh(object, transform));
    for (const component of object.components) {
      place(component.path ?? path, component.objectId, combine(component.transform, transform), depth + 1);
    }
  };
  for (const item of part(root).items) place(item.path ?? root, item.objectId, item.transform, 0);
  return meshes;
}

function placeMesh(object: ModelObject, t: Transform): RawMesh {
  const { vertices, triangles } = object;
  const position = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i]!;
    const y = vertices[i + 1]!;
    const z = vertices[i + 2]!;
    position[i] = x * t[0]! + y * t[3]! + z * t[6]! + t[9]!;
    position[i + 1] = x * t[1]! + y * t[4]! + z * t[7]! + t[10]!;
    position[i + 2] = x * t[2]! + y * t[5]! + z * t[8]! + t[11]!;
  }
  // Triangles that point past the vertex list are dropped rather than drawn as garbage.
  const count = vertices.length / 3;
  const valid = (vertex: number) => Number.isInteger(vertex) && vertex >= 0 && vertex < count;
  const index: number[] = [];
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i]!;
    const b = triangles[i + 1]!;
    const c = triangles[i + 2]!;
    if (valid(a) && valid(b) && valid(c)) index.push(a, b, c);
  }
  return { position, index: Uint32Array.from(index) };
}
