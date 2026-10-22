import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createHandler, REFRESH_COOKIE_NAME, type Api, type Env } from '../../src/index'
import { hashSessionToken } from '../../src/auth/session-token'
import { createTestEnv, makeRequest, readBody, readSetCookie } from '../helpers'

/**
 * Test integrasi auth terhadap Supabase lokal yang SESUNGGUHNYA.
 *
 * Yang hanya dapat dibuktikan di sini (dan tidak di test unit tiruan):
 *   1. nama argumen RPC yang dikirim handler benar-benar cocok dengan tanda
 *      tangan fungsi di database;
 *   2. PostgREST mengembalikan SQLSTATE kustom kita (`DF0xx`) sebagai `code`,
 *      sehingga pemetaan ke kode error API bekerja;
 *   3. bcrypt di database benar-benar memverifikasi password;
 *   4. baris `app_sessions` yang tersimpan adalah HASH, bukan token mentah;
 *   5. penulisan lewat service key benar-benar diterima RLS/GRANT.
 *
 * Cara menjalankan (Docker menyala):
 *   npm run db:start
 *   eval "$(supabase status -o env | sed 's/^/export /')"   # bash
 *   npm -w @dvflow/api run test:integration
 */

const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
const envVars = processLike?.env ?? {}

const SUPABASE_URL = envVars['SUPABASE_URL']
const SUPABASE_SECRET_KEY = envVars['SUPABASE_SECRET_KEY']
const SUPABASE_DB_URL = envVars['SUPABASE_DB_URL']

const configured = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY && SUPABASE_DB_URL)

if (!configured) {
  console.warn(
    '\n[integrasi] dilewati: SUPABASE_URL / SUPABASE_SECRET_KEY / SUPABASE_DB_URL tidak diset.\n' +
      'Jalankan `supabase status -o env` lalu ekspor ketiganya.\n',
  )
}

const run = configured ? describe : describe.skip
const ORIGIN = 'https://app.example.com'

type FailureBody = { ok: false; error: { code: string; message: string } }
type LoginData = { profile: { user_id: string; username: string }; access_token: string }

