import { roundMoney } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { productAccess, productFilter, requirePermission } from '../permissions'

/**
 * Pendaftaran peserta OTS — bayar di lokasi seminar (A29, disederhanakan di A34).
 *
 * Fitur tersendiri: setiap pendaftaran = satu order baru (`source = 'ots'`, Order ID `OTS-000001`),
 * Paid, langsung check-in. Order Pending OrderOnline tidak disentuh dan OrderOnline tidak
 * dihubungi — pembayaran hanya dicatat di dvflow. Aturan & izin ditegakkan ulang di RPC
 * `save_ots_registration` (0045).
 *
 * Ada dua bentuk request selama masa transisi:
 *   * **form baru (A34)**: `unit_price` + `quantity`; produk/batch/sesi/kota/No HP wajib.
 *   * **form lama (A29)**: `amount` saja; tetap diterima supaya aplikasi lama yang masih
 *     terbuka di HP petugas tidak langsung rusak saat backend/database dideploy lebih dulu.
 */
export const OTS_METHODS = ['ots_tunai', 'ots_transfer', 'ots_qris'] as const
const OTS_EVENT_TYPES = ['Seminar Offline', 'Hybrid']
const EVENT_LOOKBACK_DAYS = 30
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_QUANTITY = 100
const MAX_MONEY = 9_999_999_999

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
  quantity: number | string | null
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
  }, 'order_id,name,phone,product_code,product_name,batch,session,city,event_type,quantity,gross_amount,payment_method,created_at,ots_collected_by'))
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
      quantity: Number(row.quantity ?? 1),
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
  const phone = (readString(body, 'phone') ?? '').trim()
  const method = readString(body, 'method') ?? ''
  const productCode = (readString(body, 'product_code') ?? '').trim()
  const batch = (readString(body, 'batch') ?? '').trim()
  const session = (readString(body, 'session') ?? '').trim()
  const city = (readString(body, 'city') ?? '').trim()
  const eventTypeInput = (readString(body, 'event_type') ?? '').trim()
  const orderId = (readString(body, 'order_id') ?? '').trim()

  // Form baru mengirim unit_price; form lama hanya amount. Ini yang membedakan jalur validasi.
  const isNewForm = body['unit_price'] !== undefined && body['unit_price'] !== null
  const unitPrice = readNumber(body, 'unit_price')
  const quantity = readNumber(body, 'quantity')
  const legacyAmount = readNumber(body, 'amount')

  if (name === '' || name.length > 200) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama peserta wajib diisi (maks 200 karakter).')
  if (phone.length > 32) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'No HP terlalu panjang (maks 32 karakter).')
  if (!(OTS_METHODS as readonly string[]).includes(method)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih metode bayar: Tunai, Bank Transfer, atau QRIS.')

  let amount: number
  let eventType: string
  let finalQuantity: number | null = null
  let finalUnitPrice: number | null = null

  if (isNewForm) {
    if (phone === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'No HP wajib diisi.')
    if (productCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih produk terlebih dahulu.')
    if (batch === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Batch wajib diisi.')
    if (session === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Sesi wajib diisi.')
    if (city === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Kota wajib diisi.')
    if (quantity === null || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, `Jumlah tiket harus bilangan bulat 1–${MAX_QUANTITY}.`)
    }
    if (unitPrice === null || unitPrice <= 0 || unitPrice > MAX_MONEY) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Harga per tiket harus lebih dari 0.')
    }
    finalQuantity = quantity
    finalUnitPrice = roundMoney(unitPrice)
    amount = roundMoney(finalUnitPrice * finalQuantity)
    // OTS hanya untuk acara tatap muka; jenis acara tidak lagi dipilih di form.
    eventType = 'Seminar Offline'
  } else {
    // Kompatibilitas form lama (A29).
    if (productCode === '' || !OTS_EVENT_TYPES.includes(eventTypeInput)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih acara seminar.')
    if (legacyAmount === null || legacyAmount <= 0 || legacyAmount > MAX_MONEY) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nominal harus lebih dari 0.')
    amount = roundMoney(legacyAmount)
    eventType = eventTypeInput
  }

  const result = await context.db.rpc<{
    order_id: string
    action: 'created' | 'updated'
    quantity?: number
    gross_amount?: number | string
    checked_in_at: string | null
  }>('save_ots_registration', {
    p_actor: actor.id,
    p_order_id: orderId === '' ? null : orderId,
    p_name: name,
    p_phone: phone === '' ? null : phone,
    p_product_code: productCode,
    p_batch: batch === '' ? null : batch,
    p_session: session === '' ? null : session,
    p_city: city === '' ? null : city,
    p_event_type: eventType,
    p_amount: amount,
    p_method: method,
    p_quantity: finalQuantity,
    p_unit_price: finalUnitPrice,
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

function readNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key]
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function wibDate(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
