import { describe, expect, it } from 'vitest'
import type { AppRole } from '@dvflow/shared'
import { createFakeState, createTestApi, fakeUser, makeRequest, readBody, fakeOrder, sampleConfig } from './helpers'

async function setup(role: AppRole) {
  const state = createFakeState({ users: [fakeUser({ role })], config: sampleConfig() })
  const { api } = await createTestApi(state)
  const login = await api(makeRequest({ method: 'POST', path: '/api/auth/login', body: { username: 'admin1', password: 'rahasia123' } }))
  const body = await readBody<{ data: { access_token: string } }>(login)
  const headers = { authorization: `Bearer ${body.data.access_token}` }
  return { state, api, headers }
}

describe('Add Team access & CRUD', () => {
  it.each(['admin', 'staff'] as const)('%s cannot list team members', async role => {
    const { api, headers } = await setup(role)
    expect((await api(makeRequest({ method: 'GET', path: '/api/internal/users', headers }))).status).toBe(403)
  })
  it('only returns safe columns to Admin Master', async () => {
    const { api, headers } = await setup('master_admin')
    const r = await api(makeRequest({ method: 'GET', path: '/api/internal/users', headers }))
    expect(r.status).toBe(200)
    const text = await r.text()
    expect(text).toContain('admin1')
    expect(text).not.toContain('password')
    expect(text).not.toContain('rahasia123')
  })
  it('rejects disabled users with an otherwise valid token', async () => {
    const { api, headers, state } = await setup('master_admin')
    state.users[0]!.active = false
    expect((await api(makeRequest({ method: 'GET', path: '/api/internal/users', headers }))).status).toBe(401)
  })
  it('allows Admin Master to edit and delete other members, while preventing self-delete or self-deactivation', async () => {
    const { api, headers, state } = await setup('master_admin')
    const createRes = await api(makeRequest({
      method: 'POST',
      path: '/api/internal/users',
      headers,
      body: { username: 'staff2', display_name: 'Staff Dua', initial_password: 'password123', role: 'staff' },
    }))
    expect(createRes.status).toBe(201)
    const createdId = (await readBody<{ data: { user: { user_id: string } } }>(createRes)).data.user.user_id

    const updateRes = await api(makeRequest({
      method: 'PATCH',
      path: `/api/internal/users/${createdId}`,
      headers,
      body: { display_name: 'Staff Dua Diperbarui', role: 'admin', active: false },
    }))
    expect(updateRes.status).toBe(200)
    expect(state.users.find(u => u.id === createdId)?.display_name).toBe('Staff Dua Diperbarui')
    expect(state.users.find(u => u.id === createdId)?.active).toBe(false)

    // Tidak boleh menghapus akun sendiri
    const selfId = state.users[0]!.id
    expect((await api(makeRequest({ method: 'DELETE', path: `/api/internal/users/${selfId}`, headers }))).status).toBe(403)
    expect((await api(makeRequest({ method: 'PATCH', path: `/api/internal/users/${selfId}`, headers, body: { active: false } }))).status).toBe(403)

    // Boleh menghapus member lain
    const delRes = await api(makeRequest({ method: 'DELETE', path: `/api/internal/users/${createdId}`, headers }))
    expect(delRes.status).toBe(200)
    expect(state.users.find(u => u.id === createdId)).toBeUndefined()
  })
})

