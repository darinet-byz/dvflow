import type { AppRole } from '@dvflow/shared'
import { readPublicEnv } from './env'

/**
 * Klien backend dvflow (`packages/api`).
 *
 * Semua endpoint mengembalikan envelope yang sama (03 §1), jadi seluruh
 * penanganan bentuk response ada di satu tempat ini.
 */
export type ApiErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'SESSION_INVALID'
  | 'USER_DISABLED'
  | 'FORBIDDEN'
  | 'ORIGIN_NOT_ALLOWED'
  | 'INVALID_PAYLOAD'
  | 'INVALID_ARGUMENT'
  | 'WEAK_PASSWORD'
  | 'PASSWORD_MISMATCH'
  | 'USERNAME_TAKEN'
  | 'MASTER_ADMIN_CREATE_FORBIDDEN'
  | 'UNSUPPORTED_ORDER_STATUS'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_PAID'
  | 'NOT_SEMINAR_ORDER'
  | 'CODE_TAKEN'
  | 'IDENTIFIER_TAKEN'
  | 'CODE_AMBIGUOUS'
  | 'MASTER_IN_USE'
  | 'RESOURCE_NOT_FOUND'
  | 'FORBIDDEN_REPORT_TAX'
  | 'FORBIDDEN_PRODUCT_ACCESS'
  | 'AD_SPEND_OVERLAP'
  | 'AD_SPEND_NOT_FOUND'
  | 'ROLE_IN_USE'
  | 'SYSTEM_ROLE_CANNOT_BE_DELETED'
  | 'SCHEMA_OUT_OF_DATE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: ApiErrorCode; message: string } }

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  body?: unknown
  /** Access token; dikirim sebagai `Authorization: Bearer`. */
  accessToken?: string | null
  signal?: AbortSignal
}

/**
 * Panggil backend.
 *
 * Mengembalikan `data` dari envelope sukses dan melempar `ApiError` bila gagal —
 * sehingga pemanggil tidak perlu memeriksa `ok` berulang kali.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const env = readPublicEnv()
  const headers = new Headers()

  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (options.accessToken !== undefined && options.accessToken !== null) {
    headers.set('authorization', `Bearer ${options.accessToken}`)
  }

  const init: RequestInit = { method: options.method ?? 'GET', headers, credentials: 'same-origin' }
  if (options.body !== undefined) init.body = JSON.stringify(options.body)
  if (options.signal !== undefined) init.signal = options.signal

  let response: Response
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, init)
  } catch {
    throw new ApiError('INTERNAL_ERROR', 'Tidak dapat menghubungi server. Periksa koneksi Anda.', 0)
  }

  let envelope: Envelope<T> | null = null
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    envelope = null
  }

  if (envelope === null) {
    throw new ApiError('INTERNAL_ERROR', 'Respons server tidak dikenali.', response.status)
  }

  if (!envelope.ok) {
    throw new ApiError(envelope.error.code, envelope.error.message, response.status)
  }

  // `set-cookie` tidak dapat dibaca JavaScript, dan memang tidak perlu: yang
  // dibutuhkan halaman (profil + access token) ada di dalam `data` (03 §4/§5).
  return envelope.data
}

export type Profile = {
  user_id: string
  username: string
  display_name: string
  role: AppRole
  /** Nama role dari Konfigurasi Role; sumber label yang sama dengan Add Team. */
  role_name?: string
  avatar_emoji: string | null
  has_all_product_access?: boolean
  allowed_product_codes?: string[]
  /** A20: pengiklan yang dipegang akun Advertiser. */
  advertiser_code?: string | null
  advertiser_name?: string | null
  permissions?: string[]
}

export type SessionPayload = {
  profile: Profile
  access_token: string
  expires_in: number
}
