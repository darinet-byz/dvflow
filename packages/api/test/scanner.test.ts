import { describe, expect, it } from 'vitest'
import {
  createApiWithEnv,
  createFakeState,
  createTestEnv,
  fakeOrder,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
} from './helpers'

/**
 * Scanner & check-in (03 §9–§11, 01 §13–§14, 05 §H01–§H10, §M02).
 *
 * Yang dijaga berkas ini: QR bukan otorisasi (04 §11), Manual Search memakai
 * validasi yang sama persis dengan QR dan tidak dapat mem-bypass aturan Paid
 * (H09), dan hasil pencarian tidak pernah memuat order webinar (03 §10).
 */

type FailureBody = { ok: false; error: { code: string } }

async function setup(seed: Partial<Parameters<typeof createFakeState>[0]> = {}) {
  const state = createFakeState({
    users: [
      fakeUser({ id: 'user-staff', username: 'staff1', display_name: 'Operator Satu', role: 'staff' }),
      fakeUser({ id: 'user-admin', username: 'admin1', display_name: 'Admin Satu', role: 'admin' }),
    ],
    orders: [
      fakeOrder({ order_id: '700001', name: 'Ahmad', phone: '+628111', quantity: 3 }),
      fakeOrder({ order_id: '700002', name: 'Bella', phone: '+628222', event_type: 'Webinar Online' }),
      fakeOrder({ order_id: '700003', name: 'Candra', phone: '+628333', app_status: 'Pending' }),
    ],
    ...seed,
  })
  const env = await createTestEnv()
  const api = createApiWithEnv(env, state)
  const { accessToken } = await loginAndGetToken(api, 'staff1')
  return { state, api, accessToken }
}

function authed(accessToken: string, init: { method: 'POST' | 'GET'; path: string; body?: unknown }) {
  return makeRequest({
    method: init.method,
    path: init.path,
    headers: { authorization: `Bearer ${accessToken}` },
    ...(init.body === undefined ? {} : { body: init.body }),
  })
}

describe('check-in seminar lewat QR (03 §9)', () => {
  it('H01: Paid + Seminar -> CHECKIN_SUCCESS dengan data untuk kartu hasil', async () => {
    const { state, api, accessToken } = await setup()

    const response = await api(authed(accessToken, { method: 'POST', path: '/checkin/700001' }))
    expect(response.status).toBe(200)

    const body = await readBody<{
      data: { state: string; order_id: string; name: string; session: string; quantity: number; scanner: { display_name: string } }
    }>(response)
    expect(body.data.state).toBe('CHECKIN_SUCCESS')
    expect(body.data.order_id).toBe('700001')
    expect(body.data.name).toBe('Ahmad')
    expect(body.data.quantity).toBe(3)
    expect(body.data.scanner.display_name).toBe('Operator Satu')

    const event = state.attendanceEvents[0]
    expect(event?.['source']).toBe('seminar_qr')
    expect(event?.['scanner_user_id']).toBe('user-staff')
  })

  it('H02: scan berulang -> ALREADY_CHECKED_IN dengan timestamp yang sama', async () => {
    const { state, api, accessToken } = await setup()

    const first = await readBody<{ data: { clicked_at: string } }>(
      await api(authed(accessToken, { method: 'POST', path: '/checkin/700001' })),
    )
    const second = await readBody<{ data: { state: string; clicked_at: string } }>(
      await api(authed(accessToken, { method: 'POST', path: '/checkin/700001' })),
    )

    expect(second.data.state).toBe('ALREADY_CHECKED_IN')
    expect(second.data.clicked_at).toBe(first.data.clicked_at)
    expect((second.data as { quantity?: number }).quantity).toBe(3)
    expect(state.attendanceEvents).toHaveLength(1)
  })

  it('H03/H04/H05: webinar, Pending, dan order tak dikenal ditolak', async () => {
    const { api, accessToken } = await setup()

    const webinar = await api(authed(accessToken, { method: 'POST', path: '/checkin/700002' }))
    expect(webinar.status).toBe(409)
    expect((await readBody<FailureBody>(webinar)).error.code).toBe('NOT_SEMINAR_ORDER')

    const pending = await api(authed(accessToken, { method: 'POST', path: '/checkin/700003' }))
    expect(pending.status).toBe(403)
    expect((await readBody<FailureBody>(pending)).error.code).toBe('ORDER_NOT_PAID')

    const unknown = await api(authed(accessToken, { method: 'POST', path: '/checkin/999999' }))
    expect(unknown.status).toBe(404)
    expect((await readBody<FailureBody>(unknown)).error.code).toBe('ORDER_NOT_FOUND')
  })

  it('QR palsu untuk order yang tidak memenuhi syarat tidak mengotorisasi apa pun', async () => {
    const { state, api, accessToken } = await setup()

    await api(authed(accessToken, { method: 'POST', path: '/checkin/700003' }))
    await api(authed(accessToken, { method: 'POST', path: '/checkin/999999' }))

    expect(state.attendanceEvents).toHaveLength(0)
  })

  it('operator harus terautentikasi', async () => {
    const { api } = await setup()

    const tanpaToken = await api(makeRequest({ method: 'POST', path: '/checkin/700001' }))
    expect(tanpaToken.status).toBe(401)
    expect((await readBody<FailureBody>(tanpaToken)).error.code).toBe('SESSION_INVALID')
  })

  it('operator yang dinonaktifkan tidak dapat check-in', async () => {
    const { state, api, accessToken } = await setup()
    const operator = state.users.find((user) => user.username === 'staff1')
    if (operator === undefined) throw new Error('operator tidak ada')
    operator.active = false

    const response = await api(authed(accessToken, { method: 'POST', path: '/checkin/700001' }))
    expect(response.status).toBe(401)
    expect((await readBody<FailureBody>(response)).error.code).toBe('USER_DISABLED')
    expect(state.attendanceEvents).toHaveLength(0)
  })
})

