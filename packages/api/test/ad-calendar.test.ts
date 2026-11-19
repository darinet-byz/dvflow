import { describe, expect, it } from 'vitest'
import {
  createFakeState,
  createTestApi,
  fakeOrder,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
  sampleConfig,
} from './helpers'

/** A80: Kalender Iklan — deadline per batch, tanggal tayang turunan, izin, dan validasi. */
const EVENT_ID = '22222222-2222-4222-8222-222222222222'

async function setup(permissions: string[], options: { orders?: Array<Record<string, unknown>>; reports?: Array<Record<string, unknown>> } = {}) {
  const state = createFakeState({
    users: [fakeUser({ id: 'user-main', username: 'main', role: 'manajer' })],
    config: sampleConfig(),
    rolePermissions: permissions.map((permission_key) => ({ role_id: 'manajer', permission_key })),
    orders: options.orders ?? [],
  })
  state.eventCalendar.push({
    id: EVENT_ID,
    product_code: 'BM',
    category: 'Webinar',
    event_date: '2026-11-25',
    start_time: '10:00:00',
    location: 'Zoom Meeting',
  })
  state.adSpendReports.push(...(options.reports ?? []))
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'main')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

const viewOnly = ['operasional.event_calendar']
const canManage = ['operasional.event_calendar', 'action.manage_ad_calendar']
const valid = { event_id: EVENT_ID, advertiser_code: '01', batch: '392', deadline_date: '2026-11-09' }

