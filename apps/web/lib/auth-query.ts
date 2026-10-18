/** What the sign-in pages read from their address, passed to the form so it renders on the server. */
export interface AuthQuery {
  /** Where to go after signing in, as given; the form checks it. */
  readonly next: string | null;
  readonly email: string;
  readonly error: string | null;
  /** Why log-in was asked for: `private` when a page needs an account that can see it. */
  readonly reason: string | null;
}

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export async function authQuery(searchParams: Promise<Params>): Promise<AuthQuery> {
  const params = await searchParams;
  return { next: first(params.next), email: first(params.email) ?? '', error: first(params.error), reason: first(params.reason) };
}
