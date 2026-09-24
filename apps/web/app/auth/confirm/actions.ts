'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { safeReturnPath } from '../../../lib/return-path';

export async function confirmEmail(form: FormData) {
  const tokenHash = form.get('token_hash');
  const type = form.get('type');
  const rawNext = form.get('next');
  if (typeof tokenHash !== 'string' || (type !== 'email' && type !== 'recovery')) redirect('/login?error=confirmation');
  const { error } = await (await createClient()).auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) redirect(type === 'recovery' ? '/forgot-password?error=recovery' : '/login?error=confirmation');

  const appOrigin = process.env.NEXT_PUBLIC_GIGACAD_APP_URL ?? 'https://app.gigacad.site';
  let next = type === 'recovery' ? '/reset-password' : '/app';
  if (typeof rawNext === 'string') {
    try {
      const parsed = new URL(rawNext);
      if (parsed.origin === new URL(appOrigin).origin) next = safeReturnPath(parsed.pathname + parsed.search, next);
    } catch { /* A malformed return URL uses the safe default. */ }
  }
  redirect(next);
}
