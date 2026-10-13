import type { Env } from '../env'
import { ApiFailure } from './errors'

/**
 * Pertahanan CSRF (04 §8).
 *
 * Cookie refresh sudah `SameSite=Lax`, sehingga permintaan lintas situs tidak
 * membawa cookie itu. Pemeriksaan Origin adalah lapisan kedua: endpoint yang
 * memakai cookie untuk mengubah state wajib datang dari origin yang dikenal.
 *
 * SIKAP STRICT: header `Origin` yang HILANG ditolak, bukan dilewatkan. Browser
 * selalu mengirim `Origin` untuk permintaan non-GET, termasuk same-origin, jadi
 * ketiadaan header berarti klien non-browser — dan klien non-browser tidak
 * memerlukan cookie refresh untuk bekerja. Origin `"null"` (mis. iframe
 * ter-sandbox) juga tertutup karena tidak ada di daftar.
 */
export function assertSameOrigin(request: Request, env: Env): void {
  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')

  if (origin === null) {
    throw new ApiFailure('ORIGIN_NOT_ALLOWED', 'header Origin tidak ada')
  }

  const allowed = [requestOrigin, ...extraAllowedOrigins(env)]
  if (!allowed.includes(normalizeOrigin(origin))) {
    throw new ApiFailure('ORIGIN_NOT_ALLOWED', `origin=${origin}`)
  }
}

/** Origin tambahan untuk deployment yang sah-sah saja berbeda origin (opsional). */
function extraAllowedOrigins(env: Env): string[] {
  return (env.APP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => normalizeOrigin(value.trim()))
    .filter((value) => value !== '')
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/, '')
}
