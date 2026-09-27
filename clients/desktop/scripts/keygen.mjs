// Makes the Ed25519 key pair that signs code bundles and update manifests.
//
//   node scripts/keygen.mjs [private-key-file]   (default ~/.config/gigacad/desktop-update-key.pem)
//
// Then: paste the printed public key into src/bootstrap/publicKey.ts, store the private key as
// the DESKTOP_UPDATE_KEY secret (`gh secret set DESKTOP_UPDATE_KEY < <file>`), and back it up.
// Losing it means shipping a new DMG to change keys. Never commit it.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const file = process.argv[2] ?? join(homedir(), '.config', 'gigacad', 'desktop-update-key.pem');
if (existsSync(file)) {
  console.error(`${file} already exists. Replacing the key locks out every installed copy until they get a new DMG.`);
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
writeFileSync(file.replace(/\.pem$/, '.pub.pem'), pub);
console.log(`Private key: ${file}\n\nPublic key for src/bootstrap/publicKey.ts:\n\n${pub}`);
