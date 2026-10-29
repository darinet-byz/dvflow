import { describe, expect, it } from 'vitest'
import { CHECKIN_QR_ELEMENT_ID, TICKET_QR_SCRIPT_PATH } from '../src/participant/pages'
import { createApiWithEnv, createFakeState, createTestEnv, fakeOrder, makeRequest } from './helpers'

/**
 * Rute peserta (03 §8, §15; PRD §87–§93; 05 §F01–§F08, §G01–§G06).
 *
 * Halaman peserta adalah HTML yang dirender server, jadi berkas ini juga yang
 * memegang uji XSS (L07) — React tidak meng-escape apa pun di sini.
 */

const WEBINAR_DESTINATION = 'https://zoom.example.com/j/123456'

async function setup(seed: Partial<Parameters<typeof createFakeState>[0]> = {}, env: Record<string, string> = {}) {
  const state = createFakeState({ config: undefined, ...seed })
  const testEnv = await createTestEnv(env)
  const api = createApiWithEnv(testEnv, state)
  return { state, env: testEnv, api }
}

function access(api: Awaited<ReturnType<typeof setup>>['api'], orderId: string) {
  return api(makeRequest({ method: 'GET', path: `/access/${orderId}`, origin: null }))
}

describe('akses peserta: penolakan (PRD §89, §F03–§F06, §G04–§G06)', () => {
  it('order tidak dikenal -> 404 tanpa membocorkan apa pun', async () => {
    const { api } = await setup()
    const response = await access(api, '999999')

    expect(response.status).toBe(404)
    const html = await response.text()
    expect(html).toContain('Tiket tidak ditemukan')
    // Order ID yang dicoba peserta memang boleh muncul (03 §15), tetapi tidak ada
    // nama tabel, stack, atau ID internal lain.
    expect(html).not.toContain('orders')
    expect(html).not.toContain('stack')
  })

  it('Pending dan Cancelled ditolak', async () => {
    const { api } = await setup({
      orders: [fakeOrder({ order_id: '111', app_status: 'Pending' }), fakeOrder({ order_id: '222', app_status: 'Cancelled' })],
    })

    for (const orderId of ['111', '222']) {
      const response = await access(api, orderId)
      expect(response.status).toBe(403)
      expect(await response.text()).toContain('Pembayaran belum selesai')
    }
  })

  it('A58: order Refund ditolak seperti order tidak dibayar', async () => {
    const { api } = await setup({ orders: [fakeOrder({ order_id: '444', app_status: 'Refund' })] })
    const response = await access(api, '444')
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('Pembayaran belum selesai')
  })

  it('produk yang tidak terparse ditolak walau order Paid', async () => {
    const { api } = await setup({
      orders: [fakeOrder({ order_id: '333', product_parse_status: 'invalid', event_type: null })],
    })

    const response = await access(api, '333')
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('Data acara tidak dikenali')
  })

  it('Order ID yang tidak berbentuk wajar tidak menyentuh database', async () => {
    const { state, api } = await setup({ orders: [fakeOrder()] })

    for (const orderId of ['%20', 'a%20b', '!!!']) {
      const response = await access(api, orderId)
      expect(response.status).toBe(404)
    }
    expect(state.rpcCalls).toHaveLength(0)
  })
})

