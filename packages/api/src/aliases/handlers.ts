import { MAX_LIST_ROWS, parseProductRaw, type ProductAliasItem } from '@dvflow/shared'
import { buildIlikeOrFilter, sanitizeSearchTerm } from '../http/postgrest-filter'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requirePermission, requirePermissions, productAccess, assertProductAccess, allowsProduct } from '../permissions'
import { loadProductConfig } from '../webhooks/handlers'

async function requireConfigPermission(context: RouteContext) {
  return requirePermission(context, 'config.alias_produk')
}

/**
 * GET /api/product-aliases
 * Mengambil daftar seluruh alias produk.
 */
export async function listAliases(context: RouteContext): Promise<Response> {
  const actor = await requireConfigPermission(context)
  const access = await productAccess(context, actor)
  const rows = await context.db.selectRows<ProductAliasItem>(
    'product_aliases',
    { order: 'created_at.desc' },
    'id,alias_name,alias_name_normalized,canonical_target,created_at,updated_at,created_by',
  )
  const config = await loadProductConfig(context.db)
  return ok({ rows: rows.filter((row) => allowsProduct(access, parseProductRaw(row.canonical_target, config).product_code)) })
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
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama alias dan target konfigurasi wajib diisi (maks 200 karakter)')
  }

  const config = await loadProductConfig(context.db)
  const parse = parseProductRaw(canonicalTarget, config)
  if (parse.product_parse_status !== 'valid') {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Target konfigurasi tidak valid menurut aturan parser DVFLOW')
  }

  const access = await productAccess(context, actor)
  assertProductAccess(access, parse.product_code)
  const normalized = aliasName.toLowerCase()
  const existing = await context.db.selectRows<ProductAliasItem>(
    'product_aliases',
    { alias_name_normalized: `eq.${normalized}` },
    'id,canonical_target',
  )

  if (existing[0]) {
    assertProductAccess(access, parseProductRaw(existing[0].canonical_target, config).product_code)
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
  const actor = await requireConfigPermission(context)
  const access = await productAccess(context, actor)
  const id = context.params['id'] ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiFailure('NOT_FOUND')

  await requirePermission(context, 'action.delete_master')
  const rows = await context.db.selectRows<ProductAliasItem>('product_aliases', { id: `eq.${id}` }, 'canonical_target')
  if (!rows[0]) throw new ApiFailure('RESOURCE_NOT_FOUND')
  assertProductAccess(access, parseProductRaw(rows[0].canonical_target, await loadProductConfig(context.db)).product_code)
  await context.db.deleteRows('product_aliases', { id: `eq.${id}` })
  return ok({ deleted: id })
}

/**
 * GET /api/orders/unmapped
 * Mengambil daftar pesanan yang status produknya 'invalid' (menunggu pemetaan).
 */
export async function listUnmappedOrders(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.order_unmapped')
  const access = await productAccess(context, actor)
  // Order unmapped belum punya produk/pengiklan, jadi hanya untuk akses penuh (A20: bukan Advertiser).
  if (!access.all || access.advertiserCode !== null) throw new ApiFailure('FORBIDDEN')

  const search = sanitizeSearchTerm(context.url.searchParams.get('search'))
  const page = Math.max(1, parseInt(context.url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(context.url.searchParams.get('pageSize') ?? '50', 10) || 50))
  // A18: maksimal MAX_LIST_ROWS baris lewat pagination (10 halaman x 50).
  const maxPage = Math.max(1, Math.floor(MAX_LIST_ROWS / pageSize))
  if (page > maxPage) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, `Hanya ${MAX_LIST_ROWS} data pertama yang bisa dibuka. Persempit pencarian.`)
  }
  const offset = (page - 1) * pageSize

  const cutoffDate = new Date(context.now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const query: Record<string, string> = {
    product_parse_status: 'eq.invalid',
    created_at: `gte.${cutoffDate}`,
    order: 'created_at.desc',
    // One extra row tells the UI whether a next page exists without a COUNT.
    limit: String(pageSize + 1),
    offset: String(offset),
  }

  if (search) {
    query['or'] = buildIlikeOrFilter(['order_id', 'name', 'product_raw'], search)
  }

  const rows = await context.db.selectRows<Record<string, unknown>>(
    'orders',
    query,
    'id,order_id,raw_order_id,connection_id,name,phone,email,product_raw,gross_amount,raw_status,app_status,created_at',
  )

  return ok({
    rows: rows.slice(0, pageSize),
    page,
    pageSize,
    has_more: rows.length > pageSize && page < maxPage,
  })
}

/**
 * POST /api/orders/batch-remap
 * Mengeksekusi pemetaan massal pesanan invalid ke konfigurasi target DVFLOW.
 */
export async function batchRemapOrders(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.order_unmapped')
  const access = await productAccess(context, actor)
  if (!access.all) throw new ApiFailure('FORBIDDEN')

  const body = await readJsonObject(context.request)
  const orderIds = Array.isArray(body['orderIds']) ? (body['orderIds'] as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const canonicalTarget = readString(body, 'canonicalTarget')?.trim()
  const saveAlias = body['saveAlias'] === true
  const aliasName = readString(body, 'aliasName')?.trim() ?? null
  if (saveAlias) await requirePermission(context, 'config.alias_produk')

  if (orderIds.length === 0 || orderIds.length > 1000) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Daftar orderId minimal 1 dan maksimal 1000')
  }
  if (!canonicalTarget) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Target konfigurasi wajib ditentukan')
  }

  const config = await loadProductConfig(context.db)
  const parse = parseProductRaw(canonicalTarget, config)
  if (parse.product_parse_status !== 'valid') {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Target konfigurasi tidak valid menurut aturan format DVFLOW')
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


/**
 * POST /api/orders/unmapped/delete
 * A40: hapus massal order yang MASIH unmapped (beserta presensinya). Order yang sudah ter-mapping
 * dilewati oleh RPC; order bisa muncul lagi bila OrderOnline mengirim webhook baru untuknya.
 */
export async function deleteUnmappedOrders(context: RouteContext): Promise<Response> {
  const actor = await requirePermissions(context, ['operasional.order_unmapped', 'action.delete_master'])
  const access = await productAccess(context, actor)
  if (!access.all) throw new ApiFailure('FORBIDDEN')

  const body = await readJsonObject(context.request)
  const orderIds = Array.isArray(body['orderIds']) ? (body['orderIds'] as unknown[]).filter((x): x is string => typeof x === 'string') : []
  if (orderIds.length === 0 || orderIds.length > 1000) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Daftar orderId minimal 1 dan maksimal 1000')
  }

  const result = await context.db.rpc<{ deleted_count: number; skipped_count: number }>(
    'delete_unmapped_orders',
    { p_actor_id: actor.id, p_order_ids: orderIds },
  )
  return ok(result)
}
