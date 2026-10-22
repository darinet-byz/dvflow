import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createHandler, type Api } from '../../src/index'
import { createTestEnv, makeRequest, readBody } from '../helpers'
import { coFormOrder } from '../fixtures/orderonline'

/**
 * Test integrasi P5 (akses peserta, scanner, check-in) dan P6 (konfigurasi)
 * terhadap Supabase lokal.
 *
 * Yang hanya dapat dibuktikan di sini:
 *   1. filter `or=(...ilike...)` yang kami susun benar-benar diterima PostgREST
 *      (kalau sintaksnya salah, pencarian scanner akan gagal di produksi);
 *   2. `attendance_events` unik untuk seminar — termasuk saat dua scan datang
 *      BERSAMAAN (M02, ditegakkan partial unique index sungguhan);
 *   3. penulisan konfigurasi lewat service key diterima GRANT/RLS, dan kolom
 *      `code_normalized` benar-benar dihitung database (A5);
 *   4. unique index dan guard ambiguitas berperilaku seperti yang dipetakan
 *      handler (CODE_TAKEN / CODE_AMBIGUOUS).
 */

const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
const envVars = processLike?.env ?? {}

const SUPABASE_URL = envVars['SUPABASE_URL']
const SUPABASE_SECRET_KEY = envVars['SUPABASE_SECRET_KEY']
const SUPABASE_DB_URL = envVars['SUPABASE_DB_URL']
const WEBHOOK_SECRET = envVars['ORDERONLINE_WEBHOOK_SECRET'] ?? 'secret-integrasi-webhook'

const configured = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY && SUPABASE_DB_URL)

const run = configured ? describe : describe.skip

