/** A sign-in code as people type or paste it, with or without the dash or spaces, written the way the device shows it. */
export function normalizeCode(value: string): string {
  const plain = value.toUpperCase().replace(/[\s-]/g, '').slice(0, 8);
  return plain.length > 4 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : plain;
}
