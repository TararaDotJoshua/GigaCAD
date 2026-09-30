/**
 * Packs PNG images into a Windows .ico file. Since Windows Vista an .ico may hold PNG data
 * directly, so no image decoding is needed: a 6-byte header, a 16-byte entry per image, then the
 * PNGs. Sizes of 256 and up are written as 0, which the format uses to mean 256.
 */
export function pngToIco(images: readonly { readonly size: number; readonly png: Buffer }[]): Buffer {
  if (images.length === 0) throw new Error('An .ico needs at least one image');
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('pngToIco needs PNG data');
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The sizes File Explorer asks for, from list view up to extra large icons. */
export const ICO_SIZES = [16, 32, 48, 256] as const;
