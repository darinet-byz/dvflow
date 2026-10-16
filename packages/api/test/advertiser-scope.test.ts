import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeOrder, fakeUser, loginAndGetToken, makeRequest, sampleConfig } from './helpers'

/**
 * A20: role Advertiser = produk yang ditugaskan DAN hanya order berkode pengiklannya.
 * Pimpro tetap level produk. DB (RLS + RPC 0037) adalah penegak utama; ini jalur Worker.
 */
const ZUL = '33333333-3333-3333-3333-333333333333' // sampleConfig: pengiklan 01 (Zul)
const RINA = '00000000-0000-4000-8000-0000000000f2'

async function setup(role: string, extra: Partial<Parameters<typeof fakeUser>[0]> = {}) {
  const config = sampleConfig()
  config.advertisers.push({ id: RINA, name: 'Rina', code: '02', active: true })
  const state = createFakeState({
    users: [fakeUser({ role, has_all_product_access: false, ...extra }), fakeUser({ id: 'dev-1', username: 'dev1', role: 'developer' })],
    rolePermissions: ['operasional.scan_qr', 'action.manual_checkin', 'operasional.order_unmapped'].map((permission_key) => ({ role_id: role, permission_key })),
    config,
    orders: [
      fakeOrder({ order_id: '900001', name: 'Order Zul', product_code: 'KM', advertiser_code: '01' }),
      fakeOrder({ order_id: '900002', name: 'Order Rina', product_code: 'KM', advertiser_code: '02' }),
    ],
  })
  state.userProductAccess.push({ user_id: state.users[0]!.id, product_code: 'KM' })
  const { api } = await createTestApi(state)
  const as = async (username: string) => {
    const { accessToken } = await loginAndGetToken(api, username)
    return (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => api(makeRequest({
      method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }),
    }))
  }
  return { state, api, as }
}

const searchIds = async (response: Response) =>
  ((await response.json()) as { data: { candidates: { order_id: string }[] } }).data.candidates.map((c) => c.order_id).sort()

describe('A20: scope Advertiser', () => {
  it('scanner search hanya order kode pengiklannya; pimpro melihat semua pengiklan di produknya', async () => {
    const adv = await setup('advertiser', { advertiser_id: ZUL })
    expect(await searchIds(await (await adv.as('admin1'))('GET', '/api/scanner/search?q=Order'))).toEqual(['900001'])
    const pim = await setup('pimpro')
    expect(await searchIds(await (await pim.as('admin1'))('GET', '/api/scanner/search?q=Order'))).toEqual(['900001', '900002'])
  })

  it('check-in order pengiklan lain ditolak, miliknya diterima', async () => {
    const { as } = await setup('advertiser', { advertiser_id: ZUL })
    const request = await as('admin1')
    expect((await request('POST', '/checkin/900002')).status).toBe(403)
    expect((await request('POST', '/checkin/900001')).status).toBe(200)
  })

  it('Semua Produk + pengiklan tetap tidak boleh membuka order unmapped', async () => {
    const { as } = await setup('advertiser', { advertiser_id: ZUL, has_all_product_access: true })
    expect((await (await as('admin1'))('GET', '/api/orders/unmapped')).status).toBe(403)
  })

  it('profil memuat kode & nama pengiklan', async () => {
    const { as } = await setup('advertiser', { advertiser_id: ZUL })
    const body = (await (await (await as('admin1'))('GET', '/api/profile')).json()) as { data: { profile: Record<string, unknown> } }
    expect(body.data.profile).toMatchObject({ role: 'advertiser', advertiser_code: '01', advertiser_name: 'Zul' })
  })

  it('Add Team: advertiser wajib pengiklan aktif; role lain mengosongkan pengiklan', async () => {
    const { state, as } = await setup('pimpro')
    const request = await as('dev1')
    const base = { username: 'iklan1', display_name: 'Iklan', initial_password: 'password123', role: 'advertiser', has_all_product_access: false, product_codes: ['KM'] }
    expect((await request('POST', '/api/internal/users', base)).status).toBe(400)
    state.config.advertisers.find((a) => a['id'] === RINA)!['active'] = false
    expect((await request('POST', '/api/internal/users', { ...base, advertiser_id: RINA })).status).toBe(400)
    const created = await request('POST', '/api/internal/users', { ...base, advertiser_id: ZUL })
    expect(created.status).toBe(201)
    const user = state.users.find((u) => u.username === 'iklan1')!
    expect(user.advertiser_id).toBe(ZUL)
    const listed = (await (await request('GET', '/api/internal/users')).json()) as { data: { users: { username: string; advertiser_id: string | null }[] } }
    expect(listed.data.users.find((u) => u.username === 'iklan1')?.advertiser_id).toBe(ZUL)
    expect((await request('PATCH', `/api/internal/users/${user.id}`, { role: 'pimpro', has_all_product_access: false, product_codes: ['KM'] })).status).toBe(200)
    expect(user.advertiser_id).toBeNull()
  })
})
