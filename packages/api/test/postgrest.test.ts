import { describe, expect, it } from 'vitest'
import { createPostgrestDb } from '../src/db/postgrest'
import { DbError } from '../src/db/types'
import { createTestEnv } from './helpers'

describe('createPostgrestDb rpc response handling', () => {
  it('handles 204 No Content gracefully without JSON parse error', async () => {
    const env = await createTestEnv()
    const mockFetch: typeof fetch = async (url, init) => {
      expect(String(url)).toContain('/rpc/save_webinar_destination')
      expect(init?.method).toBe('POST')
      return new Response(null, { status: 204, statusText: 'No Content' })
    }

    const db = createPostgrestDb(env, mockFetch)
    const result = await db.rpc('save_webinar_destination', { p_product_raw: 'KM01', p_destination: 'https://zoom.us/j/123' })
    expect(result).toBeUndefined()
  })

  it('handles 200 with empty string body gracefully', async () => {
    const env = await createTestEnv()
    const mockFetch: typeof fetch = async () => {
      return new Response('', { status: 200, statusText: 'OK' })
    }

    const db = createPostgrestDb(env, mockFetch)
    const result = await db.rpc('save_seminar_ticket', {})
    expect(result).toBeUndefined()
  })

  it('returns parsed JSON for successful RPC that returns data', async () => {
    const env = await createTestEnv()
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ user_id: '123', display_name: 'Admin' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const db = createPostgrestDb(env, mockFetch)
    const result = await db.rpc<{ user_id: string; display_name: string }>('verify_login', {})
    expect(result).toEqual({ user_id: '123', display_name: 'Admin' })
  })

  it('throws DbError with sqlState when PostgREST returns error', async () => {
    const env = await createTestEnv()
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ code: 'DF004', message: 'Kredensial tidak valid' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }

    const db = createPostgrestDb(env, mockFetch)
    await expect(db.rpc('verify_login', {})).rejects.toThrow(DbError)
  })
})

