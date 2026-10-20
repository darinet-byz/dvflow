import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeOrder, fakeUser, loginAndGetToken, makeRequest, sampleConfig } from './helpers'

/** A29 + A34: Worker OTS — izin, validasi input, daftar acara & daftar OTS hari ini. Aturan DB: pgTAP 19_ots.sql. */
async function setup(role: string, permissions: string[] = []) {
  const now = new Date().toISOString()
  const event = { product_code: 'KM', product_name: 'Kuliner Masteri', batch: '392', session: 'S1', city: 'Solo', created_at: now }
  const state = createFakeState({
    users: [fakeUser({ role, display_name: 'Petugas Meja' })],
    rolePermissions: permissions.map((permission_key) => ({ role_id: role, permission_key })),
    config: sampleConfig(),
    orders: [
      fakeOrder({ ...event, order_id: 'MTIX-1', event_type: 'Seminar Offline' }),
      fakeOrder({ ...event, order_id: 'MTIX-2', event_type: 'Seminar Offline' }),
      fakeOrder({ ...event, order_id: 'MTIX-3', event_type: 'Webinar Online' }),
    ],
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

// Form baru (A34): tidak ada event_type/amount; server menghitung total dari unit_price x quantity.
const valid = {
  name: 'Budi OTS',
  phone: '0812',
  product_code: 'KM',
  batch: '392',
  session: 'S1',
  city: 'Solo',
  quantity: 2,
  unit_price: 150000,
  method: 'ots_tunai',
}

describe('OTS (A29/A34)', () => {
  it('tanpa izin action.ots ditolak di semua rute', async () => {
    const { request } = await setup('member', ['operasional.scan_qr'])
    expect((await request('GET', '/api/ots/events')).status).toBe(403)
    expect((await request('GET', '/api/ots')).status).toBe(403)
    expect((await request('POST', '/api/ots', valid)).status).toBe(403)
  })

  it('daftar acara: seminar/hybrid unik, tanpa webinar', async () => {
    const { request } = await setup('admin', ['action.ots'])
    const body = (await (await request('GET', '/api/ots/events')).json()) as { data: { events: Record<string, unknown>[] } }
    expect(body.data.events).toHaveLength(1)
    expect(body.data.events[0]).toMatchObject({ product_code: 'KM', batch: '392', session: 'S1', city: 'Solo', event_type: 'Seminar Offline' })
  })

  it('validasi form baru sebelum RPC', async () => {
    const { request } = await setup('admin', ['action.ots'])
    for (const bad of [
      { name: '' },
      { phone: '' },
      { product_code: '' },
      { batch: '' },
      { session: '' },
      { city: '' },
      { quantity: 0 },
      { quantity: 101 },
      { quantity: 1.5 },
      { unit_price: 0 },
      { unit_price: -1 },
      { method: 'cash' },
    ]) {
      expect((await request('POST', '/api/ots', { ...valid, ...bad })).status, JSON.stringify(bad)).toBe(400)
    }
  })

  it('simpan form baru -> Paid + N tiket + hadir, lalu edit', async () => {
    const { state, request } = await setup('admin', ['action.ots'])
    const created = await request('POST', '/api/ots', valid)
    expect(created.status).toBe(201)
    const { data } = (await created.json()) as { data: { order_id: string; quantity: number; gross_amount: number } }
    expect(data.order_id).toMatch(/^OTS-\d{6}$/)
    expect(data.quantity).toBe(2)
    expect(data.gross_amount).toBe(300000)
    expect(state.orders.find((row) => row['order_id'] === data.order_id)).toMatchObject({ quantity: 2, gross_amount: 300000, event_type: 'Seminar Offline' })
    expect(state.attendanceEvents.some((event) => event['order_id'] === data.order_id && event['source'] === 'seminar_ots')).toBe(true)

    // Tanggal WIB order tiruan (jam API tes bisa berbeda dari jam sistem).
    const createdAt = String(state.orders.find((row) => row['order_id'] === data.order_id)!['created_at'])
    const wibDate = new Date(new Date(createdAt).getTime() + 7 * 3600_000).toISOString().slice(0, 10)
    const list = (await (await request('GET', `/api/ots?date=${wibDate}`)).json()) as { data: { rows: Record<string, unknown>[] } }
    expect(list.data.rows).toEqual([expect.objectContaining({ order_id: data.order_id, collected_by: 'Petugas Meja', quantity: 2, gross_amount: 300000 })])

    const edited = await request('POST', '/api/ots', {
      ...valid,
      order_id: data.order_id,
      name: 'Budi Santoso',
      phone: '0813',
      batch: '058',
      session: 's2',
      city: 'Bandung',
      quantity: 3,
      unit_price: 100000,
      method: 'ots_qris',
    })
    expect(edited.status).toBe(200)
    expect(state.orders.find((row) => row['order_id'] === data.order_id)).toMatchObject({
      name: 'Budi Santoso', quantity: 3, gross_amount: 300000, payment_method: 'ots_qris',
    })
    expect(state.attendanceEvents.filter((event) => event['order_id'] === data.order_id && event['attendance_type'] === 'seminar')).toHaveLength(1)
  })

  it('pemanggil lama (amount, tanpa unit_price) tetap diterima selama transisi', async () => {
    const { state, request } = await setup('admin', ['action.ots'])
    const legacy = {
      name: 'Budi Lama', phone: '0812', product_code: 'KM', batch: '392', session: 'S1', city: 'Solo',
      event_type: 'Seminar Offline', amount: 150000, method: 'ots_tunai',
    }
    const created = await request('POST', '/api/ots', legacy)
    expect(created.status).toBe(201)
    const { data } = (await created.json()) as { data: { order_id: string } }
    expect(state.orders.find((row) => row['order_id'] === data.order_id)).toMatchObject({ quantity: 1, gross_amount: 150000 })
  })

  it('hapus hanya order OTS', async () => {
    const { request } = await setup('developer')
    const { data } = (await (await request('POST', '/api/ots', valid)).json()) as { data: { order_id: string } }
    expect((await request('DELETE', '/api/ots/MTIX-1')).status).toBe(404)
    expect((await request('DELETE', `/api/ots/${data.order_id}`)).status).toBe(200)
  })
})