run('integrasi auth terhadap Supabase lokal', () => {
  const suffix = `${Date.now()}`.slice(-8)
  const adminUsername = `e2e_admin_${suffix}`
  const bossUsername = `e2e_boss_${suffix}`
  const createdUsername = `e2e_new_${suffix}`

  let client: Client | undefined
  let api: Api
  let env: Env

  /** Akses koneksi yang sudah pasti terjalin (menghindari `possibly undefined`). */
  function db(): Client {
    if (client === undefined) throw new Error('koneksi pg belum siap')
    return client
  }

  beforeAll(async () => {
    client = new Client({ connectionString: SUPABASE_DB_URL })
    await client.connect()

    // Hash dibuat database (pgcrypto), sama seperti jalur produksi (A1).
    await db().query(
      `insert into public.users (username, display_name, password_hash, password_algo, role)
       values
         ($1, 'E2E Admin', extensions.crypt('rahasia123', extensions.gen_salt('bf', 4)), 'bcrypt', 'admin'),
         ($2, 'E2E Boss',  extensions.crypt('rahasia123', extensions.gen_salt('bf', 4)), 'bcrypt', 'owner')`,
      [adminUsername, bossUsername],
    )

    env = await createTestEnv({
      SUPABASE_URL: SUPABASE_URL as string,
      SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY as string,
    })
    api = createHandler(env)
  })

  afterAll(async () => {
    if (client === undefined) return
    await db().query(`delete from public.users where username like 'e2e\\_%' escape '\\'`)
    await client.end()
  })

  async function login(username: string, password: string): Promise<Response> {
    return api(makeRequest({ method: 'POST', path: '/api/auth/login', body: { username, password } }))
  }

  it('A01 login nyata: bcrypt terverifikasi, sesi disimpan sebagai hash', async () => {
    const response = await login(adminUsername, 'rahasia123')
    expect(response.status).toBe(200)

    const data = (await readBody<{ ok: true; data: LoginData }>(response)).data
    expect(data.profile.username).toBe(adminUsername)

    const token = readSetCookie(response, REFRESH_COOKIE_NAME)
    expect(token).not.toBeNull()

    const { rows } = await db().query<{ token_hash: string; user_id: string }>(
      'select token_hash, user_id from public.app_sessions where user_id = (select id from public.users where username = $1)',
      [adminUsername],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token_hash).toBe(await hashSessionToken(token as string))
    expect(rows[0]?.token_hash).not.toBe(token)
  })

  it('A03 username case-insensitive; A02 password salah -> DF004 dipetakan ke 401', async () => {
    const upper = await login(adminUsername.toUpperCase(), 'rahasia123')
    expect(upper.status).toBe(200)

    const wrong = await login(adminUsername, 'jelas-salah')
    expect(wrong.status).toBe(401)
    expect((await readBody<FailureBody>(wrong)).error.code).toBe('INVALID_CREDENTIALS')
  })

  it('A05/A06 refresh memperbarui last_used_at; logout mencabut sesi di database', async () => {
    const loginResponse = await login(adminUsername, 'rahasia123')
    const token = readSetCookie(loginResponse, REFRESH_COOKIE_NAME) as string
    const cookie = { cookie: `${REFRESH_COOKIE_NAME}=${token}` }

    const refreshed = await api(makeRequest({ method: 'POST', path: '/api/auth/refresh', headers: cookie }))
    expect(refreshed.status).toBe(200)

    const { rows } = await db().query<{ last_used_at: string | null }>(
      'select last_used_at from public.app_sessions where token_hash = $1',
      [await hashSessionToken(token)],
    )
    expect(rows[0]?.last_used_at).not.toBeNull()

    const logoutResponse = await api(makeRequest({ method: 'POST', path: '/api/auth/logout', headers: cookie }))
    expect(logoutResponse.status).toBe(200)

    const afterLogout = await api(makeRequest({ method: 'POST', path: '/api/auth/refresh', headers: cookie }))
    expect(afterLogout.status).toBe(401)
  })

  it('GET /api/profile memakai access token dan tidak memuat kolom kredensial', async () => {
    const loginResponse = await login(adminUsername, 'rahasia123')
    const accessToken = (await readBody<{ data: LoginData }>(loginResponse)).data.access_token

    const response = await api(
      makeRequest({ method: 'GET', path: '/api/profile', headers: { authorization: `Bearer ${accessToken}` } }),
    )
    expect(response.status).toBe(200)

    const raw = await response.text()
    expect(raw).not.toContain('password')
    expect(JSON.parse(raw)).toMatchObject({ ok: true, data: { profile: { username: adminUsername, role: 'admin' } } })
  })

  it('A08/A09 ganti password: password lama salah ditolak, yang benar mencabut SEMUA sesi', async () => {
    const first = await login(adminUsername, 'rahasia123')
    const second = await login(adminUsername, 'rahasia123')
    const accessToken = (await readBody<{ data: LoginData }>(second)).data.access_token
    const firstToken = readSetCookie(first, REFRESH_COOKIE_NAME) as string

    const wrongCurrent = await api(
      makeRequest({
        method: 'POST',
        path: '/api/auth/change-password',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { current_password: 'salah', new_password: 'passwordbaru1', new_password_confirmation: 'passwordbaru1' },
      }),
    )
    expect(wrongCurrent.status).toBe(401)
    expect((await readBody<FailureBody>(wrongCurrent)).error.code).toBe('INVALID_CREDENTIALS')

    const changed = await api(
      makeRequest({
        method: 'POST',
        path: '/api/auth/change-password',
        headers: { authorization: `Bearer ${accessToken}` },
        body: {
          current_password: 'rahasia123',
          new_password: 'passwordbaru1',
          new_password_confirmation: 'passwordbaru1',
        },
      }),
    )
    expect(changed.status).toBe(200)

    const { rows } = await db().query<{ count: string }>(
      `select count(*)::text as count from public.app_sessions
        where revoked_at is null and user_id = (select id from public.users where username = $1)`,
      [adminUsername],
    )
    expect(rows[0]?.count).toBe('0')

    const stale = await api(
      makeRequest({ method: 'POST', path: '/api/auth/refresh', headers: { cookie: `${REFRESH_COOKIE_NAME}=${firstToken}` } }),
    )
    expect(stale.status).toBe(401)

    // Password baru benar-benar berlaku.
    expect((await login(adminUsername, 'passwordbaru1')).status).toBe(200)
    expect((await login(adminUsername, 'rahasia123')).status).toBe(401)
  })

  it('B06/B07 provisioning lewat RPC: owner berhasil, admin ditolak', async () => {
    const bossLogin = await login(bossUsername, 'rahasia123')
    const bossToken = (await readBody<{ data: LoginData }>(bossLogin)).data.access_token

    const adminLogin = await login(adminUsername, 'passwordbaru1')
    const adminToken = (await readBody<{ data: LoginData }>(adminLogin)).data.access_token

    const newUser = {
      username: createdUsername,
      display_name: 'E2E Dibuat',
      initial_password: 'rahasia123',
      role: 'member',
    }

    const byAdmin = await api(
      makeRequest({
        method: 'POST',
        path: '/api/internal/users',
        headers: { authorization: `Bearer ${adminToken}` },
        body: newUser,
      }),
    )
    expect(byAdmin.status).toBe(403)

    const byBoss = await api(
      makeRequest({
        method: 'POST',
        path: '/api/internal/users',
        headers: { authorization: `Bearer ${bossToken}` },
        body: newUser,
      }),
    )
    expect(byBoss.status).toBe(201)

    // User yang baru dibuat benar-benar dapat login (hash bcrypt dari database).
    expect((await login(createdUsername, 'rahasia123')).status).toBe(200)
  })

  it('owner tidak dapat membuat owner tanpa flag environment (O3)', async () => {
    const bossLogin = await login(bossUsername, 'rahasia123')
    const bossToken = (await readBody<{ data: LoginData }>(bossLogin)).data.access_token

    const response = await api(
      makeRequest({
        method: 'POST',
        path: '/api/internal/users',
        headers: { authorization: `Bearer ${bossToken}` },
        body: {
          username: `e2e_ma_${suffix}`,
          display_name: 'E2E MA',
          initial_password: 'rahasia123',
          role: 'owner',
        },
      }),
    )

    expect(response.status).toBe(403)
    expect((await readBody<FailureBody>(response)).error.code).toBe('MASTER_ADMIN_CREATE_FORBIDDEN')
  })

  it('endpoint ber-Bearer menolak token yang ditandatangani kunci lain', async () => {
    const otherEnv = await createTestEnv({
      SUPABASE_URL: SUPABASE_URL as string,
      SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY as string,
    })
    const otherApi = createHandler(otherEnv)

    const loginResponse = await otherApi(
      makeRequest({ method: 'POST', path: '/api/auth/login', body: { username: adminUsername, password: 'passwordbaru1' } }),
    )
    const foreignToken = (await readBody<{ data: LoginData }>(loginResponse)).data.access_token

    const response = await api(
      makeRequest({ method: 'GET', path: '/api/profile', headers: { authorization: `Bearer ${foreignToken}` } }),
    )
    expect(response.status).toBe(401)
    expect((await readBody<FailureBody>(response)).error.code).toBe('SESSION_INVALID')
  })

  it('CSRF: refresh tanpa origin ditolak walau cookie sah', async () => {
    const loginResponse = await login(adminUsername, 'passwordbaru1')
    const token = readSetCookie(loginResponse, REFRESH_COOKIE_NAME) as string

    const response = await api(
      makeRequest({
        method: 'POST',
        path: '/api/auth/refresh',
        origin: null,
        headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` },
      }),
    )
    expect(response.status).toBe(403)
    expect((await readBody<FailureBody>(response)).error.code).toBe('ORIGIN_NOT_ALLOWED')
    expect(ORIGIN).toBe('https://app.example.com')
  })
})
