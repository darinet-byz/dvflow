import { describe, expect, it } from 'vitest'
import { createJwtSigner } from '../src/auth/jwt'
import type { AppRole } from '@dvflow/shared'
import {
  createApiWithEnv,
  createFakeState,
  createTestApi,
  createTestEnv,
  fakeUser,
  makeRequest,
  readBody,
} from './helpers'

type FailureBody = { ok: false; error: { code: string; message: string } }
type LoginData = { access_token: string }

async function loginAs(username: string, password: string, state: ReturnType<typeof createFakeState>) {
  const { api } = await createTestApi(state)
  const response = await api(makeRequest({ method: 'POST', path: '/api/auth/login', body: { username, password } }))
  const body = await readBody<{ ok: true; data: LoginData } | FailureBody>(response)
  if (!body.ok) throw new Error(`login gagal: ${body.error.code}`)
  return { api, accessToken: body.data.access_token }
}

function provisionRequest(accessToken: string, body: unknown) {
  return makeRequest({
    method: 'POST',
    path: '/api/internal/users',
    headers: { authorization: `Bearer ${accessToken}` },
    body,
  })
}

const VALID_NEW_USER = {
  username: 'staff2',
  display_name: 'Staff Dua',
  initial_password: 'rahasia123',
  role: 'member',
}

describe('B. RBAC di batas HTTP', () => {
  it('B01 staff dapat membaca profilnya sendiri', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'staff1', role: 'member' })] })
    const { api, accessToken } = await loginAs('staff1', 'rahasia123', state)

    const response = await api(
      makeRequest({ method: 'GET', path: '/api/profile', headers: { authorization: `Bearer ${accessToken}` } }),
    )
    expect(response.status).toBe(200)
    const body = await readBody<{ ok: true; data: { profile: { role: string } } }>(response)
    expect(body.data.profile.role).toBe('member')
  })

  it('B07 admin (bukan master) tidak dapat memanggil provisioning user', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'admin1', role: 'admin' })] })
    const { api, accessToken } = await loginAs('admin1', 'rahasia123', state)

    const response = await api(provisionRequest(accessToken, VALID_NEW_USER))
    expect(response.status).toBe(403)
    expect((await readBody<FailureBody>(response)).error.code).toBe('FORBIDDEN')
    expect(state.users).toHaveLength(1)
  })

  it('staff tidak dapat memanggil provisioning user', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'staff1', role: 'member' })] })
    const { api, accessToken } = await loginAs('staff1', 'rahasia123', state)

    const response = await api(provisionRequest(accessToken, VALID_NEW_USER))
    expect(response.status).toBe(403)
  })

  it('B06 owner dapat membuat admin dan staff', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'bos', role: 'owner' })] })
    const { api, accessToken } = await loginAs('bos', 'rahasia123', state)

    const response = await api(provisionRequest(accessToken, VALID_NEW_USER))
    expect(response.status).toBe(201)

    const body = await readBody<{ ok: true; data: { user: { username: string; role: string; active: boolean } } }>(
      response,
    )
    expect(body.data.user.username).toBe('staff2')
    expect(body.data.user.role).toBe('member')
    expect(body.data.user.active).toBe(true)
  })

  it('owner TIDAK dapat membuat owner selama environment melarangnya (O3)', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'bos', role: 'owner' })] })
    const { api, accessToken } = await loginAs('bos', 'rahasia123', state)

    const response = await api(provisionRequest(accessToken, { ...VALID_NEW_USER, role: 'owner' }))
    expect(response.status).toBe(403)
    expect((await readBody<FailureBody>(response)).error.code).toBe('MASTER_ADMIN_CREATE_FORBIDDEN')
  })

  it('owner dapat membuat owner bila environment mengizinkan', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'bos', role: 'owner' })] })
    const env = await createTestEnv({ ALLOW_MASTER_ADMIN_CREATE_MASTER: 'true' })
    const api = createApiWithEnv(env, state)

    const loginResponse = await api(
      makeRequest({ method: 'POST', path: '/api/auth/login', body: { username: 'bos', password: 'rahasia123' } }),
    )
    const accessToken = (await readBody<{ data: LoginData }>(loginResponse)).data.access_token

    const response = await api(provisionRequest(accessToken, { ...VALID_NEW_USER, role: 'owner' }))
    expect(response.status).toBe(201)
  })

  it('role di luar daftar ditolak sebelum menyentuh database', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'bos', role: 'owner' })] })
    const { api, accessToken } = await loginAs('bos', 'rahasia123', state)

    const response = await api(provisionRequest(accessToken, { ...VALID_NEW_USER, role: 'superuser' }))
    expect(response.status).toBe(400)
    expect((await readBody<FailureBody>(response)).error.code).toBe('INVALID_ARGUMENT')
  })

  it('username duplikat -> 409 USERNAME_TAKEN', async () => {
    const state = createFakeState({
      users: [fakeUser({ username: 'bos', role: 'owner' }), fakeUser({ id: 'user-x', username: 'staff2' })],
    })
    const { api, accessToken } = await loginAs('bos', 'rahasia123', state)

    const response = await api(provisionRequest(accessToken, { ...VALID_NEW_USER, username: 'Staff2' }))
    expect(response.status).toBe(409)
    expect((await readBody<FailureBody>(response)).error.code).toBe('USERNAME_TAKEN')
  })

  it('password awal terlalu pendek -> 400 WEAK_PASSWORD (aturan database, bukan handler)', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'bos', role: 'owner' })] })
    const { api, accessToken } = await loginAs('bos', 'rahasia123', state)

    const response = await api(provisionRequest(accessToken, { ...VALID_NEW_USER, initial_password: 'pendek' }))
    expect(response.status).toBe(400)
    expect((await readBody<FailureBody>(response)).error.code).toBe('WEAK_PASSWORD')
  })

  it('provisioning tanpa field wajib -> 400 INVALID_PAYLOAD', async () => {
    const state = createFakeState({ users: [fakeUser({ username: 'bos', role: 'owner' })] })
    const { api, accessToken } = await loginAs('bos', 'rahasia123', state)

    for (const body of [{}, { username: 'x' }, { ...VALID_NEW_USER, username: '  ' }, { ...VALID_NEW_USER, username: 'ada spasi' }]) {
      const response = await api(provisionRequest(accessToken, body))
      expect([400]).toContain(response.status)
    }
  })

  it('claim app_role yang berbohong tetap ditolak database (defense in depth)', async () => {
    // Skenario: token SAH (ditandatangani kunci kita sendiri, `kid` cocok) yang
    // mengaku owner, padahal baris user di database adalah staff.
    // Handler mempercayai claim; database TIDAK — dan permintaan tetap gagal
    // (04 §5: permission ditegakkan server-side, bukan oleh handler saja).
    const state = createFakeState({ users: [fakeUser({ id: 'user-staff', username: 'staff1', role: 'member' })] })
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)
    const liedToken = await signer.mint({
      userId: 'user-staff',
      appRole: 'owner' as AppRole,
      now: new Date('2026-10-13T08:00:00.000Z'),
    })

    const api = createApiWithEnv(env, state)
    const response = await api(provisionRequest(liedToken, VALID_NEW_USER))

    expect(response.status).toBe(403)
    expect((await readBody<FailureBody>(response)).error.code).toBe('FORBIDDEN')
    expect(state.users).toHaveLength(1)
  })
})

