import { base64UrlEncode } from './base64url'

/**
 * Refresh session opaque (01 §2, 03 §5).
 *
 * Panjang 32 byte dari CSPRNG. Nilai mentahnya hanya pernah ada di cookie
 * klien; database menyimpan hash-nya saja (04 §6), sehingga bocornya tabel
 * `app_sessions` tidak langsung memberi sesi yang bisa dipakai.
 */
export const SESSION_TOKEN_BYTES = 32

export function generateSessionToken(): string {
  const bytes = new Uint8Array(SESSION_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

/**
 * Hash token untuk lookup.
 *
 * SHA-256, bukan bcrypt/PBKDF2: token ini 256 bit acak, jadi tidak dapat
 * ditebak maupun di-*brute force*; KDF yang lambat hanya akan membakar CPU
 * setiap refresh tanpa menambah keamanan.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
