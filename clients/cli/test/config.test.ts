import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configDir, configPath, DEFAULT_API_URL, loadConfig, machineName, normalizeApiUrl, saveConfig, updateConfig } from '../src/config.js';
import type { Context } from '../src/context.js';
import { openSession } from '../src/session.js';
import { tempDir } from './context.js';

const credentials = (token: string) => ({ token, tokenId: null, userId: 'u', handle: 'alex', savedAt: '2026-01-01T00:00:00Z' });

function ctx(env: Record<string, string | undefined>, platform: NodeJS.Platform = 'linux'): Context {
  return {
    env,
    cwd: '/',
    stdout: { write: () => true },
    stderr: { write: () => true },
    platform,
    homedir: '/home/alex',
    hostname: 'alex-laptop.local',
    openBrowser: async () => {},
    sleep: async () => {},
  };
}

describe('config location', () => {
  it('uses GIGA_CONFIG_DIR, then the platform user config folder', () => {
    expect(configDir(ctx({ GIGA_CONFIG_DIR: '/tmp/giga-ci' }))).toBe('/tmp/giga-ci');
    expect(configDir(ctx({ XDG_CONFIG_HOME: '/xdg' }))).toBe(join('/xdg', 'giga'));
    expect(configDir(ctx({}))).toBe(join('/home/alex', '.config', 'giga'));
    expect(configDir(ctx({}, 'darwin'))).toBe(join('/home/alex', '.config', 'giga'));
    expect(configDir(ctx({ APPDATA: 'C:\\Users\\alex\\AppData\\Roaming' }, 'win32'))).toBe(join('C:\\Users\\alex\\AppData\\Roaming', 'giga'));
  });
});

describe('config file', () => {
  it('is readable only by the user and keeps sign-ins per API', async () => {
    const dir = join(await tempDir(), 'nested', 'giga');
    await updateConfig(dir, (config) => ({ ...config, credentials: { ...config.credentials, 'http://127.0.0.1:8787': credentials('gcd_local') } }));
    await updateConfig(dir, (config) => ({ ...config, credentials: { ...config.credentials, [DEFAULT_API_URL]: credentials('gcd_prod') } }));

    const loaded = await loadConfig(dir);
    expect(Object.keys(loaded.credentials).sort()).toEqual(['http://127.0.0.1:8787', DEFAULT_API_URL]);
    expect(loaded.credentials['http://127.0.0.1:8787']?.token).toBe('gcd_local');

    if (process.platform !== 'win32') {
      expect((await stat(configPath(dir))).mode & 0o777).toBe(0o600);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    }
  });

  it('isolates separate config folders completely', async () => {
    const [one, two] = [await tempDir(), await tempDir()];
    await saveConfig(one, { version: 1, credentials: { [DEFAULT_API_URL]: credentials('gcd_one') } });
    expect((await loadConfig(two)).credentials).toEqual({});

    const machineOne = await machineName(ctx({ GIGA_CONFIG_DIR: one }));
    const machineTwo = await machineName(ctx({ GIGA_CONFIG_DIR: two }));
    expect(machineOne).toMatch(/^alex-laptop \(giga [0-9a-f]{8}\)$/);
    expect(machineTwo).not.toBe(machineOne);
    // Stable across runs.
    expect(await machineName(ctx({ GIGA_CONFIG_DIR: one }))).toBe(machineOne);
  });

  it('normalizes API URLs so trailing slashes do not split sign-ins', () => {
    expect(normalizeApiUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(normalizeApiUrl('https://API.gigacad.site')).toBe('https://api.gigacad.site');
    expect(normalizeApiUrl('https://example.com/gigacad//')).toBe('https://example.com/gigacad');
    expect(() => normalizeApiUrl('https://user:pw@example.com')).toThrow(/credentials/);
    expect(() => normalizeApiUrl('localhost:8787')).toThrow();
  });
});

describe('sessions', () => {
  it('picks the API from the flag, then GIGA_API_URL, then the workspace, then production', async () => {
    const dir = await tempDir();
    const env = { GIGA_CONFIG_DIR: dir };
    expect((await openSession(ctx(env), {})).apiUrl).toBe(DEFAULT_API_URL);
    expect((await openSession(ctx(env), { workspaceApiUrl: 'http://127.0.0.1:8787' })).apiUrl).toBe('http://127.0.0.1:8787');
    expect((await openSession(ctx({ ...env, GIGA_API_URL: 'http://localhost:9999/' }), {})).apiUrl).toBe('http://localhost:9999');
    expect((await openSession(ctx({ ...env, GIGA_API_URL: 'http://localhost:9999' }), { apiUrlFlag: 'http://localhost:1234' })).apiUrl).toBe(
      'http://localhost:1234',
    );
    await expect(openSession(ctx(env), { apiUrlFlag: 'http://localhost:1234', workspaceApiUrl: 'http://127.0.0.1:8787' })).rejects.toMatchObject({
      code: 'api_mismatch',
    });
  });

  it('prefers GIGA_TOKEN and never saves it', async () => {
    const dir = await tempDir();
    await saveConfig(dir, { version: 1, credentials: { [DEFAULT_API_URL]: credentials('gcd_saved') } });

    const saved = await openSession(ctx({ GIGA_CONFIG_DIR: dir }), {});
    expect(saved.tokenSource).toBe('config');

    const fromEnv = await openSession(ctx({ GIGA_CONFIG_DIR: dir, GIGA_TOKEN: 'gcd_from_env' }), {});
    expect(fromEnv.tokenSource).toBe('env');
    expect(fromEnv.credentials).toBeUndefined();
    expect((await loadConfig(dir)).credentials[DEFAULT_API_URL]?.token).toBe('gcd_saved');

    const otherApi = await openSession(ctx({ GIGA_CONFIG_DIR: dir }), { apiUrlFlag: 'http://127.0.0.1:8787' });
    expect(otherApi.tokenSource).toBeNull();
  });
});
