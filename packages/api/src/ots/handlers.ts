import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { productAccess, productFilter, requirePermission } from '../permissions'

/**
 * Pendaftaran peserta OTS — bayar di lokasi seminar (A29).
 *
 * Fitur tersendiri: setiap pendaftaran = satu order baru (`source = 'ots'`, Order ID `OTS-000001`),
 * Paid, 1 tiket, langsung check-in. Order Pending OrderOnline tidak disentuh dan OrderOnline tidak
 * dihubungi — pembayaran hanya dicatat di dvflow. Aturan & izin ditegakkan ulang di RPC
 * `save_ots_registration` / `delete_ots_registration` (0041).
 */
export const OTS_METHODS = ['ots_tunai', 'ots_transfer', 'ots_qris'] as const
const OTS_EVENT_TYPES = ['Seminar Offline', 'Hybrid']
const EVENT_LOOKBACK_DAYS = 30
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type EventRow = {
  product_code: string | null
  product_name: string | null
  batch: string | null
  session: string | null
  city: string | null
  event_type: string | null
}

/**
 * GET /api/ots/events — acara seminar/hybrid dari order 30 hari terakhir (dalam scope produk),
 * supaya petugas cukup memilih acara sekali, tanpa mengetik kode.
 */
export async function listOtsEvents(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.ots')
  const access = await productAccess(context, actor)
  const since = new Date(context.now.getTime() - EVENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const rows = await context.db.selectRows<EventRow>('orders', {
    ...productFilter(access),
    product_parse_status: 'eq.valid',
    event_type: `in.(${OTS_EVENT_TYPES.map((type) => `"${type}"`).join(',')})`,
    created_at: `gte.${since}`,
    order: 'created_at.desc',
    limit: '5000',
  }, 'product_code,product_name,batch,session,city,event_type')

  const events = new Map<string, EventRow & { key: string }>()
  for (const row of rows) {
    if (!row.product_code) continue
    const key = [row.product_code, row.batch ?? '', row.session ?? '', row.city ?? '', row.event_type ?? ''].join('|')
    if (!events.has(key)) events.set(key, { ...row, key })
  }
  const sorted = [...events.values()].sort((a, b) =>
    `${a.product_name ?? a.product_code} ${a.batch} ${a.session} ${a.city}`.localeCompare(`${b.product_name ?? b.product_code} ${b.batch} ${b.session} ${b.city}`, 'id'),
  )
  return ok({ events: sorted })
}

type OtsRow = {
  order_id: string
  name: string | null
  phone: string | null
  product_code: string | null
  product_name: string | null
  batch: string | null
  session: string | null
  city: string | null
  event_type: string | null
  gross_amount: number | string
  payment_method: string | null
  created_at: string
  ots_collected_by: string | null
}

/** GET /api/ots?date=YYYY-MM-DD — pendaftaran OTS pada hari itu (WIB; default hari ini). */
export async function listOts(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.ots')
  const access = await productAccess(context, actor)
  const requested = context.url.searchParams.get('date')?.trim() ?? ''
  const date = DATE_PATTERN.test(requested) ? requested : wibDate(context.now)
  const start = new Date(`${date}T00:00:00+07:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  const rows = (await context.db.selectRows<OtsRow>('orders', {
    ...productFilter(access),
    source: 'eq.ots',
    created_at: `gte.${start.toISOString()}`,
    order: 'created_at.desc',
    limit: '1000',
  }, 'order_id,name,phone,product_code,product_name,batch,session,city,event_type,gross_amount,payment_method,created_at,ots_collected_by'))
    .filter((row) => new Date(row.created_at) < end)

  const collectorIds = [...new Set(rows.map((row) => row.ots_collected_by).filter((id): id is string => !!id))]
  const collectors = collectorIds.length === 0 ? [] : await context.db.selectRows<{ id: string; display_name: string }>(
    'users', { id: `in.(${collectorIds.join(',')})` }, 'id,display_name',
  )
  const names = new Map(collectors.map((user) => [user.id, user.display_name]))
  return ok({
    date,
    rows: rows.map(({ ots_collected_by, ...row }) => ({
      ...row,
      gross_amount: Number(row.gross_amount),
      collected_by: ots_collected_by ? names.get(ots_collected_by) ?? null : null,
    })),
  })
}

/** POST /api/ots — buat (tanpa `order_id`) atau edit (dengan `order_id` OTS-…) pendaftaran OTS. */
export async function saveOts(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.ots')
  const body = await readJsonObject(context.request)
  const name = (readString(body, 'name') ?? '').trim()
  const method = readString(body, 'method') ?? ''
  const eventType = readString(body, 'event_type') ?? ''
  const productCode = (readString(body, 'product_code') ?? '').trim()
  const amount = typeof body['amount'] === 'number' ? body['amount'] : Number(readString(body, 'amount'))

  if (name === '' || name.length > 200) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama peserta wajib diisi (maks 200 karakter).')
  if (productCode === '' || !OTS_EVENT_TYPES.includes(eventType)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih acara seminar.')
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nominal harus lebih dari 0.')
  if (!(OTS_METHODS as readonly string[]).includes(method)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih metode bayar: Tunai, Transfer, atau QRIS.')

  const orderId = (readString(body, 'order_id') ?? '').trim()
  const result = await context.db.rpc<{ order_id: string; action: 'created' | 'updated'; checked_in_at: string | null }>('save_ots_registration', {
    p_actor: actor.id,
    p_order_id: orderId === '' ? null : orderId,
    p_name: name,
    p_phone: readString(body, 'phone'),
    p_product_code: productCode,
    p_batch: readString(body, 'batch'),
    p_session: readString(body, 'session'),
    p_city: readString(body, 'city'),
    p_event_type: eventType,
    p_amount: amount,
    p_method: method,
  })
  return ok(result, { status: result.action === 'created' ? 201 : 200 })
}

/** DELETE /api/ots/:orderId — hapus pendaftaran OTS salah input (butuh izin hapus). */
export async function deleteOts(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.ots')
  const orderId = (context.params['orderId'] ?? '').trim()
  if (!/^OTS-\d{1,12}$/.test(orderId)) throw new ApiFailure('ORDER_NOT_FOUND')
  const result = await context.db.rpc<{ order_id: string; deleted: boolean }>('delete_ots_registration', {
    p_actor: actor.id,
    p_order_id: orderId,
  })
  return ok(result)
}

function wibDate(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
