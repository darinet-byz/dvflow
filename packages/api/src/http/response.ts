import { ERROR_CATALOG, type ApiErrorCode } from './errors'

/** Bentuk sukses yang dikontrak (03 §1). */
export function ok<T>(data: T, init: ResponseInit = {}): Response {
  return jsonResponse({ ok: true, data }, init)
}

/** Bentuk gagal yang dikontrak (03 §1). */
export function fail(code: ApiErrorCode, init: ResponseInit = {}, message?: string): Response {
  const entry = ERROR_CATALOG[code]
  return jsonResponse(
    { ok: false, error: { code, message: message ?? entry.message } },
    { ...init, status: init.status ?? entry.status },
  )
}

function jsonResponse(body: unknown, init: ResponseInit): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  // Respons API selalu spesifik per permintaan; jangan pernah di-cache.
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}

/**
 * Baca body JSON sebagai objek.
 *
 * Hanya menerima objek JSON: array, string, dan `null` ditolak supaya handler
 * tidak perlu memvalidasi bentuk akar berulang kali.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}

/** Ambil string non-kosong dari body, atau null. Tidak melakukan trim aturan bisnis. */
export function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  return typeof value === 'string' ? value : null
}
