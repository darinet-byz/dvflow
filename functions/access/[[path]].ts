import { pagesFunction } from '../_lib/handler'

/**
 * `GET /access/[:kodeToko/]:orderId` — halaman peserta (PRD §87–§93, 03 §8).
 *
 * Rute ini PUBLIK dan berada di luar `/api`, jadi ia memerlukan berkas fungsi
 * sendiri; lihat catatan di `../_lib/handler.ts`. `[[path]]` (bukan `[orderId]`) agar
 * `/access/KODE/123` dari koneksi multi-toko ikut tertangkap. Yang dilayani di sini:
 * webinar → 302 ke destination, seminar → halaman tiket, lainnya → halaman error.
 */
export const onRequest = pagesFunction()
