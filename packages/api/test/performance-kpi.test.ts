import { describe, expect, it } from 'vitest'
import {
  createFakeState,
  createTestApi,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
} from './helpers'

/** A83: KPI tiket global per bulan — izin, validasi, upsert. */
async function setup(permissions: string[] = ['operasional.analytics']) {
  const state = createFakeState({
    users: [fakeUser({ role: 'manajer', username: 'manajer1' })],
    rolePermissions: permissions.map((permission_key) => ({ role_id: 'manajer', permission_key })),
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'manajer1')
  const request = (method: 'GET' | 'PUT', path: string, body?: unknown) =>
    api(makeRequest({
      method,
      path,
      headers: { authorization: `Bearer ${accessToken}` },
      ...(body === undefined ? {} : { body }),
    }))
  return { state, request }
}

describe('A83: KPI Performa', () => {
  it('bulan tanpa KPI mengembalikan null, bukan 0', async () => {
    const { request } = await setup()
    const response = await request('GET', '/api/performance/kpi?month=2026-11')
    expect(response.status).toBe(200)
    const body = await readBody<{ data: { month: string; target_tickets: number | null } }>(response)
    expect(body.data).toMatchObject({ month: '2026-11', target_tickets: null })
  })

  it('menyimpan lalu memperbarui KPI bulan yang sama', async () => {
    const { request, state } = await setup()

    const created = await request('PUT', '/api/performance/kpi', { month: '2026-11', target_tickets: 100 })
    expect(created.status).toBe(200)
    expect(state.performanceKpiTargets).toHaveLength(1)
    expect(state.performanceKpiTargets[0]).toMatchObject({
      period_month: '2026-11-01',
      target_tickets: 100,
      updated_by: 'user-admin',
    })

    const read = await request('GET', '/api/performance/kpi?month=2026-11')
    expect((await readBody<{ data: { target_tickets: number } }>(read)).data.target_tickets).toBe(100)

    const updated = await request('PUT', '/api/performance/kpi', { month: '2026-11', target_tickets: 120 })
    expect(updated.status).toBe(200)
    expect(state.performanceKpiTargets).toHaveLength(1)
    expect(state.performanceKpiTargets[0]?.['target_tickets']).toBe(120)
  })

  it('bulan dan angka tidak valid ditolak sebelum menyentuh tabel', async () => {
    const { request, state } = await setup()
    for (const body of [
      { month: '2026-13', target_tickets: 100 },
      { month: '2026-1', target_tickets: 100 },
      { month: '2026-11', target_tickets: 0 },
      { month: '2026-11', target_tickets: 1.5 },
      { month: '2026-11', target_tickets: '100' },
    ]) {
      expect((await request('PUT', '/api/performance/kpi', body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await request('GET', '/api/performance/kpi?month=2026-13')).status).toBe(400)
    expect(state.performanceKpiTargets).toHaveLength(0)
  })

  it('tanpa operasional.analytics ditolak', async () => {
    const { request } = await setup([])
    expect((await request('GET', '/api/performance/kpi?month=2026-11')).status).toBe(403)
    expect((await request('PUT', '/api/performance/kpi', { month: '2026-11', target_tickets: 100 })).status).toBe(403)
  })
})
