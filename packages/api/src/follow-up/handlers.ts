import {
  EVENT_TYPE_NAME_BY_KIND,
  FOLLOW_UP_SLOTS,
  isFollowUpSlot,
  isOrderIdShaped,
  normalizeCode,
  parseProductRaw,
  toWhatsAppNumber,
  validateFollowUpTemplate,
  type EventKind,
} from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import { assertOrderAccess, assertProductAccess, allowsOrder, productAccess, requirePermission } from '../permissions'
import type { RouteContext } from '../router'
import { loadProductConfig, resolveProductAlias } from '../webhooks/handlers'

/**
 * Follow Up Manual via WhatsApp (A76).
 *
 * Aplikasi tidak mengirim pesan: modal hanya menampilkan preview, lalu tombol
 * Kirim membuka `api.whatsapp.com/send` milik operator. Handler di sini
 * menyiapkan template + penanda, dan mencatat bubble yang sudah dipakai.
 *
 * Template dipilih dari PRODUK x JENIS ACARA. Jenis acara diambil dari kode
 * event type asli (hasil parse `product_raw`, termasuk lewat alias), bukan dari
 * `orders.event_type` — Workshop ber-kind hybrid tersimpan sebagai "Hybrid".
 */
type FollowUpOrderRow = {
  order_id: string
  source: string | null
  name: string | null
  phone: string | null
  product_code: string | null
  product_name: string | null
  product_raw: string | null
  advertiser_code: string | null
  advertiser_name: string | null
  event_type: string | null
  batch: string | null
  session: string | null
  city: string | null
  quantity: number
}

type TemplateRow = {
  slot: number
  body: string
  updated_at: string
  updated_by: string | null
}

type MarkRow = {
  slot: number
  used_at: string
  used_by_name: string | null
}

/** Template + penanda untuk satu order. */
export async function getFollowUpContext(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.order')
  const access = await productAccess(context, actor)
  const order = await loadOrder(context, readOrderId(context))
  assertOrderAccess(access, order)

  const isOts = order.source === 'ots' || /^OTS-\d+$/.test(order.order_id)
  const config = await loadProductConfig(context.db)
  const aliasTarget = await resolveProductAlias(context.db, order.product_raw)
  const parsed = parseProductRaw(aliasTarget ?? order.product_raw, config)

  let productCode = order.product_code
  let eventTypeCode: string | null = null
  if (parsed.product_parse_status === 'valid') {
    productCode = parsed.product_code
    eventTypeCode = parsed.event_type_code
  }
  // OTS tidak punya product_raw; fallback ke nama jenis acara HANYA bila kind-nya
  // menunjuk tepat satu event type. Ambiguitas tidak pernah ditebak.
  if (eventTypeCode === null && order.event_type !== null) {
    const matches = config.eventTypes.filter(
      (eventType) => EVENT_TYPE_NAME_BY_KIND[eventType.kind as EventKind] === order.event_type,
    )
    if (matches.length === 1) eventTypeCode = matches[0]?.code ?? null
  }

  const eventType = eventTypeCode === null
    ? null
    : config.eventTypes.find((row) => normalizeCode(row.code) === normalizeCode(eventTypeCode)) ?? null

  const product = productCode === null
    ? null
    : (await context.db.selectRows<{ id: string; code: string; name: string }>(
        'products', { code: `eq.${productCode}` }, 'id,code,name',
      ))[0] ?? null

  let eventTypeId: string | null = null
  if (eventType !== null) {
    eventTypeId = (await context.db.selectRows<{ id: string }>(
      'event_types', { code: `eq.${normalizeCode(eventType.code)}` }, 'id',
    ))[0]?.id ?? null
  }

  let templates: TemplateRow[] = []
  if (product !== null && eventTypeId !== null) {
    templates = await context.db.selectRows<TemplateRow>(
      'follow_up_templates',
      { product_id: `eq.${product.id}`, event_type_id: `eq.${eventTypeId}`, order: 'slot.asc' },
      'slot,body,updated_at,updated_by',
    )
  }
  const marks = await context.db.selectRows<MarkRow>(
    'order_follow_up_marks',
    { order_id: `eq.${order.order_id}`, order: 'slot.asc' },
    'slot,used_at,used_by_name',
  )

  const latest = templates.reduce<TemplateRow | null>(
    (current, row) => (current === null || row.updated_at > current.updated_at ? row : current),
    null,
  )
  const updatedBy = latest?.updated_by === null || latest?.updated_by === undefined
    ? null
    : (await context.db.selectRows<{ display_name: string }>(
        'users', { id: `eq.${latest.updated_by}` }, 'display_name',
      ))[0]?.display_name ?? null

  return ok({
    order: {
      order_id: order.order_id,
      name: order.name,
      phone: order.phone,
      phone_wa: toWhatsAppNumber(order.phone),
      product_code: productCode ?? order.product_code,
      product_name: product?.name ?? order.product_name,
      advertiser_name: order.advertiser_name,
      event_type: order.event_type,
      batch: order.batch,
      session: order.session,
      city: order.city,
      is_ots: isOts,
    },
    event_type: eventType === null ? null : { code: eventType.code, name: eventType.name },
    templates: templates.map((row) => ({ slot: row.slot, body: row.body })),
    marks: marks.map((row) => ({ slot: row.slot, used_at: row.used_at, used_by_name: row.used_by_name })),
    template_updated: latest === null ? null : { at: latest.updated_at, by: updatedBy },
  })
}

