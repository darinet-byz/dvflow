import { defineConfig } from 'vitest/config'

/**
 * Test unit (default): cepat, tanpa infrastruktur.
 *
 * `test/integration/**` sengaja dikecualikan karena memerlukan Supabase lokal
 * yang menyala; jalankan dengan `npm run test:integration`.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
  },
})
