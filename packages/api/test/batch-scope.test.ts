import { describe, expect, it } from 'vitest'
import { candidateSettingKeys } from '../src/webinar/handlers'
import { createFakeState, createTestApi, fakeOrder, fakeUser, loginAndGetToken, makeRequest, sampleConfig } from './helpers'

/** A32: cakupan Zoom/Tiket — batch tidak membedakan huruf besar/kecil, nol di depan tetap berarti. */
async function setup(orderBatch: string) {
  const state = createFakeState({
    users: [fakeUser({ role: 'developer' })],
    config: sampleConfig(),
    orders: [fakeOrder({ order_id: '880001', product_code: 'KM', batch: orderBatch, session: 'S1', event_type: 'Seminar Offline', product_raw: `KM01SO${orderBatch} - S1 - Solo` })],
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const saveRule = (batch: string) => api(makeRequest({ method: 'POST', path: '/api/seminar-tickets', headers: { authorization: `Bearer ${accessToken}` },
    body: { product_code: 'KM', batch, session_code: 'S1', notes: `Catatan batch ${batch}` } }))
  const ticket = async () => (await api(makeRequest({ method: 'GET', path: '/access/880001' }))).text()
  return { saveRule, ticket }
}

describe('batch di cakupan Zoom/Tiket (A32)', () => {
  it('aturan batch 58A berlaku untuk order batch 58a (disimpan huruf besar)', async () => {
    const { saveRule, ticket } = await setup('58a')
    const saved = await saveRule('58a')
    expect(saved.status).toBe(200)
    expect(((await saved.json()) as { data: { key: string } }).data.key).toBe('__scope__::KM:58A:S1')
    expect(await ticket()).toContain('Catatan batch 58a')
  })

  it('nol di depan tetap berarti: aturan 058 tidak berlaku untuk batch 58', async () => {
    const { saveRule, ticket } = await setup('58')
    expect((await saveRule('058')).status).toBe(200)
    expect(await ticket()).not.toContain('Catatan batch 058')
  })

  it.each(['5', '1001', '1234567890'])('batch %s (berbagai panjang) bisa jadi cakupan', async (batch) => {
    const { saveRule } = await setup(batch)
    expect((await saveRule(batch)).status).toBe(200)
  })

  it('batch dengan simbol / lebih dari 10 karakter ditolak', async () => {
    const { saveRule } = await setup('58')
    expect((await saveRule('58-A')).status).toBe(400)
    expect((await saveRule('12345678901')).status).toBe(400)
  })

  it('kandidat key memakai batch huruf besar', () => {
    expect(candidateSettingKeys({ product_raw: null, product_code: 'KM', batch: ' 58a ', session: 'S1' }, 'p::')).toContain('p::__scope__::KM:58A:S1')
  })
})
