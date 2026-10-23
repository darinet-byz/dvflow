import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createHandler, type Api } from '../../src/index'
import { createTestEnv, makeRequest } from '../helpers'

/**
 * A34 terhadap Supabase lokal: membuktikan nama argumen RPC baru
 * (`p_quantity`, `p_unit_price`) benar-benar diterima PostgREST, total dihitung
 * server, quantity tersimpan, dan check-in otomatis terjadi.
 *
 * Test unit API memakai Db tiruan; test ini menutup celah "nama argumen salah"
 * yang hanya muncul saat memanggil PostgREST sungguhan.
 */
const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
const envVars = processLike?.env ?? {}
const SUPABASE_URL = envVars['SUPABASE_URL']
const SUPABASE_SECRET_KEY = envVars['SUPABASE_SECRET_KEY']
const SUPABASE_DB_URL = envVars['SUPABASE_DB_URL']
const configured = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY && SUPABASE_DB_URL)
const run = configured ? describe : describe.skip

run('integrasi OTS (A34) terhadap Supabase lokal', () => {
  const suffix = `${Date.now()}`.slice(-8)
  const username = `e2e_ots_${suffix}`
  let client: Client | undefined
  let api: Api
  let token = ''
  let orderId = ''

  function db(): Client {
    if (client === undefined) throw new Error('koneksi pg belum siap')
    return client
  }

  function authed(path: string, body: unknown) {
    return api(makeRequest({
      method: 'POST',
      path,
      headers: { authorization: `Bearer ${token}` },
      origin: null,
      body,
    }))
  }

  beforeAll(async () => {
    client = new Client({ connectionString: SUPABASE_DB_URL })
    await client.connect()
    await db().query(
      `insert into public.users (username, display_name, password_hash, password_algo, role)
       values ($1, 'E2E OTS', extensions.crypt('rahasia123', extensions.gen_salt('bf', 4)), 'bcrypt', 'developer')`,
      [username],
    )

    const env = await createTestEnv({
      SUPABASE_URL: SUPABASE_URL as string,
      SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY as string,
    })
    api = createHandler(env)
    const login = await api(makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { username, password: 'rahasia123' },
    }))
    const body = (await login.json()) as { ok: boolean; data?: { access_token: string } }
    if (!body.ok || body.data === undefined) throw new Error('login OTS gagal')
    token = body.data.access_token
  })

  afterAll(async () => {
    if (client !== undefined) {
      if (orderId !== '') {
        await client.query('delete from public.attendance_events where order_id = $1', [orderId])
        await client.query('delete from public.orders where order_id = $1', [orderId])
      }
      await client.query('delete from public.users where username = $1', [username])
      await client.end()
    }
  })

  it('buat 2 tiket x 150.000 -> Paid, total 300.000, langsung hadir', async () => {
    const response = await authed('/api/ots', {
      name: 'Budi Integrasi',
      phone: '081234567890',
      product_code: 'TEST',
      batch: '392',
      session: 'S1',
      city: 'Solo',
      quantity: 2,
      unit_price: 150000,
      method: 'ots_tunai',
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { data: { order_id: string; quantity: number; gross_amount: number } }
    orderId = body.data.order_id
    expect(orderId).toMatch(/^OTS-\d{6}$/)
    expect(body.data.quantity).toBe(2)
    expect(body.data.gross_amount).toBe(300000)

    const order = await db().query<{ source: string; app_status: string; quantity: number; gross_amount: string; net_amount: string; tax_amount: string; event_type: string; batch: string; session: string; city: string; payment_method: string }>(
      `select source, app_status, quantity, gross_amount, net_amount, tax_amount, event_type, batch, session, city, payment_method
         from public.orders where order_id = $1`,
      [orderId],
    )
    expect(order.rows[0]).toMatchObject({
      source: 'ots', app_status: 'Paid', quantity: 2, gross_amount: '300000.00', net_amount: '300000.00',
      tax_amount: '0.00', event_type: 'Seminar Offline', batch: '392', session: 'S1', city: 'Solo', payment_method: 'ots_tunai',
    })
    const attendance = await db().query<{ source: string; count: string }>(
      `select source, count(*)::text as count from public.attendance_events where order_id = $1 group by source`,
      [orderId],
    )
    expect(attendance.rows).toEqual([{ source: 'seminar_ots', count: '1' }])
  })

  it('edit 3 tiket x 100.000 -> total tetap 300.000, batch dinormalisasi, presensi tidak dobel', async () => {
    const response = await authed('/api/ots', {
      order_id: orderId,
      name: 'Budi Integrasi Edit',
      phone: '0813',
      product_code: 'TEST',
      batch: '058',
      session: 's2',
      city: 'Bandung',
      quantity: 3,
      unit_price: 100000,
      method: 'ots_qris',
    })
    expect(response.status).toBe(200)
    const order = await db().query<{ quantity: number; gross_amount: string; batch: string; session: string; city: string; payment_method: string; name: string }>(
      `select quantity, gross_amount, batch, session, city, payment_method, name from public.orders where order_id = $1`,
      [orderId],
    )
    expect(order.rows[0]).toMatchObject({
      quantity: 3, gross_amount: '300000.00', batch: '58', session: 'S2', city: 'Bandung', payment_method: 'ots_qris', name: 'Budi Integrasi Edit',
    })
    const attendance = await db().query<{ count: string }>(
      `select count(*)::text as count from public.attendance_events where order_id = $1`,
      [orderId],
    )
    expect(attendance.rows[0]?.count).toBe('1')
  })

  it('hapus OTS menghapus order dan presensinya', async () => {
    const response = await api(makeRequest({
      method: 'DELETE',
      path: `/api/ots/${encodeURIComponent(orderId)}`,
      headers: { authorization: `Bearer ${token}` },
      origin: null,
    }))
    expect(response.status).toBe(200)
    const order = await db().query('select 1 from public.orders where order_id = $1', [orderId])
    expect(order.rows).toHaveLength(0)
    const attendance = await db().query('select 1 from public.attendance_events where order_id = $1', [orderId])
    expect(attendance.rows).toHaveLength(0)
    orderId = ''
  })
})
