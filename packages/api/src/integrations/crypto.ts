import { ApiFailure } from '../http/errors'

const encoder = new TextEncoder()
function bytes(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), c => c.charCodeAt(0)) }
function base64(value: Uint8Array): string { return btoa(String.fromCharCode(...value)) }
async function key(secret: string | undefined) {
  if (!secret) throw new ApiFailure('INTERNAL_ERROR')
  return crypto.subtle.importKey('raw', bytes(secret), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function encrypt(value: string, secret: string | undefined): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(value))
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`
}
export async function decrypt(value: string, secret: string | undefined): Promise<string> {
  const [iv, data] = value.split('.')
  if (!iv || !data) throw new ApiFailure('INTERNAL_ERROR')
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, await key(secret), bytes(data)))
}
export async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('')
}
