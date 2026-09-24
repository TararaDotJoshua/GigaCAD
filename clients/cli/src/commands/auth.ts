import type { Command } from 'commander';
import { Api, type DeviceCode, type DeviceGrant, type Profile } from '../api.js';
import type { Bind, Runtime } from '../cli.js';
import { configDir, updateConfig } from '../config.js';
import { ApiError, CliError } from '../errors.js';
import { requireSignedIn } from '../session.js';

export function registerAuthCommands(program: Command, bind: Bind): void {
  program
    .command('login')
    .description('Sign in through your browser and save a device token for this API')
    .option('--no-browser', 'Print the sign-in link instead of opening a browser')
    .action(bind(login));

  program.command('whoami').description('Show who you are signed in as').action(bind(whoami));

  program.command('logout').description('Revoke this computer’s token and forget it').action(bind(logout));
}

async function login(rt: Runtime, options: { browser: boolean }): Promise<void> {
  const { ctx, out } = rt;
  const session = await rt.session();
  const anonymous = new Api(session.apiUrl, undefined);
  const host = ctx.hostname.replace(/\.local$/i, '') || 'this computer';
  const code = await anonymous.post<DeviceCode>('/v1/auth/device/code', { clientName: `giga CLI on ${host}`.slice(0, 100) });

  out.notice(`To sign in, open ${code.verificationUri} and enter the code ${code.userCode}`);
  if (options.browser) {
    out.notice('Opening your browser…');
    await ctx.openBrowser(code.verificationUriComplete);
  }
  out.notice('Waiting for approval…');

  const grant = await pollForGrant(rt, anonymous, code);
  const me = await new Api(session.apiUrl, grant.accessToken).get<Profile>('/v1/me');
  const dir = configDir(ctx);
  const previous = session.tokenSource === 'config' ? session.credentials : undefined;
  await updateConfig(dir, (config) => ({
    ...config,
    credentials: {
      ...config.credentials,
      [session.apiUrl]: {
        token: grant.accessToken,
        tokenId: grant.tokenId ?? null,
        userId: me.id,
        handle: me.handle,
        savedAt: new Date().toISOString(),
      },
    },
  }));
  // Signing in again replaces this computer's old token; revoke it so it can't linger.
  if (previous?.tokenId && previous.tokenId !== grant.tokenId) {
    await session.api.delete(`/v1/me/tokens/${previous.tokenId}`).catch(() => undefined);
  }
  if (ctx.env.GIGA_TOKEN) out.notice('Note: GIGA_TOKEN is set and takes precedence over this sign-in until you unset it.');

  out.result({ apiUrl: session.apiUrl, userId: me.id, handle: me.handle }, `Signed in to ${session.apiUrl} as @${me.handle}`);
}

async function pollForGrant(rt: Runtime, api: Api, code: DeviceCode): Promise<DeviceGrant> {
  const deadline = Date.now() + code.expiresIn * 1000;
  let intervalMs = Math.max(1, code.interval) * 1000;
  for (;;) {
    await rt.ctx.sleep(intervalMs);
    try {
      return await api.post<DeviceGrant>('/v1/auth/device/token', { deviceCode: code.deviceCode });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === 'authorization_pending' && Date.now() < deadline) continue;
      if (error.code === 'slow_down') {
        intervalMs += 5000;
        continue;
      }
      if (error.code === 'authorization_pending' || error.code === 'expired_token') {
        throw new CliError('expired_token', 'The sign-in code expired before it was approved', { hint: 'Run `giga login` again to get a new code.' });
      }
      if (error.code === 'invalid_grant') {
        throw new CliError('invalid_grant', 'This sign-in code was already used or is unknown', { hint: 'Run `giga login` again.' });
      }
      throw error;
    }
  }
}

async function whoami(rt: Runtime): Promise<void> {
  const session = await rt.session();
  requireSignedIn(session);
  const me = await session.api.get<Profile>('/v1/me');
  rt.out.result(
    { apiUrl: session.apiUrl, userId: me.id, handle: me.handle, displayName: me.displayName, tokenSource: session.tokenSource },
    [`@${me.handle}${me.displayName ? ` (${me.displayName})` : ''}`, `API: ${session.apiUrl}${session.tokenSource === 'env' ? ' (token from GIGA_TOKEN)' : ''}`],
  );
}

async function logout(rt: Runtime): Promise<void> {
  const session = await rt.session();
  if (session.tokenSource === 'env') {
    throw new CliError('token_from_env', 'You are signed in through GIGA_TOKEN, which giga never saves', {
      hint: 'Unset GIGA_TOKEN, and revoke the token on gigacad.site if it is no longer needed.',
    });
  }
  const credentials = session.credentials;
  if (!credentials) {
    rt.out.result({ apiUrl: session.apiUrl, signedOut: false, revoked: false }, `Not signed in to ${session.apiUrl}`);
    return;
  }

  let revoked = false;
  let warning: string | undefined;
  if (credentials.tokenId) {
    try {
      await session.api.delete(`/v1/me/tokens/${credentials.tokenId}`);
      revoked = true;
    } catch (error) {
      // 401/404: the token is already revoked or gone, which is what we want.
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) revoked = true;
      else warning = 'Could not reach the API to revoke the token; revoke it on gigacad.site under your devices.';
    }
  } else {
    warning = 'This sign-in predates token ids, so it was not revoked; revoke it on gigacad.site under your devices.';
  }

  await updateConfig(configDir(rt.ctx), (config) => {
    const { [session.apiUrl]: _removed, ...rest } = config.credentials;
    return { ...config, credentials: rest };
  });
  if (warning) rt.out.notice(`warning: ${warning}`);
  rt.out.result({ apiUrl: session.apiUrl, signedOut: true, revoked }, `Signed out of ${session.apiUrl}`);
}
