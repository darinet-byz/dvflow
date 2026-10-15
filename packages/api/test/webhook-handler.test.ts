import { describe, expect, it } from 'vitest'
import { DbError, type Db } from '../src/db/types'
import { createApi } from '../src/router'
import { ROUTES } from '../src/routes'
import {
  FIXED_NOW,
  createFakeDb,
  createFakeState,
  createTestEnv,
  makeRequest,
  readBody,
  sampleConfig,
  type FakeState,
} from './helpers'
import { coFormOrder, storefrontOrder } from './fixtures/orderonline'

const SECRET = 'rahasia-webhook-yang-panjang'
const WEBHOOK_PATH = `/api/webhooks/orderonline/${SECRET}`

type FailureBody = { ok: false; error: { code: string; message: string } }
type SuccessBody = { ok: true; data: { order_id: string; action: string } }

async function setup(seed: Partial<Parameters<typeof createFakeState>[0]> = {}, dbOverride?: Db) {
  const state = createFakeState({ config: sampleConfig(), ...seed })
  const env = await createTestEnv({ ORDERONLINE_WEBHOOK_SECRET: SECRET })
  const api = createApi({ env, db: dbOverride ?? createFakeDb(state), routes: ROUTES, now: FIXED_NOW })
  return { state, env, api }
}

function post(
  api: Awaited<ReturnType<typeof setup>>['api'],
  options: { path?: string; body?: unknown } = {},
) {
  // Webhook adalah server-to-server: tidak ada header Origin, dan tidak ada cookie.
  return api(
    makeRequest({
      method: 'POST',
      path: options.path ?? WEBHOOK_PATH,
      body: options.body ?? coFormOrder(),
      origin: null,
    }),
  )
}

function upsertPayload(state: FakeState): Record<string, unknown> {
  const call = [...state.rpcCalls].reverse().find((entry) => entry.name === 'upsert_order_webhook')
  if (call === undefined) throw new Error('upsert_order_webhook tidak dipanggil')
  const payload = call.args['p_payload']
  if (typeof payload !== 'object' || payload === null) throw new Error('p_payload bukan objek')
  return payload as Record<string, unknown>
}

describe('webhook: proteksi endpoint (01 §20, L05)', () => {
  it('secret salah -> 404, dan tidak menyentuh database', async () => {
    const { state, api } = await setup()

    const response = await post(api, { path: '/api/webhooks/orderonline/rahasia-yang-salah-panjang' })

    expect(response.status).toBe(404)
    expect((await readBody<FailureBody>(response)).error.code).toBe('NOT_FOUND')
    expect(state.rpcCalls).toHaveLength(0)
    expect(state.webhookLogs).toHaveLength(0)
  })

  it('secret yang lebih pendek/panjang juga 404', async () => {
    const { api } = await setup()
    for (const candidate of ['', 'rahasia', `${SECRET}panjangsekali`]) {
      const response = await post(api, { path: `/api/webhooks/orderonline/${candidate}` })
      expect(response.status).toBe(404)
    }
  })

  it('bila environment tidak menyetel secret, endpoint gagal-tertutup', async () => {
    const state = createFakeState({ config: sampleConfig() })
    const env = await createTestEnv({ ORDERONLINE_WEBHOOK_SECRET: undefined })
    const api = createApi({ env, db: createFakeDb(state), routes: ROUTES, now: FIXED_NOW })

    // Bahkan path dengan secret kosong tetap ditolak.
    const response = await post(api, { path: '/api/webhooks/orderonline/' })
    expect(response.status).toBe(404)
    expect(state.rpcCalls).toHaveLength(0)
  })
})

