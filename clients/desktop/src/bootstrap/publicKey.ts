/**
 * Verifies code bundles and update manifests. The private half is the DESKTOP_UPDATE_KEY
 * GitHub secret (backed up outside the repository); it is never committed.
 *
 * Local builds made without that key are signed with a throwaway key instead, and
 * scripts/build.mjs swaps its public half in through `__GIGACAD_DEV_PUBLIC_KEY__`.
 */
declare const __GIGACAD_DEV_PUBLIC_KEY__: string | undefined;

const PRODUCTION_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAcnY4iZMNpOZ0Ln3bPzwI0awrt4RtyPCh6Z8yMcrW2iY=
-----END PUBLIC KEY-----
`;

export const PUBLIC_KEY: string = typeof __GIGACAD_DEV_PUBLIC_KEY__ === 'string' ? __GIGACAD_DEV_PUBLIC_KEY__ : PRODUCTION_PUBLIC_KEY;
