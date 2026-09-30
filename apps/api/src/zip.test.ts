import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipStream, type ZipEntry } from './zip.js';

const entry = (path: string, content: string): ZipEntry => {
  const bytes = Buffer.from(content);
  return { path, size: bytes.length, open: async () => [bytes.subarray(0, 3), bytes.subarray(3)] };
};

describe('release zip', () => {
  it('stores each file under its path, byte for byte', async () => {
    const zip = await buffer(zipStream([entry('robot-v2/Robot.SLDASM', 'assembly'), entry('robot-v2/parts/Ärm.SLDPRT', 'part with a longer body')]));
    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files)).toEqual(['robot-v2/Robot.SLDASM', 'robot-v2/parts/Ärm.SLDPRT']);
    expect(Buffer.from(files['robot-v2/parts/Ärm.SLDPRT']!).toString()).toBe('part with a longer body');
  });

  it('refuses a file whose bytes don’t match its recorded size', async () => {
    await expect(buffer(zipStream([{ path: 'a', size: 10, open: async () => [Buffer.from('short')] }]))).rejects.toThrow(/expected 10 bytes/);
  });

  // Python's zipfile reads ZIP64 and checks every CRC; skip where it isn't installed.
  const python = (() => {
    try {
      execFileSync('python3', ['--version']);
      return true;
    } catch {
      return false;
    }
  })();
  it.runIf(python)('writes ZIP64 records that other tools read, when sizes or offsets need them', async () => {
    const zip = await buffer(zipStream([entry('a.txt', 'first file'), entry('b.txt', 'second file'), entry('c.txt', 'third')], { zip64Threshold: 8 }));
    const dir = mkdtempSync(join(tmpdir(), 'zip64-'));
    writeFileSync(join(dir, 'test.zip'), zip);
    const out = execFileSync('python3', ['-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("|".join(n + "=" + z.read(n).decode() for n in z.namelist()))', join(dir, 'test.zip')]).toString().trim();
    expect(out).toBe('a.txt=first file|b.txt=second file|c.txt=third');
    expect(readFileSync(join(dir, 'test.zip')).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
  });
});
