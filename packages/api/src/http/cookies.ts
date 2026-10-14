import { SESSION_LIFETIME_SECONDS } from '@dvflow/shared'

/**
 * Cookie refresh session (04 §7).
 *
 * Nama cookie adalah detail implementasi (dokumen tidak menetapkannya).
 */
export const REFRESH_COOKIE_NAME = 'dvflow_refresh'

export const REFRESH_COOKIE_MAX_AGE_SECONDS = SESSION_LIFETIME_SECONDS

/**
 * Atribut cookie refresh.
 *
 * `HttpOnly`  : JavaScript tidak dapat membacanya, sehingga XSS tidak langsung
 *               memberi penyerang sesi 7 hari.
 * `Secure`    : hanya lewat HTTPS (localhost tetap dianggap secure context).
 * `SameSite=Lax`: permintaan lintas situs tidak membawa cookie ini — pertahanan
 *               pertama terhadap CSRF, dilengkapi pemeriksaan Origin (04 §8).
 * `Path=/`    : berlaku untuk seluruh aplikasi.
 */
export function setRefreshCookie(token: string, maxAgeSeconds = REFRESH_COOKIE_MAX_AGE_SECONDS): string {
  return [
    `${REFRESH_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

export function clearRefreshCookie(): string {
  return `${REFRESH_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

/** Baca nilai cookie dari header `Cookie`. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (header === null) return null

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    return value.length > 0 ? value : null
  }
  return null
}
