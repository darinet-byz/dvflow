import { pagesFunction } from '../_lib/handler'

/**
 * Seluruh rute `/api/*` (STATE.md K2).
 *
 * Backend dan frontend sengaja satu origin: cookie refresh (`HttpOnly` +
 * `Secure` + `SameSite=Lax`) tidak terkirim antar situs, sehingga memisahkan
 * API ke `*.workers.dev` akan mematikan login.
 *
 * Rute di luar `/api` punya berkas fungsinya sendiri: `access/` dan `checkin/`.
 * Tanpa berkas itu, rute tersebut akan jatuh ke fallback SPA dan mengembalikan
 * `index.html` alih-alih halaman peserta.
 */
export const onRequest = pagesFunction()
