import { describe, expect, it } from 'vitest'
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_MAX_AGE_SECONDS } from '../src/http/cookies'
import { ROUTES } from '../src/routes'
import { hashSessionToken } from '../src/auth/session-token'
import { createFakeState, createTestApi, fakeUser, makeRequest, readBody, readSetCookie } from './helpers'

type LoginData = {
  profile: { user_id: string; username: string; display_name: string; role: string; avatar_emoji: string | null }
  access_token: string
  expires_in: number
}

type FailureBody = { ok: false; error: { code: string; message: string } }

/** Baca payload JWT tanpa memverifikasi (verifikasi diuji di jwt.test.ts). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadPart = token.split('.')[1] ?? ''
  const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

async function login(api: Awaited<ReturnType<typeof createTestApi>>['api'], password = 'rahasia123') {
  return api(makeRequest({ method: 'POST', path: '/api/auth/login', body: { username: 'admin1', password } }))
}

describe('A. Authentication', () => {
  it('A01 login sah -> access token + refresh session aman', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const response = await login(api)
    expect(response.status).toBe(200)

    const body = await readBody<{ ok: true; data: LoginData }>(response)
    expect(body.ok).toBe(true)
    expect(body.data.profile).toMatchObject({
      user_id: 'user-admin',
      username: 'admin1',
      display_name: 'Admin Satu',
      role: 'admin',
      avatar_emoji: null,
    })
    expect(body.data.expires_in).toBe(30 * 60)

    // Atribut cookie (04 §7).
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain(`Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}`)

    // Yang tersimpan adalah HASH, bukan token yang dipegang klien (04 §6).
    const cookieToken = readSetCookie(response, REFRESH_COOKIE_NAME)
    expect(cookieToken).not.toBeNull()
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]?.token_hash).toBe(await hashSessionToken(cookieToken as string))
    expect(state.sessions[0]?.token_hash).not.toBe(cookieToken)
    expect(JSON.stringify(state.sessions)).not.toContain(cookieToken as string)

    // Claim access JWT (01 §2, A3).
    const claims = decodeJwtPayload(body.data.access_token)
    expect(claims['sub']).toBe('user-admin')
    expect(claims['app_user_id']).toBe('user-admin')
    expect(claims['app_role']).toBe('admin')
    expect(claims['role']).toBe('authenticated')
    expect(claims['aud']).toBe('authenticated')
    expect(claims['iss']).toBe('https://project.supabase.co/auth/v1')
    expect(Number(claims['exp']) - Number(claims['iat'])).toBe(30 * 60)
  })

  it('A02 password salah -> 401 INVALID_CREDENTIALS', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const response = await login(api, 'salah-sekali')
    expect(response.status).toBe(401)
    expect((await readBody<FailureBody>(response)).error.code).toBe('INVALID_CREDENTIALS')
    expect(state.sessions).toHaveLength(0)
  })

  it('A03 username tidak dikenal -> response identik dengan password salah', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const wrongPassword = await login(api, 'salah-sekali')
    const unknownUser = await api(
      makeRequest({ method: 'POST', path: '/api/auth/login', body: { username: 'tidak-ada', password: 'apa pun' } }),
    )

    expect(unknownUser.status).toBe(wrongPassword.status)
    expect(await readBody<FailureBody>(unknownUser)).toEqual(await readBody<FailureBody>(wrongPassword))
  })

  it('A04 user nonaktif -> login ditolak', async () => {
    const state = createFakeState({ users: [fakeUser({ active: false })] })
    const { api } = await createTestApi(state)

    const response = await login(api)
    expect(response.status).toBe(401)
    expect((await readBody<FailureBody>(response)).error.code).toBe('USER_DISABLED')
  })

  it('A05 logout -> sesi dicabut + cookie dihapus', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const loginResponse = await login(api)
    const token = readSetCookie(loginResponse, REFRESH_COOKIE_NAME) as string

    const response = await api(
      makeRequest({ method: 'POST', path: '/api/auth/logout', headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` } }),
    )

    expect(response.status).toBe(200)
    expect(state.sessions[0]?.revoked_at).not.toBeNull()
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('Max-Age=0')
  })

  it('A05 logout tanpa cookie tetap 200 (idempoten)', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const response = await api(makeRequest({ method: 'POST', path: '/api/auth/logout' }))
    expect(response.status).toBe(200)
  })

  it('A06 sesi dicabut -> refresh ditolak', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const loginResponse = await login(api)
    const token = readSetCookie(loginResponse, REFRESH_COOKIE_NAME) as string
    const withCookie = { cookie: `${REFRESH_COOKIE_NAME}=${token}` }

    const first = await api(makeRequest({ method: 'POST', path: '/api/auth/refresh', headers: withCookie }))
    expect(first.status).toBe(200)
    expect(state.sessions[0]?.last_used_at).toBe('2026-10-13T08:00:00.000Z')

    await api(makeRequest({ method: 'POST', path: '/api/auth/logout', headers: withCookie }))

    const afterLogout = await api(makeRequest({ method: 'POST', path: '/api/auth/refresh', headers: withCookie }))
    expect(afterLogout.status).toBe(401)
    expect((await readBody<FailureBody>(afterLogout)).error.code).toBe('SESSION_INVALID')
  })

  it('A06 sesi kedaluwarsa -> refresh ditolak', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const loginResponse = await login(api)
    const token = readSetCookie(loginResponse, REFRESH_COOKIE_NAME) as string

    const session = state.sessions[0]
    if (session === undefined) throw new Error('sesi tidak dibuat')
    session.expires_at = '2026-10-01T00:00:00.000Z' // sebelum `now` test

    const response = await api(
      makeRequest({ method: 'POST', path: '/api/auth/refresh', headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` } }),
    )
    expect(response.status).toBe(401)
    expect((await readBody<FailureBody>(response)).error.code).toBe('SESSION_INVALID')
  })

  it('A06 user dinonaktifkan -> refresh ditolak USER_DISABLED', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const loginResponse = await login(api)
    const token = readSetCookie(loginResponse, REFRESH_COOKIE_NAME) as string

    const user = state.users[0]
    if (user === undefined) throw new Error('user tidak ada')
    user.active = false

    const response = await api(
      makeRequest({ method: 'POST', path: '/api/auth/refresh', headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` } }),
    )
    expect(response.status).toBe(401)
    expect((await readBody<FailureBody>(response)).error.code).toBe('USER_DISABLED')
  })

  it('A07 refresh menerbitkan access JWT baru yang belum kedaluwarsa', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    let clock = new Date('2026-10-13T08:00:00.000Z')
    const { api } = await createTestApi(state, { now: () => clock })

    const loginResponse = await login(api)
    const token = readSetCookie(loginResponse, REFRESH_COOKIE_NAME) as string
    const firstClaims = decodeJwtPayload((await readBody<{ data: LoginData }>(loginResponse)).data.access_token)

    clock = new Date('2026-10-13T08:20:00.000Z')
    const refreshResponse = await api(
      makeRequest({ method: 'POST', path: '/api/auth/refresh', headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` } }),
    )
    expect(refreshResponse.status).toBe(200)

    const secondClaims = decodeJwtPayload(
      (await readBody<{ data: LoginData }>(refreshResponse)).data.access_token,
    )
    expect(Number(secondClaims['exp'])).toBeGreaterThan(Number(firstClaims['exp']))
    expect(secondClaims['sub']).toBe(firstClaims['sub'])
  })

  it('A08 ganti password dengan password lama salah -> ditolak', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const loginResponse = await login(api)
    const accessToken = (await readBody<{ data: LoginData }>(loginResponse)).data.access_token

    const response = await api(
      makeRequest({
        method: 'POST',
        path: '/api/auth/change-password',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { current_password: 'bukan-ini', new_password: 'passwordbaru1', new_password_confirmation: 'passwordbaru1' },
      }),
    )

    expect(response.status).toBe(401)
    expect((await readBody<FailureBody>(response)).error.code).toBe('INVALID_CREDENTIALS')
    expect(state.users[0]?.password).toBe('rahasia123')
  })

  it('A08 konfirmasi tidak sama -> PASSWORD_MISMATCH, tanpa menyentuh password', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    const loginResponse = await login(api)
    const accessToken = (await readBody<{ data: LoginData }>(loginResponse)).data.access_token

    const response = await api(
      makeRequest({
        method: 'POST',
        path: '/api/auth/change-password',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { current_password: 'rahasia123', new_password: 'passwordbaru1', new_password_confirmation: 'beda' },
      }),
    )

    expect(response.status).toBe(400)
    expect((await readBody<FailureBody>(response)).error.code).toBe('PASSWORD_MISMATCH')
    expect(state.users[0]?.password).toBe('rahasia123')
  })

  it('A09 ganti password berhasil -> seluruh sesi user dicabut', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    // Dua sesi: dua perangkat.
    const firstLogin = await login(api)
    const secondLogin = await login(api)
    const accessToken = (await readBody<{ data: LoginData }>(secondLogin)).data.access_token
    const firstToken = readSetCookie(firstLogin, REFRESH_COOKIE_NAME) as string

    expect(state.sessions).toHaveLength(2)

    const response = await api(
      makeRequest({
        method: 'POST',
        path: '/api/auth/change-password',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { current_password: 'rahasia123', new_password: 'passwordbaru1', new_password_confirmation: 'passwordbaru1' },
      }),
    )

    expect(response.status).toBe(200)
    expect((await readBody<{ data: { revoked_sessions: number } }>(response)).data.revoked_sessions).toBe(2)
    expect(state.sessions.every((session) => session.revoked_at !== null)).toBe(true)

    // Cookie refresh klien ini juga dibersihkan; klien harus login ulang.
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0')

    // Sesi lama benar-benar mati.
    const staleRefresh = await api(
      makeRequest({
        method: 'POST',
        path: '/api/auth/refresh',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=${firstToken}` },
      }),
    )
    expect(staleRefresh.status).toBe(401)

    // Password baru berlaku.
    const relogin = await login(api, 'passwordbaru1')
    expect(relogin.status).toBe(200)
  })

  it('A10 tidak ada endpoint signup/registrasi', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    for (const path of ['/api/auth/register', '/api/auth/signup', '/api/auth/forgot-password']) {
      const response = await api(makeRequest({ method: 'POST', path, body: {} }))
      expect(response.status).toBe(404)
    }

    // Tidak ada satu pun rute publik yang dapat membuat akun.
    expect(ROUTES.map((route) => route.path)).not.toContain('/api/auth/register')
    expect(ROUTES.map((route) => route.handler.name)).not.toContain('register')
    expect(ROUTES.map((route) => route.handler.name)).not.toContain('signup')

    // Daftar lengkap rute terbuka — hanya ini, dan tidak satu pun dapat membuat
    // akun. Webhook terbuka karena otorisasinya secret pada path (01 §20);
    // rute peserta terbuka karena Order ID adalah identitas akses (04 §12).
    expect(ROUTES.filter((route) => route.auth === 'none').map((route) => route.path)).toEqual([
      '/api/webhooks/orderonline/:connectionId/:webhookSecret',
      '/api/webhooks/orderonline/:webhookSecret',
      '/api/auth/login',
      '/api/auth/refresh',
      '/api/auth/logout',
      '/access/:orderId',
      '/checkin/:orderId',
    ])
  })

  it('login dengan body tidak lengkap -> 400 tanpa menyentuh database', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api } = await createTestApi(state)

    for (const body of [{}, { username: 'admin1' }, { password: 'x' }, { username: '   ', password: 'x' }]) {
      const response = await api(makeRequest({ method: 'POST', path: '/api/auth/login', body }))
      expect(response.status).toBe(400)
      expect((await readBody<FailureBody>(response)).error.code).toBe('INVALID_PAYLOAD')
    }
    expect(state.rpcCalls).toHaveLength(0)
  })
})
