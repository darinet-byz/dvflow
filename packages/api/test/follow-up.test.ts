import { describe, expect, it } from 'vitest'
import {
  createApiWithEnv,
  createFakeState,
  createTestEnv,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
  sampleConfig,
} from './helpers'

/**
 * A76: Follow Up Manual via WhatsApp.
 *
 * Dua hal yang dijaga: jenis acara diambil dari KODE asli (Workshop = hybrid,
 * bukan nama "Hybrid"), dan semua akses lewat cek izin + cakupan produk.
 */
const WS_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const SO_ID = '44444444-4444-4444-4444-444444444444'
const PRODUCT_ID = '11111111-1111-1111-1111-111111111111'

type ContextBody = {
  ok: true
  data: {
    order: { order_id: string; phone_wa: string | null; is_ots: boolean; product_name: string | null }
    event_type: { code: string; name: string } | null
    templates: Array<{ slot: number; body: string }>
    marks: Array<{ slot: number; used_at: string; used_by_name: string | null }>
    template_updated: { at: string; by: string | null } | null
  }
}

async function setup() {
  const state = createFakeState({
    users: [
      fakeUser({ id: 'user-admin', username: 'admin1', role: 'admin' }),
      fakeUser({ id: 'user-pimpro', username: 'pimpro1', role: 'pimpro', display_name: 'Pimpro Satu', has_all_product_access: false }),
      fakeUser({ id: 'user-member', username: 'member1', role: 'member', has_all_product_access: false }),
    ],
    config: sampleConfig(),
  })
  state.config.eventTypes.push({ id: WS_ID, name: 'Workshop', code: 'WS', kind: 'hybrid', active: true })

  state.orders.push({
    id: 'order-uuid-1',
    order_id: 'KM-1',
    source: 'orderonline',
    name: 'Budi',
    phone: '0812-3456-7890',
    product_code: 'KM',
    product_name: 'Kuliner Masteri',
    product_raw: 'KM01WS100 - S1 - Solo',
    advertiser_code: '01',
    advertiser_name: 'Zul',
    event_type: 'Hybrid',
    batch: '100',
    session: 'S1',
    city: 'Solo',
    app_status: 'Paid',
  })

  state.followUpTemplates.push(
    { product_id: PRODUCT_ID, event_type_id: WS_ID, slot: 1, body: 'Halo {nama}, ini workshop {produk}. {link}', updated_by: 'user-admin', updated_at: '2026-11-14T03:00:00.000Z' },
    { product_id: PRODUCT_ID, event_type_id: WS_ID, slot: 2, body: 'Info workshop: {batch} {sesi} {kota}', updated_by: 'user-admin', updated_at: '2026-11-14T03:00:00.000Z' },
    { product_id: PRODUCT_ID, event_type_id: SO_ID, slot: 1, body: 'Ini template seminar yang tidak boleh muncul.', updated_by: 'user-admin', updated_at: '2026-11-14T03:00:00.000Z' },
  )
  state.orderFollowUpMarks.push({ order_id: 'KM-1', slot: 1, used_at: '2026-11-14T04:00:00.000Z', used_by: 'user-admin', used_by_name: 'Admin Satu' })

  const env = await createTestEnv()
  const api = createApiWithEnv(env, state)
  const admin = await loginAndGetToken(api, 'admin1')
  const pimpro = await loginAndGetToken(api, 'pimpro1')
  const member = await loginAndGetToken(api, 'member1')
  return { state, api, admin: admin.accessToken, pimpro: pimpro.accessToken, member: member.accessToken }
}

type Ctx = Awaited<ReturnType<typeof setup>>

function call(
  ctx: Ctx,
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
) {
  return ctx.api(makeRequest({ method, path, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body }) }))
}

describe('A76: konteks follow up', () => {
  it('order workshop memakai template event type WS, bukan seminar', async () => {
    const ctx = await setup()
    const response = await call(ctx, ctx.admin, 'GET', '/api/orders/KM-1/follow-up')
    expect(response.status).toBe(200)

    const body = await readBody<ContextBody>(response)
    expect(body.data.event_type).toEqual({ code: 'WS', name: 'Workshop' })
    expect(body.data.order.phone_wa).toBe('6281234567890')
    expect(body.data.order.is_ots).toBe(false)
    expect(body.data.templates).toHaveLength(2)
    expect(body.data.templates.map((item) => item.body)).not.toContain('Ini template seminar yang tidak boleh muncul.')
    expect(body.data.marks).toEqual([{ slot: 1, used_at: '2026-11-14T04:00:00.000Z', used_by_name: 'Admin Satu' }])
    expect(body.data.template_updated?.by).toBe('Admin Satu')
  })

  it('order OTS tetap punya follow up, tanpa link tiket', async () => {
    const ctx = await setup()
    ctx.state.orders.push({
      id: 'order-uuid-ots',
      order_id: 'OTS-000009',
      source: 'ots',
      name: 'Siti',
      phone: '08123456789',
      product_code: 'KM',
      product_name: 'Kuliner Masteri',
      product_raw: null,
      advertiser_code: null,
      advertiser_name: null,
      event_type: 'Seminar Offline',
      batch: '392',
      session: 'S1',
      city: 'Solo',
      app_status: 'Paid',
    })

    const response = await call(ctx, ctx.admin, 'GET', '/api/orders/OTS-000009/follow-up')
    expect(response.status).toBe(200)
    const body = await readBody<ContextBody>(response)
    expect(body.data.order.is_ots).toBe(true)
    expect(body.data.event_type).toEqual({ code: 'SO', name: 'Seminar Offline' })
    expect(body.data.templates.map((item) => item.slot)).toEqual([1])
  })

  it('tanpa izin Order atau di luar cakupan produk ditolak', async () => {
    const ctx = await setup()
    expect((await call(ctx, ctx.member, 'GET', '/api/orders/KM-1/follow-up')).status).toBe(403)
    expect((await call(ctx, ctx.pimpro, 'GET', '/api/orders/KM-1/follow-up')).status).toBe(403)
  })

  it('order tidak dikenal 404', async () => {
    const ctx = await setup()
    expect((await call(ctx, ctx.admin, 'GET', '/api/orders/TIDAK-ADA/follow-up')).status).toBe(404)
  })
})

