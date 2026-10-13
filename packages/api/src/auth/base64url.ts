/**
 * Base64URL (RFC 4648 §5) — encoding yang dipakai JWT dan token sesi.
 *
 * Memakai `btoa`/`atob` yang tersedia di Worker, Pages Functions, dan Node,
 * sehingga paket ini tetap tanpa dependensi.
 */

const BASE64_PLUS = /\+/g
const BASE64_SLASH = /\//g
const BASE64_PADDING = /=+$/

/**
 * Tipe kembalian ditulis `Uint8Array<ArrayBuffer>`, bukan `Uint8Array` biasa:
 * `BufferSource` yang diterima Web Crypto mensyaratkan buffer `ArrayBuffer`
 * (bukan `ArrayBufferLike`/`SharedArrayBuffer`), dan TypeScript 5.9 membedakan
 * keduanya.
 */
export function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value)
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(BASE64_PLUS, '-').replace(BASE64_SLASH, '_').replace(BASE64_PADDING, '')
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = padded.length % 4
  const binary = atob(remainder === 0 ? padded : padded + '='.repeat(4 - remainder))

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function base64UrlEncodeUtf8(value: string): string {
  return base64UrlEncode(utf8Bytes(value))
}

export function base64UrlDecodeUtf8(value: string): string {
  return new TextDecoder().decode(base64UrlDecode(value))
}
