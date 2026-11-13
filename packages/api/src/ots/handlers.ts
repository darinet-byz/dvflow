import { normalizeCode, roundMoney } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { sanitizeSearchTerm } from '../http/postgrest-filter'
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

/** GET /api/ots?date=YYYY-MM-DD — pendaftaran OTS pada hari itu (WIB; default hari ini). */
export async function listOts(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.ots')
  const params = context.url.searchParams
  const requestedDate = params.get('date')?.trim() ?? ''
  const requestedFrom = params.get('from')?.trim() ?? ''
  const requestedTo = params.get('to')?.trim() ?? ''
  const term = sanitizeSearchTerm(params.get('q'))
  for (const value of [requestedDate, requestedFrom, requestedTo]) {
    if (value && (!DATE_PATTERN.test(value) || !validDate(value))) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal tidak valid.')
  }
  const requestedDateValue = DATE_PATTERN.test(requestedDate) ? requestedDate : null
  const requestedFromValue = DATE_PATTERN.test(requestedFrom) ? requestedFrom : null
  const requestedToValue = DATE_PATTERN.test(requestedTo) ? requestedTo : null
  // Kompatibilitas: panggilan lama tanpa parameter apa pun tetap berarti "hari ini".
  // `scope=all`, rentang tanggal, atau pencarian membuka seluruh riwayat.
  const explicitAll = params.get('scope') === 'all'
    || term !== null
    || (requestedDateValue === null && (requestedFromValue !== null || requestedToValue !== null))
  const defaultDate = !explicitAll && requestedDateValue === null && requestedFromValue === null && requestedToValue === null
    ? wibDate(context.now)
    : null
  const date = requestedDateValue ?? defaultDate
  const from = date ?? requestedFromValue
  const to = date ?? requestedToValue

  const requestedPage = Number.parseInt(params.get('page') ?? '', 10)
  const requestedPageSize = Number.parseInt(params.get('pageSize') ?? '', 10)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0
    ? Math.min(requestedPageSize, 200)
    : 50

  if (from && !validDate(from) || to && !validDate(to) || from && to && from > to) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Rentang tanggal tidak valid.')
  }
  const filters: Record<string, unknown> = { from, to, q: term, page, pageSize }
  for (const key of ['product_code', 'batch', 'session', 'city', 'method', 'collector']) {
    filters[key] = params.get(key)?.trim() || null
  }
  if (filters.method && !OTS_METHODS.includes(filters.method as typeof OTS_METHODS[number])) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Metode bayar tidak valid.')
  }
  const result = await context.db.rpc<Record<string, unknown>>('ots_registrations_page', { p_actor: actor.id, p_filters: filters })
  return ok({ ...result, date, from, to })
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** GET /api/ots/report — laporan keuangan OTS per batch dan per sesi + kota. */
export async function otsFinanceReport(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.ots')
  const params = context.url.searchParams
  const from = (params.get('from') ?? '').trim()
  const to = (params.get('to') ?? '').trim()
  for (const value of [from, to]) {
    if (value && (!DATE_PATTERN.test(value) || !validDate(value))) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal tidak valid.')
    }
  }
  if (from && to && from > to) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Rentang tanggal tidak valid.')
  }
  const method = (params.get('method') ?? '').trim()
  if (method && !(OTS_METHODS as readonly string[]).includes(method)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Metode bayar tidak valid.')
  }
  const filters: Record<string, unknown> = {
    from: from || null,
    to: to || null,
    product_code: (params.get('product_code') ?? '').trim() || null,
    batch: (params.get('batch') ?? '').trim() || null,
    session: (params.get('session') ?? '').trim() || null,
    city: (params.get('city') ?? '').trim() || null,
    method: method || null,
    collector: (params.get('collector') ?? '').trim() || null,
  }
  const result = await context.db.rpc<Record<string, unknown>>('ots_finance_report', {
    p_actor: actor.id,
    p_filters: filters,
  })
  return ok({ ...result, from: from || null, to: to || null })
}

export async function otsDuplicates(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.ots')
  const args: Record<string, unknown> = { p_actor: actor.id }
  for (const key of ['phone', 'product_code', 'batch', 'session', 'city']) {
    const value = context.url.searchParams.get(key)?.trim()
    if (!value) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Lengkapi nomor HP dan acara.')
    args[`p_${key}`] = value
  }
  return ok(await context.db.rpc('ots_duplicate_candidates', args))
}

function wibDate(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
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

  // A74: sesi untuk pendaftaran BARU wajib aktif. Saat mengedit, sesi lama yang
  // tersimpan tetap boleh dipertahankan walau sesinya sudah dinonaktifkan, supaya
  // koreksi nama/No HP tidak gagal hanya karena perubahan status konfigurasi.
  if (session !== '') {
    const active = await context.db.selectRows<{ code: string }>(
      'sessions_config', { code: `eq.${normalizeCode(session)}`, active: 'is.true' }, 'code',
    )
    if (active.length === 0) {
      const stored = orderId === ''
        ? null
        : (await context.db.selectRows<{ session: string | null }>('orders', { order_id: `eq.${orderId}` }, 'session'))[0] ?? null
      const keepsStored = stored !== null && normalizeCode(stored.session ?? '') === normalizeCode(session)
      if (!keepsStored) {
        throw new ApiFailure('INVALID_ARGUMENT', undefined, `Sesi ${session.toUpperCase()} sudah dinonaktifkan. Pilih sesi yang masih aktif.`)
      }
    }
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
