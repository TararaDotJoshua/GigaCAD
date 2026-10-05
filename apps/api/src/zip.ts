import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

/**
 * A streaming ZIP writer for release downloads. Files are stored, not compressed: CAD
 * formats are mostly compressed already, and storing keeps the server's work to a CRC.
 * Sizes are known up front (from the blobs table) but CRCs aren't, so each entry ends in
 * a data descriptor. ZIP64 records are written only when a size or offset needs them, so
 * ordinary archives open in every unzip tool.
 */

export interface ZipEntry {
  /** Path inside the archive, with `/` separators. */
  readonly path: string;
  readonly size: number;
  /** Opens the entry's bytes when the writer reaches it. */
  readonly open: () => Promise<AsyncIterable<Uint8Array> | Iterable<Uint8Array>>;
}

const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
// Bit 3: sizes and CRC follow in a data descriptor. Bit 11: names are UTF-8.
const FLAGS = 0x0808;

interface Written {
  readonly name: Buffer;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
  readonly zip64: boolean;
}

/** DOS date and time fields for `date`, which ZIP stores in local time without a zone. */
function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function u64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export function zipStream(entries: readonly ZipEntry[], options: { modified?: Date; zip64Threshold?: number } = {}): Readable {
  const { time, date } = dosTime(options.modified ?? new Date());
  // Tests lower this to exercise the ZIP64 records without writing gigabytes.
  const limit = options.zip64Threshold ?? MAX_32;

  async function* generate(): AsyncGenerator<Buffer> {
    const written: Written[] = [];
    let offset = 0;

    for (const entry of entries) {
      const name = Buffer.from(entry.path, 'utf8');
      const zip64 = entry.size >= limit || offset >= limit;
      const extra = zip64 ? Buffer.concat([Buffer.from([0x01, 0x00, 16, 0x00]), u64(entry.size), u64(entry.size)]) : Buffer.alloc(0);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(zip64 ? 45 : 20, 4);
      header.writeUInt16LE(FLAGS, 6);
      header.writeUInt16LE(0, 8); // stored
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(date, 12);
      header.writeUInt32LE(0, 14); // CRC, in the data descriptor
      header.writeUInt32LE(zip64 ? MAX_32 : entry.size, 18);
      header.writeUInt32LE(zip64 ? MAX_32 : entry.size, 22);
      header.writeUInt16LE(name.length, 26);
      header.writeUInt16LE(extra.length, 28);
      yield Buffer.concat([header, name, extra]);

      let crc = 0;
      let size = 0;
      for await (const chunk of await entry.open()) {
        crc = crc32(chunk, crc);
        size += chunk.byteLength;
        yield Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      }
      if (size !== entry.size) throw new Error(`${entry.path}: expected ${entry.size} bytes, read ${size}`);

      const descriptor = Buffer.alloc(zip64 ? 24 : 16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      if (zip64) {
        descriptor.writeBigUInt64LE(BigInt(size), 8);
        descriptor.writeBigUInt64LE(BigInt(size), 16);
      } else {
        descriptor.writeUInt32LE(size, 8);
        descriptor.writeUInt32LE(size, 12);
      }
      yield descriptor;

      written.push({ name, crc, size, offset, zip64 });
      offset += header.length + name.length + extra.length + size + descriptor.length;
    }

    const directoryOffset = offset;
    let directorySize = 0;
    for (const file of written) {
      const bigSize = file.size >= limit;
      const bigOffset = file.offset >= limit;
      const fields = [...(bigSize ? [u64(file.size), u64(file.size)] : []), ...(bigOffset ? [u64(file.offset)] : [])];
      const extra = fields.length ? Buffer.concat([Buffer.from([0x01, 0x00, fields.length * 8, 0x00]), ...fields]) : Buffer.alloc(0);
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(file.zip64 || fields.length ? 45 : 20, 4); // made by
      header.writeUInt16LE(file.zip64 || fields.length ? 45 : 20, 6); // needed
      header.writeUInt16LE(FLAGS, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(time, 12);
      header.writeUInt16LE(date, 14);
      header.writeUInt32LE(file.crc, 16);
      header.writeUInt32LE(bigSize ? MAX_32 : file.size, 20);
      header.writeUInt32LE(bigSize ? MAX_32 : file.size, 24);
      header.writeUInt16LE(file.name.length, 28);
      header.writeUInt16LE(extra.length, 30);
      header.writeUInt32LE(bigOffset ? MAX_32 : file.offset, 42);
      const record = Buffer.concat([header, file.name, extra]);
      directorySize += record.length;
      yield record;
    }

    const zip64End = written.length >= MAX_16 || directoryOffset >= limit || directorySize >= limit;
    if (zip64End) {
      const end64 = Buffer.alloc(56);
      end64.writeUInt32LE(0x06064b50, 0);
      end64.writeBigUInt64LE(44n, 4);
      end64.writeUInt16LE(45, 12);
      end64.writeUInt16LE(45, 14);
      end64.writeBigUInt64LE(BigInt(written.length), 24);
      end64.writeBigUInt64LE(BigInt(written.length), 32);
      end64.writeBigUInt64LE(BigInt(directorySize), 40);
      end64.writeBigUInt64LE(BigInt(directoryOffset), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeBigUInt64LE(BigInt(directoryOffset + directorySize), 8);
      locator.writeUInt32LE(1, 16);
      yield Buffer.concat([end64, locator]);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(zip64End ? MAX_16 : written.length, 8);
    end.writeUInt16LE(zip64End ? MAX_16 : written.length, 10);
    end.writeUInt32LE(zip64End ? MAX_32 : directorySize, 12);
    end.writeUInt32LE(zip64End ? MAX_32 : directoryOffset, 16);
    yield end;
  }

  return Readable.from(generate(), { objectMode: false });
}
