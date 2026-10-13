import { defineConfig } from 'vitest/config'

/**
 * Test integrasi: berjalan terhadap Supabase lokal yang sesungguhnya.
 *
 * Butuh environment `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, dan `SUPABASE_DB_URL`.
 * Nilainya diambil dari `supabase status -o env` (lihat README paket ini).
 * Bila ketiganya tidak ada, seluruh berkas di-skip — bukan gagal — supaya
 * `npm test` tetap dapat dijalankan tanpa Docker.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Satu berkas berbagi database; jangan dijalankan paralel.
    fileParallelism: false,
  },
})
