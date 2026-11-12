import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeState,
  createTestApi,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  sampleConfig,
} from './helpers'

const ADVERTISER_ID = '33333333-3333-3333-3333-333333333333'
const PRODUCT_ID = '11111111-1111-1111-1111-111111111111'
const SECOND_PRODUCT_ID = '22222222-2222-2222-2222-222222222222'
const TEMPLATE_ID = '44444444-4444-4444-4444-444444444444'
const PRODUCT_GROUP_ID = '55555555-5555-5555-5555-555555555555'
const SCHEDULE_ID = '66666666-6666-6666-6666-666666666666'
const ENCRYPTION_KEY = btoa('0123456789abcdef0123456789abcdef')

function baseState(role = 'admin', permissions: string[] = ['config.wa_bot', 'action.wa_bot_send']) {
  const config = sampleConfig()
  // Kolom generated di database; tiruan perlu nilai yang sama untuk pencarian kode.
  config.products = config.products.map((row) => ({
    ...row,
    code_normalized: String(row['code'] ?? '').trim().toUpperCase(),
  }))
  config.advertisers = config.advertisers.map((row) => ({
    ...row,
    code_normalized: String(row['code'] ?? '').trim().toUpperCase(),
    wa_phone: '628111111111',
  }))
  const state = createFakeState({
    users: [fakeUser({ role })],
    config,
    rolePermissions: permissions.map((permission_key) => ({ role_id: role, permission_key })),
  })
  state.waReminderTemplates.push({
    id: TEMPLATE_ID,
    name: 'Pagi',
    message_content: 'Halo {{mention}}, {{advertiser_name}} {{product_name}} {{event_type}} {{date}}. {{report_url}}',
    is_active: true,
  })
  state.waProductGroups.push({
    id: PRODUCT_GROUP_ID,
    product_id: PRODUCT_ID,
    fonnte_group_id: '111@g.us',
    is_active: true,
  })
  state.productAdvertisers.push({ product_id: PRODUCT_ID, advertiser_id: ADVERTISER_ID })
  state.waReminderSchedules.push({
    id: SCHEDULE_ID,
    execution_time: '09:00:00',
    template_id: TEMPLATE_ID,
    days: [0, 1, 2, 3, 4, 5, 6],
    only_if_missing_report: true,
    is_active: true,
  })
  return state
}

async function setup(options: { role?: string; permissions?: string[]; env?: Record<string, string> } = {}) {
  const state = baseState(options.role, options.permissions)
  const { api, env } = await createTestApi(state, {
    env: {
      INTEGRATION_ENCRYPTION_KEY: ENCRYPTION_KEY,
      WA_CRON_SECRET: 'cron-secret',
      WA_FONNTE_BASE_URL: 'https://fonnte.test',
      WA_SEND_DELAY_MS: '0',
      ...options.env,
    },
  })
  const { accessToken } = await loginAndGetToken(api, 'admin1')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', path: string, body?: unknown, headers: Record<string, string> = {}) =>
    api(makeRequest({
      method,
      path,
      headers: { authorization: `Bearer ${accessToken}`, ...headers },
      ...(body === undefined ? {} : { body }),
    }))
  return { state, api, env, request }
}

