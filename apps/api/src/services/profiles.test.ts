import { describe, expect, it } from 'vitest';
import { encodePng } from '../thumbnails/png.js';
import { avatarIntact, avatarType } from './profiles.js';

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
});