describe('A76: penanda bubble', () => {
  it('menandai slot dan menolak slot di luar 1-4', async () => {
    const ctx = await setup()
    const ok = await call(ctx, ctx.admin, 'POST', '/api/orders/KM-1/follow-up', { slot: 3 })
    expect(ok.status).toBe(200)
    expect(ctx.state.orderFollowUpMarks.some((row) => row['slot'] === 3)).toBe(true)

    expect((await call(ctx, ctx.admin, 'POST', '/api/orders/KM-1/follow-up', { slot: 9 })).status).toBe(400)
  })
})

describe('A76: ringkasan untuk kartu HP', () => {
  it('mengembalikan slot template dan slot terpakai', async () => {
    const ctx = await setup()
    const response = await call(ctx, ctx.admin, 'GET', '/api/orders/follow-up-summary?ids=KM-1')
    expect(response.status).toBe(200)

    const body = await readBody<{ ok: true; data: { orders: Array<{ order_id: string; slots: number[]; used: number[] }> } }>(response)
    expect(body.data.orders).toEqual([{ order_id: 'KM-1', slots: [1, 2], used: [1] }])
  })

  it('order di luar cakupan produk tidak ikut', async () => {
    const ctx = await setup()
    const response = await call(ctx, ctx.pimpro, 'GET', '/api/orders/follow-up-summary?ids=KM-1')
    const body = await readBody<{ ok: true; data: { orders: unknown[] } }>(response)
    expect(body.data.orders).toEqual([])
  })

  it('id tidak valid atau lebih dari 50 ditolak', async () => {
    const ctx = await setup()
    expect((await call(ctx, ctx.admin, 'GET', '/api/orders/follow-up-summary?ids=bad!id')).status).toBe(400)
    const many = Array.from({ length: 51 }, (_, index) => `KM-${index + 1}`).join(',')
    expect((await call(ctx, ctx.admin, 'GET', `/api/orders/follow-up-summary?ids=${many}`)).status).toBe(400)
  })
})

describe('A76: template per produk x jenis acara', () => {
  it('membaca template beserta daftar jenis acara', async () => {
    const ctx = await setup()
    const response = await call(ctx, ctx.admin, 'GET', '/api/follow-up-templates?product=KM')
    expect(response.status).toBe(200)

    const body = await readBody<{ ok: true; data: { product: { code: string }; event_types: Array<{ code: string }>; templates: Array<{ slot: number; event_type_id: string }> } }>(response)
    expect(body.data.product.code).toBe('KM')
    expect(body.data.event_types.map((row) => row.code)).toEqual(expect.arrayContaining(['SO', 'WS']))
    expect(body.data.templates.some((row) => row.event_type_id === WS_ID && row.slot === 1)).toBe(true)
  })

  it('menyimpan slot dan menghapus slot kosong', async () => {
    const ctx = await setup()
    const save = await call(ctx, ctx.admin, 'PUT', '/api/follow-up-templates', {
      productCode: 'KM',
      eventTypeCode: 'WS',
      slots: { '1': 'Halo {nama}', '2': '' },
    })
    expect(save.status).toBe(200)

    const wsRows = ctx.state.followUpTemplates.filter((row) => row['event_type_id'] === WS_ID)
    expect(wsRows.map((row) => row['slot'])).toEqual([1])
    expect(wsRows[0]?.['body']).toBe('Halo {nama}')
  })

  it('placeholder asing dan produk di luar cakupan ditolak', async () => {
    const ctx = await setup()
    const invalid = await call(ctx, ctx.admin, 'PUT', '/api/follow-up-templates', {
      productCode: 'KM',
      eventTypeCode: 'WS',
      slots: { '1': 'Halo {nama} {lead}' },
    })
    expect(invalid.status).toBe(400)

    const forbidden = await call(ctx, ctx.pimpro, 'PUT', '/api/follow-up-templates', {
      productCode: 'KM',
      eventTypeCode: 'WS',
      slots: { '1': 'Halo' },
    })
    expect(forbidden.status).toBe(403)
  })
})
