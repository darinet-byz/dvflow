import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeOrder, fakeUser, loginAndGetToken, makeRequest, sampleConfig } from './helpers'

/**
 * A58: endpoint reschedule/refund.
 *
 * Handler hanya memvalidasi bentuk input lalu memanggil RPC; aturan bisnis
 * (Paid, belum check-in, penuh, refund aktif) diuji di pgTAP 31 dan integrasi.
 */
async function setup(permissions: string[] = ['action.reschedule', 'action.refund']) {
  const state = createFakeState({
    users: [fakeUser({ role: 'admin', display_name: 'Admin Aksi' })],
    rolePermissions: permissions.map((permission_key) => ({ role_id: 'admin', permission_key })),
    config: sampleConfig(),
    orders: [fakeOrder({ order_id: 'MTIX-77', app_status: 'Paid' })],
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'POST', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

type Body<T> = { data: T }

describe('A58 — aksi reschedule/refund', () => {
  it('tanpa izin aksi ditolak (403) di ketiga endpoint', async () => {
    const { request } = await setup([])
    expect((await request('POST', '/api/orders/MTIX-77/reschedule', { session: 'S2', city: 'Bandung' })).status).toBe(403)
    expect((await request('POST', '/api/orders/MTIX-77/refund', { reason: 'batal' })).status).toBe(403)
    expect((await request('POST', '/api/orders/MTIX-77/refund/cancel', {})).status).toBe(403)
  })

  it('reschedule memvalidasi Order ID, sesi, dan kota sebelum RPC', async () => {
    const { state, request } = await setup()
    expect((await request('POST', '/api/orders/bad id/reschedule', { session: 'S2', city: 'Bandung' })).status).toBe(404)
    expect((await request('POST', '/api/orders/MTIX-77/reschedule', { city: 'Bandung' })).status).toBe(400)
    expect((await request('POST', '/api/orders/MTIX-77/reschedule', { session: 'S2' })).status).toBe(400)
    expect(state.rpcCalls.filter((call) => call.name === 'reschedule_order')).toHaveLength(0)
  })

  it('reschedule valid meneruskan aktor dan tujuan ke RPC', async () => {
    const { state, request } = await setup()
    const response = await request('POST', '/api/orders/MTIX-77/reschedule', {
      batch: '200',
      session: 'S2',
      city: 'Bandung',
      reason: 'pindah kota',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Body<{ order_id: string; session: string }>
    expect(body.data.order_id).toBe('MTIX-77')
    const call = state.rpcCalls.find((item) => item.name === 'reschedule_order')
    expect(call?.args).toMatchObject({
      p_order_id: 'MTIX-77',
      p_batch: '200',
      p_session: 'S2',
      p_city: 'Bandung',
      p_reason: 'pindah kota',
    })
  })

  it('refund wajib beralasan dan mengirim p_actor', async () => {
    const { state, request } = await setup()
    expect((await request('POST', '/api/orders/MTIX-77/refund', { reason: '   ' })).status).toBe(400)
    const response = await request('POST', '/api/orders/MTIX-77/refund', { reason: 'peserta batal' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Body<{ status: string }>
    expect(body.data.status).toBe('Refund')
    expect(state.rpcCalls.some((item) => item.name === 'refund_order' && item.args['p_reason'] === 'peserta batal')).toBe(true)
  })

  it('batalkan refund memanggil RPC cancel_refund', async () => {
    const { state, request } = await setup()
    const response = await request('POST', '/api/orders/MTIX-77/refund/cancel', { reason: 'salah input' })
    expect(response.status).toBe(200)
    expect(state.rpcCalls.some((item) => item.name === 'cancel_refund')).toBe(true)
  })
})
