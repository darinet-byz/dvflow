import { describe, expect, it } from 'vitest'
import type { AppRole } from '@dvflow/shared'
import { createJwtSigner } from '../src/auth/jwt'
import { DbError, type Db } from '../src/db/types'
import { createApi, matchRoute } from '../src/router'
import { ROUTES } from '../src/routes'
import {
  FIXED_NOW,
  TEST_ORIGIN,
  createApiWithEnv,
  createFakeState,
  createTestEnv,
  fakeUser,
  makeRequest,
  readBody,
  readSetCookie,
} from './helpers'
import { REFRESH_COOKIE_NAME } from '../src/http/cookies'

type FailureBody = { ok: false; error: { code: string; message: string } }

describe('L. Batas keamanan', () => {
  it('L01/L02 tidak ada secret yang pernah masuk ke response', async () => {
    const env = await createTestEnv()

    // Db yang selalu gagal dengan kesalahan tak dikenal: response harus tetap
    // generik, tanpa pesan database, tanpa stack, tanpa secret (03 §1, 04 §14).
    const explodingDb: Db = {
      async rpc() {
        throw new DbError('42P01', 'relation "secret_table" does not exist')
      },
      async selectRows() {
        throw new DbError('42P01', 'relation "secret_table" does not exist')
      },
      async insertRow() {
        throw new DbError('42P01', 'relation "secret_table" does not exist')
      },
      async updateRows() {
        throw new DbError('42P01', 'relation "secret_table" does not exist')
      },
      async deleteRows() {
        throw new DbError('42P01', 'relation "secret_table" does not exist')
      },
    }

    const api = createApi({ env, db: explodingDb, routes: ROUTES, now: FIXED_NOW })
    const response = await api(
      makeRequest({ method: 'POST', path: '/api/auth/login', body: { username: 'admin1', password: 'rahasia123' } }),
    )

    expect(response.status).toBe(500)
    const raw = await response.text()
    expect(JSON.parse(raw)).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server.' },
    })

    for (const secret of [env.SUPABASE_SECRET_KEY, env.APP_JWT_PRIVATE_KEY, 'secret_table', '42P01', 'BEGIN']) {
      expect(raw).not.toContain(secret)
    }
    expect(raw).not.toContain('stack')
  })

  it('L05 respons error hanya memuat code + message, tanpa detail internal', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createApiWithEnvSelf(state)

    const response = await api(
      makeRequest({ method: 'POST', path: '/api/auth/login', body: { username: 'admin1', password: 'salah' } }),
    )
    const body = await readBody<FailureBody>(response)

    expect(Object.keys(body).sort()).toEqual(['error', 'ok'])
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message'])
    expect(typeof body.error.message).toBe('string')
  })

  it('CSRF: refresh tanpa header Origin ditolak', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createApiWithEnvSelf(state)

    const response = await api(makeRequest({ method: 'POST', path: '/api/auth/refresh', origin: null }))
    expect(response.status).toBe(403)
    expect((await readBody<FailureBody>(response)).error.code).toBe('ORIGIN_NOT_ALLOWED')
  })

  it('CSRF: refresh dari origin asing ditolak, walau cookie valid', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createApiWithEnvSelf(state)

    const loginResponse = await api(
      makeRequest({ method: 'POST', path: '/api/auth/login', body: { username: 'admin1', password: 'rahasia123' } }),
    )
    const token = readSetCookie(loginResponse, REFRESH_COOKIE_NAME) as string

    const crossSite = await api(
      makeRequest({
        method: 'POST',
        path: '/api/auth/refresh',
        origin: 'https://penyerang.example',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` },
      }),
    )
    expect(crossSite.status).toBe(403)
    expect(state.sessions[0]?.last_used_at).toBeNull()
  })

  it('CSRF: origin `null` (iframe ter-sandbox) ditolak', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createApiWithEnvSelf(state)

    const response = await api(makeRequest({ method: 'POST', path: '/api/auth/logout', origin: 'null' }))
    expect(response.status).toBe(403)
  })

  it('CSRF: origin yang sama diizinkan, dan allowlist environment juga dihormati', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const env = await createTestEnv({ APP_ALLOWED_ORIGINS: 'https://preview.pages.dev' })
    const api = createApiWithEnv(env, state)

    const sameOrigin = await api(makeRequest({ method: 'POST', path: '/api/auth/logout', origin: TEST_ORIGIN }))
    expect(sameOrigin.status).toBe(200)

    const allowlisted = await api(
      makeRequest({ method: 'POST', path: '/api/auth/logout', origin: 'https://preview.pages.dev' }),
    )
    expect(allowlisted.status).toBe(200)

    const notAllowed = await api(
      makeRequest({ method: 'POST', path: '/api/auth/logout', origin: 'https://lain.example' }),
    )
    expect(notAllowed.status).toBe(403)
  })

  it('endpoint ber-Bearer tidak bergantung pada cookie, dan menolak token cacat', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createApiWithEnvSelf(state)

    for (const authorization of ['', 'Basic abc', 'Bearer', 'Bearer bukan-token', 'Bearer a.b.c']) {
      const headers: Record<string, string> = {}
      if (authorization !== '') headers['authorization'] = authorization

      const response = await api(makeRequest({ method: 'GET', path: '/api/profile', headers }))
      expect(response.status).toBe(401)
      expect((await readBody<FailureBody>(response)).error.code).toBe('SESSION_INVALID')
    }
  })

  it('rute tidak dikenal -> 404, dan metode salah -> 404 (bukan 405)', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createApiWithEnvSelf(state)

    expect((await api(makeRequest({ method: 'GET', path: '/api/tidak-ada' }))).status).toBe(404)
    expect((await api(makeRequest({ method: 'GET', path: '/api/auth/login' }))).status).toBe(404)
    expect((await api(makeRequest({ method: 'DELETE', path: '/api/profile', origin: TEST_ORIGIN }))).status).toBe(404)
  })

  it('matchRoute menolak path yang mirip dan mendukung path parameter', () => {
    expect(matchRoute(ROUTES, 'POST', '/api/auth/login/extra')).toBeNull()
    expect(matchRoute(ROUTES, 'POST', '/api/internal/users/')).toBeNull()
    expect(matchRoute(ROUTES, 'PATCH', '/api/profile')?.params).toEqual({})

    const withParam = matchRoute(
      [{ method: 'POST', path: '/api/webhooks/orderonline/:webhookSecret', handler: async () => new Response(), auth: 'none' }],
      'POST',
      '/api/webhooks/orderonline/rahasia-panjang',
    )
    expect(withParam?.params['webhookSecret']).toBe('rahasia-panjang')
  })

  it('ApiFailure tidak pernah membocorkan logContext ke klien', async () => {
    // Jalur nyata: requireActiveUser melempar USER_DISABLED dengan id user di
    // logContext. Response tidak boleh memuat id itu.
    const secretUserId = 'user-rahasia-12345'
    const state = createFakeState({ users: [fakeUser({ id: secretUserId, active: false })] })
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)
    const token = await signer.mint({
      userId: secretUserId,
      appRole: 'admin' as AppRole,
      now: new Date('2026-10-13T08:00:00.000Z'),
    })

    const api = createApiWithEnv(env, state)
    const response = await api(
      makeRequest({ method: 'GET', path: '/api/profile', headers: { authorization: `Bearer ${token}` } }),
    )

    expect(response.status).toBe(401)
    const raw = await response.text()
    // Yang bocor akan berbentuk "user <id> nonaktif" (logContext). Pesan resmi
    // untuk pengguna — "Akun ini dinonaktifkan." — memang memuat kata
    // "dinonaktifkan", jadi yang diperiksa adalah bentuk logContext-nya.
    expect(raw).not.toContain(secretUserId)
    expect(raw).not.toContain(`${secretUserId} nonaktif`)
    expect(JSON.parse(raw)).toEqual({
      ok: false,
      error: { code: 'USER_DISABLED', message: 'Akun ini dinonaktifkan.' },
    })
  })
})

/** API dengan env test standar. */
async function createApiWithEnvSelf(state: ReturnType<typeof createFakeState>) {
  const env = await createTestEnv()
  return { api: createApiWithEnv(env, state), env }
}
