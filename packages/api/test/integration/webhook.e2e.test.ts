import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createHandler, type Api } from '../../src/index'
import { createTestEnv, makeRequest, readBody } from '../helpers'
import { coFormOrder, storefrontOrder } from '../fixtures/orderonline'

/**
 * Test integrasi ingestion webhook terhadap Supabase lokal.
 *
 * Yang hanya dapat dibuktikan di sini:
 *   1. RPC `upsert_order_webhook` benar-benar idempoten lewat UNIQUE `order_id`
 *      di PostgreSQL, termasuk saat dua webhook identik datang BERSAMAAN (M01);
 *   2. snapshot tax benar-benar dihitung dan dicocokkan dengan fee rule nyata;
 *   3. `webhook_logs` benar-benar tertulis lewat service key;
 *   4. urutan status (`pending` -> `processing`) tidak menggeser `paid_at`.
 *
 * Konfigurasi yang dipakai berasal dari `supabase/seed.sql` (produk KULI, pengiklan
 * 01, event type SO/WO, sesi S1/ST, dan dua fee rule). Bila seed berubah, test ini
 * akan gagal — dan itu memang tujuannya: fixture dan seed harus sejalan.
 */

const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
const envVars = processLike?.env ?? {}

const SUPABASE_URL = envVars['SUPABASE_URL']
const SUPABASE_SECRET_KEY = envVars['SUPABASE_SECRET_KEY']
const SUPABASE_DB_URL = envVars['SUPABASE_DB_URL']
const WEBHOOK_SECRET = envVars['ORDERONLINE_WEBHOOK_SECRET'] ?? 'secret-integrasi-webhook'

const configured = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY && SUPABASE_DB_URL)

const run = configured ? describe : describe.skip

