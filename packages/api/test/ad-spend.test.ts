import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeUser, loginAndGetToken, makeRequest, sampleConfig } from './helpers'

/** A37: Worker Report Spend Iklan — izin, validasi input, dan notif rentang bertumpuk. Aturan DB: pgTAP 24_ad_spend_reports.sql. */
async function setup(role: string, permissions: string[] = []) {
  const state = createFakeState({
    users: [fakeUser({ role, display_name: 'Pengiklan' })],
    rolePermissions: permissions.map((permission_key) => ({ role_id: role, permission_key })),
    config: sampleConfig(),
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

const valid = { product_code: 'KM', batch: '0122', event_type: 'Seminar Offline', date_from: '2026-10-20', date_to: '2026-10-21', spend: 6000000, tax_percent: 11 }
const REPORT_ID = '11111111-2222-4333-8444-555555555555'

describe('Report Spend Iklan (A37)', () => {
  it('tanpa izin action.input_spend ditolak di semua rute', async () => {
    const { request } = await setup('manajer', ['operasional.report_spend'])
    expect((await request('POST', '/api/ad-spend-reports', valid)).status).toBe(403)
    expect((await request('PATCH', `/api/ad-spend-reports/${REPORT_ID}`, valid)).status).toBe(403)
    expect((await request('DELETE', `/api/ad-spend-reports/${REPORT_ID}`)).status).toBe(403)
  })

  it('validasi sebelum RPC', async () => {
    const { request, state } = await setup('advertiser', ['action.input_spend'])
    for (const bad of [
      { product_code: '' },
      { batch: '' },
      { batch: '   ' },
      { event_type: '' },
      { event_type: 'Workshop' },
      { date_from: '' },
      { date_to: '2026-10-19' },
      { date_from: '2026-02-30', date_to: '2026-02-30' },
      { spend: -1 },
      { spend: 'enam juta' },
      { spend: null },
      { tax_percent: null },
      { tax_percent: -1 },
      { tax_percent: 101 },
    ]) {
      const response = await request('POST', '/api/ad-spend-reports', { ...valid, ...bad })
      expect(response.status, JSON.stringify(bad)).toBe(400)
    }
    expect(state.rpcCalls.filter((call) => call.name === 'save_ad_spend_report')).toHaveLength(0)
  })

  it('menyimpan dengan batch ternormalisasi; pengiklan tidak pernah dari body', async () => {
    const { request, state } = await setup('advertiser', ['action.input_spend'])
    const response = await request('POST', '/api/ad-spend-reports', { ...valid, advertiser_id: 'lain', spend: '6000000' })
    expect(response.status).toBe(201)
    const call = state.rpcCalls.find((item) => item.name === 'save_ad_spend_report')!
    expect(call.args).toEqual({
      p_actor: state.users[0]!.id,
      p_id: null,
      p_product_code: 'KM',
      p_batch: '122',
      p_event_type: 'Seminar Offline',
      p_date_from: '2026-10-20',
      p_date_to: '2026-10-21',
      p_spend: 6000000,
      p_tax_percent: 11,
      p_confirm_overlap: false,
    })
    const body = (await response.json()) as { data: { spend: number; tax_percent: number } }
    expect(body.data).toMatchObject({ spend: 6000000, tax_percent: 11 })
  })

  it('rentang bertumpuk -> 409 AD_SPEND_OVERLAP; "Tambahkan Data Ini" (confirm_overlap) tetap menyimpan', async () => {
    const { request } = await setup('advertiser', ['action.input_spend'])
    expect((await request('POST', '/api/ad-spend-reports', valid)).status).toBe(201)
    const second = await request('POST', '/api/ad-spend-reports', valid)
    expect(second.status).toBe(409)
    const failure = (await second.json()) as { error: { code: string; message: string } }
    expect(failure.error).toEqual({ code: 'AD_SPEND_OVERLAP', message: 'Tanggal, produk, batch, dan jenis acara sudah ada.' })
    expect((await request('POST', '/api/ad-spend-reports', { ...valid, confirm_overlap: true })).status).toBe(201)
  })

  it('edit & hapus memakai id dari path; id tidak valid -> 404', async () => {
    const { request, state } = await setup('advertiser', ['action.input_spend'])
    expect((await request('PATCH', `/api/ad-spend-reports/${REPORT_ID}`, valid)).status).toBe(200)
    expect(state.rpcCalls.at(-1)!.args['p_id']).toBe(REPORT_ID)
    expect((await request('DELETE', `/api/ad-spend-reports/${REPORT_ID}`)).status).toBe(200)
    expect((await request('DELETE', '/api/ad-spend-reports/bukan-uuid')).status).toBe(404)
  })
})

/** A87: Card Report — banyak baris budget, PPN per baris, manajer boleh mengelola. */
async function setupCard(role: string, permissions: string[] = [], advertiserId: string | null = null) {
  const state = createFakeState({
    users: [fakeUser({ role, display_name: 'Pengiklan', advertiser_id: advertiserId })],
    rolePermissions: permissions.map((permission_key) => ({ role_id: role, permission_key })),
    config: sampleConfig(),
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

const cardValid = {
  name: 'Card Batch 122',
  product_code: 'KM',
  batch: '0122',
  event_type: 'Seminar Offline',
  spends: [
    { date_from: '2026-10-20', date_to: '2026-10-21', spend: 6000000, tax_percent: 11 },
    { date_from: '2026-10-20', date_to: '2026-10-21', spend: 4000000, tax_percent: 0 },
  ],
}
const CARD_ID = '11111111-2222-4333-8444-555555555555'

describe('Card Report Iklan (A87)', () => {
  it('advertiser membuat card dengan dua baris budget; PPN tiap baris tidak dicampur', async () => {
    const { request, state } = await setupCard('advertiser', ['action.input_spend'], 'adv-1')
    const response = await request('POST', '/api/ad-spend-cards', cardValid)
    expect(response.status).toBe(201)
    const call = state.rpcCalls.find((item) => item.name === 'save_ad_spend_card')!
    expect(call.args).toMatchObject({
      p_actor: state.users[0]!.id,
      p_card_id: null,
      p_name: 'Card Batch 122',
      p_product_code: 'KM',
      p_batch: '122',
      p_event_type: 'Seminar Offline',
      p_status: 'berjalan',
    })
    expect(call.args['p_spends']).toEqual([
      { id: null, date_from: '2026-10-20', date_to: '2026-10-21', spend: 6000000, tax_percent: 11 },
      { id: null, date_from: '2026-10-20', date_to: '2026-10-21', spend: 4000000, tax_percent: 0 },
    ])
  })

  it('card yang sudah ada mengembalikan 200 existing', async () => {
    const { request } = await setupCard('advertiser', ['action.input_spend'], 'adv-1')
    expect((await request('POST', '/api/ad-spend-cards', cardValid)).status).toBe(201)
    const second = await request('POST', '/api/ad-spend-cards', cardValid)
    expect(second.status).toBe(200)
    expect(((await second.json()) as { data: { action: string } }).data.action).toBe('existing')
  })

  it('manajer dengan action.manage_spend bisa edit/hapus; tanpa izin ditolak', async () => {
    const allowed = await setupCard('manajer', ['action.manage_spend'])
    allowed.state.adSpendCards.push({
      id: CARD_ID,
      advertiser_id: 'adv-1',
      product_code: 'KM',
      batch: '122',
      event_type: 'Seminar Offline',
      name: 'Card Batch 122',
      status: 'berjalan',
    })
    expect((await allowed.request('PATCH', `/api/ad-spend-cards/${CARD_ID}`, cardValid)).status).toBe(200)
    expect((await allowed.request('DELETE', `/api/ad-spend-cards/${CARD_ID}`)).status).toBe(200)

    const denied = await setupCard('manajer', ['operasional.report_spend'])
    expect((await denied.request('PATCH', `/api/ad-spend-cards/${CARD_ID}`, cardValid)).status).toBe(403)
    expect((await denied.request('DELETE', `/api/ad-spend-cards/${CARD_ID}`)).status).toBe(403)
  })

  it('manajer tidak boleh membuat card baru (hanya advertiser)', async () => {
    const { request, state } = await setupCard('manajer', ['action.manage_spend'])
    expect((await request('POST', '/api/ad-spend-cards', cardValid)).status).toBe(403)
    expect(state.rpcCalls.filter((call) => call.name === 'save_ad_spend_card')).toHaveLength(0)
  })

  it('validasi tiap baris sebelum RPC', async () => {
    const { request, state } = await setupCard('advertiser', ['action.input_spend'], 'adv-1')
    const tooMany = Array.from({ length: 21 }, () => cardValid.spends[0]!)
    for (const bad of [
      { spends: [] },
      { spends: tooMany },
      { spends: [{ ...cardValid.spends[0], date_from: '' }] },
      { spends: [{ ...cardValid.spends[0], date_from: '2026-02-30' }] },
      { spends: [{ ...cardValid.spends[0], date_to: '2026-10-19' }] },
      { spends: [{ ...cardValid.spends[0], spend: -1 }] },
      { spends: [{ ...cardValid.spends[0], spend: 'enam juta' }] },
      { spends: [{ ...cardValid.spends[0], tax_percent: null }] },
      { spends: [{ ...cardValid.spends[0], tax_percent: 101 }] },
      { spends: [{ ...cardValid.spends[0], id: 'bukan-uuid' }] },
    ]) {
      const response = await request('POST', '/api/ad-spend-cards', { ...cardValid, ...bad })
      expect(response.status, JSON.stringify(bad)).toBe(400)
    }
    expect(state.rpcCalls.filter((call) => call.name === 'save_ad_spend_card')).toHaveLength(0)
  })

  it('id card tidak valid -> 404', async () => {
    const { request } = await setupCard('manajer', ['action.manage_spend'])
    expect((await request('PATCH', '/api/ad-spend-cards/bukan-uuid', cardValid)).status).toBe(404)
    expect((await request('DELETE', '/api/ad-spend-cards/bukan-uuid')).status).toBe(404)
  })
})
