const BASE = 'http://return-path.invalid';

/** Keeps a ?next value only when it stays on this site, resolved the way the browser will resolve it (dot segments included). */
export function safeReturnPath(value: string | null | undefined, fallback = '/app') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  // "/.//evil.example" and "/x/..//evil.example" resolve to a path starting with "//", which a Location header reads as another host.
  if (url.origin !== BASE || url.pathname.startsWith('//') || url.pathname.includes('\\')) return fallback;
  return url.pathname + url.search + url.hash;
}