describe('akses peserta seminar: halaman tiket (PRD §93, §G01, §G03)', () => {
  it('Paid + Seminar -> halaman tiket dengan data minimum dan payload check-in', async () => {
    const { api } = await setup({ orders: [fakeOrder()] })
    const response = await access(api, '283033796')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')

    const html = await response.text()
    expect(html).toContain('283033796')
    // Payload QR (03 §8) — QR sendiri dibuat browser, bukan di sini.
    expect(html).toContain('/checkin/283033796')
  })

  it('A58: tiket memakai acara efektif setelah reschedule', async () => {
    const { api } = await setup({
      orders: [fakeOrder({
        order_id: '283033797',
        event_session: 'S2',
        event_city: 'Bandung',
        effective_session: 'S2',
        effective_city: 'Bandung',
        effective_batch: '392',
      })],
    })
    const response = await access(api, '283033797')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Bandung')
    expect(html).toContain('S2')
  })

  it('A19: urutan nama, Order ID (sekali), produk, batch, kota, sesi, QR, jumlah tiket; tanpa pengiklan/label acara', async () => {
    const { api } = await setup({ orders: [fakeOrder({ quantity: 3 })] })
    const html = await (await access(api, '283033796')).text()
    const at = (needle: string) => {
      const index = html.indexOf(needle)
      expect(index, needle).toBeGreaterThan(-1)
      return index
    }
    const order = [at('class="name">Ahmad'), at('Order ID <strong>283033796'), at('<dd>Kuliner Masteri'), at('<dd>392'),
      at('<dd>Solo'), at('<dd>S1'), at('data-checkin-payload'), at('<strong>3</strong> TIKET')]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html.split('>283033796<')).toHaveLength(2)
    expect(html).not.toContain('Zul')
    expect(html).not.toContain('Seminar Offline')
    expect(html).toContain('data-checked-in="false"')
  })

  it('halaman tiket tidak memuat email maupun nomor WA (04 §12)', async () => {
    const { api } = await setup({
      orders: [fakeOrder({ phone: '+628999888777', email: 'rahasia@example.com' })],
    })

    const html = await (await access(api, '283033796')).text()
    expect(html).not.toContain('+628999888777')
    expect(html).not.toContain('rahasia@example.com')
  })

  it('L07: nama peserta berisi HTML ditampilkan sebagai teks, bukan dijalankan', async () => {
    const payload = '<script>alert("xss")</script>'
    const { api } = await setup({ orders: [fakeOrder({ name: payload })] })

    const response = await access(api, '283033796')
    const html = await response.text()

    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
    // CSP hanya mengizinkan skrip SAME-ORIGIN untuk menggambar QR — tanpa
    // 'unsafe-inline' dan tanpa 'unsafe-eval'.
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-inline; script')
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('halaman tiket memuat wadah QR + skrip same-origin (QR dibuat di browser)', async () => {
    const { api } = await setup({ orders: [fakeOrder()] })
    const html = await (await access(api, '283033796')).text()

    // Wadah QR dengan payload check-in; SVG-nya dipasang skrip di browser.
    expect(html).toContain(`id="${CHECKIN_QR_ELEMENT_ID}"`)
    expect(html).toContain('data-checkin-payload="/checkin/283033796"')
    expect(html).toContain(`<script src="${TICKET_QR_SCRIPT_PATH}" defer></script>`)

    // Backend tidak pernah membuat gambar QR.
    expect(html).not.toContain('<svg')
  })

  it('tiket yang sudah check-in menampilkan status Check-in Telah Berhasil dan TANPA QR', async () => {
    const { api } = await setup({
      orders: [fakeOrder()],
      attendanceEvents: [
        {
          id: 'event-uuid-1',
          order_id: '283033796',
          attendance_type: 'seminar',
          source: 'seminar_qr',
          clicked_at: '2026-10-13T07:30:00.000Z',
        },
      ],
    })

    const html = await (await access(api, '283033796')).text()

    // A19: stempel menggantikan QR; info lain dan jumlah tiket tetap tampil.
    expect(html).toContain('CHECK-IN BERHASIL')
    expect(html).toContain('WIB')
    expect(html).toContain('data-checked-in="true"')
    for (const text of ['Ahmad', '283033796', 'Kuliner Masteri', '392', 'Solo', 'S1', '<strong>1</strong> TIKET']) {
      expect(html).toContain(text)
    }

    // TIDAK menampilkan wadah QR dan TIDAK memuat skrip ticket-qr.js
    expect(html).not.toContain(`id="${CHECKIN_QR_ELEMENT_ID}"`)
    expect(html).not.toContain('data-checkin-payload')
    expect(html).not.toContain(TICKET_QR_SCRIPT_PATH)
  })

  it('halaman error tidak memuat skrip sama sekali', async () => {
    const { api } = await setup()
    const response = await access(api, '999999')

    expect(await response.text()).not.toContain('<script')
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).not.toContain('script-src')
  })

  it('XSS lewat nama produk dan kota juga di-escape', async () => {
    const { api } = await setup({
      orders: [fakeOrder({ product_name: '<img src=x onerror=alert(1)>', city: '"><b>x</b>' })],
    })

    const html = await (await access(api, '283033796')).text()
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>x</b>')
  })

  it('halaman peserta tidak dapat di-cache', async () => {
    const { api } = await setup({ orders: [fakeOrder()] })
    const response = await access(api, '283033796')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('akses peserta webinar (PRD §90–§92, §F01–§F08)', () => {
  const webinarOrder = fakeOrder({
    order_id: '555',
    event_type: 'Webinar Online',
    product_raw: 'KM01WO392 - S1 - Solo',
  })

  it('F01: Paid + destination terkonfigurasi -> presensi + 302', async () => {
    const { state, api } = await setup({
      orders: [webinarOrder],
      appSettings: [{ key: 'webinar_destination::KM01WO392 - S1 - Solo', value_text: WEBINAR_DESTINATION }],
    })

    const response = await access(api, '555')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(WEBINAR_DESTINATION)
    expect(state.attendanceEvents).toHaveLength(1)
    expect(state.attendanceEvents[0]?.['attendance_type']).toBe('webinar')
    expect(state.attendanceEvents[0]?.['source']).toBe('webinar_redirect')
  })

  it('F02: setiap klik menghasilkan presensi baru (tidak di-deduplicate)', async () => {
    const { state, api } = await setup({
      orders: [webinarOrder],
      appSettings: [{ key: 'webinar_destination::KM01WO392 - S1 - Solo', value_text: WEBINAR_DESTINATION }],
    })

    await access(api, '555')
    await access(api, '555')
    await access(api, '555')

    expect(state.attendanceEvents).toHaveLength(3)
  })

  it('F07: destination tidak ada -> 503, TANPA presensi dan TANPA redirect', async () => {
    const { state, api } = await setup({ orders: [webinarOrder] })

    const response = await access(api, '555')

    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    expect(state.attendanceEvents).toHaveLength(0)

    // Halaman tunggu: nama + Order ID menandakan tiket sah, maskot tanpa logo Meta Ads.
    const html = await response.text()
    expect(html).toContain('Link Zoom akan bisa diakses mendekati jadwal pelaksanaan webinar')
    expect(html).toContain('Ahmad')
    expect(html).toContain('<strong>555</strong>')
    expect(html).toContain('<svg')
    expect(html).not.toContain('meta-ads')
    expect(html).not.toContain('<script')
    expect(response.headers.get('content-security-policy')).not.toContain('script-src')
  })

  it('F07: nama peserta di halaman tunggu webinar di-escape', async () => {
    const { api } = await setup({ orders: [{ ...webinarOrder, name: '<script>alert(1)</script>' }] })

    const html = await (await access(api, '555')).text()

    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
  })

  it('destination harus exact: product_raw yang berbeda tidak cocok', async () => {
    const { state, api } = await setup({
      orders: [webinarOrder],
      appSettings: [{ key: 'webinar_destination::KM01WO392 - S1 - solo', value_text: WEBINAR_DESTINATION }],
    })

    expect((await access(api, '555')).status).toBe(503)
    expect(state.attendanceEvents).toHaveLength(0)
  })

  it('F08: destination non-HTTPS ditolak seperti destination yang tidak ada', async () => {
    const { state, api } = await setup({
      orders: [webinarOrder],
      appSettings: [{ key: 'webinar_destination::KM01WO392 - S1 - Solo', value_text: 'http://penyerang.example/phish' }],
    })

    const response = await access(api, '555')
    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    expect(state.attendanceEvents).toHaveLength(0)
  })

  it('F08: localhost hanya boleh bila environment mengizinkannya', async () => {
    const settings = [{ key: 'webinar_destination::KM01WO392 - S1 - Solo', value_text: 'http://localhost:3000/room' }]

    const tanpaIzin = await setup({ orders: [webinarOrder], appSettings: settings })
    expect((await access(tanpaIzin.api, '555')).status).toBe(503)

    const denganIzin = await setup({ orders: [webinarOrder], appSettings: settings }, {
      ALLOW_INSECURE_WEBINAR_DESTINATION: 'true',
    })
    expect((await access(denganIzin.api, '555')).status).toBe(302)
  })

  it('destination yang bukan URL ditolak, bukan diteruskan', async () => {
    const { state, api } = await setup({
      orders: [webinarOrder],
      appSettings: [{ key: 'webinar_destination::KM01WO392 - S1 - Solo', value_text: 'javascript:alert(1)' }],
    })

    const response = await access(api, '555')
    expect([503]).toContain(response.status)
    expect(state.attendanceEvents).toHaveLength(0)
  })
})

describe('GET /checkin/:orderId tidak pernah mengubah apa pun (03 §9)', () => {
  it('menampilkan instruksi, bukan hasil check-in', async () => {
    const { state, api } = await setup({ orders: [fakeOrder()] })

    const response = await api(makeRequest({ method: 'GET', path: '/checkin/283033796', origin: null }))

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Bukan halaman check-in')
    expect(html).toContain('283033796')
    // Tidak ada presensi yang tercatat, dan tidak ada RPC yang dipanggil.
    expect(state.attendanceEvents).toHaveLength(0)
    expect(state.rpcCalls).toHaveLength(0)
  })
})

describe('akses peserta: Hybrid (A14) — satu Order ID untuk tiket QR dan Zoom', () => {
  const hybridOrder = fakeOrder({
    order_id: '777',
    event_type: 'Hybrid',
    product_raw: 'KULI01HY392 - S1 - Solo',
  })
  const zoomSetting = { key: 'webinar_destination::KULI01HY392 - S1 - Solo', value_text: WEBINAR_DESTINATION }

  it('link membuka tiket QR + tombol Zoom, tanpa mencatat presensi', async () => {
    const { state, api } = await setup({ orders: [hybridOrder], appSettings: [zoomSetting] })
    const response = await access(api, '777')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('data-checkin-payload="/checkin/777"')
    expect(html).toContain('href="/access/777?via=zoom"')
    expect(html).toContain('JOIN SECARA ONLINE (ZOOM)')
    expect(state.attendanceEvents).toHaveLength(0)
  })

  it('tombol Zoom tidak tampil bila link Zoom belum dikonfigurasi', async () => {
    const { api } = await setup({ orders: [hybridOrder] })
    const html = await (await access(api, '777')).text()
    expect(html).toContain('data-checkin-payload')
    expect(html).not.toContain('via=zoom')
  })

  it('?via=zoom -> presensi online + 302, setiap klik tercatat', async () => {
    const { state, api } = await setup({ orders: [hybridOrder], appSettings: [zoomSetting] })
    const zoom = () => api(makeRequest({ method: 'GET', path: '/access/777?via=zoom', origin: null }))
    const response = await zoom()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(WEBINAR_DESTINATION)
    await zoom()
    expect(state.attendanceEvents.filter((e) => e['attendance_type'] === 'webinar')).toHaveLength(2)
  })

  it('order Seminar Offline mengabaikan ?via=zoom (tetap tiket)', async () => {
    const { state, api } = await setup({ orders: [fakeOrder({ order_id: '888' })], appSettings: [zoomSetting] })
    const response = await api(makeRequest({ method: 'GET', path: '/access/888?via=zoom', origin: null }))
    expect(response.status).toBe(200)
    expect(state.attendanceEvents).toHaveLength(0)
  })
})
