import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from './context.js';
import { CliError } from './errors.js';

export const DEFAULT_API_URL = 'https://api.gigacad.site';

export interface Credentials {
  /** Device token from `giga login`. Never printed. */
  readonly token: string;
  /** Lets `giga logout` revoke exactly this token. */
  readonly tokenId: string | null;
  readonly userId: string;
  readonly handle: string;
  readonly savedAt: string;
}

export interface ConfigFile {
  readonly version: 1;
  /** Identifies this computer in branch check-out locks. Created on first use. */
  readonly machineId?: string | undefined;
  /** Keyed by normalized API URL, so local and production sign-ins never mix. */
  readonly credentials: Readonly<Record<string, Credentials>>;
}

const EMPTY: ConfigFile = { version: 1, credentials: {} };

/** GIGA_CONFIG_DIR, else the platform's per-user config folder. */
export function configDir(ctx: Pick<Context, 'env' | 'platform' | 'homedir'>): string {
  const { env } = ctx;
  if (env.GIGA_CONFIG_DIR) return env.GIGA_CONFIG_DIR;
  if (ctx.platform === 'win32') return join(env.APPDATA ?? join(ctx.homedir, 'AppData', 'Roaming'), 'giga');
  return join(env.XDG_CONFIG_HOME || join(ctx.homedir, '.config'), 'giga');
}

export function configPath(dir: string): string {
  return join(dir, 'config.json');
}

export async function loadConfig(dir: string): Promise<ConfigFile> {
  let text: string;
  try {
    text = await readFile(configPath(dir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<ConfigFile>;
    return { version: 1, machineId: parsed.machineId, credentials: parsed.credentials ?? {} };
  } catch {
    throw new CliError('config_invalid', `Can't read ${configPath(dir)}`, { hint: 'Fix or delete the file, then run `giga login`.' });
  }
}

/** Written atomically and readable only by the current user (the folder too). */
export async function saveConfig(dir: string, config: ConfigFile): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = configPath(dir);
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, target);
}

export async function updateConfig(dir: string, change: (config: ConfigFile) => ConfigFile): Promise<ConfigFile> {
  const next = change(await loadConfig(dir));
  await saveConfig(dir, next);
  return next;
}

/** A stable key for an API: scheme, host, port, and path without trailing slashes. */
export function normalizeApiUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CliError('invalid_api_url', `"${input}" is not a valid API URL`, { hint: 'Use a full URL like http://127.0.0.1:8787' });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CliError('invalid_api_url', `"${input}" must start with http:// or https://`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CliError('invalid_api_url', 'The API URL must not include credentials, a query, or a fragment');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The machine name sent with check-outs: readable in lock messages, unique per computer. */
export async function machineName(ctx: Pick<Context, 'env' | 'platform' | 'homedir' | 'hostname'>): Promise<string> {
  const dir = configDir(ctx);
  let config = await loadConfig(dir);
  if (!config.machineId) {
    config = await updateConfig(dir, (current) => ({ ...current, machineId: current.machineId ?? randomBytes(4).toString('hex') }));
  }
  const host = ctx.hostname.replace(/\.local$/i, '').slice(0, 150) || 'computer';
  return `${host} (giga ${config.machineId})`;
}
