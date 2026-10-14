import { ApiError, type ApiErrorCode } from './api'
import { readPublicEnv } from './env'
import { getAccessToken, refreshProfile } from './session'

/**
 * Baca langsung Browser → Supabase (02 §14, STATE.md K2/K11).
 *
 * Data besar (Order, Presensi, Dashboard, Report Tax, konfigurasi) TIDAK
 * dialihkan lewat backend: browser memakai access JWT dan RLS yang menegakkan
 * batasnya. Yang lewat backend hanya penulisan dan hal yang butuh service key.
 *
 * Service key TIDAK pernah ada di sini. Yang dipakai adalah publishable key
 * (memang publik) + access JWT milik pengguna, sehingga setiap baris tetap
 * melewati policy RLS.
 */

export type Query = Record<string, string>

export async function supabaseSelect<T>(table: string, query: Query, columns: string): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await restRequest<T[]>(`/${table}?${buildQuery({ ...query, order: query['order'] ?? 'id.asc', limit: '500', offset: String(offset), select: columns })}`, 'GET')
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

export async function supabaseRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return restRequest<T>(`/rpc/${encodeURIComponent(fn)}`, 'POST', args)
}

async function restRequest<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const env = readPublicEnv()
  const token = getAccessToken()
  if (token === null) throw new ApiError('SESSION_INVALID', 'Belum login.', 401)

  const headers = new Headers({
    apikey: env.supabasePublishableKey,
    authorization: `Bearer ${token}`,
  })
  if (body !== undefined) headers.set('content-type', 'application/json')

  const init: RequestInit = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)

  const response = await fetch(`${env.supabaseUrl.replace(/\/+$/, '')}/rest/v1${path}`, init)
  if (!response.ok) {
    const error = await toApiError(response)
    if (error.code === 'FORBIDDEN' || error.code === 'FORBIDDEN_REPORT_TAX') await refreshProfile()
    throw error
  }

  return (await response.json()) as T
}

/**
 * Peta SQLSTATE → kode error aplikasi.
 *
 * PostgREST mengembalikan SQLSTATE kustom kita sebagai `code` di body, dan
 * memetakan status HTTP-nya sendiri: kode yang tidak dikenal menjadi 400.
 * Karena itu status HTTP saja tidak cukup — tanpa peta ini, penolakan
 * `FORBIDDEN_REPORT_TAX` akan terbaca sebagai "kesalahan server" dan halaman
 * Report Tax tidak dapat menjelaskan apa yang sebenarnya terjadi.
 *
 * Hanya kode yang MUNGKIN diterima jalur baca yang ada di sini; pesan
 * Indonesia-nya diambil dari katalog lokal karena `message` dari RPC berisi
 * nama kode, bukan kalimat.
 */
const SQLSTATE_TO_CODE: Record<string, ApiErrorCode> = {
  DF006: 'FORBIDDEN',
  DF011: 'INVALID_ARGUMENT',
  DF012: 'FORBIDDEN_REPORT_TAX',
  // `insufficient_privilege` standar Postgres — dipetakan PostgREST ke 403.
  '42501': 'FORBIDDEN',
  // RPC/tabel/kolom belum ada: database tertinggal dari versi aplikasi.
  PGRST202: 'SCHEMA_OUT_OF_DATE',
  PGRST205: 'SCHEMA_OUT_OF_DATE',
  '42883': 'SCHEMA_OUT_OF_DATE',
  '42703': 'SCHEMA_OUT_OF_DATE',
  '42P01': 'SCHEMA_OUT_OF_DATE',
}

const LOCAL_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  SESSION_INVALID: 'Sesi berakhir. Silakan login kembali.',
  FORBIDDEN: 'Anda tidak memiliki akses ke data ini.',
  FORBIDDEN_REPORT_TAX: 'Anda tidak memiliki izin membuka Report Tax.',
  INVALID_ARGUMENT: 'Permintaan data tidak valid.',
  NOT_FOUND: 'Data tidak ditemukan.',
  SCHEMA_OUT_OF_DATE: 'Database belum diperbarui ke versi aplikasi ini. Hubungi developer.',
  INTERNAL_ERROR: 'Data tidak dapat dimuat.',
}

async function toApiError(response: Response): Promise<ApiError> {
  let sqlState: string | null = null
  try {
    const body = (await response.json()) as { code?: unknown }
    if (typeof body.code === 'string' && body.code !== '') sqlState = body.code
  } catch {
    // Body bukan JSON; jatuh ke pemetaan berdasarkan status HTTP.
  }

  const mapped = sqlState === null ? undefined : SQLSTATE_TO_CODE[sqlState]
  if (mapped !== undefined) {
    return new ApiError(mapped, LOCAL_MESSAGES[mapped] ?? 'Permintaan data gagal.', response.status)
  }

  // 401 memaksa login ulang; 403 TIDAK — pengguna sudah login, ia hanya tidak
  // berhak. Menyamakan keduanya akan membuat penolakan izin terasa seperti
  // sesi yang mati, dan memicu refresh yang tidak perlu.
  if (response.status === 401) {
    return new ApiError('SESSION_INVALID', LOCAL_MESSAGES['SESSION_INVALID'] as string, 401)
  }
  if (response.status === 403) {
    return new ApiError('FORBIDDEN', LOCAL_MESSAGES['FORBIDDEN'] as string, 403)
  }

  return new ApiError('INTERNAL_ERROR', LOCAL_MESSAGES['INTERNAL_ERROR'] as string, response.status)
}

function buildQuery(params: Query): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}
