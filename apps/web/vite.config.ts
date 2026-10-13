import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Build aplikasi admin (React + Tailwind).
 *
 * Skrip QR halaman peserta TIDAK ikut di sini: ia dibangun terpisah oleh
 * `vite.ticket.config.ts` supaya keluar sebagai satu berkas klasik tanpa impor.
 * Lihat berkas itu untuk alasannya.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  /**
   * CATATAN PENTING soal env: nilainya HARUS berada di `apps/web/`
   * (`.env` untuk dev, `.env.production` untuk build).
   *
   * Awalnya berkas env ditaruh di root repo dengan `envDir: '..'`, dan itu
   * TIDAK bekerja: Vite 8 tidak memuat berkas env dari luar root aplikasi —
   * `loadEnv()` mengembalikan objek kosong, build tetap "berhasil", tetapi
   * bundelnya terkirim tanpa konfigurasi Supabase sama sekali. Gejalanya:
   * aplikasi produksi menampilkan "Konfigurasi frontend tidak lengkap".
   *
   * Templatenya tetap satu di root repo (`.env.example`) supaya tidak ada dua
   * sumber kebenaran; salin ke sini:
   *   cp .env.example apps/web/.env
   */
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Backend dijalankan terpisah saat pengembangan (`wrangler dev`); lihat
    // README. Karena backend memeriksa same-origin (K19), jalankan backend
    // dengan APP_ALLOWED_ORIGINS=http://localhost:5173.
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/access': 'http://127.0.0.1:8788',
      '/checkin': 'http://127.0.0.1:8788',
    },
  },
})
