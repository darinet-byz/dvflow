import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeUser, loginAndGetToken, makeRequest, sampleConfig } from './helpers'

/** A27: halaman Zoom/Tiket menerima kode toko aktif untuk link `/access/{KODE}/{{order_id}}`, tanpa token/secret. */
describe('kode toko di daftar Zoom & Tiket', () => {
  it.each(['/api/webinar-destinations', '/api/seminar-tickets'])('%s mengembalikan stores aktif saja', async (path) => {
    const state = createFakeState({ users: [fakeUser({ role: 'developer' })], config: sampleConfig() })
    state.orderonlineConnections.push(
      { id: 'c1', name: 'Master Tiktok Indonesia', slug: 'MTIX', active: true, api_token_encrypted: 'rahasia', webhook_secret_hash: 'hash' },
      { id: 'c2', name: 'Toko Lama', slug: 'OLD', active: false },
    )
    const { api } = await createTestApi(state)
    const { accessToken } = await loginAndGetToken(api, 'admin1')
    const body = (await (await api(makeRequest({ method: 'GET', path, headers: { authorization: `Bearer ${accessToken}` } }))).json()) as { data: { stores: unknown[] } }
    expect(body.data.stores).toEqual([{ name: 'Master Tiktok Indonesia', slug: 'MTIX' }])
  })
})
