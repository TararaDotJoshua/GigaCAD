import { redirect } from 'next/navigation';
import { cache } from 'react';
import { loginPath } from './current-path';
import { createClient } from './supabase/server';

/** The signed-in user's Supabase access token for API calls, once per request. Null when signed out. */
export const getAccessToken = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
});

/**
 * Pages and actions that need a user. The proxy normally redirects first; this covers
 * sessions that expire mid-visit, and sends the person back to the same page after logging in.
 */
export async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) redirect(await loginPath());
  return token;
}

/** The signed-in user's email, from the session's claims. */
export const getViewerEmail = cache(async (): Promise<string | null> => {
  const { data } = await (await createClient()).auth.getClaims();
  const email = data?.claims?.email;
  return typeof email === 'string' ? email : null;
});
