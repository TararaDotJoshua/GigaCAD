// Fails when the shell changed without a SHELL_VERSION bump. The shell is what a DMG
// installs: the Electron version and src/bootstrap. Installed apps only run bundles whose
// shellMin they meet, so a shell change that isn't counted would ship bundles to apps that
// can't run them.
//
//   node scripts/check-shell.mjs [base-ref]   (default origin/main)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib.mjs';

const base = process.argv[2] ?? process.env.GIGACAD_SHELL_BASE ?? 'origin/main';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const show = (ref, path) => {
  try {
    return git('show', `${ref}:clients/desktop/${path}`);
  } catch {
    return null;
  }
};

const mergeBase = git('merge-base', base, 'HEAD').trim();
const baseShell = show(mergeBase, 'src/bootstrap/shell.ts');
if (baseShell === null) {
  console.log(`No desktop shell at ${base} yet; nothing to compare.`);
  process.exit(0);
}
const version = (text) => Number(text.match(/SHELL_VERSION = (\d+)/)?.[1]);
const electron = (text) => JSON.parse(text).devDependencies?.electron;

const changed = git('diff', '--name-only', mergeBase, '--', 'src/bootstrap').split('\n').filter(Boolean);
const electronBefore = electron(show(mergeBase, 'package.json') ?? '{}');
const electronNow = electron(readFileSync(join(root, 'package.json'), 'utf8'));
const reasons = [...changed.map((file) => `${file} changed`), ...(electronBefore !== electronNow ? [`Electron ${electronBefore} → ${electronNow}`] : [])].filter(
  (reason) => !reason.startsWith('clients/desktop/src/bootstrap/shell.ts'),
);

const before = version(baseShell);
const now = version(readFileSync(join(root, 'src', 'bootstrap', 'shell.ts'), 'utf8'));
if (reasons.length > 0 && now <= before) {
  console.error(`The desktop shell changed, but SHELL_VERSION is still ${now}:\n  ${reasons.join('\n  ')}`);
  console.error('Bump SHELL_VERSION in clients/desktop/src/bootstrap/shell.ts. Installed apps will need a new DMG for bundles that use it.');
  process.exit(1);
}
console.log(reasons.length > 0 ? `Shell changed and SHELL_VERSION went ${before} → ${now}.` : `Shell unchanged (SHELL_VERSION ${now}).`);
