import { describe, expect, it } from 'vitest'
import {
  createFakeState,
  createTestApi,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
} from './helpers'

/** A50/A54: delegasi team.manage dan kebijakan hapus user. */
async function setup(scoped = true) {
  const state = createFakeState({
    users: [
      fakeUser({ id: 'user-dev', username: 'dev1', role: 'developer', password: 'rahasia123' }),
      fakeUser({
        id: 'user-mgr',
        username: 'mgr1',
        role: 'manajer',
        has_all_product_access: !scoped,
        password: 'rahasia123',
      }),
      fakeUser({
        id: 'user-adv',
        username: 'adv1',
        role: 'advertiser',
        advertiser_id: 'adv-1',
        password: 'rahasia123',
      }),
      fakeUser({ id: 'user-free', username: 'free1', role: 'member', password: 'rahasia123' }),
    ],
    config: {
      products: [
        { id: 'p-km', code: 'KM', name: 'Kuliner', active: true },
        { id: 'p-bm', code: 'BM', name: 'Bisnis', active: true },
      ],
    },
    rolePermissions: [
      { role_id: 'manajer', permission_key: 'team.manage' },
      { role_id: 'manajer', permission_key: 'operasional.presensi' },
    ],
    userProductAccess: scoped ? [{ user_id: 'user-mgr', product_code: 'KM' }] : [],
  })
  const { api } = await createTestApi(state)
  const { accessToken: managerToken } = await loginAndGetToken(api, 'mgr1')
  const { accessToken: developerToken } = await loginAndGetToken(api, 'dev1')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', path: string, token: string, body?: Record<string, unknown>) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${token}` }, body }))

  return { state, request, managerToken, developerToken }
}

describe('team.manage delegation', () => {
  it('manajer hanya melihat role yang boleh ia berikan', async () => {
    const { request, managerToken } = await setup()
    const response = await request('GET', '/api/roles', managerToken)
    expect(response.status).toBe(200)
    const body = await readBody<{ data: { roles: Array<{ id: string }> } }>(response)
    const ids = body.data.roles.map((role) => role.id)
    expect(ids).toContain('member')
    expect(ids).toContain('pimpro')
    expect(ids).toContain('advertiser')
    expect(ids).not.toContain('owner')
    expect(ids).not.toContain('developer')
    expect(ids).not.toContain('manajer')
    expect(ids).not.toContain('admin')
  })

  it('manajer dapat menambah member dengan produk yang ia pegang', async () => {
    const { request, managerToken } = await setup()
    const response = await request('POST', '/api/internal/users', managerToken, {
      username: 'baru1',
      display_name: 'Baru',
      initial_password: 'password123',
      role: 'member',
      has_all_product_access: false,
      product_codes: ['KM'],
    })
    expect(response.status).toBe(201)
  })

  it('manajer tidak dapat memberi produk di luar scope atau role admin', async () => {
    const { request, managerToken } = await setup()
    const outside = await request('POST', '/api/internal/users', managerToken, {
      username: 'baru2', display_name: 'Baru 2', initial_password: 'password123', role: 'member',
      has_all_product_access: false, product_codes: ['BM'],
    })
    expect(outside.status).toBe(403)

    const admin = await request('POST', '/api/internal/users', managerToken, {
      username: 'baru3', display_name: 'Baru 3', initial_password: 'password123', role: 'admin',
    })
    expect(admin.status).toBe(403)

    const all = await request('POST', '/api/internal/users', managerToken, {
      username: 'baru4', display_name: 'Baru 4', initial_password: 'password123', role: 'member',
    })
    expect(all.status).toBe(403)
  })

  it('manajer tidak dapat mengedit atau menghapus user', async () => {
    const { request, managerToken } = await setup()
    expect((await request('PATCH', '/api/internal/users/user-free', managerToken, { active: false })).status).toBe(403)
    expect((await request('DELETE', '/api/internal/users/user-free', managerToken)).status).toBe(403)
  })

  it('username duplikat case-insensitive tetap ditolak, termasuk user nonaktif', async () => {
    const { state, request, managerToken } = await setup()
    const duplicate = await request('POST', '/api/internal/users', managerToken, {
      username: 'MGR1', display_name: 'Duplikat', initial_password: 'password123', role: 'member',
      has_all_product_access: false, product_codes: ['KM'],
    })
    expect(duplicate.status).toBe(409)
    expect((await readBody<{ error: { code: string } }>(duplicate)).error.code).toBe('USERNAME_TAKEN')

    state.users.find((user) => user.id === 'user-free')!.active = false
    const inactive = await request('POST', '/api/internal/users', managerToken, {
      username: 'FREE1', display_name: 'Duplikat 2', initial_password: 'password123', role: 'member',
      has_all_product_access: false, product_codes: ['KM'],
    })
    expect(inactive.status).toBe(409)
    expect((await readBody<{ error: { code: string } }>(inactive)).error.code).toBe('USERNAME_TAKEN')
  })
})

describe('team delete policy', () => {
  it('hapus user tanpa data berhasil; user berdata ditolak USER_HAS_DATA', async () => {
    const { request, developerToken } = await setup()

    const noData = await request('DELETE', '/api/internal/users/user-free', developerToken)
    expect(noData.status).toBe(200)

    const advertiser = await request('DELETE', '/api/internal/users/user-adv', developerToken)
    expect(advertiser.status).toBe(409)
    expect((await readBody<{ error: { code: string } }>(advertiser)).error.code).toBe('USER_HAS_DATA')
  })
})
