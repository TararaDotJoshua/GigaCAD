import { sites } from './hosts';

/**
 * A marker the app sets while you're signed in, so gigacad.site can offer "Your projects"
 * instead of "Log in". It holds no session or identity, just "1", and it's shared with the
 * marketing host because the app's own session cookies are host-only.
 */
export const SIGNED_IN_COOKIE = 'gigacad_signed_in';

/** How long the marker lasts without a visit to the app. */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** `; domain=gigacad.site` when the app is a subdomain of the site, so both hosts see the marker. */
function domainAttribute(): string {
  const { siteUrl, appUrl } = sites();
  const site = new URL(siteUrl).hostname;
  const app = new URL(appUrl).hostname;
  return app !== site && app.endsWith(`.${site}`) ? `; domain=${site}` : '';
}

/** Sets (and renews) or clears the marker. Browser only. */
export function rememberSignedIn(signedIn: boolean): void {
  if (!signedIn && !readSignedIn()) return;
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  const value = signedIn ? `1; max-age=${MAX_AGE_SECONDS}` : `; max-age=0`;
  document.cookie = `${SIGNED_IN_COOKIE}=${value}; path=/; samesite=lax${domainAttribute()}${secure}`;
}

/** Whether the marker is set. Browser only. */
export function readSignedIn(): boolean {
  return document.cookie.split('; ').includes(`${SIGNED_IN_COOKIE}=1`);
}
