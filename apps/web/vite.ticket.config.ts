import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Build TERPISAH untuk skrip QR halaman tiket peserta.
 *
 * Kenapa dipisah dari build aplikasi:
 *
 *   1. **Satu berkas, tanpa impor.** Sebagai bagian dari build multi-entry,
 *      skrip ini keluar sebagai ES module yang mengimpor chunk runtime bersama
 *      (`import ... from "./rolldown-runtime-*.js"`). Halaman peserta hanya
 *      memuatnya dengan `<script src>` biasa, jadi bentuk itu tidak sah — dan
 *      menambah `type="module"` berarti menambah syarat dukungan browser plus
 *      satu permintaan jaringan lagi. Di lapangan, acara sering berlangsung
 *      dengan Wi-Fi buruk: satu berkas klasik jauh lebih tahan gagal.
 *
 *   2. **IIFE (script klasik).** Tidak butuh dukungan ES module sama sekali —
 *      dijalankan apa adanya oleh browser mana pun, tua maupun baru.
 *
 * Hasilnya dipaku ke `dist/assets/ticket-qr.js`, path yang dirujuk backend
 * (`TICKET_QR_SCRIPT_PATH` di `packages/api/src/participant/pages.ts`).
 *
 * Dijalankan SETELAH build aplikasi (`npm run build`), dan sengaja TIDAK
 * membersihkan `dist` supaya hasil build aplikasi tidak ikut terhapus.
 */
export default defineConfig({
  // `publicDir` dimatikan: berkas publik (`_redirects`) sudah disalin oleh build
  // aplikasi, dan build ini menulis ke dalam `dist`, bukan ke root-nya.
  publicDir: false,
  build: {
    outDir: 'dist/assets',
    emptyOutDir: false,
    // Minifier dibiarkan pada bawaan Vite 8 (Oxc). Menulis `minify: 'esbuild'`
    // akan gagal: sejak Vite 8 esbuild tidak lagi ikut dipasang.
    lib: {
      entry: fileURLToPath(new URL('src/ticket/entry.ts', import.meta.url)),
      name: 'dvflowTicketQr',
      formats: ['iife'],
      fileName: () => 'ticket-qr.js',
    },
  },
})
