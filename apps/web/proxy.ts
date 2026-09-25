import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Every page, so the host split and the sign-in guard apply everywhere. Static build output is skipped.
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
