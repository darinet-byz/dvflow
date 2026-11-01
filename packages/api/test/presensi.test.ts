import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROLE_PERMISSIONS,
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
 * A62: koreksi presensi dari halaman Presensi.
 *
 * Dua jalur diuji di sini: menandai hadir tanpa scan (memakai RPC check-in yang
 * sama) dan mengembalikan tiket ke Belum Hadir lewat `reset_presensi`. Aturan
 * bisnis (Paid, seminar/hybrid, cakupan produk) tetap diuji di pgTAP.
 */

type FailureBody = { ok: false; error: { code: string } }

async function setup(seed: Partial<Parameters<typeof createFakeState>[0]> = {}, username = 'admin1') {
  const state = createFakeState({
    users: [
      fakeUser({ id: 'user-admin', username: 'admin1', display_name: 'Admin Satu', role: 'admin' }),
      fakeUser({ id: 'user-member', username: 'member1', display_name: 'Operator Satu', role: 'member' }),
    ],
    orders: [
      fakeOrder({ order_id: '800001', name: 'Ahmad', quantity: 2 }),
      fakeOrder({ order_id: '800002', name: 'Bella', event_type: 'Webinar Online', quantity: 2 }),
    ],
    ...seed,
  })
  const env = await createTestEnv()
  const api = createApiWithEnv(env, state)
  const { accessToken } = await loginAndGetToken(api, username)
  // Login memakai RPC verify_login; mulai dari nol supaya asersi "tidak menyentuh RPC" akurat.
  state.rpcCalls.length = 0
  return { state, api, accessToken }
}

function authed(accessToken: string, path: string, body?: unknown) {
  return makeRequest({
    method: 'POST',
    path,
    headers: { authorization: `Bearer ${accessToken}` },
    ...(body === undefined ? {} : { body }),
  })
}

describe('A62: tandai hadir tanpa scan', () => {
  it('tanpa tickets -> semua sisa tiket hadir dan operator tercatat', async () => {
    const { state, api, accessToken } = await setup()

    const response = await api(authed(accessToken, '/api/presensi/800001/mark-present'))
    expect(response.status).toBe(200)

    const body = await readBody<{
      data: {
        state: string
        quantity: number
        checked_in_tickets: number
        remaining_tickets: number
        tickets_confirmed: number
        scanner: { display_name: string }
      }
    }>(response)
    expect(body.data.state).toBe('CHECKIN_SUCCESS')
    expect(body.data.quantity).toBe(2)
    expect(body.data.checked_in_tickets).toBe(2)
    expect(body.data.remaining_tickets).toBe(0)
    expect(body.data.tickets_confirmed).toBe(2)
    expect(body.data.scanner.display_name).toBe('Admin Satu')

    expect(state.attendanceEvents).toHaveLength(2)
    expect(state.attendanceEvents.every((row) => row['source'] === 'seminar_manual')).toBe(true)
    expect(state.attendanceEvents.every((row) => row['scanner_user_id'] === 'user-admin')).toBe(true)
  })

  it('tickets=1 -> hanya satu tiket, sisa tetap bisa check-in', async () => {
    const { state, api, accessToken } = await setup()

    const response = await api(authed(accessToken, '/api/presensi/800001/mark-present', { tickets: 1 }))
    const body = await readBody<{ data: { checked_in_tickets: number; remaining_tickets: number } }>(response)

    expect(response.status).toBe(200)
    expect(body.data.checked_in_tickets).toBe(1)
    expect(body.data.remaining_tickets).toBe(1)
    expect(state.attendanceEvents).toHaveLength(1)
  })

  it('jumlah 0 ditolak sebelum menyentuh RPC', async () => {
    const { state, api, accessToken } = await setup()

    const response = await api(authed(accessToken, '/api/presensi/800001/mark-present', { tickets: 0 }))
    const body = await readBody<FailureBody>(response)

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_ARGUMENT')
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('webinar ditolak RPC (NOT_SEMINAR_ORDER)', async () => {
    const { api, accessToken } = await setup()
    const response = await api(authed(accessToken, '/api/presensi/800002/mark-present'))
    const body = await readBody<FailureBody>(response)

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('NOT_SEMINAR_ORDER')
  })

  it('tanpa action.manual_checkin -> FORBIDDEN', async () => {
    const rolePermissions = DEFAULT_ROLE_PERMISSIONS.filter(
      (row) => !(row.role_id === 'member' && row.permission_key === 'action.manual_checkin'),
    )
    const { api, accessToken } = await setup({ rolePermissions }, 'member1')

    const response = await api(authed(accessToken, '/api/presensi/800001/mark-present'))
    expect(response.status).toBe(403)
  })
})

describe('A62: kembalikan tiket ke Belum Hadir', () => {
  it('reset sebagian menghapus presensi terbaru saja', async () => {
    const { state, api, accessToken } = await setup()
    await api(authed(accessToken, '/api/presensi/800001/mark-present'))
    expect(state.attendanceEvents).toHaveLength(2)

    const response = await api(authed(accessToken, '/api/presensi/800001/reset', { tickets: 1 }))
    const body = await readBody<{
      data: { removed_tickets: number; checked_in_tickets: number; remaining_tickets: number }
    }>(response)

    expect(response.status).toBe(200)
    expect(body.data.removed_tickets).toBe(1)
    expect(body.data.checked_in_tickets).toBe(1)
    expect(body.data.remaining_tickets).toBe(1)
    expect(state.attendanceEvents).toHaveLength(1)
  })

  it('tanpa tickets -> seluruh presensi order dihapus', async () => {
    const { state, api, accessToken } = await setup()
    await api(authed(accessToken, '/api/presensi/800001/mark-present'))

    const response = await api(authed(accessToken, '/api/presensi/800001/reset'))
    const body = await readBody<{ data: { removed_tickets: number; checked_in_tickets: number } }>(response)

    expect(response.status).toBe(200)
    expect(body.data.removed_tickets).toBe(2)
    expect(body.data.checked_in_tickets).toBe(0)
    expect(state.attendanceEvents).toHaveLength(0)
  })

  it('order tanpa presensi -> removed 0, bukan error', async () => {
    const { api, accessToken } = await setup()
    const response = await api(authed(accessToken, '/api/presensi/800001/reset'))
    const body = await readBody<{ data: { removed_tickets: number } }>(response)

    expect(response.status).toBe(200)
    expect(body.data.removed_tickets).toBe(0)
  })
})