const okSend = () => new Response(JSON.stringify({ status: true, id: ['fonnte-1'] }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WA Admin Bot — akses & konfigurasi', () => {
  it('tanpa izin ditolak dan token tidak pernah dikirim ke browser', async () => {
    const { request } = await setup({ role: 'member', permissions: [] })
    expect((await request('GET', '/api/wa-bot')).status).toBe(403)
    expect((await request('PUT', '/api/wa-bot/settings', { fonnte_token: 'token-rahasia' })).status).toBe(403)

    const allowed = await setup()
    const before = await allowed.request('GET', '/api/wa-bot')
    const beforeBody = (await before.json()) as {
      data: {
        settings: { has_token: boolean }
        products: Array<{ code: string; group: { fonnte_group_id: string } | null }>
        templates: unknown[]
      }
    }
    expect(beforeBody.data.settings.has_token).toBe(false)
    expect(beforeBody.data.products.find((row) => row.code === 'KM')?.group?.fonnte_group_id).toBe('111@g.us')
    expect(JSON.stringify(beforeBody)).not.toContain('fonnte_token_encrypted')

    expect((await allowed.request('PUT', '/api/wa-bot/settings', { fonnte_token: 'token-rahasia-panjang' })).status).toBe(200)
    const stored = allowed.state.waBotSettings[0]
    expect(stored?.['fonnte_token_encrypted']).not.toBe('token-rahasia-panjang')
    expect(String(stored?.['fonnte_token_encrypted'])).toContain('.')
  })

  it('template menolak placeholder asing dan nama ganda', async () => {
    const { request } = await setup()
    const bad = await request('POST', '/api/wa-bot/templates', { name: 'Salah', message_content: 'Halo {{lead}}' })
    expect(bad.status).toBe(400)
    const duplicate = await request('POST', '/api/wa-bot/templates', { name: 'pagi', message_content: 'Halo {{advertiser_name}}' })
    expect(duplicate.status).toBe(400)
    const created = await request('POST', '/api/wa-bot/templates', { name: 'Siang', message_content: 'Halo {{advertiser_name}} {{event_type}}' })
    expect(created.status).toBe(201)
  })

  it('nomor WA pengiklan wajib dan dinormalisasi', async () => {
    const { state, request } = await setup()
    const saved = await request('PATCH', `/api/wa-bot/advertisers/${ADVERTISER_ID}`, { wa_phone: '0812-3456-7890' })
    expect(saved.status).toBe(200)
    expect(state.config.advertisers[0]?.['wa_phone']).toBe('6281234567890')

    expect((await request('PATCH', `/api/wa-bot/advertisers/${ADVERTISER_ID}`, { wa_phone: '12345' })).status).toBe(400)
    expect((await request('PATCH', `/api/wa-bot/advertisers/${ADVERTISER_ID}`, { wa_phone: '' })).status).toBe(400)
    expect((await request('PATCH', '/api/wa-bot/advertisers/99999999-9999-4999-8999-999999999999', { wa_phone: '081234567890' })).status).toBe(404)
  })

  it('satu produk hanya boleh punya satu grup dan grup aktif butuh nomor pengiklan', async () => {
    const { state, request } = await setup()

    const created = await request('POST', '/api/wa-bot/product-groups', {
      product_id: SECOND_PRODUCT_ID,
      fonnte_group_id: '222@g.us',
      is_active: true,
    })
    expect(created.status).toBe(201)

    const duplicate = await request('POST', '/api/wa-bot/product-groups', {
      product_id: SECOND_PRODUCT_ID,
      fonnte_group_id: '333@g.us',
      is_active: true,
    })
    expect(duplicate.status).toBe(400)

    // Pengiklan yang ditugaskan belum punya nomor: grup aktif harus ditolak.
    state.config.advertisers[0]!['wa_phone'] = null
    const blocked = await request('PATCH', `/api/wa-bot/product-groups/${PRODUCT_GROUP_ID}`, {
      product_id: PRODUCT_ID,
      fonnte_group_id: '111@g.us',
      is_active: true,
    })
    expect(blocked.status).toBe(400)
    expect((await blocked.json() as { error: { message: string } }).error.message).toContain('Lengkapi nomor WA')

    // Nonaktif tetap boleh disimpan walau nomor belum lengkap.
    const inactive = await request('PATCH', `/api/wa-bot/product-groups/${PRODUCT_GROUP_ID}`, {
      product_id: PRODUCT_ID,
      fonnte_group_id: '111@g.us',
      is_active: false,
    })
    expect(inactive.status).toBe(200)
  })

  it('jadwal memvalidasi jam, template, dan hari', async () => {
    const { request } = await setup()
    expect((await request('POST', '/api/wa-bot/schedules', { execution_time: '25:00', template_id: TEMPLATE_ID })).status).toBe(400)
    expect((await request('POST', '/api/wa-bot/schedules', { execution_time: '09:30', template_id: '99999999-9999-4999-8999-999999999999' })).status).toBe(400)
    expect((await request('POST', '/api/wa-bot/schedules', { execution_time: '9:30', template_id: TEMPLATE_ID, days: [1, 1, 3] })).status).toBe(201)
  })
})

