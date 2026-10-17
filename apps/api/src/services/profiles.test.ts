import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng } from '../thumbnails/png.js';
import { avatarIntact, avatarProblem, avatarType } from './profiles.js';

/** A PNG chunk with its length and CRC. */
function chunk(name: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(name, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A PNG whose header says one size and whose pixel data inflates to `pixels`. */
function pngOf(width: number, height: number, pixels: Buffer, { colour = 6, interlace = 0 } = {}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colour;
  header[12] = interlace;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const png = encodePng(3, 2, new Uint8Array(24).fill(120));
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xab, 0xcd,
  0xff, 0xd9,
]);
/** RIFF header, WEBP, and a VP8L chunk of 5 bytes. */
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([18, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.from([5, 0, 0, 0]), Buffer.from([0x2f, 0, 0, 0, 0]), Buffer.from([0])]);

describe('avatar images', () => {
  it('accepts whole PNG, JPEG, and WebP files', () => {
    expect(avatarType(png)).toBe('image/png');
    expect(avatarIntact(png, 'image/png')).toBe(true);
    expect(avatarIntact(jpeg, 'image/jpeg')).toBe(true);
    expect(avatarType(webp)).toBe('image/webp');
    expect(avatarIntact(webp, 'image/webp')).toBe(true);
  });

  it('refuses files that only start like an image', () => {
    expect(avatarIntact(Buffer.concat([png.subarray(0, 8), Buffer.alloc(40, 7)]), 'image/png')).toBe(false);
    expect(avatarIntact(png.subarray(0, png.length - 12), 'image/png')).toBe(false);
    const flipped = Buffer.from(png);
    flipped[20] = flipped[20]! ^ 0xff;
    expect(avatarIntact(flipped, 'image/png')).toBe(false);
    expect(avatarIntact(jpeg.subarray(0, 12), 'image/jpeg')).toBe(false);
    expect(avatarIntact(Buffer.concat([jpeg.subarray(0, 2), Buffer.from('garbage!')]), 'image/jpeg')).toBe(false);
    expect(avatarIntact(webp.subarray(0, 14), 'image/webp')).toBe(false);
  });

  it('never inflates a PNG past the size its header declares', () => {
    // 64 MB of zeros compresses to about 64 KB; a 10x10 image needs 410 bytes.
    const bomb = pngOf(10, 10, Buffer.alloc(64 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const started = performance.now();
    expect(avatarProblem(bomb, 'image/png')).toBe('damaged');
    expect(performance.now() - started).toBeLessThan(500);
    // Too little data for the size declared is damaged too.
    expect(avatarProblem(pngOf(10, 10, Buffer.alloc(100)), 'image/png')).toBe('damaged');
  });

  it('refuses images whose pixels would be too big, before inflating anything', () => {
    expect(avatarProblem(pngOf(30_000, 30_000, Buffer.alloc(10)), 'image/png')).toBe('too_large');
    expect(avatarProblem(pngOf(2049, 2048, Buffer.alloc(10)), 'image/png')).toBe('too_large');
    // 2048 square RGBA fits exactly.
    expect(avatarProblem(pngOf(2048, 2048, Buffer.alloc(2048 * (1 + 2048 * 4))), 'image/png')).toBeNull();
  });

  it('counts interlaced and paletted PNGs by their real size', () => {
    // Adam7 on 3x3 RGB: the passes that land inside the image, each row with its filter byte.
    const rows = (w: number, h: number) => (w && h ? h * (1 + w * 3) : 0);
    const passes = [rows(1, 1), 0, rows(1, 0), rows(1, 1), rows(2, 1), rows(1, 2), rows(3, 1)];
    expect(avatarProblem(pngOf(3, 3, Buffer.alloc(passes.reduce((a, b) => a + b, 0)), { colour: 2, interlace: 1 }), 'image/png')).toBeNull();
    expect(avatarProblem(pngOf(4, 2, Buffer.alloc(2 * (1 + 4)), { colour: 3 }), 'image/png')).toBeNull();
  });

  it('accepts JPEGs with bytes after the end-of-image marker', () => {
    expect(avatarIntact(Buffer.concat([jpeg, Buffer.alloc(32)]), 'image/jpeg')).toBe(true);
    expect(avatarIntact(Buffer.concat([jpeg, Buffer.from('SEFH trailer from a phone')]), 'image/jpeg')).toBe(true);
    // But a scan that never ends is still damaged.
    expect(avatarIntact(jpeg.subarray(0, jpeg.length - 2), 'image/jpeg')).toBe(false);
  });
});
