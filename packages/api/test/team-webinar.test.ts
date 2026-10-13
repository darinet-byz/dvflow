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

describe('Add Team access', () => {
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
})

describe('Zoom mapping and participant access', () => {
  it('allows active Team to save, list, update and redirect a paid webinar order', async () => {
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
