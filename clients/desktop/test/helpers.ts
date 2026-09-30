import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestFor, MANIFEST_FILE, REQUIRED_FILES, SIGNATURE_FILE, signBytes } from '../src/shared/bundle.js';

export function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

/** A minimal signed bundle folder. */
export function makeBundle(dir: string, version: string, privateKey: string, shellMin = 1): string {
  mkdirSync(dir, { recursive: true });
  for (const file of REQUIRED_FILES) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), `// ${file} ${version}\n`);
  }
  const bytes = `${JSON.stringify(manifestFor(dir, version, shellMin), null, 2)}\n`;
  writeFileSync(join(dir, MANIFEST_FILE), bytes);
  writeFileSync(join(dir, SIGNATURE_FILE), signBytes(bytes, privateKey));
  return dir;
}
