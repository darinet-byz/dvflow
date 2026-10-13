import { pagesFunction } from '../_lib/handler'

/**
 * `GET /checkin/:orderId` (halaman informasi) dan `POST /checkin/:orderId`
 * (check-in oleh operator) — PRD §94, 03 §9.
 *
 * `onRequest` melayani semua metode; router di `packages/api` yang memisahkan
 * GET (tidak pernah mengubah apa pun) dari POST (mutasi).
 */
export const onRequest = pagesFunction()
