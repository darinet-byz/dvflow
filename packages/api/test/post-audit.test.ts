import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeUser, loginAndGetToken, makeRequest, sampleConfig } from './helpers'

type Failure = { ok: false; error: { code: string; message: string } }

async function setup(role = 'developer') {
  const state = createFakeState({ users: [fakeUser({ role })], config: sampleConfig() })
  const { api } = await createTestApi(state, { env: { INTEGRATION_ENCRYPTION_KEY: btoa('x'.repeat(32)) } })
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

describe('perbaikan pasca-audit', () => {
  it('ganti nama baris legacy tetap bisa bila kode tidak berubah', async () => {
    const { state, request } = await setup()
    const legacy = state.config.products[1]! // kode legacy 2 huruf "BM"
    const response = await request('PATCH', `/api/config/products/${String(legacy['id'])}`, { name: 'Bisnis Baru', code: 'bm ' })
    expect(response.status).toBe(200)
    expect(legacy['name']).toBe('Bisnis Baru')
    expect(legacy['code']).toBe('BM')
  })

  it('kode yang benar-benar diubah tetap wajib standar, dengan pesan yang jelas', async () => {
    const { state, request } = await setup()
    const response = await request('PATCH', `/api/config/products/${String(state.config.products[1]!['id'])}`, { code: 'XY' })
    expect(response.status).toBe(400)
    expect(((await response.json()) as Failure).error.message).toContain('4 huruf')
  })

  it('mengaktifkan ulang fee rule dengan identifier yang sudah aktif -> IDENTIFIER_TAKEN', async () => {
    const { state, request } = await setup()
    state.config.feeRules.push({ id: '00000000-0000-4000-8000-000000000099', name: 'Lama', identifier: 'qris', fee_type: 'flat', fee_value: 1, active: false })
    const response = await request('PATCH', '/api/config/payment-fee-rules/00000000-0000-4000-8000-000000000099', { active: true })
    expect(response.status).toBe(409)
    expect(((await response.json()) as Failure).error.code).toBe('IDENTIFIER_TAKEN')
  })

  it('kode toko koneksi tidak dapat diubah setelah dibuat', async () => {
    const { request } = await setup()
    const created = await request('POST', '/api/integrations/orderonline', { name: 'Toko Solo', slug: 'SOLO', active: true })
    expect(created.status).toBe(201)
    const { data } = (await created.json()) as { data: { id: string } }
    const changed = await request('PATCH', `/api/integrations/orderonline/${data.id}`, { name: 'Toko Solo', slug: 'BDG', active: true })
    expect(changed.status).toBe(400)
    expect(((await changed.json()) as Failure).error.message).toContain('tidak dapat diubah')
    expect((await request('PATCH', `/api/integrations/orderonline/${data.id}`, { name: 'Toko Solo 2', slug: 'SOLO', active: true })).status).toBe(200)
  })

  it('pesan validasi Zoom sampai ke klien', async () => {
    const { request } = await setup()
    const response = await request('POST', '/api/webinar-destinations', { product_code: '*', destination: 'https://contoh.com/x' })
    expect(response.status).toBe(400)
    expect(((await response.json()) as Failure).error.message).toBe('Gunakan link HTTPS Zoom')
  })

  it('edit scope Zoom membuang key lama, tidak meninggalkan rule ganda', async () => {
    const { state, request } = await setup()
    const save = (body: Record<string, unknown>) => request('POST', '/api/webinar-destinations', body)
    expect((await save({ product_code: 'BM', batch: '*', session_code: '*', destination: 'https://zoom.us/j/1' })).status).toBe(200)
    expect((await save({
      product_code: 'BM', batch: '*', session_code: 'S1', destination: 'https://zoom.us/j/2',
      original_key: '__scope__::BM:*:*',
    })).status).toBe(200)
    const keys = state.appSettings.map((row) => String(row['key']))
    expect(keys).toContain('webinar_destination::__scope__::BM:*:S1')
    expect(keys).not.toContain('webinar_destination::__scope__::BM:*:*')
  })

  it('master_admin tidak dapat menghapus developer; developer dapat', async () => {
    const state = createFakeState({
      users: [
        fakeUser({ id: 'u-master', username: 'master', role: 'master_admin' }),
        fakeUser({ id: 'u-dev', username: 'dev', role: 'developer' }),
        fakeUser({ id: 'u-member', username: 'member', role: 'member' }),
      ],
    })
    const { api } = await createTestApi(state)
    const master = (await loginAndGetToken(api, 'master')).accessToken
    const del = (token: string, id: string) =>
      api(makeRequest({ method: 'DELETE', path: `/api/internal/users/${id}`, headers: { authorization: `Bearer ${token}` } }))
    expect((await del(master, 'u-dev')).status).toBe(403)
    expect((await del(master, 'u-member')).status).toBe(200)
    const dev = (await loginAndGetToken(api, 'dev')).accessToken
    expect((await del(dev, 'u-master')).status).toBe(200)
    expect(state.users.map((u) => u.id)).toEqual(['u-dev'])
  })
})
