import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeUser, loginAndGetToken, makeRequest, fakeOrder, sampleConfig } from './helpers'

async function setup(role: string, permissions: string[] = [], all = true) {
  const state = createFakeState({
    users: [fakeUser({ role, has_all_product_access: all })],
    rolePermissions: permissions.map(permission_key => ({ role_id: role, permission_key })),
    config: sampleConfig(),
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', path: string, body?: unknown) => api(makeRequest({
    method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }),
  }))
  return { state, request }
}

describe('database role + dynamic permission enforcement', () => {
  it.each(['developer', 'owner', 'master_admin'])('%s has full master access even without permission rows', async role => {
    const { request } = await setup(role, [], false)
    for (const [resource, body] of [
      ['products', { name: 'Baru', code: ' abcd ' }],
      ['advertisers', { name: 'Baru', code: '09' }],
      ['event-types', { name: 'Baru', code: 'ab', kind: 'seminar' }],
      ['sessions', { name: 'Baru', code: 'S8' }],
      ['payment-fee-rules', { name: 'Baru', identifier: 'new', fee_type: 'flat', fee_value: 100 }],
    ] as const) {
      const response = await request('POST', `/api/config/${resource}`, body)
      expect(response.status).toBe(201)
      const { data } = await response.json() as { data: { item: { id: string } } }
      expect((await request('PATCH', `/api/config/${resource}/${data.item.id}`, { name: 'Diedit' })).status).toBe(200)
      expect((await request('DELETE', `/api/config/${resource}/${data.item.id}`)).status).toBe(200)
    }
  })

  it.each(['manajer', 'admin', 'pimpro', 'member', 'staff', 'custom_gate'])('%s follows grants and revocation on the next request', async role => {
    const { state, request } = await setup(role)
    const write = () => request('POST', '/api/config/products', { name: 'Baru', code: 'TEST' })
    expect((await write()).status).toBe(403)
    state.rolePermissions.push({ role_id: role, permission_key: 'config.produk' })
    expect((await write()).status).toBe(201)
    state.rolePermissions.length = 0
    expect((await write()).status).toBe(403)
    expect((await request('GET', '/api/integrations/orderonline')).status).toBe(403)
    expect((await request('GET', '/api/product-aliases')).status).toBe(403)
    expect((await request('POST', '/api/scanner/manual-checkin', { order_id: '123' })).status).toBe(403)
    state.rolePermissions.push({ role_id: role, permission_key: 'config.roles' })
    expect((await request('GET', '/api/roles')).status).toBe(403)
  })

  it.each(['manajer', 'admin', 'pimpro', 'member', 'staff', 'custom_gate'])('%s uses the same module guards across configuration and operational endpoints', async role => {
    const { state, request } = await setup(role)
    const routes = [
      ['config.integrasi', '/api/integrations/orderonline'],
      ['config.alias_produk', '/api/product-aliases'],
      ['config.zoom', '/api/webinar-destinations'],
      ['config.tiket', '/api/seminar-tickets'],
      ['operasional.scan_qr', '/api/scanner/search?q=zz'],
      ['operasional.order_unmapped', '/api/orders/unmapped'],
    ] as const
    for (const [permission, path] of routes) {
      expect((await request('GET', path)).status, `${permission}: empty`).toBe(403)
      state.rolePermissions.push({ role_id: role, permission_key: permission })
      expect((await request('GET', path)).status, `${permission}: granted`).toBe(200)
      state.rolePermissions.length = 0
      expect((await request('GET', path)).status, `${permission}: revoked`).toBe(403)
    }
  })

  it('uses current role after promotion/demotion, and rejects inactive users', async () => {
    const { state, request } = await setup('member')
    state.users[0]!.role = 'developer'
    expect((await request('POST', '/api/config/products', { name: 'A', code: 'ABCD' })).status).toBe(201)
    state.users[0]!.role = 'member'
    expect((await request('POST', '/api/config/products', { name: 'B', code: 'EFGH' })).status).toBe(403)
    state.users[0]!.active = false
    expect((await request('POST', '/api/config/products', { name: 'B', code: 'EFGH' })).status).toBe(401)
  })

  it('requires the separate permanent deletion permission', async () => {
    const { state, request } = await setup('custom', ['config.produk'])
    const id = state.config.products[0]!['id']
    expect((await request('DELETE', `/api/config/products/${id}?permanent=true`)).status).toBe(403)
    expect(state.config.products).toHaveLength(2)
    expect((await request('DELETE', `/api/config/products/${id}`)).status).toBe(200)
  })

  it('requires deletion permission for Zoom, ticket and integration configuration too', async () => {
    const { request } = await setup('custom', ['config.zoom', 'config.tiket', 'config.integrasi'])
    for (const path of ['/api/webinar-destinations?key=__scope__::*:*:*', '/api/seminar-tickets?key=__scope__::*:*:*', '/api/integrations/orderonline/00000000-0000-0000-0000-000000000001']) {
      expect((await request('DELETE', path)).status).toBe(403)
    }
  })

  it('scopes scanner and Zoom, rejects global writes and unmapped access for scoped users', async () => {
    const { state, request } = await setup('pimpro', ['operasional.scan_qr', 'config.zoom', 'operasional.order_unmapped'], false)
    state.userProductAccess.push({ user_id: state.users[0]!.id, product_code: 'KM' })
    state.orders.push(fakeOrder({ order_id: '777001', product_code: 'BM' }))
    expect((await request('POST', '/checkin/777001')).status).toBe(403)
    expect((await request('GET', '/api/orders/unmapped')).status).toBe(403)
    expect((await request('POST', '/api/webinar-destinations', { product_code: '*', destination: 'https://zoom.us/j/1' })).status).toBe(403)
    expect((await request('POST', '/api/webinar-destinations', { product_code: 'BM', destination: 'https://zoom.us/j/1' })).status).toBe(403)
    expect((await request('POST', '/api/webinar-destinations', { product_code: 'KM', destination: 'https://zoom.us/j/1' })).status).toBe(200)
    const response = await request('GET', '/api/webinar-destinations')
    const { data } = await response.json() as { data: { products: { code: string }[] } }
    expect(data.products.map(p => p.code)).toEqual(['KM'])
  })

  it('rejects an invalid permission before changing the existing set', async () => {
    const { state, request } = await setup('developer')
    state.rolePermissions.push({ role_id: 'member', permission_key: 'operasional.scan_qr' })
    expect((await request('PUT', '/api/roles/member/permissions', { permissions: ['bad.permission'] })).status).toBe(400)
    expect(state.rolePermissions).toContainEqual({ role_id: 'member', permission_key: 'operasional.scan_qr' })
    expect(state.rpcCalls.some(c => c.name === 'save_role_permissions')).toBe(false)
  })
})