describe('Manual Search (03 §10, 01 §14, H06–H08)', () => {
  async function search(api: Awaited<ReturnType<typeof setup>>['api'], token: string, q: string) {
    const response = await api(authed(token, { method: 'GET', path: `/api/scanner/search?q=${encodeURIComponent(q)}` }))
    return readBody<{ data: { candidates: Array<Record<string, unknown>> } }>(response)
  }

  it('H07: Order ID persis -> kandidat, dan yang persis berada di depan', async () => {
    const { api, accessToken } = await setup()
    const body = await search(api, accessToken, '700001')

    expect(body.data.candidates).toHaveLength(1)
    expect(body.data.candidates[0]?.['order_id']).toBe('700001')
    expect(body.data.candidates[0]?.['name']).toBe('Ahmad')
    expect(body.data.candidates[0]?.['already_checked_in']).toBe(false)
  })

  it('H08: mencari nama dan nomor WA', async () => {
    const { api, accessToken } = await setup()

    // 'Ahmad' (seminar) dan '628333' (Candra, seminar Pending) — keduanya
    // kandidat yang sah. 'Bella' sengaja tidak dipakai: ordernya webinar, dan
    // memang tidak boleh muncul di scanner seminar (diuji terpisah di bawah).
    expect((await search(api, accessToken, 'Ahmad')).data.candidates).toHaveLength(1)
    expect((await search(api, accessToken, '628333')).data.candidates).toHaveLength(1)
  })

  it('03 §10: order webinar TIDAK pernah muncul di scanner seminar', async () => {
    const { api, accessToken } = await setup()
    const body = await search(api, accessToken, 'Bella')

    // Bella ada, tetapi ordernya webinar -> tidak boleh muncul.
    expect(body.data.candidates).toHaveLength(0)

    const all = await search(api, accessToken, '700')
    expect(all.data.candidates.map((row) => row['order_id'])).not.toContain('700002')
  })

  it('order Pending tetap muncul supaya operator tahu penyebabnya', async () => {
    const { api, accessToken } = await setup()
    const body = await search(api, accessToken, 'Candra')

    expect(body.data.candidates).toHaveLength(1)
    expect(body.data.candidates[0]?.['app_status']).toBe('Pending')
  })

  it('status check-in ikut ditampilkan', async () => {
    const { api, accessToken } = await setup()
    await api(authed(accessToken, { method: 'POST', path: '/checkin/700001' }))

    const body = await search(api, accessToken, '700001')
    expect(body.data.candidates[0]?.['already_checked_in']).toBe(true)
    expect(body.data.candidates[0]?.['checked_in_at']).toBe('2026-10-13T08:00:00.000Z')
  })

  it('H08: hasil dibatasi 20 baris, dikerjakan server-side', async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      fakeOrder({ order_id: `8000${index}`, name: `Peserta ${index}`, phone: '+628000' }),
    )
    const { api, accessToken } = await setup({ orders: many })

    const body = await search(api, accessToken, 'Peserta')
    expect(body.data.candidates).toHaveLength(20)
  })

  it('pencarian terlalu pendek tidak mengembalikan apa pun (01 §7)', async () => {
    const { api, accessToken } = await setup()

    expect((await search(api, accessToken, 'A')).data.candidates).toHaveLength(0)
    // Order ID numerik boleh 1 karakter.
    expect((await search(api, accessToken, '7')).data.candidates.length).toBeGreaterThan(0)
  })

  it('L06: teks pencarian dengan karakter khusus tidak merusak query', async () => {
    const { api, accessToken } = await setup()

    const response = await api(
      authed(accessToken, { method: 'GET', path: `/api/scanner/search?q=${encodeURIComponent('a,()"\\%*:b')}` }),
    )
    expect(response.status).toBe(200)
    expect((await readBody<{ data: { candidates: unknown[] } }>(response)).data.candidates).toEqual([])
  })

  it('scanner tidak dapat dipakai tanpa login', async () => {
    const { api } = await setup()
    const response = await api(makeRequest({ method: 'GET', path: '/api/scanner/search?q=700' }))
    expect(response.status).toBe(401)
  })
})

