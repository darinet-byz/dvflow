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

/**
 * PENTING: setiap nilai dibaca dengan akses properti STATIS
 * (`import.meta.env.VITE_X`), bukan lewat variabel perantara seperti
 * `const source = import.meta.env`.
 *
 * Vite mengganti nilai env saat BUILD dengan mencocokkan pola
 * `import.meta.env.NAMA` secara literal. Lewat variabel perantara, penggantian
 * itu tidak terjadi: di dev server nilainya ada (karena `import.meta.env`
 * adalah objek sungguhan), tetapi di hasil build nilainya hilang — dan
 * aplikasi produksi terkirim tanpa konfigurasi Supabase sama sekali.
 * Kesalahan ini tidak terlihat di dev, hanya di bundel hasil build.
 */
export function readPublicEnv(): PublicEnv {
  return {
    supabaseUrl: requireValue(import.meta.env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL'),
    supabasePublishableKey: requireValue(
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ),
    apiBaseUrl: typeof import.meta.env.VITE_API_BASE_URL === 'string' ? import.meta.env.VITE_API_BASE_URL : '',
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
