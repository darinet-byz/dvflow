import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteContext } from '../src/router'
import type { Db } from '../src/db/types'
import { encrypt, decrypt } from '../src/integrations/crypto'
import { listConnections, saveConnection, connectionWebhookUrl, testConnection, validateConnectionWebhook, deleteConnection } from '../src/integrations/handlers'

function setup() {
  const rows: Record<string, unknown>[] = []
  const user = { id: 'admin', role: 'admin', active: true }
  const db = {
    selectRows: vi.fn(async (table: string, query: Record<string, string>) => table === 'users' ? [user] : table === 'app_role_permissions' ? (user.role === 'admin' ? [{ permission_key: 'config.integrasi' }, { permission_key: 'action.delete_master' }] : []) : rows.filter(row => !query.id || `eq.${row.id}` === query.id)),
    insertRow: vi.fn(async (_: string, row: Record<string, unknown>) => { const value = { id: crypto.randomUUID(), ...row }; rows.push(value); return value }),
    updateRows: vi.fn(async (_: string, query: Record<string, string>, patch: Record<string, unknown>) => { Object.assign(rows.find(row => `eq.${row.id}` === query.id)!, patch) }),
    deleteRows: vi.fn(async (_: string, query: Record<string, string>) => {
      const idx = rows.findIndex(row => `eq.${row.id}` === query.id)
      if (idx !== -1) rows.splice(idx, 1)
    }),
    rpc: vi.fn(),
  } as unknown as Db
  const context = { db, env: { INTEGRATION_ENCRYPTION_KEY: btoa('x'.repeat(32)) }, claims: { sub: 'admin' }, url: new URL('https://dvflow.test'), params: {}, now: new Date() } as unknown as RouteContext
  function body(value: unknown) { context.request = new Request('https://dvflow.test', { method: 'POST', body: JSON.stringify(value) }) }
  return { context, rows, user, body }
}
afterEach(() => vi.unstubAllGlobals())
describe('OrderOnline connections', () => {
  it('encrypts credentials, separates multiple webhooks, masks lists, disables delivery and deletes connection', async () => {
    const { context, rows, body } = setup()
    for (const name of ['Shop A', 'Shop B']) { body({ name, api_token: 'private-token', active: true }); expect((await saveConnection(context)).status).toBe(201) }
    expect(rows).toHaveLength(2)
    expect(rows[0]!.webhook_secret_hash).not.toBe(rows[1]!.webhook_secret_hash)
    expect(JSON.stringify(rows)).not.toContain('private-token')
    const list = await (await listConnections(context)).text()
    expect(list).toContain('has_api_token')
    expect(list).not.toContain('encrypted')
    expect(list).not.toContain('webhook_secret')
    context.params = { id: String(rows[0]!.id) }
    const links = (await (await connectionWebhookUrl(context)).json()).data as { url: string; redirectUrl: string }
    const url = links.url
    // Variabel OrderOnline: {{order_id}} (kurung kurawal ganda), dengan kode toko di depannya.
    expect(links.redirectUrl).toBe(`https://dvflow.test/access/${String(rows[0]!.slug)}/{{order_id}}`)
    context.params = { connectionId: String(rows[0]!.id), webhookSecret: url.split('/').at(-1)! }
    expect(await validateConnectionWebhook(context)).toBe(true)
    context.params.connectionId = String(rows[1]!.id)
    expect(await validateConnectionWebhook(context)).toBe(false)
    context.params.connectionId = String(rows[0]!.id)
    rows[0]!.active = false
    expect(await validateConnectionWebhook(context)).toBe(false)
    context.params = { id: String(rows[0]!.id) }
    expect((await deleteConnection(context)).status).toBe(200)
    expect(rows).toHaveLength(1)
  })
  it('preserves token on blank edit and never returns upstream credentials', async () => {
    const { context, rows, body } = setup()
    body({ name: 'Shop', api_token: 'private-token', active: true }); await saveConnection(context)
    const encrypted = rows[0]!.api_token_encrypted
    context.params = { id: String(rows[0]!.id) }
    body({ name: 'Updated', api_token: '', active: true }); await saveConnection(context)
    expect(rows[0]!.api_token_encrypted).toBe(encrypted)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_code: 0, data: { access_token: 'upstream-secret' } })))
    vi.stubGlobal('fetch', fetchMock)
    const response = await (await testConnection(context)).text()
    expect(response).toContain('"connected":true')
    expect(response).not.toContain('upstream-secret')
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.orderonline.id/v1/auth')
    expect(fetchMock.mock.calls[0]![1].body).toBe(JSON.stringify({ token: 'private-token' }))
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    expect((await (await testConnection(context)).json()).data.connected).toBe(false)
  })
  it('denies Team and inactive users across settings operations', async () => {
    const { context, user } = setup()
    user.role = 'member'
    for (const fn of [listConnections, saveConnection, connectionWebhookUrl, testConnection, deleteConnection]) await expect(fn(context)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    user.role = 'admin'; user.active = false
    await expect(listConnections(context)).rejects.toMatchObject({ code: 'USER_DISABLED' })
  })
  it('rejects ciphertext with a different key or missing key', async () => {
    const value = await encrypt('secret', btoa('x'.repeat(32)))
    expect(await decrypt(value, btoa('x'.repeat(32)))).toBe('secret')
    await expect(decrypt(value, btoa('y'.repeat(32)))).rejects.toBeDefined()
    await expect(encrypt('secret', undefined)).rejects.toBeDefined()
  })
})