run('integrasi webhook terhadap Supabase lokal', () => {
  const suffix = `${Date.now()}`.slice(-8)
  const orderId = `e2e${suffix}01`
  const cancelledOrderId = `e2e${suffix}02`
  const invalidProductOrderId = `e2e${suffix}03`
  const concurrentOrderId = `e2e${suffix}04`
  const storefrontOrderId = `e2e${suffix}05`
  const qrisOrderId = `e2e${suffix}06`

  let client: Client | undefined
  let api: Api

  function db(): Client {
    if (client === undefined) throw new Error('koneksi pg belum siap')
    return client
  }

  function post(body: unknown, secret = WEBHOOK_SECRET): Promise<Response> {
    return api(
      makeRequest({
        method: 'POST',
        path: `/api/webhooks/orderonline/${secret}`,
        body,
        origin: null,
      }),
    )
  }

  async function orderRow(id: string): Promise<Record<string, unknown>> {
    const { rows } = await db().query<Record<string, unknown>>(
      `select order_id, app_status, raw_status, product_raw, product_parse_status, product_code,
              advertiser_code, event_type, batch, session, city, payment_identifier_normalized,
              gross_amount, tax_amount, net_amount, tax_mapping_status, fee_rule_name_snapshot,
              paid_at, created_at
         from public.orders where order_id = $1`,
      [id],
    )
    const row = rows[0]
    if (row === undefined) throw new Error(`order ${id} tidak ada`)
    return row
  }

  beforeAll(async () => {
    client = new Client({ connectionString: SUPABASE_DB_URL })
    await client.connect()

    const env = await createTestEnv({
      SUPABASE_URL: SUPABASE_URL as string,
      SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY as string,
      ORDERONLINE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    })
    api = createHandler(env)
  })

  afterAll(async () => {
    if (client === undefined) return
    await client.query(`delete from public.webhook_logs where order_id like 'e2e%'`)
    await client.query(`delete from public.orders where order_id like 'e2e%'`)
    await client.end()
  })

  it('C01/C10/C11/C12 + tax: satu webhook menghasilkan satu Master Order lengkap', async () => {
    const response = await post(
      coFormOrder({
        order_id: orderId,
        product_data: { name: 'KULI01SO392 - S1 - Solo' },
        status: 'pending',
        total_price: 22000,
        payment: { method: 'bank_transfer', data: [], channels: [], status: 'unpaid' },
      }),
    )

    expect(response.status).toBe(200)
    expect((await readBody<{ data: { order_id: string; action: string } }>(response)).data).toEqual({
      order_id: orderId,
      action: 'inserted',
    })

    const row = await orderRow(orderId)
    expect(row['app_status']).toBe('Pending')
    expect(row['raw_status']).toBe('pending')
    expect(row['product_raw']).toBe('KULI01SO392 - S1 - Solo')
    expect(row['product_parse_status']).toBe('valid')
    expect(row['product_code']).toBe('KULI')
    expect(row['advertiser_code']).toBe('01')
    expect(row['event_type']).toBe('Seminar Offline')
    expect(row['batch']).toBe('392')
    expect(row['session']).toBe('S1')
    expect(row['city']).toBe('Solo')

    // Identifier webhook dinormalisasi database, lalu dicocokkan dengan fee rule seed.
    // Nilainya `payment.method` apa adanya (lihat VA-1): operator mendaftarkan
    // identifier yang benar-benar diterima aplikasi (06 §15).
    expect(row['payment_identifier_normalized']).toBe('bank_transfer')
    expect(row['tax_mapping_status']).toBe('mapped')
    expect(row['fee_rule_name_snapshot']).toBe('Admin Bank Transfer')
    expect(Number(row['tax_amount'])).toBe(4000)
    expect(Number(row['net_amount'])).toBe(18000)
  })

  it('C02/M01: sepuluh webhook berulang dan dua webhook BERSAMAAN tetap satu baris', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post(
        coFormOrder({ order_id: orderId, product_data: { name: 'KULI01SO392 - S1 - Solo' }, total_price: 22000 }),
      )
      expect(response.status).toBe(200)
      expect((await readBody<{ data: { action: string } }>(response)).data.action).toBe('updated')
    }

    // Dua permintaan identik dikirim bersamaan: yang kalah harus menunggu
    // transaksi pemenang lalu tidak melakukan apa pun (ON CONFLICT DO NOTHING).
    const concurrent = await Promise.all([
      post(coFormOrder({ order_id: concurrentOrderId, product_data: { name: 'KULI01SO392 - S1 - Solo' } })),
      post(coFormOrder({ order_id: concurrentOrderId, product_data: { name: 'KULI01SO392 - S1 - Solo' } })),
    ])
    expect(concurrent.map((response) => response.status)).toEqual([200, 200])

    const { rows } = await db().query<{ count: string }>(
      `select count(*)::text as count from public.orders where order_id in ($1, $2)`,
      [orderId, concurrentOrderId],
    )
    expect(rows[0]?.count).toBe('2')
  })

  it('C13: transisi ke Paid mengisi paid_at sekali saja', async () => {
    const paid = coFormOrder({
      order_id: orderId,
      product_data: { name: 'KULI01SO392 - S1 - Solo' },
      status: 'processing',
      total_price: 22000,
    })

    expect((await post(paid)).status).toBe(200)
    const first = await orderRow(orderId)
    expect(first['app_status']).toBe('Paid')
    expect(first['paid_at']).not.toBeNull()

    // Webhook Paid berikutnya membawa `complete` — status tetap Paid, paid_at tidak bergeser.
    expect((await post({ ...paid, payload: { ...paid['payload'] as object, status: 'complete', updated_at: '2026-09-15 03:00:00' } })).status).toBe(200)

    const second = await orderRow(orderId)
    expect(second['raw_status']).toBe('complete')
    expect(new Date(String(second['paid_at'])).getTime()).toBe(new Date(String(first['paid_at'])).getTime())
  })

  it('C06: cancelled -> Cancelled, dan tax snapshot tetap utuh', async () => {
    const response = await post(
      coFormOrder({ order_id: cancelledOrderId, product_data: { name: 'KULI01SO392 - S1 - Solo' }, status: 'cancelled' }),
    )
    expect(response.status).toBe(200)

    const row = await orderRow(cancelledOrderId)
    expect(row['app_status']).toBe('Cancelled')
    expect(row['paid_at']).toBeNull()
    expect(Number(row['tax_amount'])).toBe(4000)
  })

  it('C07: status tak dikenal -> 422 dan TIDAK ada order yang dibuat', async () => {
    const response = await post(coFormOrder({ order_id: `${orderId}x`, status: 'refunded' }))

    expect(response.status).toBe(422)
    expect((await readBody<{ error: { code: string } }>(response)).error.code).toBe('UNSUPPORTED_ORDER_STATUS')

    const { rows } = await db().query<{ count: string }>(
      'select count(*)::text as count from public.orders where order_id = $1',
      [`${orderId}x`],
    )
    expect(rows[0]?.count).toBe('0')
  })

  it('L05: secret salah -> 404 tanpa jejak order', async () => {
    const response = await post(coFormOrder({ order_id: `${orderId}y` }), 'secret-yang-salah')

    expect(response.status).toBe(404)
    const { rows } = await db().query<{ count: string }>(
      'select count(*)::text as count from public.orders where order_id = $1',
      [`${orderId}y`],
    )
    expect(rows[0]?.count).toBe('0')
  })

  it('01 §9: produk tak terbaca tetap tersimpan dengan parse invalid', async () => {
    const response = await post(
      coFormOrder({ order_id: invalidProductOrderId, product_data: { name: 'Nama Produk Bebas' } }),
    )
    expect(response.status).toBe(200)

    const row = await orderRow(invalidProductOrderId)
    expect(row['product_parse_status']).toBe('invalid')
    expect(row['product_raw']).toBe('Nama Produk Bebas')
    expect(row['event_type']).toBeNull()
    expect(row['batch']).toBeNull()
  })

  it('E02: fee percentage dari seed benar-benar diterapkan (0,7% dari 22000)', async () => {
    const response = await post(
      coFormOrder({
        order_id: qrisOrderId,
        product_data: { name: 'KULI01SO392 - S1 - Solo' },
        total_price: 22000,
        payment: { method: 'QRIS', data: [], channels: [], status: 'unpaid' },
      }),
    )
    expect(response.status).toBe(200)

    const row = await orderRow(qrisOrderId)
    expect(row['payment_identifier_normalized']).toBe('qris')
    expect(row['fee_rule_name_snapshot']).toBe('Fee QRIS 0.7%')
    expect(Number(row['tax_amount'])).toBe(154)
    expect(Number(row['net_amount'])).toBe(21846)
  })

  it('bentuk storefront: order tersimpan, product_raw null, parse invalid', async () => {
    const response = await post(storefrontOrder({ order_id: storefrontOrderId }))
    expect(response.status).toBe(200)

    const row = await orderRow(storefrontOrderId)
    expect(row['product_raw']).toBeNull()
    expect(row['product_parse_status']).toBe('invalid')
    expect(row['payment_identifier_normalized']).toBe('bca')
  })

  it('webhook_logs tertulis tanpa PII pelanggan', async () => {
    const { rows } = await db().query<{ outcome: string; error_code: string | null; payload_sanitized: unknown }>(
      `select outcome, error_code, payload_sanitized from public.webhook_logs where order_id = $1 order by created_at`,
      [orderId],
    )

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((row) => row.outcome === 'accepted')).toBe(true)

    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain('Budi Pengunjung')
    expect(serialized).not.toContain('+628080080808')
    expect(serialized).not.toContain('budi.pengunjung@example.com')
  })
})