/** Tandai satu bubble sudah dipakai untuk order ini. */
export async function markFollowUp(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.order')
  const access = await productAccess(context, actor)
  const orderId = readOrderId(context)
  const order = await loadOrder(context, orderId)
  assertOrderAccess(access, order)

  const body = await readJsonObject(context.request)
  const slot = body['slot']
  if (!isFollowUpSlot(slot)) throw new ApiFailure('INVALID_ARGUMENT', 'slot=invalid')

  const result = await context.db.rpc<Record<string, unknown>>('mark_order_follow_up', {
    p_actor: actor.id,
    p_order_id: orderId,
    p_slot: slot,
  })
  return ok(result)
}

/**
 * Ringkasan untuk daftar Order di HP: slot template yang tersedia + slot yang
 * sudah dipakai, untuk maksimal 50 order sekaligus (satu request per halaman).
 *
 * Isi pesan tidak dikirim di sini — preview diambil saat bubble diketuk.
 */
export async function getFollowUpSummaries(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.order')
  const access = await productAccess(context, actor)

  const idsParam = (context.url.searchParams.get('ids') ?? '').trim()
  const ids = [...new Set(idsParam.split(',').map((value) => value.trim()).filter(Boolean))]
  if (ids.length === 0) return ok({ orders: [] })
  if (ids.length > 50) throw new ApiFailure('INVALID_ARGUMENT', 'ids>50')
  if (ids.some((id) => !isOrderIdShaped(id))) throw new ApiFailure('INVALID_ARGUMENT', 'ids=invalid')

  const orders = await context.db.selectRows<FollowUpOrderRow>(
    'orders',
    { order_id: `in.(${quoteIn(ids)})` },
    'order_id,source,name,phone,product_code,product_name,product_raw,advertiser_code,advertiser_name,event_type,batch,session,city,quantity',
  )
  const allowed = orders.filter((order) => allowsOrder(access, order))
  if (allowed.length === 0) return ok({ orders: [] })

  const config = await loadProductConfig(context.db)

  // Alias produk dibaca sekali untuk seluruh halaman, bukan per order.
  const aliasKeys = [...new Set(
    allowed
      .map((order) => (order.product_raw ?? '').trim().toLowerCase())
      .filter((value) => value !== ''),
  )]
  const aliases = aliasKeys.length === 0 ? [] : await context.db.selectRows<{ alias_name_normalized: string; canonical_target: string }>(
    'product_aliases',
    { alias_name_normalized: `in.(${quoteIn(aliasKeys)})` },
    'alias_name_normalized,canonical_target',
  )
  const aliasByRaw = new Map(aliases.map((row) => [row.alias_name_normalized, row.canonical_target]))

  const [productRows, eventTypeRows] = await Promise.all([
    context.db.selectRows<{ id: string; code: string }>('products', {}, 'id,code'),
    context.db.selectRows<{ id: string; code: string }>('event_types', {}, 'id,code'),
  ])
  const productIdByCode = new Map(productRows.map((row) => [normalizeCode(row.code), row.id]))
  const eventTypeIdByCode = new Map(eventTypeRows.map((row) => [normalizeCode(row.code), row.id]))

  const targets = new Map<string, { productId: string | null; eventTypeId: string | null }>()
  for (const order of allowed) {
    const aliasTarget = aliasByRaw.get((order.product_raw ?? '').trim().toLowerCase()) ?? null
    const parsed = parseProductRaw(aliasTarget ?? order.product_raw, config)
    let productCode = order.product_code
    let eventTypeCode: string | null = null
    if (parsed.product_parse_status === 'valid') {
      productCode = parsed.product_code
      eventTypeCode = parsed.event_type_code
    } else if (order.event_type !== null) {
      const matches = config.eventTypes.filter(
        (eventType) => EVENT_TYPE_NAME_BY_KIND[eventType.kind as EventKind] === order.event_type,
      )
      if (matches.length === 1) eventTypeCode = matches[0]?.code ?? null
    }
    targets.set(order.order_id, {
      productId: productCode === null ? null : productIdByCode.get(normalizeCode(productCode)) ?? null,
      eventTypeId: eventTypeCode === null ? null : eventTypeIdByCode.get(normalizeCode(eventTypeCode)) ?? null,
    })
  }

  const productIds = [...new Set(
    [...targets.values()]
      .map((target) => target.productId)
      .filter((value): value is string => value !== null),
  )]
  const templateRows = productIds.length === 0 ? [] : await context.db.selectRows<{ product_id: string; event_type_id: string; slot: number }>(
    'follow_up_templates',
    { product_id: `in.(${quoteIn(productIds)})` },
    'product_id,event_type_id,slot',
  )
  const templateSlots = new Set(templateRows.map((row) => `${row.product_id}:${row.event_type_id}:${row.slot}`))

  const markRows = await context.db.selectRows<{ order_id: string; slot: number }>(
    'order_follow_up_marks',
    { order_id: `in.(${quoteIn(allowed.map((order) => order.order_id))})` },
    'order_id,slot',
  )
  const usedByOrder = new Map<string, number[]>()
  for (const row of markRows) {
    const current = usedByOrder.get(row.order_id) ?? []
    current.push(row.slot)
    usedByOrder.set(row.order_id, current)
  }

  return ok({
    orders: allowed.map((order) => {
      const target = targets.get(order.order_id)
      const slots: number[] = []
      if (target?.productId !== null && target?.productId !== undefined && target.eventTypeId !== null) {
        for (let slot = 1; slot <= 4; slot += 1) {
          if (templateSlots.has(`${target.productId}:${target.eventTypeId}:${slot}`)) slots.push(slot)
        }
      }
      return {
        order_id: order.order_id,
        slots,
        used: [...new Set(usedByOrder.get(order.order_id) ?? [])].sort((left, right) => left - right),
        quantity: order.quantity,
      }
    }),
  })
}