describe('A80: Kalender Iklan', () => {
  it('tanpa izin lihat ditolak', async () => {
    const { request } = await setup(['account.profile'])
    expect((await request('GET', '/api/ad-calendar')).status).toBe(403)
  })

  it('hanya pemegang izin kelola yang boleh menulis', async () => {
    const { request } = await setup(viewOnly)
    expect((await request('GET', '/api/ad-calendar?from=2026-11-01&to=2026-11-30')).status).toBe(200)
    expect((await request('POST', '/api/ad-calendar', valid)).status).toBe(403)
    expect((await request('PATCH', `/api/ad-calendar/${EVENT_ID}`, valid)).status).toBe(403)
    expect((await request('DELETE', `/api/ad-calendar/${EVENT_ID}`)).status).toBe(403)
  })

  it('membuat deadline, menormalkan batch, lalu membacanya kembali', async () => {
    const { request, state } = await setup(canManage)
    const created = await request('POST', '/api/ad-calendar', { ...valid, batch: '0392' })
    expect(created.status).toBe(201)
    expect(state.adCalendar).toHaveLength(1)
    expect(state.adCalendar[0]?.['batch']).toBe('392')
    expect(state.adCalendar[0]?.['product_code']).toBe('BM')

    const listed = await request('GET', '/api/ad-calendar?from=2026-11-01&to=2026-11-30')
    expect(listed.status).toBe(200)
    const body = await readBody<{ data: { rows: Array<{ batch: string; advertiser_code: string; status: string }> } }>(listed)
    expect(body.data.rows).toHaveLength(1)
    expect(body.data.rows[0]?.batch).toBe('392')
    expect(body.data.rows[0]?.advertiser_code).toBe('01')
    expect(body.data.rows[0]?.status).toBe('unpublished')
  })

  it('tanggal tayang memakai order pertama dan mengalahkan report', async () => {
    const { request } = await setup(canManage, {
      orders: [
        fakeOrder({ id: 'o1', order_id: 'A1', product_code: 'BM', advertiser_code: '01', batch: '392', source: 'orderonline', source_created_at: '2026-11-10T03:00:00Z' }),
        fakeOrder({ id: 'o2', order_id: 'A2', product_code: 'BM', advertiser_code: '01', batch: '392', source: 'orderonline', source_created_at: '2026-11-12T03:00:00Z' }),
        // OTS tidak boleh dianggap iklan tayang.
        fakeOrder({ id: 'o3', order_id: 'OTS-000001', product_code: 'BM', advertiser_code: '01', batch: '392', source: 'ots', source_created_at: '2026-11-01T03:00:00Z' }),
      ],
      reports: [{ advertiser_id: '33333333-3333-3333-3333-333333333333', product_code: 'BM', batch: '392', date_from: '2026-11-02' }],
    })
    await request('POST', '/api/ad-calendar', valid)
    const listed = await request('GET', '/api/ad-calendar?from=2026-11-01&to=2026-11-30')
    const body = await readBody<{ data: { rows: Array<{ publish_date: string; publish_source: string; days_late: number; score: number }> } }>(listed)
    expect(body.data.rows[0]?.publish_date).toBe('2026-11-10')
    expect(body.data.rows[0]?.publish_source).toBe('order')
    expect(body.data.rows[0]?.days_late).toBe(1)
    expect(body.data.rows[0]?.score).toBe(8)
  })

  it('tanpa lead, report spend menjadi sumber tanggal tayang', async () => {
    const { request } = await setup(canManage, {
      reports: [{ advertiser_id: '33333333-3333-3333-3333-333333333333', product_code: 'BM', batch: '392', date_from: '2026-11-13' }],
    })
    await request('POST', '/api/ad-calendar', valid)
    const listed = await request('GET', '/api/ad-calendar?from=2026-11-01&to=2026-11-30')
    const body = await readBody<{ data: { rows: Array<{ publish_date: string; publish_source: string; score: number }> } }>(listed)
    expect(body.data.rows[0]?.publish_date).toBe('2026-11-13')
    expect(body.data.rows[0]?.publish_source).toBe('report')
    expect(body.data.rows[0]?.score).toBe(6)
  })

  it('input tidak valid ditolak sebelum menyentuh tabel', async () => {
    const { request, state } = await setup(canManage)
    for (const bad of [
      { event_id: '' },
      { event_id: 'bukan-uuid' },
      { event_id: '99999999-9999-4999-8999-999999999999' },
      { advertiser_code: '' },
      { advertiser_code: 'TIDAK_ADA' },
      { batch: '   ' },
      { batch: 'x'.repeat(33) },
      { deadline_date: '2026-02-30' },
    ]) {
      expect((await request('POST', '/api/ad-calendar', { ...valid, ...bad })).status, JSON.stringify(bad)).toBe(400)
    }
    expect(state.adCalendar).toHaveLength(0)
    expect((await request('GET', '/api/ad-calendar?from=2026-11-30&to=2026-11-01')).status).toBe(400)
  })

  it('duplikat pengiklan + produk + batch ditolak', async () => {
    const { request } = await setup(canManage)
    expect((await request('POST', '/api/ad-calendar', valid)).status).toBe(201)
    expect((await request('POST', '/api/ad-calendar', { ...valid, deadline_date: '2026-11-15' })).status).toBe(409)
  })

  it('edit dan hapus; id tidak valid / tidak ada -> 404', async () => {
    const { request, state } = await setup(canManage)
    const created = await request('POST', '/api/ad-calendar', valid)
    const id = (await readBody<{ data: { calendar: { id: string } } }>(created)).data.calendar.id

    const updated = await request('PATCH', `/api/ad-calendar/${id}`, { ...valid, batch: '393', deadline_date: '2026-11-20' })
    expect(updated.status).toBe(200)
    expect(state.adCalendar[0]?.['batch']).toBe('393')
    expect(state.adCalendar[0]?.['deadline_date']).toBe('2026-11-20')

    expect((await request('PATCH', '/api/ad-calendar/bukan-uuid', valid)).status).toBe(404)
    expect((await request('DELETE', '/api/ad-calendar/99999999-9999-4999-8999-999999999999')).status).toBe(404)

    const deleted = await request('DELETE', `/api/ad-calendar/${id}`)
    expect(deleted.status).toBe(200)
    expect(state.adCalendar).toHaveLength(0)
  })
})
