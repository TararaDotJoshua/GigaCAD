import type { TriangleMesh } from './parse.js';

/**
 * A small software renderer for thumbnails, so the server needs no GPU. It draws like the
 * web viewer and the site's part line art: a pale solid with ink edges, seen from an
 * isometric angle, on a transparent background.
 */

export const THUMBNAIL_SIZE = 512;
/** Rendered this many times larger, then scaled down, for smooth edges. */
const SUPERSAMPLE = 2;

const MIST: Vec = [235, 235, 237];
const GROUND: Vec = [184, 194, 191];
const INK: Vec = [10, 41, 34];
const INK_OPACITY = 0.7;
/** Edges between faces meeting at more than this angle are drawn (the viewer uses the same). */
const EDGE_COS = Math.cos((30 * Math.PI) / 180);

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec): Vec => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
};

/** Returns RGBA pixels, `size` by `size`. */
export function renderMesh(mesh: TriangleMesh, size = THUMBNAIL_SIZE): Uint8Array {
  const W = size * SUPERSAMPLE;
  const vertexCount = mesh.positions.length / 3;

  // Camera: looking at the model from (1, 0.8, 1), Y up, like the viewer.
  const toCamera = normalize([1, 0.8, 1]);
  const right = normalize(cross([-toCamera[0], -toCamera[1], -toCamera[2]], [0, 1, 0]));
  const up = cross(right, [-toCamera[0], -toCamera[1], -toCamera[2]]);
  const light = normalize([toCamera[0] - right[0] * 0.4 + up[0] * 0.7, toCamera[1] - right[1] * 0.4 + up[1] * 0.7, toCamera[2] - right[2] * 0.4 + up[2] * 0.7]);

  // World positions (Y up), and their screen positions.
  const world = new Float64Array(vertexCount * 3);
  const screen = new Float64Array(vertexCount * 3);
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    const [x, y, z] = [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
    const p: Vec = mesh.zUp ? [x, z, -y] : [x, y, z];
    world.set(p, i * 3);
    const [sx, sy, sz] = [dot(p, right), dot(p, up), dot(p, toCamera)];
    screen[i * 3] = sx;
    screen[i * 3 + 1] = sy;
    screen[i * 3 + 2] = sz;
  }
  // Only vertices that are part of a triangle count toward the framing.
  for (const index of mesh.indices) {
    const [sx, sy] = [screen[index * 3]!, screen[index * 3 + 1]!];
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const padding = W * 0.07;
  const scale = (W - 2 * padding) / span;
  const [centerX, centerY] = [(minX + maxX) / 2, (minY + maxY) / 2];
  for (let i = 0; i < vertexCount; i++) {
    screen[i * 3] = W / 2 + (screen[i * 3]! - centerX) * scale;
    screen[i * 3 + 1] = W / 2 - (screen[i * 3 + 1]! - centerY) * scale;
    screen[i * 3 + 2] = screen[i * 3 + 2]! * scale; // in pixels; larger is nearer
  }

  const depth = new Float32Array(W * W).fill(-Infinity);
  const color = new Uint8ClampedArray(W * W * 3);
  const ink = new Float32Array(W * W);
  const triangleCount = mesh.indices.length / 3;
  const normals = new Float32Array(triangleCount * 3);

  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    const pa: Vec = [world[a * 3]!, world[a * 3 + 1]!, world[a * 3 + 2]!];
    const pb: Vec = [world[b * 3]!, world[b * 3 + 1]!, world[b * 3 + 2]!];
    const pc: Vec = [world[c * 3]!, world[c * 3 + 1]!, world[c * 3 + 2]!];
    let normal = normalize(cross([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]));
    normals.set(normal, t * 3);
    if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) continue;
    // Drawn from both sides, since exported meshes often have flipped faces.
    if (dot(normal, toCamera) < 0) normal = [-normal[0], -normal[1], -normal[2]];

    const sky = 0.5 + 0.5 * normal[1];
    const diffuse = Math.max(0, dot(normal, light));
    const shade: Vec = [0, 1, 2].map((k) => {
      const ambient = GROUND[k]! + (255 - GROUND[k]!) * sky;
      return (MIST[k]! / 255) * (ambient * 0.68 + 255 * 0.42 * diffuse);
    }) as Vec;

    const [x0, y0, z0] = [screen[a * 3]!, screen[a * 3 + 1]!, screen[a * 3 + 2]!];
    const [x1, y1, z1] = [screen[b * 3]!, screen[b * 3 + 1]!, screen[b * 3 + 2]!];
    const [x2, y2, z2] = [screen[c * 3]!, screen[c * 3 + 1]!, screen[c * 3 + 2]!];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) continue;
    const left = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const rightEdge = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const top = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const bottom = Math.min(W - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = top; y <= bottom; y++) {
      const py = y + 0.5;
      for (let x = left; x <= rightEdge; x++) {
        const px = x + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const pixel = y * W + x;
        if (z <= depth[pixel]!) continue;
        depth[pixel] = z;
        color[pixel * 3] = shade[0];
        color[pixel * 3 + 1] = shade[1];
        color[pixel * 3 + 2] = shade[2];
      }
    }
  }

  drawFeatureEdges(mesh, screen, normals, depth, ink, W);
  drawOutlines(depth, ink, W);
  return downsample(color, depth, ink, W, size);
}

