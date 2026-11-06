import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeUser, loginAndGetToken, makeRequest } from './helpers'

/** Advertiser Notes: izin, validasi, dan kontrak route Worker. Aturan DB diuji terpisah. */
async function setup(role: string, permissions: string[] = []) {
  const state = createFakeState({
    users: [fakeUser({ role })],
    rolePermissions: permissions.map((permission_key) => ({ role_id: role, permission_key })),
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

const valid = {
  advertiser_code: '01',
  product_code: 'KM',
  batch: '122',
  title: 'Seminar Solo',
  description: 'Jalankan iklan sebelum deadline.',
  event_at: '2026-11-20T10:00:00+07:00',
  location: 'Solo',
  monitor_from: '2026-11-06',
  deadline_at: '2026-11-10T10:00:00+07:00',
  status: 'Aktif',
}

describe('Advertiser Notes', () => {
  it('tanpa izin ditolak di semua rute', async () => {
    const { request } = await setup('member', ['operasional.order'])
    expect((await request('GET', '/api/advertiser-notes')).status).toBe(403)
    expect((await request('POST', '/api/advertiser-notes', valid)).status).toBe(403)
    expect((await request('PATCH', '/api/advertiser-notes/11111111-1111-1111-1111-111111111111', valid)).status).toBe(403)
    expect((await request('DELETE', '/api/advertiser-notes/11111111-1111-1111-1111-111111111111')).status).toBe(403)
  })

  it('daftar memakai izin lihat dan mengirim filter ke RPC', async () => {
    const { request, state } = await setup('manajer', ['operasional.advertiser_notes'])
    const response = await request('GET', '/api/advertiser-notes?status=Aktif&batch=0122&page=2&pageSize=25')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { badge: number; summary: { active: number } } }
    expect(body.data.badge).toBe(0)
    const call = state.rpcCalls.find((item) => item.name === 'advertiser_notes_page')
    expect(call?.args['p_filters']).toMatchObject({ status: 'Aktif', batch: '122', page: 2, pageSize: 25 })
  })

  it('membuat note valid dan menolak input tidak valid sebelum RPC', async () => {
    const { request, state } = await setup('manajer', ['operasional.advertiser_notes', 'action.manage_advertiser_notes'])
    expect((await request('POST', '/api/advertiser-notes', valid)).status).toBe(201)
    const call = state.rpcCalls.find((item) => item.name === 'save_advertiser_note')
    expect(call?.args).toMatchObject({
      p_advertiser_code: '01', p_product_code: 'KM', p_batch: '122', p_title: 'Seminar Solo', p_status: 'Aktif',
    })

    for (const bad of [
      { title: '' },
      { advertiser_code: '' },
      { product_code: '' },
      { event_at: '' },
      { deadline_at: '' },
      { status: 'Selesai Sekali' },
    ]) {
      expect((await request('POST', '/api/advertiser-notes', { ...valid, ...bad })).status, JSON.stringify(bad)).toBe(400)
    }
  })

  it('id note tidak valid -> 404; arsip valid -> 200', async () => {
    const { request } = await setup('manajer', ['operasional.advertiser_notes', 'action.manage_advertiser_notes'])
    expect((await request('PATCH', '/api/advertiser-notes/bukan-uuid', valid)).status).toBe(404)
    expect((await request('DELETE', '/api/advertiser-notes/bukan-uuid')).status).toBe(404)
    expect((await request('DELETE', '/api/advertiser-notes/11111111-1111-1111-1111-111111111111')).status).toBe(200)
  })
})
