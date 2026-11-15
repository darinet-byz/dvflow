import { describe, expect, it } from 'vitest'
import {
  createFakeState,
  createTestApi,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
  sampleConfig,
  type FakeUser,
} from './helpers'

/**
 * A79: Chat Internal. Handler memeriksa izin, validasi, lalu memanggil RPC
 * service_role. Aturan fan-out dan kepemilikan thread diuji di pgTAP 42_chat.sql.
 */
const ADVERTISER_ZUL = '33333333-3333-3333-3333-333333333333'
const ADVERTISER_BUDI = '44444444-4444-4444-4444-444444444444'
const USER_ZUL = '66666666-6666-4666-8666-666666666666'
const USER_BUDI = '77777777-7777-4777-8777-777777777777'
const THREAD_ID = '55555555-5555-4555-8555-555555555555'

function configWithTwoAdvertisers() {
  const config = sampleConfig()
  config.advertisers = [
    { id: ADVERTISER_ZUL, name: 'Zul', code: '01', active: true },
    { id: ADVERTISER_BUDI, name: 'Budi', code: '02', active: true },
  ]
  return config
}

function advertiserUsers(): FakeUser[] {
  return [
    fakeUser({ id: USER_ZUL, username: 'zul', display_name: 'Akun Zul', role: 'advertiser', advertiser_id: ADVERTISER_ZUL }),
    fakeUser({ id: USER_BUDI, username: 'budi', display_name: 'Akun Budi', role: 'advertiser', advertiser_id: ADVERTISER_BUDI }),
  ]
}