describe('Zoom mapping (scoped & exact) and participant access', () => {
  it('allows active Team to save, list, update, delete and redirect a paid webinar order', async () => {
    const { api, headers, state } = await setup('staff')
    const product = 'KM01WO392 - S1 - Solo'
    for (const url of ['https://us02web.zoom.us/j/123', 'https://zoom.us/j/456?pwd=test']) {
      const r = await api(makeRequest({ method: 'POST', path: '/api/webinar-destinations', headers, body: { product_raw: product, destination: url } }))
      expect(r.status).toBe(200)
    }
    expect(state.appSettings).toHaveLength(1)
    const list = await api(makeRequest({ method: 'GET', path: '/api/webinar-destinations', headers }))
    expect(list.status).toBe(200)
    expect(await list.text()).toContain(product)
    state.orders.push(fakeOrder({ product_raw: product, event_type: 'Webinar Online' }))
    const access = await api(makeRequest({ method: 'GET', path: '/access/283033796' }))
    expect(access.status).toBe(302)
    expect(access.headers.get('location')).toBe('https://zoom.us/j/456?pwd=test')
    expect(state.attendanceEvents).toHaveLength(1)

    const del = await api(makeRequest({ method: 'DELETE', path: `/api/webinar-destinations?key=${encodeURIComponent(product)}`, headers }))
    expect(del.status).toBe(200)
    expect(state.appSettings).toHaveLength(0)
  })

  it('resolves scoped Zoom rules by specificity (global -> session -> product -> product+session)', async () => {
    const { api, headers, state } = await setup('staff')
    state.orders.push(fakeOrder({
      order_id: '777001',
      product_raw: 'KM01WO392 - S1 - Solo',
      product_code: 'KM',
      batch: '392',
      session: 'S1',
      event_type: 'Webinar Online',
    }))

    // 1. Global rule (*:*:*)
    await api(makeRequest({
      method: 'POST',
      path: '/api/webinar-destinations',
      headers,
      body: { product_code: '*', batch: '*', session_code: '*', destination: 'https://zoom.us/j/global' },
    }))
    expect((await api(makeRequest({ method: 'GET', path: '/access/777001' }))).headers.get('location')).toBe('https://zoom.us/j/global')

    // 2. Per session (*:*:S1) beats global
    await api(makeRequest({
      method: 'POST',
      path: '/api/webinar-destinations',
      headers,
      body: { product_code: '*', batch: '*', session_code: 'S1', destination: 'https://zoom.us/j/session-s1' },
    }))
    expect((await api(makeRequest({ method: 'GET', path: '/access/777001' }))).headers.get('location')).toBe('https://zoom.us/j/session-s1')

    // 3. Per product (KM:*:*) beats per session
    await api(makeRequest({
      method: 'POST',
      path: '/api/webinar-destinations',
      headers,
      body: { product_code: 'KM', batch: '*', session_code: '*', destination: 'https://zoom.us/j/product-km' },
    }))
    expect((await api(makeRequest({ method: 'GET', path: '/access/777001' }))).headers.get('location')).toBe('https://zoom.us/j/product-km')

    // 4. Product + Session (KM:*:S1) beats product only
    await api(makeRequest({
      method: 'POST',
      path: '/api/webinar-destinations',
      headers,
      body: { product_code: 'KM', batch: '*', session_code: 'S1', destination: 'https://zoom.us/j/km-s1' },
    }))
    expect((await api(makeRequest({ method: 'GET', path: '/access/777001' }))).headers.get('location')).toBe('https://zoom.us/j/km-s1')
  })

  it.each(['http://zoom.us/j/1', 'https://zoom.us.evil.test/j/1', 'javascript:alert(1)', 'https://x:y@zoom.us/j/1'])('rejects unsafe destination %s', async destination => {
    const { api, headers, state } = await setup('admin')
    expect((await api(makeRequest({ method: 'POST', path: '/api/webinar-destinations', headers, body: { product_raw: 'KM01WO392 - S1 - Solo', destination } }))).status).toBe(400)
    expect(state.appSettings).toHaveLength(0)
  })
  it.each(['UNKNOWN01WO392 - S1 - Solo', 'KM01SO392 - S1 - Solo'])('rejects invalid or seminar product %s', async product_raw => {
    const { api, headers } = await setup('admin')
    expect((await api(makeRequest({ method: 'POST', path: '/api/webinar-destinations', headers, body: { product_raw, destination: 'https://zoom.us/j/1' } }))).status).toBe(400)
  })
})

describe('Seminar Ticket / Barcode configuration and participant ticket rendering', () => {
  it('saves scoped ticket metadata and renders venue, schedule, and notes on participant QR ticket page', async () => {
    const { api, headers, state } = await setup('staff')
    state.orders.push(fakeOrder({
      order_id: '888001',
      product_raw: 'KM01SO392 - S1 - Solo',
      product_code: 'KM',
      batch: '392',
      session: 'S1',
      event_type: 'Seminar Offline',
    }))

    const saveRes = await api(makeRequest({
      method: 'POST',
      path: '/api/seminar-tickets',
      headers,
      body: {
        product_code: 'KM',
        batch: '392',
        session_code: 'S1',
        venue: 'Hotel Solo Paragon Ballroom',
        schedule: 'Minggu, 09:00 - 15:00 WIB',
        notes: 'Hadir 30 menit sebelum acara.',
        active: true,
      },
    }))
    expect(saveRes.status).toBe(200)

    const ticketPage = await api(makeRequest({ method: 'GET', path: '/access/888001' }))
    expect(ticketPage.status).toBe(200)
    const html = await ticketPage.text()
    expect(html).toContain('Hotel Solo Paragon Ballroom')
    expect(html).toContain('Minggu, 09:00 - 15:00 WIB')
    expect(html).toContain('Hadir 30 menit sebelum acara.')
    expect(html).toContain('data-checkin-payload="/checkin/888001"')

    const delRes = await api(makeRequest({
      method: 'DELETE',
      path: `/api/seminar-tickets?key=${encodeURIComponent('__scope__::KM:392:S1')}`,
      headers,
    }))
    expect(delRes.status).toBe(200)
  })
})
