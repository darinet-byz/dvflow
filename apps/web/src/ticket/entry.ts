import { CHECKIN_QR_ELEMENT_ID, mountCheckinQr } from './qr'
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
function retryMount(): void {
  const container = document.getElementById(CHECKIN_QR_ELEMENT_ID)
  if (container === null || container.getAttribute('data-qr-ready') === 'true') return
  mountCheckinQr()
}

function start(): void {
  const mounted = mountCheckinQr()

  // Sebagian browser in-app menunda eksekusi/defer sampai tab kembali terlihat.
  // Coba pasang lagi tanpa mengganggu QR yang sudah berhasil. Lingkungan
  // verifikasi Node tidak punya `window`, jadi penjaga ini diperlukan.
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', retryMount)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retryMount()
    })
  }

  if (!mounted) return
  // Lingkungan tanpa `location`/`fetch` (mis. verifikasi artefak di Node) cukup menggambar QR.
  if (typeof location === 'undefined' || typeof fetch !== 'function') return
  // A62: tiket multi-tiket boleh hadir bertahap; muat ulang ketika jumlah tiket
  // hadir berubah supaya sisa tiket yang bisa dipindai ikut terlihat.
  const initialCount = document
    .querySelector('[data-checkin-count]')
    ?.getAttribute('data-checkin-count') ?? null
  watchCheckin({
    url: location.href,
    fetchPage: async (url) => (await fetch(url, { cache: 'no-store', credentials: 'omit' })).text(),
    onCheckedIn: () => location.reload(),
    initialCount,
    onChanged: () => location.reload(),
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
