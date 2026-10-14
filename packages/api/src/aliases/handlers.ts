import { parseProductRaw, type ProductAliasItem } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requireActiveUser } from '../users'
import { loadProductConfig } from '../webhooks/handlers'

async function requireConfigPermission(context: RouteContext) {
  const user = await requireActiveUser(context)
  if (user.role === 'staff' || user.role === 'member') {
    throw new ApiFailure('FORBIDDEN', 'Akses ditolak: Izin konfigurasi diperlukan')
  }
  return user
}

/**
 * GET /api/product-aliases
 * Mengambil daftar seluruh alias produk.
 */
export async function listAliases(context: RouteContext): Promise<Response> {
  await requireConfigPermission(context)
  const rows = await context.db.selectRows<ProductAliasItem>(
    'product_aliases',
    { order: 'created_at.desc' },
    'id,alias_name,alias_name_normalized,canonical_target,created_at,updated_at,created_by',
  )
  return ok({ rows })
}

/**
 * POST /api/product-aliases
 * Menyimpan alias produk baru atau memperbarui alias yang sudah ada.
 */
export async function saveAlias(context: RouteContext): Promise<Response> {
  const actor = await requireConfigPermission(context)
  const body = await readJsonObject(context.request)
  const aliasName = readString(body, 'alias_name')?.trim()
  const canonicalTarget = readString(body, 'canonical_target')?.trim()

  if (!aliasName || aliasName.length > 200 || !canonicalTarget || canonicalTarget.length > 200) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Nama alias dan target konfigurasi wajib diisi (maks 200 karakter)')
  }

  const config = await loadProductConfig(context.db)
  const parse = parseProductRaw(canonicalTarget, config)
  if (parse.product_parse_status !== 'valid') {
    throw new ApiFailure('INVALID_ARGUMENT', 'Target konfigurasi tidak valid menurut aturan parser DVFLOW')
  }

  const normalized = aliasName.toLowerCase()
  const existing = await context.db.selectRows<ProductAliasItem>(
    'product_aliases',
    { alias_name_normalized: `eq.${normalized}` },
    'id',
  )

  if (existing[0]) {
    await context.db.updateRows(
      'product_aliases',
      { id: `eq.${existing[0].id}` },
      { canonical_target: canonicalTarget, updated_at: new Date().toISOString() },
    )
    return ok({ id: existing[0].id, action: 'updated' })
  }

  const inserted = await context.db.insertRow<{ id: string }>(
    'product_aliases',
    {
      alias_name: aliasName,
      alias_name_normalized: normalized,
      canonical_target: canonicalTarget,
      created_by: actor.id,
    },
    'id',
  )
  return ok({ id: inserted.id, action: 'inserted' }, { status: 201 })
}

/**
 * DELETE /api/product-aliases/:id
 * Menghapus alias produk.
 */
export async function deleteAlias(context: RouteContext): Promise<Response> {
  await requireConfigPermission(context)
  const id = context.params['id'] ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiFailure('NOT_FOUND')

  await context.db.deleteRows('product_aliases', { id: `eq.${id}` })
  return ok({ deleted: id })
}

/**
 * GET /api/orders/unmapped
 * Mengambil daftar pesanan yang status produknya 'invalid' (menunggu pemetaan).
 */
export async function listUnmappedOrders(context: RouteContext): Promise<Response> {
  const user = await requireActiveUser(context)
  if (user.role === 'staff' || user.role === 'member') {
    throw new ApiFailure('FORBIDDEN')
  }

  const search = context.url.searchParams.get('search')?.trim() ?? ''
  const page = Math.max(1, parseInt(context.url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(context.url.searchParams.get('pageSize') ?? '50', 10) || 50))
  const offset = (page - 1) * pageSize

  const cutoffDate = new Date(context.now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const query: Record<string, string> = {
    product_parse_status: 'eq.invalid',
    created_at: `gte.${cutoffDate}`,
    order: 'created_at.desc',
    limit: String(pageSize),
    offset: String(offset),
  }

  if (search) {
    query['or'] = `(order_id.ilike.*${search}*,name.ilike.*${search}*,product_raw.ilike.*${search}*)`
  }

  const rows = await context.db.selectRows<Record<string, unknown>>(
    'orders',
    query,
    'id,order_id,raw_order_id,connection_id,name,phone,email,product_raw,gross_amount,raw_status,app_status,created_at',
  )

  return ok({
    rows,
    page,
    pageSize,
  })
}

/**
 * POST /api/orders/batch-remap
 * Mengeksekusi pemetaan massal pesanan invalid ke konfigurasi target DVFLOW.
 */
export async function batchRemapOrders(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (actor.role === 'staff' || actor.role === 'member') {
    throw new ApiFailure('FORBIDDEN')
  }

  const body = await readJsonObject(context.request)
  const orderIds = Array.isArray(body['orderIds']) ? (body['orderIds'] as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const canonicalTarget = readString(body, 'canonicalTarget')?.trim()
  const saveAlias = body['saveAlias'] === true
  const aliasName = readString(body, 'aliasName')?.trim() ?? null

  if (orderIds.length === 0 || orderIds.length > 1000) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Daftar orderId minimal 1 dan maksimal 1000')
  }
  if (!canonicalTarget) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Target konfigurasi wajib ditentukan')
  }

  const config = await loadProductConfig(context.db)
  const parse = parseProductRaw(canonicalTarget, config)
  if (parse.product_parse_status !== 'valid') {
    throw new ApiFailure('INVALID_ARGUMENT', 'Target konfigurasi tidak valid menurut aturan format DVFLOW')
  }

  const result = await context.db.rpc<{ success: boolean; updated_count: number; alias_saved: boolean }>(
    'batch_remap_orders',
    {
      p_order_ids: orderIds,
      p_canonical_target: canonicalTarget,
      p_parsed: {
        product_parse_status: 'valid',
        product_code: parse.product_code,
        product_name: parse.product_name,
        advertiser_code: parse.advertiser_code,
        advertiser_name: parse.advertiser_name,
        event_type: parse.event_type,
        batch: parse.batch,
        session: parse.session,
        city: parse.city,
      },
      p_save_alias: saveAlias,
      p_alias_name: aliasName,
      p_actor_id: actor.id,
    },
  )

  return ok(result)
}

