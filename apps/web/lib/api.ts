import { apiUrl } from './config';

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  ownerHandle: string;
  role: string | null;
  latestReleaseNumber: number | null;
}

export interface Profile {
  id: string;
  handle: string;
  displayName: string | null;
}

export async function apiRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, apiUrl()), {
    ...init,
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
