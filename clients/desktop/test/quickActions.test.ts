import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandFor, installQuickActions, parseActionUrl, QUICK_ACTIONS, quickActionsInstalled } from '../src/main/quickActions.js';

describe('parseActionUrl', () => {
  it('reads the action and the encoded path', () => {
    expect(parseActionUrl(`gigacad://action/checkout?path=${encodeURIComponent('/Users/a/GigaCAD/a/b/Branches/x y')}`)).toEqual({
      action: 'checkout',
      path: '/Users/a/GigaCAD/a/b/Branches/x y',
    });
    expect(parseActionUrl('gigacad://action/copy-link?path=%2Ftmp%2Fz')).toEqual({ action: 'copy-link', path: '/tmp/z' });
  });

  it('rejects anything else', () => {
    expect(parseActionUrl('gigacad://action/rm?path=%2F')).toBeUndefined();
    expect(parseActionUrl('gigacad://action/checkout')).toBeUndefined();
    expect(parseActionUrl('gigacad://other/checkout?path=%2F')).toBeUndefined();
    expect(parseActionUrl('https://action/checkout?path=%2F')).toBeUndefined();
    expect(parseActionUrl('not a url')).toBeUndefined();
  });
});

describe('workflows', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('only opens a gigacad:// link, with nothing outside macOS', () => {
    const command = commandFor('pull');
    expect(command).toContain('/usr/bin/open -g "gigacad://action/pull?path=$p"');
    expect(command).not.toMatch(/node|nvm|python/);
  });

  it('writes one workflow per action, marked with the version', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gigacad-services-'));
    expect(quickActionsInstalled('1.0.0', dir)).toBe(false);
    await installQuickActions('1.0.0', dir);
    expect(quickActionsInstalled('1.0.0', dir)).toBe(true);
    expect(quickActionsInstalled('1.0.1', dir)).toBe(false);
    const wflow = readFileSync(join(dir, 'GigaCAD: Commit Version….workflow', 'Contents', 'document.wflow'), 'utf8');
    expect(wflow).toContain('gigacad://action/commit?path=$p');
    expect(wflow).toContain('&quot;');
  });

  it.runIf(process.platform === 'darwin')('writes property lists macOS accepts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gigacad-services-'));
    await installQuickActions('1.0.0', dir);
    for (const { title } of QUICK_ACTIONS) {
      const contents = join(dir, `GigaCAD: ${title}.workflow`, 'Contents');
      execFileSync('/usr/bin/plutil', ['-lint', join(contents, 'Info.plist'), join(contents, 'document.wflow')]);
      const command = execFileSync('/usr/bin/plutil', ['-extract', 'actions.0.action.ActionParameters.COMMAND_STRING', 'raw', join(contents, 'document.wflow')], {
        encoding: 'utf8',
      });
      expect(command.trim()).toBe(commandFor(QUICK_ACTIONS.find((candidate) => candidate.title === title)!.action));
    }
  });
});