async function setup(
  role: string,
  permissions: string[],
  options: { users?: FakeUser[]; rolePermissions?: Array<{ role_id: string; permission_key: string }> } = {},
) {
  const state = createFakeState({
    users: [fakeUser({ id: 'user-main', username: 'main', display_name: 'Manajer Satu', role }), ...(options.users ?? [])],
    config: configWithTwoAdvertisers(),
    rolePermissions: options.rolePermissions ?? permissions.map((permission_key) => ({ role_id: role, permission_key })),
  })
  const { api } = await createTestApi(state)
  const { accessToken } = await loginAndGetToken(api, 'main')
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
    api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` }, ...(body === undefined ? {} : { body }) }))
  return { state, api, request }
}

const messagePermissions = [
  { role_id: 'manajer', permission_key: 'operasional.chat' },
  { role_id: 'manajer', permission_key: 'action.send_chat' },
  { role_id: 'advertiser', permission_key: 'operasional.chat' },
  { role_id: 'advertiser', permission_key: 'action.send_chat' },
]

describe('A79: Chat Internal', () => {
  it('tanpa izin ditolak di semua rute', async () => {
    const { request } = await setup('member', ['account.profile'])
    expect((await request('GET', '/api/chat/recipients')).status).toBe(403)
    expect((await request('GET', '/api/chat/threads')).status).toBe(403)
    expect((await request('GET', `/api/chat/threads/${THREAD_ID}/messages`)).status).toBe(403)
    expect((await request('POST', '/api/chat/messages', { role_id: 'advertiser', all: true, body: 'Halo' })).status).toBe(403)
  })

  it('daftar penerima dikelompokkan per role dengan nama pengiklan', async () => {
    const { request } = await setup('manajer', [], { users: advertiserUsers(), rolePermissions: messagePermissions })
    const response = await request('GET', '/api/chat/recipients')
    expect(response.status).toBe(200)
    const body = await readBody<{ data: { roles: Array<{ id: string; users: Array<{ id: string; display_name: string }> }> } }>(response)
    const advertiser = body.data.roles.find((role) => role.id === 'advertiser')
    expect(advertiser?.users.map((user) => user.display_name).sort()).toEqual(['Budi', 'Zul'])
  })

  it('kirim ke semua anggota role membuat satu thread per penerima', async () => {
    const { request, state } = await setup('manajer', [], { users: advertiserUsers(), rolePermissions: messagePermissions })
    const response = await request('POST', '/api/chat/messages', {
      role_id: 'advertiser',
      all: true,
      body: 'Halo semua pengiklan',
    })
    expect(response.status).toBe(201)
    const body = await readBody<{ data: { sent: number; thread_ids: string[] } }>(response)
    expect(body.data.sent).toBe(2)
    expect(body.data.thread_ids).toHaveLength(2)
    expect(state.chatThreads).toHaveLength(2)
    expect(state.chatMessages).toHaveLength(2)

    const call = state.rpcCalls.find((item) => item.name === 'send_chat_message')
    expect(call?.args).toMatchObject({
      p_role_id: 'advertiser',
      p_all: true,
      p_body: 'Halo semua pengiklan',
      p_recipient_id: null,
    })
  })

  it('kirim ke satu orang hanya membuat satu pesan', async () => {
    const { request, state } = await setup('manajer', [], { users: advertiserUsers(), rolePermissions: messagePermissions })
    const response = await request('POST', '/api/chat/messages', {
      role_id: 'advertiser',
      recipient_id: USER_ZUL,
      all: false,
      body: 'Halo Zul',
    })
    expect(response.status).toBe(201)
    const body = await readBody<{ data: { sent: number } }>(response)
    expect(body.data.sent).toBe(1)
    expect(state.chatThreads).toHaveLength(1)
    expect(state.chatMessages[0]?.['body']).toBe('Halo Zul')
  })

  it('penerima melihat pesan, lalu badge belum dibaca kembali nol setelah dibuka', async () => {
    const { api, request, state } = await setup('manajer', [], { users: advertiserUsers(), rolePermissions: messagePermissions })
    await request('POST', '/api/chat/messages', { role_id: 'advertiser', all: true, body: 'Pengingat report' })
    const threadId = String(state.chatThreads[0]?.['id'])

    const { accessToken } = await loginAndGetToken(api, 'zul')
    const asZul = (method: 'GET', path: string) =>
      api(makeRequest({ method, path, headers: { authorization: `Bearer ${accessToken}` } }))

    const before = await asZul('GET', '/api/chat/threads')
    const beforeBody = await readBody<{ data: { threads: Array<{ unread: number }>; unread_total: number } }>(before)
    expect(beforeBody.data.threads[0]?.unread).toBe(1)
    expect(beforeBody.data.unread_total).toBe(1)

    const messages = await asZul('GET', `/api/chat/threads/${threadId}/messages`)
    expect(messages.status).toBe(200)
    const messagesBody = await readBody<{ data: { messages: Array<{ body: string; mine: boolean }> } }>(messages)
    expect(messagesBody.data.messages[0]?.body).toBe('Pengingat report')
    expect(messagesBody.data.messages[0]?.mine).toBe(false)

    const after = await asZul('GET', '/api/chat/threads')
    const afterBody = await readBody<{ data: { unread_total: number } }>(after)
    expect(afterBody.data.unread_total).toBe(0)
  })

  it('pesan kosong, role tidak valid, dan penerima salah ditolak sebelum RPC berhasil', async () => {
    const { request, state } = await setup('manajer', [], { users: advertiserUsers(), rolePermissions: messagePermissions })
    expect((await request('POST', '/api/chat/messages', { role_id: 'advertiser', all: true, body: '   ' })).status).toBe(400)

    const before = state.rpcCalls.filter((item) => item.name === 'send_chat_message').length
    expect(
      (await request('POST', '/api/chat/messages', { role_id: 'tidak_ada', all: true, body: 'Halo' })).status,
    ).toBe(400)
    expect(
      (await request('POST', '/api/chat/messages', { role_id: 'advertiser', recipient_id: '22222222-2222-4222-8222-222222222222', all: false, body: 'Halo' })).status,
    ).toBe(400)
    // Dua panggilan terakhir tetap sampai ke RPC (validasi role/penerima ada di sana).
    expect(state.rpcCalls.filter((item) => item.name === 'send_chat_message').length).toBe(before + 2)
  })

  it('user di luar thread tidak bisa membaca isinya', async () => {
    const { api, request, state } = await setup('manajer', [], { users: advertiserUsers(), rolePermissions: messagePermissions })
    await request('POST', '/api/chat/messages', { role_id: 'advertiser', recipient_id: USER_ZUL, all: false, body: 'Rahasia' })
    const threadId = String(state.chatThreads[0]?.['id'])

    const { accessToken } = await loginAndGetToken(api, 'budi')
    const response = await api(makeRequest({
      method: 'GET',
      path: `/api/chat/threads/${threadId}/messages`,
      headers: { authorization: `Bearer ${accessToken}` },
    }))
    expect(response.status).toBe(404)
  })

  it('id thread tidak valid -> 404', async () => {
    const { request } = await setup('manajer', [], { users: advertiserUsers(), rolePermissions: messagePermissions })
    expect((await request('GET', '/api/chat/threads/bukan-uuid/messages')).status).toBe(404)
  })
})
