import { homedir, hostname } from 'node:os';
import { Api, configDir, loadConfig, machineName, normalizeApiUrl } from '@gigacad/cli/lib';

const ctx = () => ({ env: process.env, platform: process.platform, homedir: homedir(), hostname: hostname() });

/** An API client with the sign-in `giga login` saved for this API (the app and the terminal share it). */
export async function apiClient(apiUrl: string): Promise<Api> {
  const url = normalizeApiUrl(apiUrl);
  const token = process.env.GIGA_TOKEN?.trim() || (await loadConfig(configDir(ctx()))).credentials[url]?.token;
  return new Api(url, token);
}

/** This computer's name in checkout locks, the same one the terminal `giga` uses. */
export const thisMachine = () => machineName(ctx());
