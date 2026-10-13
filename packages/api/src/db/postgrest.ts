import type { Env } from '../env'
import { DbError, type Db } from './types'

/**
 * Implementasi `Db` di atas PostgREST Supabase.
 *
 * Memakai `fetch` mentah, bukan `supabase-js`: yang dibutuhkan hanya RPC dan
 * empat operasi tabel, sehingga satu dependensi runtime tidak sepadan (06 §12).
 *
 * Service key hanya hidup di sini dan hanya dikirim ke Supabase (04 §5).
 */
export function createPostgrestDb(env: Env, fetchImpl: typeof fetch = fetch): Db {
  const restUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
  const authHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
  }

  return {
    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const response = await fetchImpl(`${restUrl}/rpc/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(args),
      })
      await ensureOk(response, `rpc ${name}`)
      if (response.status === 204) return undefined as T
      const text = await response.text()
      if (!text || text.trim() === '') return undefined as T
      return JSON.parse(text) as T
    },

    async selectRows<T>(table: string, query: Record<string, string>, columns: string): Promise<T[]> {
      const search = buildQuery({ ...query, select: columns })
      const response = await fetchImpl(`${restUrl}/${table}?${search}`, { headers: authHeaders })
      await ensureOk(response, `select ${table}`)
      return (await response.json()) as T[]
    },

    async insertRow<T>(table: string, row: Record<string, unknown>, columns = '*'): Promise<T> {
      const response = await fetchImpl(`${restUrl}/${table}?select=${encodeURIComponent(columns)}`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'content-type': 'application/json',
          // Tanpa `return=representation`, PostgREST tidak mengembalikan baris
          // yang baru dibuat dan pemanggil kehilangan id-nya.
          prefer: 'return=representation',
        },
        body: JSON.stringify(row),
      })
      await ensureOk(response, `insert ${table}`)
      const rows = (await response.json()) as T[]
      const created = rows[0]
      if (created === undefined) throw new DbError('PGRST_EMPTY', `insert ${table} tidak mengembalikan baris`)
      return created
    },

    async updateRows(table: string, query: Record<string, string>, patch: Record<string, unknown>): Promise<void> {
      const response = await fetchImpl(`${restUrl}/${table}?${buildQuery(query)}`, {
        method: 'PATCH',
        headers: {
          ...authHeaders,
          'content-type': 'application/json',
          prefer: 'return=minimal',
        },
        body: JSON.stringify(patch),
      })
      await ensureOk(response, `update ${table}`)
    },

    async deleteRows(table: string, query: Record<string, string>): Promise<void> {
      const response = await fetchImpl(`${restUrl}/${table}?${buildQuery(query)}`, {
        method: 'DELETE',
        headers: {
          ...authHeaders,
          prefer: 'return=minimal',
        },
      })
      await ensureOk(response, `delete ${table}`)
    },
  }
}

function buildQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

/**
 * Ubah response gagal menjadi `DbError`.
 *
 * `code` dari PostgREST adalah SQLSTATE asli untuk error yang di-RAISE database
 * kita (mis. `DF004`), sehingga pemetaan ke kode API dapat dilakukan di satu
 * tempat. Pesan mentah hanya dipakai untuk log server, tidak pernah dikirim ke
 * klien (03 §1).
 */
async function ensureOk(response: Response, context: string): Promise<void> {
  if (response.ok) return

  let sqlState = String(response.status)
  let message = response.statusText
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown }
    if (typeof body.code === 'string' && body.code !== '') sqlState = body.code
    if (typeof body.message === 'string' && body.message !== '') message = body.message
  } catch {
    // Body bukan JSON (mis. halaman error proxy) — pakai status HTTP saja.
  }

  throw new DbError(sqlState, `${context}: ${message}`)
}