describe('Manual check-in (03 §11, H09)', () => {
  it('memakai validasi yang sama dan mencatat sumber seminar_manual', async () => {
    const { state, api, accessToken } = await setup()

    const response = await api(
      authed(accessToken, {
        method: 'POST',
        path: '/api/scanner/manual-checkin',
        body: { order_id: '700001' },
      }),
    )

    expect(response.status).toBe(200)
    expect(state.attendanceEvents[0]?.['source']).toBe('seminar_manual')
  })

  it('H09: manual TIDAK dapat mem-bypass aturan Paid', async () => {
    const { state, api, accessToken } = await setup()

    const response = await api(
      authed(accessToken, {
        method: 'POST',
        path: '/api/scanner/manual-checkin',
        body: { order_id: '700003' },
      }),
    )

    expect(response.status).toBe(403)
    expect((await readBody<FailureBody>(response)).error.code).toBe('ORDER_NOT_PAID')
    expect(state.attendanceEvents).toHaveLength(0)
  })

  it('order_id wajib diisi', async () => {
    const { api, accessToken } = await setup()

    for (const body of [{}, { order_id: '' }, { order_id: '   ' }]) {
      const response = await api(authed(accessToken, { method: 'POST', path: '/api/scanner/manual-checkin', body }))
      expect(response.status).toBe(400)
    }
  })

  it('manual dan QR pada order yang sama tidak membuat presensi kedua', async () => {
    const { state, api, accessToken } = await setup()

    await api(authed(accessToken, { method: 'POST', path: '/checkin/700001' }))
    const manual = await api(
      authed(accessToken, { method: 'POST', path: '/api/scanner/manual-checkin', body: { order_id: '700001' } }),
    )

    expect((await readBody<{ data: { state: string } }>(manual)).data.state).toBe('ALREADY_CHECKED_IN')
    expect(state.attendanceEvents).toHaveLength(1)
  })
})
