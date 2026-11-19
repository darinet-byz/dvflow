import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeState,
  createTestApi,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
  sampleConfig,
} from './helpers'

const ENCRYPTION_KEY = btoa('0123456789abcdef0123456789abcdef')
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222'
const GROUP_ID = '111@g.us'
const WEBHOOK_SECRET = 'webhook-rahasia-citta'

const ADD_AI_REPLY = {
  items: [
    {
      category: null,
      event_date: '2026-11-30',
      start_time: '09:00',
      city: 'Pekalongan',
      location: 'Hotel Aston Pekalongan',
    },
  ],
  issues: [],
}

const DELETE_AI_REPLY = {
  match: {
    event_date: '2026-11-30',
    start_time: null,
    city: 'Pekalongan',
    location: null,
  },
  issues: [],
}

async function setup() {
  const state = createFakeState({
    users: [fakeUser({ role: 'owner', username: 'owner1' })],
    config: sampleConfig(),
  })
  state.waProductGroups.push({
    id: 'group-1',
    product_id: PRODUCT_ID,
    fonnte_group_id: GROUP_ID,
    is_active: true,
    ai_enabled: true,
  })

  const { api } = await createTestApi(state, {
    env: {
      INTEGRATION_ENCRYPTION_KEY: ENCRYPTION_KEY,
      WA_FONNTE_BASE_URL: 'https://fonnte.test',
      FONNTE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
  })
  const { accessToken } = await loginAndGetToken(api, 'owner1')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', path: string, body?: unknown) =>
    api(makeRequest({
      method,
      path,
      headers: { authorization: `Bearer ${accessToken}` },
      ...(body === undefined ? {} : { body }),
    }))

  await request('PUT', '/api/wa-bot/settings', { fonnte_token: 'fonnte-token-12345678' })
  await request('PUT', '/api/ai/settings', {
    enabled: true,
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    api_key: 'sk-test-key-12345678',
  })

  return { state, api, request }
}

function webhook(api: Awaited<ReturnType<typeof setup>>['api'], body: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  return api(makeRequest({
    method: 'POST',
    path: `/api/webhooks/fonnte/${secret}`,
    body,
    origin: null,
  }))
}

type Captured = { url: string; body: string }

function stubAi(aiReply: unknown, options: { fail?: boolean } = {}) {
  const calls: Captured[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? init.body : ''
    calls.push({ url, body })

    if (url.endsWith('/chat/completions')) {
      if (options.fail === true) {
        return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        model: 'deepseek-flash',
        choices: [{ message: { content: JSON.stringify(aiReply) } }],
        usage: { prompt_tokens: 120, completion_tokens: 40 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    if (url.endsWith('/send')) {
      return new Response(JSON.stringify({ status: true, id: ['fonnte-1'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('A82: Citta AI', () => {
  it('tanpa /add atau /delete tidak memanggil AI dan tidak menulis apa pun', async () => {
    const { api, state } = await setup()
    const { fetchMock } = stubAi(ADD_AI_REPLY)

    const response = await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: 'halo, ini cuma obrolan biasa',
      inboxid: 'biasa-1',
    })

    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.aiDrafts).toHaveLength(0)
    expect(state.waAiInbox).toHaveLength(0)
    expect(state.aiRuns).toHaveLength(0)
  })

  it('secret webhook salah ditolak 404', async () => {
    const { api } = await setup()
    const response = await webhook(api, { sender: GROUP_ID, message: '/add x' }, 'salah')
    expect(response.status).toBe(404)
  })

  it('/add membuat preview dari produk grup, lalu YA menyimpan dengan kota', async () => {
    const { api, state } = await setup()
    const { calls } = stubAi(ADD_AI_REPLY)

    const added = await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: '/add jadwal terbaru\nPEKALONGAN\n30 Nov 2026\n09.00 WIB\nHotel Aston Pekalongan',
      inboxid: 'add-1',
    })
    expect(added.status).toBe(200)
    expect(state.aiDrafts).toHaveLength(1)
    expect(state.aiDrafts[0]?.['status']).toBe('pending')
    expect(state.aiRuns).toHaveLength(1)

    const payload = state.aiDrafts[0]?.['payload'] as { items: Array<Record<string, unknown>> }
    expect(payload.items[0]).toMatchObject({
      category: 'Seminar',
      category_source: 'location',
      event_date: '2026-11-30',
      start_time: '09:00',
      city: 'Pekalongan',
      location: 'Hotel Aston Pekalongan',
      valid: true,
    })

    const preview = calls.find((call) => call.url.endsWith('/send'))?.body ?? ''
    expect(preview).toContain('Cek+dulu')
    expect(preview).toContain('Hotel+Aston+Pekalongan')
    expect(preview).toContain('Kota%3A+Pekalongan')
    expect(preview).toContain('Seminar')

    const confirmed = await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: 'YA',
      inboxid: 'add-2',
    })
    expect(confirmed.status).toBe(200)
    expect(state.eventCalendar).toHaveLength(1)
    expect(state.eventCalendar[0]).toMatchObject({
      product_code: 'BM',
      category: 'Seminar',
      event_date: '2026-11-30',
      city: 'Pekalongan',
      source: 'ai',
    })
    expect(state.aiDrafts[0]?.['status']).toBe('confirmed')
  })

  it('webhook yang sama (inboxid sama) tidak membuat draft kedua', async () => {
    const { api, state } = await setup()
    stubAi(ADD_AI_REPLY)
    const body = {
      sender: GROUP_ID,
      member: '628111',
      message: '/add 30 Nov 2026 09.00 Hotel Aston Pekalongan',
      inboxid: 'same-inbox',
    }

    await webhook(api, body)
    await webhook(api, body)

    expect(state.aiDrafts).toHaveLength(1)
    expect(state.waAiInbox).toHaveLength(1)
  })

  it('grup tanpa ai_enabled diabaikan', async () => {
    const { api, state } = await setup()
    state.waProductGroups[0]!['ai_enabled'] = false
    const { fetchMock } = stubAi(ADD_AI_REPLY)

    await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: '/add 30 Nov 2026 09.00 Hotel',
      inboxid: 'off-1',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.aiDrafts).toHaveLength(0)
  })

  it('/delete menampilkan kandidat produk grup, lalu YA menghapus dan menyimpan snapshot', async () => {
    const { api, state } = await setup()
    state.eventCalendar.push({
      id: 'event-1',
      product_code: 'BM',
      category: 'Seminar',
      event_date: '2026-11-30',
      start_time: '09:00:00',
      location: 'Hotel Aston Pekalongan',
      city: 'Pekalongan',
      source: 'manual',
    })
    stubAi(DELETE_AI_REPLY)

    await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: '/delete 30 Nov 2026 Pekalongan',
      inboxid: 'del-1',
    })
    expect(state.aiDrafts).toHaveLength(1)
    const payload = state.aiDrafts[0]?.['payload'] as { candidates: Array<Record<string, unknown>> }
    expect(payload.candidates[0]?.['id']).toBe('event-1')

    await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: 'YA',
      inboxid: 'del-2',
    })

    expect(state.eventCalendar).toHaveLength(0)
    expect(state.aiDrafts[0]?.['status']).toBe('confirmed')
    const snapshot = state.aiDrafts[0]?.['deleted_snapshot'] as Array<Record<string, unknown>>
    expect(snapshot[0]?.['id']).toBe('event-1')
  })

  it('event yang punya deadline iklan tidak dibuatkan draft hapus', async () => {
    const { api, state } = await setup()
    state.eventCalendar.push({
      id: 'event-2',
      product_code: 'BM',
      category: 'Seminar',
      event_date: '2026-11-30',
      start_time: '09:00:00',
      location: 'Hotel Aston Pekalongan',
      city: 'Pekalongan',
    })
    state.adCalendar.push({
      id: 'ad-1',
      event_id: 'event-2',
      advertiser_id: '33333333-3333-3333-3333-333333333333',
      product_code: 'BM',
      batch: '12',
      deadline_date: '2026-11-20',
    })
    const { calls } = stubAi(DELETE_AI_REPLY)

    await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: '/delete 30 Nov 2026',
      inboxid: 'del-ad-1',
    })

    expect(state.eventCalendar).toHaveLength(1)
    expect(state.aiDrafts).toHaveLength(0)
    expect(calls.some((call) => call.url.endsWith('/send') && call.body.includes('deadline+iklan'))).toBe(true)
  })

  it('API key ditolak -> tidak ada draft, kegagalan dicatat', async () => {
    const { api, state } = await setup()
    stubAi({}, { fail: true })

    await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: '/add 30 Nov 2026 09.00 Hotel Aston Pekalongan',
      inboxid: 'fail-1',
    })

    expect(state.aiDrafts).toHaveLength(0)
    expect(state.aiRuns[0]?.['status']).toBe('failed')
  })

  it('settings hanya bisa dibuka pemegang config.ai_citta dan key tidak dikembalikan', async () => {
    const state = createFakeState({
      users: [fakeUser({ role: 'admin', username: 'admin1' })],
      config: sampleConfig(),
      rolePermissions: [{ role_id: 'admin', permission_key: 'config.wa_bot' }],
    })
    const { api } = await createTestApi(state, { env: { INTEGRATION_ENCRYPTION_KEY: ENCRYPTION_KEY } })
    const { accessToken } = await loginAndGetToken(api, 'admin1')
    const request = (method: 'GET' | 'PUT', path: string, body?: unknown) =>
      api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))

    expect((await request('GET', '/api/ai/settings')).status).toBe(403)
    expect((await request('PUT', '/api/ai/settings', { api_key: 'sk-test-key-12345678' })).status).toBe(403)

    const owner = await setup()
    const response = await owner.request('GET', '/api/ai/settings')
    expect(response.status).toBe(200)
    const body = await readBody<{ data: { enabled: boolean; has_key: boolean } }>(response)
    expect(body.data).toMatchObject({ enabled: true, has_key: true })
    expect(JSON.stringify(body)).not.toContain('sk-test-key')
    expect(JSON.stringify(body)).not.toContain('api_key_encrypted')
  })

  it('tes koneksi mengembalikan hasil provider tanpa membocorkan key', async () => {
    const { request } = await setup()
    const { calls } = stubAi(ADD_AI_REPLY)

    const response = await request('POST', '/api/ai/settings/test', {})
    expect(response.status).toBe(200)
    const body = await readBody<{ data: { ok: boolean; model: string; reply: string | null } }>(response)
    expect(body.data.ok).toBe(true)
    expect(body.data.model).toBe('deepseek-flash')
    expect(String(body.data.reply)).toContain('"items"')
    expect(JSON.stringify(body)).not.toContain('sk-test-key')

    const call = calls.find((item) => item.url.endsWith('/chat/completions'))
    expect(call?.body).not.toContain('sk-test-key-12345678')
  })

  it('grup yang terhubung ke dua produk ditolak dengan pesan', async () => {
    const { api, state } = await setup()
    state.waProductGroups.push({
      id: 'group-2',
      product_id: '11111111-1111-1111-1111-111111111111',
      fonnte_group_id: GROUP_ID,
      is_active: true,
      ai_enabled: true,
    })
    const { calls } = stubAi(ADD_AI_REPLY)

    await webhook(api, {
      sender: GROUP_ID,
      member: '628111',
      message: '/add 30 Nov 2026 09.00 Hotel',
      inboxid: 'amb-1',
    })

    expect(state.aiDrafts).toHaveLength(0)
    expect(calls.some((call) => call.url.endsWith('/send') && call.body.includes('lebih+dari+satu+produk'))).toBe(true)
  })
})
