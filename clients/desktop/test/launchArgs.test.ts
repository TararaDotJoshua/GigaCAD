import { describe, expect, it } from 'vitest';
import { actionUrlFromArgv } from '../src/main/launchArgs.js';
import { parseActionUrl } from '../src/main/quickActions.js';

const exe = 'C:\\Users\\alex\\AppData\\Local\\Programs\\GigaCAD\\GigaCAD.exe';

describe('actionUrlFromArgv', () => {
  it('turns a right-click menu launch into an action link', () => {
    const path = 'C:\\Users\\alex\\GigaCAD\\alex\\arm\\Branches\\dev & test #2';
    const url = actionUrlFromArgv([exe, '--action', 'checkout', path]);
    expect(parseActionUrl(url!)).toEqual({ action: 'checkout', path });
  });

  it('finds the arguments among Chromium switches', () => {
    const url = actionUrlFromArgv([exe, '--allow-file-access-from-files', '--action', 'pull', 'C:\\x', '--original-process-start-time=1']);
    expect(parseActionUrl(url!)).toEqual({ action: 'pull', path: 'C:\\x' });
  });

  it('passes a gigacad:// link through', () => {
    expect(actionUrlFromArgv([exe, '--some-switch', 'gigacad://action/show?path=C%3A%5Cx'])).toBe('gigacad://action/show?path=C%3A%5Cx');
  });

  it('ignores ordinary launches and incomplete actions', () => {
    expect(actionUrlFromArgv([exe])).toBeUndefined();
    expect(actionUrlFromArgv([exe, '--action', 'checkout'])).toBeUndefined();
    expect(actionUrlFromArgv([exe, '--action', '--other', 'C:\\x'])).toBeUndefined();
  });
});