describe('WA Admin Bot — pengiriman', () => {
  it('preview merender pesan tanpa mengirim apa pun', async () => {
    const fetchMock = vi.fn(async () => okSend())
    vi.stubGlobal('fetch', fetchMock)
    const { request } = await setup()

    const response = await request('POST', '/api/wa-bot/test-preview', {
      advertiser_code: '01',
      product_code: 'KM',
      template_id: TEMPLATE_ID,
      event_type: 'Webinar Online',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { found: boolean; message: string; group_id: string } }
    expect(body.data.found).toBe(true)
    expect(body.data.group_id).toBe('111@g.us')
    expect(body.data.message).toContain('@628111111111')
    expect(body.data.message).toContain('Webinar Online')
    expect(body.data.message).toContain('eventType=Webinar%20Online')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('kirim tes memakai token tersimpan dan mencatat log', async () => {
    const fetchMock = vi.fn(async () => okSend())
    vi.stubGlobal('fetch', fetchMock)
    const { state, request } = await setup()

    await request('PUT', '/api/wa-bot/settings', { fonnte_token: 'token-rahasia-panjang' })
    const response = await request('POST', '/api/wa-bot/test-send', {
      advertiser_code: '01',
      product_code: 'KM',
      template_id: TEMPLATE_ID,
      event_type: 'Seminar Offline',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { sent: boolean; group_id: string; event_type: string } }
    expect(body.data.sent).toBe(true)
    expect(body.data.group_id).toBe('111@g.us')
    expect(body.data.event_type).toBe('Seminar Offline')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://fonnte.test/send')
    expect((init.headers as Record<string, string>)['authorization']).toBe('token-rahasia-panjang')
    expect(String(init.body)).toContain('target=111%40g.us')
    expect(String(init.body)).toContain('message=Halo')

    expect(state.waReminderLogs[0]?.['status']).toBe('sent')
    expect(state.waReminderLogs[0]?.['schedule_id']).toBeNull()
    expect(state.waReminderLogs[0]?.['event_type']).toBe('Seminar Offline')
  })

  it('cron gagal-tertutup tanpa secret yang benar', async () => {
    const { request } = await setup()
    expect((await request('POST', '/api/internal/wa-reminders/run')).status).toBe(404)
    expect((await request('POST', '/api/internal/wa-reminders/run', undefined, { 'x-wa-cron-secret': 'salah' })).status).toBe(404)
  })

  it('cron tanpa token tidak mengirim apa pun', async () => {
    const fetchMock = vi.fn(async () => okSend())
    vi.stubGlobal('fetch', fetchMock)
    const { request } = await setup()
    const response = await request('POST', '/api/internal/wa-reminders/run', undefined, { 'x-wa-cron-secret': 'cron-secret' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { skipped: string; claimed: number } }
    expect(body.data).toEqual({ skipped: 'NO_TOKEN', claimed: 0, sent: 0, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cron mengirim task, menandai hasil, dan menghormati secret', async () => {
    const fetchMock = vi.fn(async () => okSend())
    vi.stubGlobal('fetch', fetchMock)
    const { state, request } = await setup()
    await request('PUT', '/api/wa-bot/settings', { fonnte_token: 'token-rahasia-panjang' })
    state.waClaimTasks = [{
      log_id: '77777777-7777-4777-8777-777777777777',
      group_id: '111@g.us',
      message: 'Pesan pengingat',
      advertiser_id: ADVERTISER_ID,
      advertiser_name: 'Zul',
      product_code: 'KM',
      product_name: 'Kuliner Masteri',
      event_type: 'Seminar Offline',
    }]

    const response = await request('POST', '/api/internal/wa-reminders/run', undefined, { 'x-wa-cron-secret': 'cron-secret' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { claimed: number; sent: number; failed: number } }
    expect(body.data).toEqual({ skipped: null, claimed: 1, sent: 1, failed: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.waReminderLogs[0]?.['status']).toBe('sent')
    expect(state.rpcCalls.some((call) => call.name === 'wa_reminder_mark')).toBe(true)
  })

  it('kegagalan Fonnte dicatat sebagai failed tanpa menghentikan respons', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: false, reason: 'token invalid' }), { status: 200 })))
    const { state, request } = await setup()
    await request('PUT', '/api/wa-bot/settings', { fonnte_token: 'token-rahasia-panjang' })
    state.waClaimTasks = [{
      log_id: '88888888-8888-4888-8888-888888888888',
      group_id: '111@g.us',
      message: 'Pesan pengingat',
      advertiser_id: ADVERTISER_ID,
      advertiser_name: 'Zul',
      product_code: 'KM',
      product_name: 'Kuliner Masteri',
      event_type: 'Seminar Offline',
    }]

    const response = await request('POST', '/api/internal/wa-reminders/run', undefined, { 'x-wa-cron-secret': 'cron-secret' })
    const body = (await response.json()) as { data: { sent: number; failed: number } }
    expect(body.data).toEqual({ skipped: null, claimed: 1, sent: 0, failed: 1 })
    expect(state.waReminderLogs[0]?.['error']).toBe('token invalid')
  })

  it('kirim ulang menolak id tak dikenal dan memperbarui log yang ada', async () => {
    const fetchMock = vi.fn(async () => okSend())
    vi.stubGlobal('fetch', fetchMock)
    const { state, request } = await setup()
    await request('PUT', '/api/wa-bot/settings', { fonnte_token: 'token-rahasia-panjang' })
    expect((await request('POST', '/api/wa-bot/logs/bukan-uuid/resend')).status).toBe(404)

    state.waReminderLogs.push({
      id: '99999999-9999-4999-8999-999999999999',
      schedule_id: null,
      advertiser_id: ADVERTISER_ID,
      advertiser_name: 'Zul',
      product_code: 'KM',
      product_name: 'Kuliner Masteri',
      reminder_date: '2026-11-10',
      group_id: '111@g.us',
      template_id: TEMPLATE_ID,
      event_type: 'Seminar Offline',
      message: 'Pesan lama',
      status: 'failed',
      attempts: 1,
      created_at: '2026-11-10T01:00:00Z',
    })
    const response = await request('POST', '/api/wa-bot/logs/99999999-9999-4999-8999-999999999999/resend')
    expect(response.status).toBe(200)
    expect(state.waReminderLogs[0]?.['status']).toBe('sent')
    expect(state.waReminderLogs[0]?.['attempts']).toBe(2)
  })

  it('daftar log memakai filter server-side', async () => {
    const { state, request } = await setup()
    state.waReminderLogs.push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      advertiser_id: ADVERTISER_ID,
      advertiser_name: 'Zul',
      product_code: 'KM',
      product_name: 'Kuliner Masteri',
      reminder_date: '2026-11-10',
      group_id: '111@g.us',
      event_type: 'Seminar Offline',
      message: 'Pesan',
      status: 'sent',
      attempts: 1,
      created_at: '2026-11-10T01:00:00Z',
    })
    const response = await request('GET', '/api/wa-bot/logs?status=sent&advertiser=01&product=KM&event_type=Seminar%20Offline&date_from=2026-11-01&date_to=2026-11-30')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { total: number; rows: unknown[] } }
    expect(body.data.total).toBe(1)
    expect(body.data.rows).toHaveLength(1)
  })
})
