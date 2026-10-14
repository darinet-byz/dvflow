import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requirePermission, requirePermissions } from '../permissions'
import { decrypt, encrypt, hash } from './crypto'

type Connection = { id: string; name: string; slug: string; active: boolean; api_token_encrypted: string | null; webhook_secret_encrypted: string; webhook_secret_hash: string; last_received_at: string | null; created_at: string }
const fields = 'id,name,slug,active,api_token_encrypted,webhook_secret_encrypted,webhook_secret_hash,last_received_at,created_at'
async function requireAdmin(context: RouteContext) {
  await requirePermission(context, 'config.integrasi')
}
async function getConnection(context: RouteContext) {
  const id = context.params['id'] ?? context.params['connectionId'] ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiFailure('NOT_FOUND')
  const [row] = await context.db.selectRows<Connection>('orderonline_connections', { id: `eq.${id}` }, fields)
  if (!row) throw new ApiFailure('NOT_FOUND')
  return row
}
export async function listConnections(context: RouteContext): Promise<Response> {
  await requireAdmin(context)
  const rows: Connection[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await context.db.selectRows<Connection>('orderonline_connections', { order: 'created_at.asc,id.asc', offset: String(offset), limit: '500' }, fields)
    rows.push(...page)
    if (page.length < 500) break
  }
  return ok({ rows: rows.map(row => ({ id: row.id, name: row.name, slug: row.slug, active: row.active, has_api_token: !!row.api_token_encrypted, last_received_at: row.last_received_at })) })
}
export async function saveConnection(context: RouteContext): Promise<Response> {
  await requireAdmin(context)
  const body = await readJsonObject(context.request)
  const name = readString(body, 'name')?.trim()
  let slug = readString(body, 'slug')?.trim().toUpperCase()
  const token = readString(body, 'api_token')?.trim()
  const isEditing = !!context.params['id']
  if (!name || name.length > 100 || (token && token.length > 8192) || typeof body['active'] !== 'boolean') throw new ApiFailure('INVALID_ARGUMENT')
  if (!isEditing && !slug) {
    const cleaned = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    const prefix = (cleaned.slice(0, 2) || 'TK')
    const suffix = Math.floor(10 + Math.random() * 89).toString()
    slug = (prefix + suffix).slice(0, 4)
  }
  if (slug && !/^[A-Z0-9]{1,4}$/.test(slug)) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Kode toko wajib 1-4 karakter alfanumerik kapital')
  }
  const patch: Record<string, unknown> = { name, active: body['active'] }
  if (slug) patch['slug'] = slug
  if (token) patch['api_token_encrypted'] = await encrypt(token, context.env.INTEGRATION_ENCRYPTION_KEY)
  if (context.params['id']) {
    const row = await getConnection(context)
    await context.db.updateRows('orderonline_connections', { id: `eq.${row.id}` }, patch)
    return ok({ id: row.id })
  }
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  const row = await context.db.insertRow<{ id: string }>('orderonline_connections', {
    ...patch, webhook_secret_encrypted: await encrypt(secret, context.env.INTEGRATION_ENCRYPTION_KEY), webhook_secret_hash: await hash(secret),
  }, 'id')
  return ok({ id: row.id }, { status: 201 })
}
export async function connectionWebhookUrl(context: RouteContext): Promise<Response> {
  await requireAdmin(context)
  const row = await getConnection(context)
  const secret = await decrypt(row.webhook_secret_encrypted, context.env.INTEGRATION_ENCRYPTION_KEY)
  return ok({
    url: `${context.url.origin}/api/webhooks/orderonline/${row.id}/${secret}`,
    redirectUrl: `${context.url.origin}/access/${row.slug}/{order_id}`,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function testConnection(context: RouteContext): Promise<Response> {
  await requireAdmin(context)
  const row = await getConnection(context)
  if (!row.active || !row.api_token_encrypted) throw new ApiFailure('INVALID_ARGUMENT')
  const token = await decrypt(row.api_token_encrypted, context.env.INTEGRATION_ENCRYPTION_KEY)
  try {
    const response = await fetch('https://api.orderonline.id/v1/auth', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token }) })
    const body = await response.json() as { error_code?: number; data?: { access_token?: string } }
    const connected = response.ok && body.error_code === 0 && typeof body.data?.access_token === 'string' && body.data.access_token.length > 0
    return ok({ connected, message: connected ? 'Token API berhasil terhubung ke OrderOnline.' : 'Token ditolak OrderOnline. Periksa personal access token dan status akun.' })
  } catch { return ok({ connected: false, message: 'OrderOnline belum dapat dihubungi. Coba lagi nanti.' }) }
}
export async function validateConnectionWebhook(context: RouteContext): Promise<boolean> {
  let row: Connection
  try { row = await getConnection(context) } catch (e) { if (e instanceof ApiFailure && e.code === 'NOT_FOUND') return false; throw e }
  if (!row.active) return false
  return await hash(context.params['webhookSecret'] ?? '') === row.webhook_secret_hash
}
export async function deleteConnection(context: RouteContext): Promise<Response> {
  await requirePermissions(context, ['action.delete_master', 'config.integrasi'])
  const row = await getConnection(context)
  await context.db.deleteRows('orderonline_connections', { id: `eq.${row.id}` })
  return ok({ deleted: row.id })
}

