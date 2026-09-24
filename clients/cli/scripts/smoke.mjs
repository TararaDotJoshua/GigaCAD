// Packs @gigacad/cli like `pnpm publish` would, installs the tarball into a scratch project,
// and runs the installed `giga` to prove the package works on its own.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'giga-smoke-'));
const windows = process.platform === 'win32';

function check(condition, message) {
  if (!condition) {
    console.error(`smoke test failed: ${message}`);
    process.exit(1);
  }
}

function pnpm(args, cwd) {
  // pnpm comes from corepack; fall back to it when pnpm itself isn't on PATH.
  const direct = spawnSync('pnpm', args, { cwd, encoding: 'utf8', shell: windows });
  if (!direct.error) {
    check(direct.status === 0, `pnpm ${args.join(' ')}:\n${direct.stderr}`);
    return direct.stdout;
  }
  return execFileSync('corepack', ['pnpm', ...args], { cwd, encoding: 'utf8', shell: windows });
}

try {
  pnpm(['pack', '--pack-destination', work], packageDir);
  const tarball = readdirSync(work).find((file) => file.endsWith('.tgz'));
  check(tarball, 'pnpm pack produced no tarball');

  const listing = execFileSync('tar', ['-tzf', join(work, tarball)], { encoding: 'utf8' }).trim().split('\n').sort();
  check(
    JSON.stringify(listing) === JSON.stringify(['package/README.md', 'package/dist/giga.js', 'package/package.json']),
    `unexpected package contents: ${listing.join(', ')}`,
  );

  const app = join(work, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'giga-smoke', private: true }));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', join(work, tarball)], { cwd: app, stdio: 'inherit', shell: windows });

  const installed = JSON.parse(readFileSync(join(app, 'node_modules', '@gigacad', 'cli', 'package.json'), 'utf8'));
  check(!installed.dependencies && !installed.devDependencies?.['@gigacad/core']?.startsWith('workspace:'), 'workspace dependencies leaked into the package');

  const bin = join(app, 'node_modules', '.bin', windows ? 'giga.cmd' : 'giga');
  const giga = (args, env = {}) =>
    spawnSync(bin, args, { cwd: app, encoding: 'utf8', shell: windows, env: { ...process.env, GIGA_CONFIG_DIR: join(work, 'config'), ...env } });

  const version = giga(['--version']);
  check(version.status === 0 && version.stdout.trim() === pkg.version, `--version printed "${version.stdout.trim()}", expected ${pkg.version}`);

  const help = giga(['--help']);
  check(help.status === 0 && help.stdout.includes('clone') && help.stdout.includes('rr'), '--help is missing commands');

  const outside = giga(['status', '--json']);
  check(outside.status === 1 && JSON.parse(outside.stderr).error.code === 'not_a_workspace', `status outside a workspace: ${outside.stderr}`);

  const token = 'gcd_smoke_secret';
  const offline = giga(['whoami', '--api-url', 'http://127.0.0.1:1'], { GIGA_TOKEN: token });
  check(offline.status === 1 && offline.stderr.includes("Can't reach the GigaCAD API"), `offline whoami: ${offline.stderr}`);
  check(!(offline.stdout + offline.stderr).includes(token), 'the token was printed');

  console.log(`smoke test passed: ${tarball} installs and runs giga ${pkg.version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