/** Empat slot template untuk satu produk x jenis acara + daftar jenis acara. */
export async function getFollowUpTemplates(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.order')
  const access = await productAccess(context, actor)
  const productCode = (context.url.searchParams.get('product') ?? '').trim()
  if (productCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Produk wajib dipilih.')

  const products = await context.db.selectRows<{ id: string; code: string; name: string; active: boolean }>(
    'products', {}, 'id,code,name,active',
  )
  const product = products.find((row) => normalizeCode(row.code) === normalizeCode(productCode))
  if (product === undefined) throw new ApiFailure('RESOURCE_NOT_FOUND', `product=${productCode}`)
  assertProductAccess(access, product.code)

  const eventTypes = await context.db.selectRows<{ id: string; code: string; name: string; kind: EventKind; active: boolean }>(
    'event_types', { order: 'code.asc' }, 'id,code,name,kind,active',
  )
  const templates = await context.db.selectRows<TemplateRow & { event_type_id: string }>(
    'follow_up_templates',
    { product_id: `eq.${product.id}`, order: 'event_type_id.asc,slot.asc' },
    'event_type_id,slot,body,updated_at,updated_by',
  )

  return ok({
    product: { code: product.code, name: product.name },
    event_types: eventTypes.map((row) => ({ id: row.id, code: row.code, name: row.name, kind: row.kind, active: row.active })),
    templates: templates.map((row) => ({
      event_type_id: row.event_type_id,
      slot: row.slot,
      body: row.body,
      updated_at: row.updated_at,
    })),
  })
}

/** Simpan empat slot sekaligus; slot kosong dihapus. */
export async function saveFollowUpTemplates(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.order')
  const access = await productAccess(context, actor)
  const body = await readJsonObject(context.request)

  const productCode = (readString(body, 'productCode') ?? '').trim()
  const eventTypeCode = (readString(body, 'eventTypeCode') ?? '').trim()
  if (productCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Produk wajib dipilih.')
  if (eventTypeCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Jenis acara wajib dipilih.')

  const products = await context.db.selectRows<{ code: string }>('products', {}, 'code')
  const product = products.find((row) => normalizeCode(row.code) === normalizeCode(productCode))
  if (product === undefined) throw new ApiFailure('RESOURCE_NOT_FOUND', `product=${productCode}`)
  assertProductAccess(access, product.code)

  const rawSlots = body['slots']
  if (rawSlots === null || typeof rawSlots !== 'object' || Array.isArray(rawSlots)) {
    throw new ApiFailure('INVALID_PAYLOAD', 'slots harus objek 1-4')
  }
  const slots: Record<string, string> = {}
  for (const slot of FOLLOW_UP_SLOTS) {
    const value = (rawSlots as Record<string, unknown>)[String(slot)]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') throw new ApiFailure('INVALID_PAYLOAD', `slot=${slot}`)
    const text = value.trim()
    if (text === '') continue
    const validation = validateFollowUpTemplate(text)
    if (!validation.ok) throw new ApiFailure('INVALID_ARGUMENT', undefined, validation.message)
    slots[String(slot)] = text
  }
  // Slot kosong tetap dikirim agar RPC menghapus baris lama.
  for (const slot of FOLLOW_UP_SLOTS) {
    if (slots[String(slot)] === undefined) slots[String(slot)] = ''
  }

  await context.db.rpc('save_follow_up_templates', {
    p_actor: actor.id,
    p_product_code: product.code,
    p_event_type_code: eventTypeCode,
    p_slots: slots,
  })
  return ok({ saved: true })
}

async function loadOrder(context: RouteContext, orderId: string): Promise<FollowUpOrderRow> {
  const rows = await context.db.selectRows<FollowUpOrderRow>(
    'orders',
    { order_id: `eq.${orderId}` },
    'order_id,source,name,phone,product_code,product_name,product_raw,advertiser_code,advertiser_name,event_type,batch,session,city,quantity',
  )
  const row = rows[0]
  if (row === undefined) throw new ApiFailure('ORDER_NOT_FOUND', `order=${orderId}`)
  return row
}

/** Nilai PostgREST `in.(...)`: setiap nilai dikutip agar aman. */
function quoteIn(values: readonly string[]): string {
  return values.map((value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')
}

function readOrderId(context: RouteContext): string {
  const orderId = (context.params['orderId'] ?? '').trim()
  if (!isOrderIdShaped(orderId)) throw new ApiFailure('ORDER_NOT_FOUND')
  return orderId
}
