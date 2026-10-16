import { mountCheckinQr } from './qr'
import { watchCheckin } from './watch'

/**
 * Entry skrip QR halaman tiket peserta.
 *
 * Berkas ini dibangun menjadi `assets/ticket-qr.js` (lihat `vite.config.ts`) dan
 * dirujuk oleh HTML yang dirender backend. Halaman itu adalah HTML biasa tanpa
 * framework: yang dibutuhkan hanya mengganti isi satu `<div>` dengan SVG QR, lalu
 * menunggu check-in agar QR berganti stempel (A19).
 *
 * Sengaja TIDAK memuat React: halaman peserta dibuka di lapangan, sering dengan
 * koneksi buruk, jadi berkasnya harus sekecil mungkin.
 */
function start(): void {
  if (!mountCheckinQr()) return
  // Lingkungan tanpa `location`/`fetch` (mis. verifikasi artefak di Node) cukup menggambar QR.
  if (typeof location === 'undefined' || typeof fetch !== 'function') return
  watchCheckin({
    url: location.href,
    fetchPage: async (url) => (await fetch(url, { cache: 'no-store', credentials: 'omit' })).text(),
    onCheckedIn: () => location.reload(),
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
