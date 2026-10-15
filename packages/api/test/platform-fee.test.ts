import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeUser, loginAndGetToken, makeRequest, sampleConfig } from './helpers'

type Failure = { ok: false; error: { code: string; message: string } }

async function setup(role = 'developer', permissions: string[] = []) {
  const state = createFakeState({
    users: [fakeUser({ role })],
    config: sampleConfig(),
    rolePermissions: permissions.map((permission_key) => ({ role_id: role, permission_key })),
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, request }
}

describe('A15: platform fee & e-payment fee tax', () => {
  it('PLATFORM FEE global: simpan lalu baca', async () => {
    const { state, request } = await setup()
    expect(((await (await request('GET', '/api/config/platform-fee')).json()) as { data: { percent: number } }).data.percent).toBe(0)
    expect((await request('PUT', '/api/config/platform-fee', { percent: 2.5 })).status).toBe(200)
    expect(state.appSettings).toContainEqual(expect.objectContaining({ key: 'fee_setting::platform_fee_percent', value_text: '2.5' }))
    expect((await request('PUT', '/api/config/platform-fee', { percent: 3 })).status).toBe(200)
    expect(state.appSettings.filter((row) => row['key'] === 'fee_setting::platform_fee_percent')).toHaveLength(1)
    expect(((await (await request('GET', '/api/config/platform-fee')).json()) as { data: { percent: number } }).data.percent).toBe(3)
  })

  it('PLATFORM FEE di luar 0–100 ditolak dengan pesan jelas', async () => {
    const { request } = await setup()
    const response = await request('PUT', '/api/config/platform-fee', { percent: 101 })
    expect(response.status).toBe(400)
    expect(((await response.json()) as Failure).error.message).toContain('0–100')
  })

  it('role tanpa config.tax tidak dapat membaca/mengubah PLATFORM FEE', async () => {
    const { request } = await setup('member', ['operasional.order'])
    expect((await request('GET', '/api/config/platform-fee')).status).toBe(403)
    expect((await request('PUT', '/api/config/platform-fee', { percent: 1 })).status).toBe(403)
  })

  it('rule baru menyimpan platform fee + e-payment fee tax', async () => {
    const { state, request } = await setup()
    const response = await request('POST', '/api/config/payment-fee-rules', {
      name: 'VA BCA', identifier: 'va_bca', fee_type: 'flat', fee_value: 4000,
      platform_fee_applies: true, epayment_tax_type: 'percentage', epayment_tax_value: 1,
    })
    expect(response.status).toBe(201)
    expect(state.config.feeRules.at(-1)).toMatchObject({ platform_fee_applies: true, epayment_tax_type: 'percentage', epayment_tax_value: 1 })
  })

  it('e-payment fee tax: tipe tanpa nilai, atau persen > 100, ditolak', async () => {
    const { request } = await setup()
    const base = { name: 'X', identifier: 'x', fee_type: 'flat', fee_value: 0 }
    expect((await request('POST', '/api/config/payment-fee-rules', { ...base, epayment_tax_type: 'flat' })).status).toBe(400)
    expect((await request('POST', '/api/config/payment-fee-rules', { ...base, epayment_tax_type: 'percentage', epayment_tax_value: 150 })).status).toBe(400)
  })

  it('mengosongkan e-payment fee tax menghapus tipe dan nilainya', async () => {
    const { state, request } = await setup()
    const id = String(state.config.feeRules[0]!['id'])
    expect((await request('PATCH', `/api/config/payment-fee-rules/${id}`, { epayment_tax_type: 'percentage', epayment_tax_value: 1 })).status).toBe(200)
    expect((await request('PATCH', `/api/config/payment-fee-rules/${id}`, { epayment_tax_type: '', epayment_tax_value: '' })).status).toBe(200)
    expect(state.config.feeRules[0]).toMatchObject({ epayment_tax_type: null, epayment_tax_value: null })
  })
})
