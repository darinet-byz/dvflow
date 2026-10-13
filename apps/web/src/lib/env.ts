/**
 * Environment frontend (04 §13, 06 §3).
 *
 * HANYA nilai publik yang boleh ada di sini. Service key Supabase, private key
 * JWT, dan webhook secret tidak pernah masuk bundle — semuanya hidup di Worker
 * sebagai secret (`.env.example` hanya memuat `VITE_*`).
 */
export type PublicEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
  /** Kosong berarti backend satu origin (Pages Functions) — jalur produksi MVP. */
  apiBaseUrl: string
}

export function readPublicEnv(): PublicEnv {
  const source = import.meta.env

  return {
    supabaseUrl: requireValue(source.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL'),
    supabasePublishableKey: requireValue(
      source.VITE_SUPABASE_PUBLISHABLE_KEY,
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ),
    apiBaseUrl: typeof source.VITE_API_BASE_URL === 'string' ? source.VITE_API_BASE_URL : '',
  }
}

/**
 * Gagal cepat bila konfigurasi publik tidak lengkap.
 *
 * Lebih baik halaman menampilkan kesalahan konfigurasi yang jelas daripada
 * aplikasi tampak jalan lalu setiap permintaan gagal tanpa sebab yang terbaca.
 */
function requireValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Konfigurasi frontend tidak lengkap: ${name} belum diisi.`)
  }
  return value
}