/** Welds vertices by position, so triangles that share an edge can be found. */
function weld(mesh: TriangleMesh): Uint32Array {
  const count = mesh.positions.length / 3;
  let extent = 0;
  for (const value of mesh.positions) extent = Math.max(extent, Math.abs(value));
  const step = Math.max(extent * 1e-6, 1e-12);
  const ids = new Map<string, number>();
  const welded = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(mesh.positions[i * 3]! / step)},${Math.round(mesh.positions[i * 3 + 1]! / step)},${Math.round(mesh.positions[i * 3 + 2]! / step)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    welded[i] = id;
  }
  return welded;
}

/** Ink along creases sharper than 30°, and along open edges. */
function drawFeatureEdges(mesh: TriangleMesh, screen: Float64Array, normals: Float32Array, depth: Float32Array, ink: Float32Array, W: number) {
  const welded = weld(mesh);
  let weldedCount = 0;
  for (const id of welded) weldedCount = Math.max(weldedCount, id + 1);
  // Per edge: the first triangle seen with it, or -1 once it's settled as a smooth edge.
  const edges = new Map<number, number>();
  const feature: [number, number][] = [];
  const triangleCount = mesh.indices.length / 3;
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.indices[t * 3 + k]!;
      const b = mesh.indices[t * 3 + ((k + 1) % 3)]!;
      const [wa, wb] = [welded[a]!, welded[b]!];
      if (wa === wb) continue;
      const key = Math.min(wa, wb) * weldedCount + Math.max(wa, wb);
      const first = edges.get(key);
      if (first === undefined) {
        edges.set(key, t);
      } else if (first >= 0) {
        const cos = normals[first * 3]! * normals[t * 3]! + normals[first * 3 + 1]! * normals[t * 3 + 1]! + normals[first * 3 + 2]! * normals[t * 3 + 2]!;
        if (cos < EDGE_COS) feature.push([a, b]);
        edges.set(key, -1);
      }
    }
  }
  // Edges only one triangle uses are open boundaries; draw them too.
  for (const [key, first] of edges) {
    if (first < 0) continue;
    const [lo, hi] = [Math.floor(key / weldedCount), key % weldedCount];
    for (let k = 0; k < 3; k++) {
      const a = mesh.indices[first * 3 + k]!;
      const b = mesh.indices[first * 3 + ((k + 1) % 3)]!;
      if (Math.min(welded[a]!, welded[b]!) === lo && Math.max(welded[a]!, welded[b]!) === hi) {
        feature.push([a, b]);
        break;
      }
    }
  }

  const radius = 0.7 * SUPERSAMPLE;
  // Lines show through the surface they lie on, but not through anything in front of it.
  const bias = 2 * SUPERSAMPLE;
  for (const [a, b] of feature) {
    const [x0, y0, z0] = [screen[a * 3]!, screen[a * 3 + 1]!, screen[a * 3 + 2]!];
    const [x1, y1, z1] = [screen[b * 3]!, screen[b * 3 + 1]!, screen[b * 3 + 2]!];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const [x, y, z] = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f];
      for (let py = Math.floor(y - radius); py <= Math.ceil(y + radius); py++) {
        if (py < 0 || py >= W) continue;
        for (let px = Math.floor(x - radius); px <= Math.ceil(x + radius); px++) {
          if (px < 0 || px >= W) continue;
          const pixel = py * W + px;
          const d = depth[pixel]!;
          if (d === -Infinity || z < d - bias) continue;
          const coverage = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(px + 0.5 - x, py + 0.5 - y)));
          if (coverage > ink[pixel]!) ink[pixel] = coverage;
        }
      }
    }
  }
}

/** Ink where the model meets the background, and where one part passes in front of another. */
function drawOutlines(depth: Float32Array, ink: Float32Array, W: number) {
  const gap = W * 0.03;
  const reach = SUPERSAMPLE;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const d = depth[y * W + x]!;
      if (d === -Infinity) continue;
      let edge = false;
      for (let dy = -reach; dy <= reach && !edge; dy++) {
        for (let dx = -reach; dx <= reach && !edge; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          const neighbor = nx < 0 || ny < 0 || nx >= W || ny >= W ? -Infinity : depth[ny * W + nx]!;
          // Only the nearer side of a depth jump is inked, so the line sits on the front part.
          if (neighbor === -Infinity || d - neighbor > gap) edge = true;
        }
      }
      if (edge) ink[y * W + x] = 1;
    }
  }
}

function downsample(color: Uint8ClampedArray, depth: Float32Array, ink: Float32Array, W: number, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b, covered] = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const pixel = (y * SUPERSAMPLE + sy) * W + (x * SUPERSAMPLE + sx);
          if (depth[pixel] === -Infinity) continue;
          const alpha = ink[pixel]! * INK_OPACITY;
          r += color[pixel * 3]! * (1 - alpha) + INK[0] * alpha;
          g += color[pixel * 3 + 1]! * (1 - alpha) + INK[1] * alpha;
          b += color[pixel * 3 + 2]! * (1 - alpha) + INK[2] * alpha;
          covered++;
        }
      }
      if (covered === 0) continue;
      const offset = (y * size + x) * 4;
      out[offset] = Math.round(r / covered);
      out[offset + 1] = Math.round(g / covered);
      out[offset + 2] = Math.round(b / covered);
      out[offset + 3] = Math.round((covered / samples) * 255);
    }
  }
  return out;
}