describe('webhook: payload tidak valid', () => {
  it('body kosong -> 400 dan tercatat', async () => {
    const { state, api } = await setup()

    const response = await api(makeRequest({ method: 'POST', path: WEBHOOK_PATH, origin: null }))

    expect(response.status).toBe(400)
    expect(state.webhookLogs[0]?.['outcome']).toBe('rejected')
    expect((state.webhookLogs[0]?.['payload_sanitized'] as Record<string, unknown>)['reason']).toBe('EMPTY_BODY')
  })

  it('body bukan JSON -> 400 dan tercatat', async () => {
    const { state, api } = await setup()

    const response = await api(
      makeRequest({
        method: 'POST',
        path: WEBHOOK_PATH,
        origin: null,
        headers: { 'content-type': 'application/json' },
        rawBody: 'ini bukan json',
      }),
    )

    expect(response.status).toBe(400)
    expect((state.webhookLogs[0]?.['payload_sanitized'] as Record<string, unknown>)['reason']).toBe('INVALID_JSON')
  })

  it('body melebihi batas ukuran ditolak tanpa diproses (04 §10)', async () => {
    const { state, api } = await setup()

    const response = await post(api, { body: coFormOrder({ padding: 'x'.repeat(70_000) }) })

    expect(response.status).toBe(400)
    expect((state.webhookLogs[0]?.['payload_sanitized'] as Record<string, unknown>)['reason']).toBe('TOO_LARGE')
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('gagal validasi kanonik (mis. nomor WA kepanjangan) -> 400, tanpa PII di log', async () => {
    const { state, api } = await setup()

    const response = await post(api, {
      body: coFormOrder({ customer_data: { name: 'X', phone: `+62${'9'.repeat(60)}`, email: 'a@b.c' } }),
    })

    expect(response.status).toBe(400)
    const summary = state.webhookLogs[0]?.['payload_sanitized'] as Record<string, unknown>
    expect(summary['reason']).toBe('CANONICAL_VALIDATION_FAILED')
    // Pesan validator disimpan untuk diagnosa operator, tetapi nomor WA mentahnya tidak.
    expect(summary['detail']).toContain('Nomor WA terlalu panjang')
    expect(JSON.stringify(state.webhookLogs)).not.toContain('9'.repeat(40))
  })

  it('C07: status order tak dikenal -> 422 dan TIDAK dipetakan diam-diam', async () => {
    const { state, api } = await setup()

    const response = await post(api, { body: coFormOrder({ status: 'refunded' }) })

    expect(response.status).toBe(422)
    expect((await readBody<FailureBody>(response)).error.code).toBe('UNSUPPORTED_ORDER_STATUS')
    expect(state.rpcCalls).toHaveLength(0)
    expect(state.orders.length).toBe(0)
    expect(state.webhookLogs[0]?.['error_code']).toBe('UNSUPPORTED_ORDER_STATUS')
  })
})

describe('webhook: ingestion yang diterima', () => {
  it('C01 pending -> 200 inserted dan payload RPC lengkap', async () => {
    const { state, api } = await setup()

    const response = await post(api)
    expect(response.status).toBe(200)

    const body = await readBody<SuccessBody>(response)
    expect(body).toEqual({ ok: true, data: { order_id: '281343516', action: 'inserted' } })

    const payload = upsertPayload(state)
    expect(payload['orderId']).toBe('281343516')
    expect(payload['appStatus']).toBe('Pending')
    expect(payload['rawStatus']).toBe('pending')
    expect(payload['grossAmount']).toBe(22000)
    expect(payload['productRaw']).toBe('Test')
    expect(payload['sourceCreatedAt']).toBe('2026-09-15T02:31:33Z')

    expect(state.webhookLogs[0]?.['outcome']).toBe('accepted')
    expect(state.webhookLogs[0]?.['order_id']).toBe('281343516')
  })

  it('C02 webhook yang sama diulang tetap satu order', async () => {
    const { state, api } = await setup()

    await post(api)
    const second = await post(api)

    expect((await readBody<SuccessBody>(second)).data.action).toBe('updated')
    expect(state.orders.length).toBe(1)
    expect(state.webhookLogs).toHaveLength(2)
  })

  it('C04/C05 processing dan complete -> Paid; C06 cancelled -> Cancelled', async () => {
    const cases: Array<[string, string]> = [
      ['pending', 'Pending'],
      ['processing', 'Paid'],
      ['complete', 'Paid'],
      ['cancelled', 'Cancelled'],
    ]

    for (const [rawStatus, expected] of cases) {
      const { state, api } = await setup()
      const response = await post(api, { body: coFormOrder({ status: rawStatus }) })

      expect(response.status).toBe(200)
      expect(upsertPayload(state)['appStatus']).toBe(expected)
    }
  })

  it('C10/C11/C12: produk valid diparse, product_raw dipertahankan', async () => {
    const { state, api } = await setup()

    const response = await post(api, { body: coFormOrder({ product_data: { name: 'KM01SO392 - S1 - Solo' } }) })
    expect(response.status).toBe(200)

    const payload = upsertPayload(state)
    expect(payload['productRaw']).toBe('KM01SO392 - S1 - Solo')
    expect(payload['parse']).toEqual({
      status: 'valid',
      productCode: 'KM',
      productName: 'Kuliner Masteri',
      advertiserCode: '01',
      advertiserName: 'Zul',
      eventType: 'Seminar Offline',
      batch: '392',
      session: 'S1',
      city: 'Solo',
    })
  })

  it('K8: produk yang NONAKTIF tetap dipakai parser', async () => {
    // `sampleConfig()` menandai produk KM sebagai active: false.
    const { state, api } = await setup()
    await post(api, { body: coFormOrder({ product_data: { name: 'KM01SO392 - S1 - Solo' } }) })

    expect((upsertPayload(state)['parse'] as Record<string, unknown>)['status']).toBe('valid')
  })

  it('01 §9: produk tak terbaca tetap menyimpan order, parse invalid', async () => {
    const { state, api } = await setup()

    const response = await post(api, { body: coFormOrder({ product_data: { name: 'Nama Produk Bebas' } }) })
    expect(response.status).toBe(200)

    const payload = upsertPayload(state)
    expect(payload['productRaw']).toBe('Nama Produk Bebas')
    expect(payload['parse']).toEqual({ status: 'invalid' })
    expect(state.orders.length).toBe(1)
  })

  it('K9: kandidat ambigu dicatat di webhook_logs untuk diagnosa', async () => {
    // Dua kombinasi kode menghasilkan prefix yang sama: K+M01+SO dan KM+01+SO.
    const state = createFakeState({
      config: {
        products: [
          { name: 'Produk K', code: 'K', active: true },
          { name: 'Produk KM', code: 'KM', active: true },
        ],
        advertisers: [
          { name: 'Pengiklan M01', code: 'M01', active: true },
          { name: 'Pengiklan 01', code: '01', active: true },
        ],
        eventTypes: [{ name: 'Seminar Offline', code: 'SO', kind: 'seminar', active: true }],
        sessions: [{ name: 'Sesi 1', code: 'S1', active: true }],
      },
    })
    const env = await createTestEnv({ ORDERONLINE_WEBHOOK_SECRET: SECRET })
    const api = createApi({ env, db: createFakeDb(state), routes: ROUTES, now: FIXED_NOW })

    const response = await post(api, { body: coFormOrder({ product_data: { name: 'KM01SO392 - S1 - Solo' } }) })
    expect(response.status).toBe(200)

    const summary = state.webhookLogs[0]?.['payload_sanitized'] as Record<string, unknown>
    expect(summary['parse_failure_reason']).toBe('AMBIGUOUS_CODE_COMBINATION')
    expect(summary['parse_candidates']).toEqual(['K+M01+SO', 'KM+01+SO'])
    // Order tetap tersimpan; akses acara nanti ditolak karena parse invalid.
    expect(state.orders.length).toBe(1)
  })

  it('bentuk storefront: order tersimpan, product_raw null, parse invalid', async () => {
    const { state, api } = await setup()

    const response = await post(api, { body: storefrontOrder() })
    expect(response.status).toBe(200)

    const payload = upsertPayload(state)
    expect(payload['orderId']).toBe('283033796')
    expect(payload['productRaw']).toBeNull()
    expect(payload['paymentIdentifier']).toBe('BCA')
    // Tanpa productRaw, RPC menolak blok parse — jadi parse tidak boleh dikirim.
    expect(payload).not.toHaveProperty('parse')

    const summary = state.webhookLogs[0]?.['payload_sanitized'] as Record<string, unknown>
    expect(summary['warnings']).toContain('storefront_product_raw_undetermined')
  })

  it('webhook_logs tidak pernah memuat PII pelanggan', async () => {
    const { state, api } = await setup()
    await post(api)
    await post(api, { body: storefrontOrder() })

    const serialized = JSON.stringify(state.webhookLogs)
    expect(serialized).not.toContain('Budi Pengunjung')
    expect(serialized).not.toContain('+628080080808')
    expect(serialized).not.toContain('budi.pengunjung@example.com')
    expect(serialized).not.toContain('Siti Pengunjung')
    expect(serialized).not.toContain('+628123456789')
    // Yang tetap ada hanyalah konteks operasional.
    expect(serialized).toContain('281343516')
  })

  it('kegagalan database -> 500 generik dan tetap tercatat', async () => {
    const state = createFakeState({ config: sampleConfig() })
    const failingDb: Db = {
      ...createFakeDb(state),
      async rpc() {
        throw new DbError('XX000', 'internal error on orders')
      },
    }
    const env = await createTestEnv({ ORDERONLINE_WEBHOOK_SECRET: SECRET })
    const api = createApi({ env, db: failingDb, routes: ROUTES, now: FIXED_NOW })

    const response = await post(api)

    expect(response.status).toBe(500)
    const raw = await response.text()
    expect(JSON.parse(raw)).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server.' },
    })
    expect(raw).not.toContain('orders')
    expect(raw).not.toContain('XX000')

    expect(state.webhookLogs[0]?.['outcome']).toBe('failed')
    expect(state.webhookLogs[0]?.['error_code']).toBe('XX000')
  })

  it('webhook tidak memerlukan header Origin (server-to-server)', async () => {
    const { api } = await setup()
    // `post()` selalu mengirim origin: null, dan permintaan tetap diterima.
    const response = await post(api)
    expect(response.status).toBe(200)
  })
})

describe('webhook: pemetaan dikunci walau alias dihapus (A17)', () => {
  it('alias dipakai saat Pending, alias dihapus, webhook Paid tetap terpetakan', async () => {
    const { state, api } = await setup()
    state.productAliases.push({ id: 'a1', alias_name: 'Test', alias_name_normalized: 'test', canonical_target: 'KM01SO392 - S1 - Solo' })
    expect((await post(api)).status).toBe(200)
    const order = () => state.orders.find((row) => row['order_id'] === '281343516')!
    expect(order()['product_parse_status']).toBe('valid')
    expect(order()['product_code']).toBe('KM')

    state.productAliases.length = 0 // alias dihapus
    expect((await post(api, { body: coFormOrder({ status: 'processing' }) })).status).toBe(200)
    expect(order()['app_status']).toBe('Paid')
    expect(order()['product_parse_status']).toBe('valid')
    expect(order()['product_code']).toBe('KM')
    expect(order()['event_type']).toBe('Seminar Offline')
    expect(state.webhookLogs.at(-1)?.['payload_sanitized']).toMatchObject({ mapping_kept: true })
  })
})
