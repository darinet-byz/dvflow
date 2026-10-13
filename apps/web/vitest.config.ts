import { defineConfig } from 'vitest/config'

/**
 * Test aplikasi web.
 *
 * Berjalan di Node (tanpa browser). Yang diuji di sini adalah logika murni —
 * terutama QR: hasil encode harus benar-benar dapat DIBACA KEMBALI oleh decoder
 * independen (`jsqr`). Itu bukti yang bisa diperiksa, bukan klaim.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    // Default Node (logika murni). Berkas yang butuh DOM menandai dirinya
    // sendiri dengan `@vitest-environment jsdom`.
    environment: 'node',
  },
})
