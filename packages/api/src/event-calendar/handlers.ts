import { normalizeCode } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requirePermission } from '../permissions'

/**
 * Kalender Event (A79).
 *
 * Jadwal Seminar / Webinar / Workshop per produk. Field yang disimpan hanya
 * produk, jenis acara, tanggal, jam mulai, dan lokasi/platform. Tabel tertutup
 * untuk browser; baca dan tulis lewat Worker.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const CATEGORIES = ['Seminar', 'Webinar', 'Workshop'] as const
const MAX_LOCATION = 200
const MAX_CITY = 80
const MAX_RANGE_DAYS = 400

type EventRow = {
  id: string
  product_code: string
  category: string
  event_date: string
  start_time: string
  location: string
  city: string | null
  source: string
  ai_draft_id: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

type ProductRow = { code: string; name: string }

/** GET /api/event-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function listEventCalendar(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'operasional.event_calendar')
  const params = context.url.searchParams
  const from = (params.get('from') ?? '').trim()
  const to = (params.get('to') ?? '').trim()

  if (from !== '' && !isDate(from)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal awal tidak valid.')
  if (to !== '' && !isDate(to)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal akhir tidak valid.')
  if (from !== '' && to !== '' && from > to) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Rentang tanggal tidak valid.')
  }
  if (from !== '' && to !== '' && daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Rentang tanggal terlalu panjang.')
  }

  const query: Record<string, string> = {
    order: 'event_date.asc,start_time.asc',
    limit: '1000',
  }
  if (from !== '' && to !== '') query['and'] = `(event_date.gte.${from},event_date.lte.${to})`
  else if (from !== '') query['event_date'] = `gte.${from}`
  else if (to !== '') query['event_date'] = `lte.${to}`

  const [rows, products] = await Promise.all([
    context.db.selectRows<EventRow>(
      'event_calendar',
      query,
      'id,product_code,category,event_date,start_time,location,city,source,ai_draft_id,created_by,updated_by,created_at,updated_at',
    ),
    context.db.selectRows<ProductRow>('products', { active: 'is.true', order: 'code.asc' }, 'code,name'),
  ])

  const productNames = new Map(products.map((product) => [product.code.toUpperCase(), product.name]))
  return ok({
    events: rows.map((row) => ({
      ...row,
      product_name: productNames.get(row.product_code.toUpperCase()) ?? row.product_code,
    })),
    products,
  })
}

/** POST /api/event-calendar */
export async function createEventCalendar(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.manage_event_calendar')
  const input = await readEventInput(context)
  const created = await context.db.insertRow<EventRow>(
    'event_calendar',
    {
      product_code: input.productCode,
      category: input.category,
      event_date: input.eventDate,
      start_time: input.startTime,
      location: input.location,
      city: input.city,
      source: 'manual',
      created_by: actor.id,
      updated_by: actor.id,
    },
    '*',
  )
  return ok({ event: { ...created, product_name: input.productName } }, { status: 201 })
}

/** PATCH /api/event-calendar/:id */
export async function updateEventCalendar(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'action.manage_event_calendar')
  const id = eventId(context)
  const input = await readEventInput(context)
  await assertEventExists(context, id)
  await context.db.updateRows(
    'event_calendar',
    { id: `eq.${id}` },
    {
      product_code: input.productCode,
      category: input.category,
      event_date: input.eventDate,
      start_time: input.startTime,
      location: input.location,
      city: input.city,
      updated_by: context.claims?.sub ?? null,
    },
  )
  return ok({ id, updated: true })
}

/** DELETE /api/event-calendar/:id */
export async function deleteEventCalendar(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'action.manage_event_calendar')
  const id = eventId(context)
  await assertEventExists(context, id)
  await context.db.deleteRows('event_calendar', { id: `eq.${id}` })
  return ok({ id, deleted: true })
}

async function readEventInput(context: RouteContext): Promise<{
  productCode: string
  productName: string
  category: string
  eventDate: string
  startTime: string
  location: string
  city: string | null
}> {
  const body = await readJsonObject(context.request)
  const productCode = (readString(body, 'product_code') ?? '').trim()
  const category = (readString(body, 'category') ?? '').trim()
  const eventDate = (readString(body, 'event_date') ?? '').trim()
  const startTime = (readString(body, 'start_time') ?? '').trim()
  const location = (readString(body, 'location') ?? '').trim()
  const cityRaw = (readString(body, 'city') ?? '').trim()

  if (productCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih produk terlebih dahulu.')
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Jenis acara harus Seminar, Webinar, atau Workshop.')
  }
  if (!isDate(eventDate)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal event tidak valid.')
  if (!TIME_PATTERN.test(startTime)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Jam mulai tidak valid.')
  if (location === '' || location.length > MAX_LOCATION) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Lokasi/platform wajib diisi (maks 200 karakter).')
  }
  if (cityRaw.length > MAX_CITY) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Kota terlalu panjang (maks 80 karakter).')
  }

  const code = normalizeCode(productCode) ?? ''
  const products = await context.db.selectRows<ProductRow>('products', { code: `eq.${code}` }, 'code,name')
  const product = products[0]
  if (product === undefined) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Produk tidak dikenal.')

  return {
    productCode: product.code,
    productName: product.name,
    category,
    eventDate,
    // Simpan "HH:MM" agar konsisten dengan input jam di browser.
    startTime: startTime.slice(0, 5),
    location,
    city: cityRaw === '' ? null : cityRaw,
  }
}

async function assertEventExists(context: RouteContext, id: string): Promise<void> {
  const rows = await context.db.selectRows<{ id: string }>('event_calendar', { id: `eq.${id}` }, 'id')
  if (rows.length === 0) throw new ApiFailure('RESOURCE_NOT_FOUND')
}

function eventId(context: RouteContext): string {
  const id = (context.params['id'] ?? '').trim()
  if (!UUID_PATTERN.test(id)) throw new ApiFailure('RESOURCE_NOT_FOUND')
  return id
}

function isDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}
