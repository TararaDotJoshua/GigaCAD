import CFB from 'cfb';
import { inflateRawSync } from 'node:zlib';
import { UnreadableFile } from './parse.js';
import { decodePng, type Image } from './png.js';

/**
 * SolidWorks saves a picture of the model in every part, assembly, and drawing, taken
 * from the view on screen at the time. It is read here without SolidWorks. Files from
 * 2015 on are a series of compressed chunks; older ones are OLE compound files.
 * The chunk layout follows openswx (MIT), github.com/schwitters/openswx.
 */

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const CHUNK_MARKER = Buffer.from([0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
const CHUNK_HEADER = 0x1e;
/** Chunks whose first field is at least this carry their data inline. */
const INLINE_THRESHOLD = 65536;

/** Picks the model's own preview; each configuration may also have one ("Config-1-PreviewPNG"). */
function choosePreview(streams: Map<string, Uint8Array>): Uint8Array | undefined {
  return streams.get('PreviewPNG') ?? [...streams].find(([name]) => name.endsWith('PreviewPNG'))?.[1];
}

function modernStreams(data: Buffer): Map<string, Uint8Array> {
  // Stream names are obfuscated by rotating each byte left by a key stored in the header.
  const key = data[7]! & 7;
  const rotate = (byte: number) => ((byte << key) | (byte >> (8 - key))) & 0xff;
  const streams = new Map<string, Uint8Array>();
  let position = 0;
  for (;;) {
    const marker = data.indexOf(CHUNK_MARKER, position);
    if (marker < 0) break;
    const start = marker - 4;
    position = marker + CHUNK_MARKER.length;
    if (start < 0 || start + CHUNK_HEADER > data.length) continue;
    const inline = data.readUInt32LE(start + 0x0e) >= INLINE_THRESHOLD;
    const compressed = data.readUInt32LE(start + 0x12);
    const nameLength = data.readUInt32LE(start + 0x1a);
    const nameEnd = start + CHUNK_HEADER + nameLength;
    if (nameLength === 0 || nameLength > 512 || nameEnd + compressed > data.length) continue;
    const name = String.fromCharCode(...data.subarray(start + CHUNK_HEADER, nameEnd).map(rotate));
    if (!/^[\x20-\x7e]+$/.test(name) || !inline || compressed === 0) continue;
    // Only previews are unpacked; the rest of the file is never read.
    if (name.endsWith('PreviewPNG') && !streams.has(name)) {
      try {
        streams.set(name, inflateRawSync(data.subarray(nameEnd, nameEnd + compressed)));
      } catch {
        // A damaged chunk; keep looking.
      }
    }
    position = nameEnd + compressed;
  }
  return streams;
}

function oleStreams(data: Buffer): Map<string, Uint8Array> {
  const container = CFB.read(data, { type: 'buffer' });
  const streams = new Map<string, Uint8Array>();
  container.FileIndex.forEach((entry) => {
    if (entry.type === 2 && entry.name.endsWith('PreviewPNG') && entry.content) streams.set(entry.name, Uint8Array.from(entry.content as ArrayLike<number>));
  });
  return streams;
}

/** The PNG preview inside a SolidWorks file. */
export function readSolidWorksPreview(bytes: Uint8Array): Image {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let streams: Map<string, Uint8Array>;
  try {
    streams = OLE_MAGIC.every((byte, index) => data[index] === byte) ? oleStreams(data) : modernStreams(data);
  } catch {
    throw new UnreadableFile('This SolidWorks file couldn’t be read.');
  }
  const png = choosePreview(streams);
  const image = png && decodePng(png);
  if (!image) throw new UnreadableFile('This SolidWorks file has no preview picture. Saving it in SolidWorks adds one.');
  return image;
}

/**
 * Turns a preview into a thumbnail like the rendered ones: the white background around the
 * model made transparent (white faces inside it stay), cropped, and centered in a square.
 */
export function fitPreview(image: Image, size: number): Uint8Array {
  const { width, height, rgba } = image;
  const background = new Uint8Array(width * height);
  const isWhite = (pixel: number) => rgba[pixel * 4 + 3]! < 16 || Math.min(rgba[pixel * 4]!, rgba[pixel * 4 + 1]!, rgba[pixel * 4 + 2]!) >= 245;
  // Flood fill from the border, so only white that touches the edge counts as background.
  const stack: number[] = [];
  const visit = (pixel: number) => {
    if (!background[pixel] && isWhite(pixel)) {
      background[pixel] = 1;
      stack.push(pixel);
    }
  };
  for (let x = 0; x < width; x++) [visit(x), visit((height - 1) * width + x)];
  for (let y = 0; y < height; y++) [visit(y * width), visit(y * width + width - 1)];
  while (stack.length > 0) {
    const pixel = stack.pop()!;
    const [x, y] = [pixel % width, Math.floor(pixel / width)];
    if (x > 0) visit(pixel - 1);
    if (x < width - 1) visit(pixel + 1);
    if (y > 0) visit(pixel - width);
    if (y < height - 1) visit(pixel + width);
  }

  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (background[y * width + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new UnreadableFile('This SolidWorks file’s preview picture is blank.');

  // Fit the model into the square with the same margin as rendered thumbnails. Small
  // previews are enlarged at most 3x, past which they only get blurry.
  const [cropWidth, cropHeight] = [right - left + 1, bottom - top + 1];
  const scale = Math.min((size * 0.86) / cropWidth, (size * 0.86) / cropHeight, 3);
  const [offsetX, offsetY] = [(size - cropWidth * scale) / 2, (size - cropHeight * scale) / 2];
  const out = new Uint8Array(size * size * 4);
  const sample = (x: number, y: number, channel: number) => {
    const pixel = y * width + x;
    const alpha = background[pixel] ? 0 : rgba[pixel * 4 + 3]! / 255;
    return channel === 3 ? alpha : rgba[pixel * 4 + channel]! * alpha;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Bilinear sampling in premultiplied color, so the transparent edge doesn't bleed white.
      const sx = left + (x + 0.5 - offsetX) / scale - 0.5;
      const sy = top + (y + 0.5 - offsetY) / scale - 0.5;
      if (sx < left - 0.5 || sy < top - 0.5 || sx > right + 0.5 || sy > bottom + 0.5) continue;
      const x0 = Math.max(left, Math.min(right, Math.floor(sx)));
      const y0 = Math.max(top, Math.min(bottom, Math.floor(sy)));
      const x1 = Math.min(right, x0 + 1);
      const y1 = Math.min(bottom, y0 + 1);
      const [fx, fy] = [Math.max(0, Math.min(1, sx - x0)), Math.max(0, Math.min(1, sy - y0))];
      const mix = (channel: number) =>
        (sample(x0, y0, channel) * (1 - fx) + sample(x1, y0, channel) * fx) * (1 - fy) +
        (sample(x0, y1, channel) * (1 - fx) + sample(x1, y1, channel) * fx) * fy;
      const alpha = mix(3);
      if (alpha <= 0) continue;
      const offset = (y * size + x) * 4;
      out[offset] = Math.round(mix(0) / alpha);
      out[offset + 1] = Math.round(mix(1) / alpha);
      out[offset + 2] = Math.round(mix(2) / alpha);
      out[offset + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}
