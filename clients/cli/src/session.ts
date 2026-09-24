import { Api } from './api.js';
import { configDir, DEFAULT_API_URL, loadConfig, normalizeApiUrl, type Credentials } from './config.js';
import type { Context } from './context.js';
import { CliError } from './errors.js';

export interface Session {
  readonly apiUrl: string;
  readonly api: Api;
  /** Where the token came from; `null` when signed out. */
  readonly tokenSource: 'env' | 'config' | null;
  readonly credentials: Credentials | undefined;
}

/**
 * API URL: --api-url, then GIGA_API_URL, then the workspace's API, then production.
 * Token: GIGA_TOKEN (never saved), then the token saved for that API by `giga login`.
 */
export async function openSession(ctx: Context, options: { apiUrlFlag?: string | undefined; workspaceApiUrl?: string | undefined }): Promise<Session> {
  const requested = options.apiUrlFlag ?? ctx.env.GIGA_API_URL;
  const apiUrl = normalizeApiUrl(requested ?? options.workspaceApiUrl ?? DEFAULT_API_URL);
  if (requested && options.workspaceApiUrl && normalizeApiUrl(requested) !== options.workspaceApiUrl) {
    throw new CliError('api_mismatch', `This workspace belongs to ${options.workspaceApiUrl}, not ${apiUrl}`, {
      hint: 'Unset GIGA_API_URL or drop --api-url inside this workspace.',
    });
  }

  const envToken = ctx.env.GIGA_TOKEN?.trim();
  if (envToken) return { apiUrl, api: new Api(apiUrl, envToken), tokenSource: 'env', credentials: undefined };

  const credentials = (await loadConfig(configDir(ctx))).credentials[apiUrl];
  return {
    apiUrl,
    api: new Api(apiUrl, credentials?.token),
    tokenSource: credentials ? 'config' : null,
    credentials,
  };
}

export function requireSignedIn(session: Session): void {
  if (!session.api.signedIn) {
    throw new CliError('unauthorized', `Not signed in to ${session.apiUrl}`, { hint: 'Run `giga login`, or set GIGA_TOKEN.' });
  }
}