run('integrasi P5/P6 terhadap Supabase lokal', () => {
  const suffix = `${Date.now()}`.slice(-8)
  const seminarOrderId = `e2e${suffix}s`
  const webinarOrderId = `e2e${suffix}w`
  const orphanWebinarId = `e2e${suffix}x`
  const operatorUsername = `e2e_op_${suffix}`
  const adminUsername = `e2e_adm_${suffix}`
  const productCode = 'TEST'
  const ambiguousProductCode = 'K'

  let client: Client | undefined
  let api: Api
  let operatorToken = ''
  let adminToken = ''

  /**
   * Baris konfigurasi yang dibuat test ini, agar dapat dibersihkan berdasarkan
   * id. Membersihkan berdasarkan pola kode tidak cukup: `like` peka huruf besar/
   * kecil, dan kode yang dikirim test ini justru huruf kecil untuk menguji
   * normalisasi.
   */
  const createdConfig: Array<{ table: string; id: string }> = []

  function db(): Client {
    if (client === undefined) throw new Error('koneksi pg belum siap')
    return client
  }

  function authed(path: string, init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) {
    return api(
      makeRequest({
        method: init.method,
        path,
        headers: { authorization: `Bearer ${operatorToken}` },
        origin: null,
        ...(init.body === undefined ? {} : { body: init.body }),
      }),
    )
  }

  /** Seperti `authed`, tetapi memakai token admin (untuk penulisan konfigurasi). */
  function authedAdmin(path: string, init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) {
    return api(
      makeRequest({
        method: init.method,
        path,
        headers: { authorization: `Bearer ${adminToken}` },
        origin: null,
        ...(init.body === undefined ? {} : { body: init.body }),
      }),
    )
  }

  async function seedOrder(
    orderId: string,
    overrides: { productRaw: string; eventType: 'Seminar Offline' | 'Webinar Online'; status: string },
  ): Promise<void> {
    const parse =
      overrides.eventType === 'Seminar Offline'
        ? {
            status: 'valid',
            productCode: 'KULI',
            productName: 'Kuliner Masteri',
            advertiserCode: '01',
            advertiserName: 'Zul',
            eventType: 'Seminar Offline',
            batch: '392',
            session: 'S1',
            city: 'Solo',
          }
        : { status: 'invalid' }

    const response = await api(
      makeRequest({
        method: 'POST',
        path: `/api/webhooks/orderonline/${WEBHOOK_SECRET}`,
        origin: null,
        body: coFormOrder({
          order_id: orderId,
          status: overrides.status,
          product_data: { name: overrides.productRaw },
          total_price: 22000,
        }),
      }),
    )
    if (response.status !== 200) throw new Error(`seed ${orderId} gagal: ${response.status}`)

    if (parse.status === 'valid') {
      // Webhook menyimpan hasil parser; pastikan event_type benar-benar Seminar.
      const { rows } = await db().query<{ app_status: string }>(
        'select app_status from public.orders where order_id = $1',
        [orderId],
      )
      if (rows[0]?.app_status !== 'Paid' && overrides.status !== 'pending') {
        throw new Error(`seed ${orderId}: status tidak sesuai`)
      }
    }
  }

  beforeAll(async () => {
    client = new Client({ connectionString: SUPABASE_DB_URL })
    await client.connect()

    await db().query(
      `insert into public.users (username, display_name, password_hash, password_algo, role)
       values
         ($1, 'E2E Operator', extensions.crypt('rahasia123', extensions.gen_salt('bf', 4)), 'bcrypt', 'member'),
         ($2, 'E2E Admin',    extensions.crypt('rahasia123', extensions.gen_salt('bf', 4)), 'bcrypt', 'developer')`,
      [operatorUsername, adminUsername],
    )

    const env = await createTestEnv({
      SUPABASE_URL: SUPABASE_URL as string,
      SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY as string,
      ORDERONLINE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    })
    api = createHandler(env)

    async function loginAs(username: string): Promise<string> {
      const login = await api(
        makeRequest({ method: 'POST', path: '/api/auth/login', body: { username, password: 'rahasia123' } }),
      )
      const body = (await login.json()) as { ok: boolean; data?: { access_token: string } }
      if (!body.ok || body.data === undefined) throw new Error(`login ${username} gagal`)
      return body.data.access_token
    }

    operatorToken = await loginAs(operatorUsername)
    // Konfigurasi hanya boleh ditulis admin/owner (03 §12).
    adminToken = await loginAs(adminUsername)

    // Order seminar Paid, dan order webinar Paid.
    await seedOrder(seminarOrderId, {
      productRaw: 'KULI01SO392 - S1 - Solo',
      eventType: 'Seminar Offline',
      status: 'processing',
    })
    await seedOrder(webinarOrderId, {
      productRaw: 'KULI01SO392 - S1 - Solo',
      eventType: 'Seminar Offline',
      status: 'processing',
    })
    await seedOrder(orphanWebinarId, {
      productRaw: 'KULI01SO392 - S1 - Solo',
      eventType: 'Seminar Offline',
      status: 'processing',
    })

    // Jadikan dua order terakhir sebagai Webinar langsung di database: webhook
    // hanya memetakan produk, sedangkan jenis acara ditentukan konfigurasi.
    await db().query(
      `update public.orders set event_type = 'Webinar Online', product_raw = 'KULI01WO392 - S1 - Solo'
        where order_id in ($1, $2)`,
      [webinarOrderId, orphanWebinarId],
    )

    // Destination webinar: satu terkonfigurasi (KULI01WO392 - S1 - Solo), satu tidak.
    await db().query(
      `insert into public.app_settings (key, value_text) values ($1, $2)
       on conflict (key) do update set value_text = excluded.value_text`,
      ['webinar_destination::KULI01WO392 - S1 - Solo', 'https://zoom.example.com/j/e2e'],
    )
    await db().query(`update public.orders set product_raw = 'KULI01WO362 - S1 - Bandung' where order_id = $1`, [
      orphanWebinarId,
    ])
  })

  afterAll(async () => {
    if (client === undefined) return

    for (const row of createdConfig) {
      // Nama tabel berasal dari literal di berkas ini, bukan dari input.
      await db().query(`delete from public.${row.table} where id = $1`, [row.id])
    }

    await db().query(`delete from public.attendance_events where order_id like 'e2e%'`)
    await db().query(`delete from public.orders where order_id like 'e2e%'`)
    await db().query(`delete from public.app_settings where key like 'webinar_destination::KULI01WO392%'`)
    await db().query(`delete from public.webhook_logs where order_id like 'e2e%'`)
    await db().query(`delete from public.users where username like 'e2e\\_%' escape '\\'`)
    await client.end()
  })

  describe('akses peserta (P5)', () => {
    it('G01/G02: Paid + Seminar -> halaman tiket dengan data dan payload check-in', async () => {
      const response = await api(makeRequest({ method: 'GET', path: `/access/${seminarOrderId}`, origin: null }))

      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain(seminarOrderId)
      expect(html).toContain('Kuliner Masteri')
      expect(html).toContain(`/checkin/${seminarOrderId}`)
      // A19 sengaja menghapus label jenis acara dari halaman tiket.
    })

    it('F05: order tidak dikenal -> 404', async () => {
      const response = await api(makeRequest({ method: 'GET', path: '/access/99999999999', origin: null }))
      expect(response.status).toBe(404)
    })

    it('F01: webinar dengan destination -> 302 dan presensi tercatat', async () => {
      const before = await db().query<{ count: string }>(
        'select count(*)::text as count from public.attendance_events where order_id = $1',
        [webinarOrderId],
      )
      expect(before.rows[0]?.count).toBe('0')

      const response = await api(makeRequest({ method: 'GET', path: `/access/${webinarOrderId}`, origin: null }))

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('https://zoom.example.com/j/e2e')

      const { rows } = await db().query<{ attendance_type: string; source: string }>(
        'select attendance_type, source from public.attendance_events where order_id = $1',
        [webinarOrderId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.attendance_type).toBe('webinar')
      expect(rows[0]?.source).toBe('webinar_redirect')
    })

    it('F02: klik kedua menghasilkan presensi kedua (webinar tidak unik)', async () => {
      await api(makeRequest({ method: 'GET', path: `/access/${webinarOrderId}`, origin: null }))

      const { rows } = await db().query<{ count: string }>(
        'select count(*)::text as count from public.attendance_events where order_id = $1',
        [webinarOrderId],
      )
      expect(rows[0]?.count).toBe('2')
    })

    it('F07: destination tidak dikonfigurasi -> 503 tanpa presensi', async () => {
      const response = await api(makeRequest({ method: 'GET', path: `/access/${orphanWebinarId}`, origin: null }))

      expect(response.status).toBe(503)
      expect(response.headers.get('location')).toBeNull()

      const { rows } = await db().query<{ count: string }>(
        'select count(*)::text as count from public.attendance_events where order_id = $1',
        [orphanWebinarId],
      )
      expect(rows[0]?.count).toBe('0')
    })
  })

  describe('check-in seminar (P5)', () => {
    it('H01/H10: check-in QR mencatat presensi dan operatornya', async () => {
      const response = await authed(`/checkin/${seminarOrderId}`, { method: 'POST' })

      expect(response.status).toBe(200)
      const body = await readBody<{ data: { state: string; name: string | null } }>(response)
      expect(body.data.state).toBe('CHECKIN_SUCCESS')
      expect(body.data.name).toBe('Budi Pengunjung')

      const { rows } = await db().query<{ source: string; scanner_user_id: string | null }>(
        'select source, scanner_user_id from public.attendance_events where order_id = $1',
        [seminarOrderId],
      )
      expect(rows[0]?.source).toBe('seminar_qr')
      expect(rows[0]?.scanner_user_id).not.toBeNull()
    })

    it('H02/M02: scan berulang dan DUA SCAN BERSAMAAN tetap satu baris', async () => {
      const again = await authed(`/checkin/${seminarOrderId}`, { method: 'POST' })
      expect((await readBody<{ data: { state: string } }>(again)).data.state).toBe('ALREADY_CHECKED_IN')

      // Dua scan bersamaan: partial unique index yang memutuskan, bukan handler.
      const concurrent = await Promise.all([
        authed(`/checkin/${orphanWebinarId}`, { method: 'POST' }),
        authed(`/checkin/${orphanWebinarId}`, { method: 'POST' }),
      ])
      expect(concurrent.map((response) => response.status)).not.toContain(500)

      const { rows } = await db().query<{ count: string }>(
        'select count(*)::text as count from public.attendance_events where order_id = $1',
        [seminarOrderId],
      )
      expect(rows[0]?.count).toBe('1')
    })

    it('H04: order Pending tidak dapat check-in', async () => {
      const pendingId = `e2e${suffix}p`
      await seedOrder(pendingId, { productRaw: 'KULI01SO392 - S1 - Solo', eventType: 'Seminar Offline', status: 'pending' })

      const response = await authed(`/checkin/${pendingId}`, { method: 'POST' })
      expect(response.status).toBe(403)
      expect((await readBody<{ error: { code: string } }>(response)).error.code).toBe('ORDER_NOT_PAID')
    })
  })

  describe('scanner search (P5)', () => {
    it('H07/H08: filter or=(ilike) diterima PostgREST dan menemukan kandidat', async () => {
      const byOrderId = await authed(`/api/scanner/search?q=${seminarOrderId}`, { method: 'GET' })
      expect(byOrderId.status).toBe(200)
      const candidates = (await readBody<{ data: { candidates: Array<Record<string, unknown>> } }>(byOrderId)).data
        .candidates
      expect(candidates.some((row) => row['order_id'] === seminarOrderId)).toBe(true)

      // Pencarian nama peserta dari fixture webhook.
      const byName = await authed('/api/scanner/search?q=Budi', { method: 'GET' })
      const named = (await readBody<{ data: { candidates: Array<Record<string, unknown>> } }>(byName)).data.candidates
      expect(named.some((row) => row['order_id'] === seminarOrderId)).toBe(true)
    })

    it('03 §10: order webinar tidak muncul di scanner seminar', async () => {
      const response = await authed(`/api/scanner/search?q=${webinarOrderId}`, { method: 'GET' })
      const candidates = (await readBody<{ data: { candidates: unknown[] } }>(response)).data.candidates
      expect(candidates).toHaveLength(0)
    })

    it('sudah check-in terlihat di hasil pencarian', async () => {
      const response = await authed(`/api/scanner/search?q=${seminarOrderId}`, { method: 'GET' })
      const candidates = (await readBody<{ data: { candidates: Array<Record<string, unknown>> } }>(response)).data
        .candidates
      expect(candidates[0]?.['already_checked_in']).toBe(true)
      expect(candidates[0]?.['checked_in_at']).toBeTruthy()
    })
  })

  describe('konfigurasi (P6)', () => {
    it('membuat produk: code_normalized dihitung database (A5)', async () => {
      const response = await authedAdmin('/api/config/products', {
        method: 'POST',
        body: { name: 'Produk E2E', code: productCode.toLowerCase() },
      })

      expect(response.status).toBe(201)
      createdConfig.push({ table: 'products', id: String((await readBody<{ data: { item: { id: string } } }>(response)).data.item.id) })

      const { rows } = await db().query<{ code: string; code_normalized: string; active: boolean }>(
        'select code, code_normalized, active from public.products where code = $1',
        [productCode],
      )
      expect(rows[0]?.code_normalized).toBe(productCode.toUpperCase())
      expect(rows[0]?.active).toBe(true)
    })

    it('kode duplikat -> 409 CODE_TAKEN', async () => {
      const response = await authedAdmin('/api/config/products', {
        method: 'POST',
        body: { name: 'Duplikat', code: productCode },
      })

      expect(response.status).toBe(409)
      expect((await readBody<{ error: { code: string } }>(response)).error.code).toBe('CODE_TAKEN')
    })

    it('D07: kode yang membuat kombinasi ambigu ditolak', async () => {
      // Dengan produk KULI + pengiklan 01 + type SO yang sudah ada, kode produk
      // "K" tidak ambigu sendiri. Ambiguitas dibuat lewat pengiklan: tambah
      // pengiklan "M01" sehingga K+M01+SO akan sama dengan KULI+01+SO.
      const advertiser = await authedAdmin('/api/config/advertisers', {
        method: 'POST',
        body: { name: 'Pengiklan E2E', code: 'M01' },
      })
      expect(advertiser.status).toBe(400)


      const response = await authedAdmin('/api/config/products', { method: 'POST', body: { name: 'Produk K', code: 'K' } })

      expect(response.status).toBe(400)
      expect((await readBody<{ error: { code: string } }>(response)).error.code).toBe('INVALID_ARGUMENT')

      const { rows } = await db().query<{ count: string }>(
        `select count(*)::text as count from public.products where code in ('K', $1)`,
        [ambiguousProductCode],
      )
      expect(rows[0]?.count).toBe('0')
    })

    it('DELETE menonaktifkan, bukan menghapus (01 §8)', async () => {
      const created = await authedAdmin('/api/config/products', { method: 'POST', body: { name: 'Produk Nonaktif', code: 'DEAC' } })
      expect(created.status).toBe(201)
      const item = (await readBody<{ data: { item: { id: string } } }>(created)).data.item
      createdConfig.push({ table: 'products', id: item.id })

      const removed = await authedAdmin(`/api/config/products/${item.id}`, { method: 'DELETE' })
      expect(removed.status).toBe(200)

      const { rows } = await db().query<{ active: boolean }>(
        'select active from public.products where id = $1',
        [item.id],
      )
      expect(rows[0]?.active).toBe(false)
    })
  })
})
