import { describe, expect, it } from 'vitest'
import {
  createFakeState,
  createTestApi,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
  sampleConfig,
} from './helpers'

/** A79: Kalender Event — izin, validasi, dan kontrak route Worker. */
async function setup(permissions: string[]) {
  const state = createFakeState({
    users: [fakeUser({ id: 'user-main', username: 'main', role: 'manajer' })],
    config: sampleConfig(),
    rolePermissions: permissions.map((permission_key) => ({ role_id: 'manajer', permission_key })),
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'main')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

const valid = {
  product_code: 'BM',
  category: 'Webinar',
  event_date: '2026-11-20',
  start_time: '10:00',
  location: 'Zoom Meeting',
}

const viewOnly = ['operasional.event_calendar']
const canManage = ['operasional.event_calendar', 'action.manage_event_calendar']

describe('A79: Kalender Event', () => {
  it('tanpa izin lihat ditolak', async () => {
    const { request } = await setup(['account.profile'])
    expect((await request('GET', '/api/event-calendar')).status).toBe(403)
  })

  it('hanya pemegang izin kelola yang boleh menulis', async () => {
    const { request } = await setup(viewOnly)
    expect((await request('GET', '/api/event-calendar?from=2026-11-01&to=2026-11-30')).status).toBe(200)
    expect((await request('POST', '/api/event-calendar', valid)).status).toBe(403)
    expect((await request('PATCH', '/api/event-calendar/11111111-1111-4111-8111-111111111111', valid)).status).toBe(403)
    expect((await request('DELETE', '/api/event-calendar/11111111-1111-4111-8111-111111111111')).status).toBe(403)
  })

  it('membuat event valid lalu membacanya kembali dalam rentang bulan', async () => {
    const { request, state } = await setup(canManage)
    const created = await request('POST', '/api/event-calendar', valid)
    expect(created.status).toBe(201)
    const createdBody = await readBody<{ data: { event: { id: string; product_name: string; start_time: string } } }>(created)
    expect(createdBody.data.event.product_name).toBe('Bisnis Masteri')
    expect(createdBody.data.event.start_time).toBe('10:00')
    expect(state.eventCalendar).toHaveLength(1)

    const listed = await request('GET', '/api/event-calendar?from=2026-11-01&to=2026-11-30')
    expect(listed.status).toBe(200)
    const listedBody = await readBody<{ data: { events: Array<{ id: string }>; products: Array<{ code: string }> } }>(listed)
    expect(listedBody.data.events).toHaveLength(1)
    expect(listedBody.data.products.map((product) => product.code)).toContain('BM')
  })

  it('input tidak valid ditolak sebelum menyentuh tabel', async () => {
    const { request, state } = await setup(canManage)
    for (const bad of [
      { product_code: '' },
      { product_code: 'TIDAK_ADA' },
      { category: 'Hybrid' },
      { event_date: '2026-02-30' },
      { start_time: '25:00' },
      { location: '   ' },
    ]) {
      expect((await request('POST', '/api/event-calendar', { ...valid, ...bad })).status, JSON.stringify(bad)).toBe(400)
    }
    expect(state.eventCalendar).toHaveLength(0)

    expect((await request('GET', '/api/event-calendar?from=2026-11-30&to=2026-11-01')).status).toBe(400)
    expect((await request('GET', '/api/event-calendar?from=bukan-tanggal')).status).toBe(400)
  })

  it('edit dan hapus event; id tidak valid / tidak ada -> 404', async () => {
    const { request, state } = await setup(canManage)
    const created = await request('POST', '/api/event-calendar', valid)
    const id = (await readBody<{ data: { event: { id: string } } }>(created)).data.event.id

    const updated = await request('PATCH', `/api/event-calendar/${id}`, {
      ...valid,
      category: 'Workshop',
      start_time: '13:30',
      location: 'Kantor Pusat',
    })
    expect(updated.status).toBe(200)
    expect(state.eventCalendar[0]?.['category']).toBe('Workshop')
    expect(state.eventCalendar[0]?.['location']).toBe('Kantor Pusat')

    expect((await request('PATCH', '/api/event-calendar/bukan-uuid', valid)).status).toBe(404)
    expect((await request('DELETE', '/api/event-calendar/22222222-2222-4222-8222-222222222222')).status).toBe(404)

    const deleted = await request('DELETE', `/api/event-calendar/${id}`)
    expect(deleted.status).toBe(200)
    expect(state.eventCalendar).toHaveLength(0)
  })
})