describe('profil', () => {
  it('PATCH hanya menerima field yang diizinkan dan mengabaikan yang lain', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api, accessToken } = await loginAs('admin1', 'rahasia123', state)

    const response = await api(
      makeRequest({
        method: 'PATCH',
        path: '/api/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { display_name: '  Admin Baru  ', avatar_emoji: '🙂', username: 'diganti', role: 'owner' },
      }),
    )

    expect(response.status).toBe(200)
    const body = await readBody<{ data: { profile: { display_name: string; username: string; role: string } } }>(
      response,
    )
    expect(body.data.profile.display_name).toBe('Admin Baru')
    expect(body.data.profile.username).toBe('admin1')
    expect(body.data.profile.role).toBe('admin')
  })

  it('PATCH avatar_emoji null menghapus emoji', async () => {
    const state = createFakeState({ users: [fakeUser({ avatar_emoji: '🙂' })] })
    const { api, accessToken } = await loginAs('admin1', 'rahasia123', state)

    const response = await api(
      makeRequest({
        method: 'PATCH',
        path: '/api/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { avatar_emoji: null },
      }),
    )

    expect(response.status).toBe(200)
    expect(state.users[0]?.avatar_emoji).toBeNull()
  })

  it('PATCH tanpa field yang dapat diubah -> 400', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api, accessToken } = await loginAs('admin1', 'rahasia123', state)

    const response = await api(
      makeRequest({
        method: 'PATCH',
        path: '/api/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { username: 'diganti' },
      }),
    )
    expect(response.status).toBe(400)
  })

  it('user yang dinonaktifkan tidak dapat mengubah profil walau tokennya masih sah', async () => {
    const state = createFakeState({ users: [fakeUser()] })
    const { api, accessToken } = await loginAs('admin1', 'rahasia123', state)

    const user = state.users[0]
    if (user === undefined) throw new Error('user tidak ada')
    user.active = false

    const response = await api(
      makeRequest({
        method: 'PATCH',
        path: '/api/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { display_name: 'Tetap Tidak Boleh' },
      }),
    )
    expect(response.status).toBe(401)
    expect((await readBody<FailureBody>(response)).error.code).toBe('USER_DISABLED')
  })
})
