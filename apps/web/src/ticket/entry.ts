import { mountCheckinQr } from './qr'

/**
 * Entry skrip QR halaman tiket peserta.
 *
 * Berkas ini dibangun menjadi `assets/ticket-qr.js` (lihat `vite.config.ts`) dan
 * dirujuk oleh HTML yang dirender backend. Halaman itu adalah HTML biasa tanpa
 * framework: yang dibutuhkan hanya mengganti isi satu `<div>` dengan SVG QR.
 *
 * Sengaja TIDAK memuat React: halaman peserta dibuka di lapangan, sering dengan
 * koneksi buruk, jadi berkasnya harus sekecil mungkin.
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => mountCheckinQr(), { once: true })
} else {
  mountCheckinQr()
}
