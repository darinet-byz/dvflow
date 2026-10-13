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
  // Satu `.env` untuk seluruh repo (sejajar dengan `.env.example`), bukan satu
  // per paket — supaya nilai publik tidak perlu disalin ke dua tempat.
  envDir: '..',
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
