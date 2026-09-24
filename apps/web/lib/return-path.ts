export function safeReturnPath(value: string | null | undefined, fallback = '/app') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
