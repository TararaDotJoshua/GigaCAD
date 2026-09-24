export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  return { url, key };
}

export function apiUrl() {
  return process.env.NEXT_PUBLIC_GIGACAD_API_URL ?? 'http://127.0.0.1:8787';
}
