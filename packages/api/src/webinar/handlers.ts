import { parseProductRaw } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requireActiveUser } from '../users'
import { loadProductConfig } from '../webhooks/handlers'

const PREFIX = 'webinar_destination::'

export async function listWebinars(context: RouteContext): Promise<Response> {
  await requireActiveUser(context)
  const rows: { key: string; value_text: string | null; updated_at: string }[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await context.db.selectRows<(typeof rows)[number]>('app_settings',
      { key: `like.${PREFIX}*`, order: 'key.asc', limit: '500', offset: String(offset) }, 'key,value_text,updated_at')
    rows.push(...page)
    if (page.length < 500) break
  }
  return ok({ rows: rows.map(row => ({ product_raw: row.key.slice(PREFIX.length), destination: row.value_text, updated_at: row.updated_at })) })
}

export async function saveWebinar(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  const body = await readJsonObject(context.request)
  const productRaw = readString(body, 'product_raw')?.trim()
  const destination = readString(body, 'destination')?.trim()
  if (!productRaw || !destination || productRaw.length > 1000 || destination.length > 4096) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Produk dan link Zoom wajib diisi')
  }
  let url: URL
  try { url = new URL(destination) } catch { throw new ApiFailure('INVALID_ARGUMENT', 'URL tidak valid') }
  if (url.protocol !== 'https:' || url.username || url.password ||
    !(url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us') || url.hostname === 'zoom.com' || url.hostname.endsWith('.zoom.com'))) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Gunakan link HTTPS Zoom')
  }
  const parsed = parseProductRaw(productRaw, await loadProductConfig(context.db))
  if (parsed.product_parse_status !== 'valid' || parsed.event_kind !== 'webinar') {
    throw new ApiFailure('INVALID_ARGUMENT', 'Nama produk harus webinar dengan kode yang terdaftar')
  }
  await context.db.rpc('save_webinar_destination', { p_actor: actor.id, p_product_raw: productRaw, p_destination: destination })
  return ok({ product_raw: productRaw, destination })
}
