import { isPlanId } from '@gigacad/core';
import { NextResponse } from 'next/server';
import { ApiError, apiRequest } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';

/**
 * Where the pricing page's plan buttons go: straight on to Stripe Checkout. The proxy
 * sends signed-out visitors to log in first and back here after.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = url.searchParams.get('plan');
  const interval = url.searchParams.get('interval');
  const back = (query = '') => NextResponse.redirect(new URL(`/settings/billing${query}`, url.origin));
  if (!isPlanId(plan) || plan === 'free' || (interval !== 'monthly' && interval !== 'yearly')) return back();

  const token = await getAccessToken();
  if (!token) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, url.origin));
  try {
    const { url: checkout } = await apiRequest<{ url: string }>(token, '/v1/billing/checkout', { method: 'POST', body: JSON.stringify({ plan, interval }) });
    return NextResponse.redirect(checkout, 303);
  } catch (error) {
    return back(`?error=${error instanceof ApiError ? encodeURIComponent(error.code) : 'failed'}`);
  }
}
