import { normalizeBatch, normalizeCode } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import { assertProductAccess, productAccess, requirePermission } from '../permissions'
import type { RouteContext } from '../router'
import type { UserRow } from '../users'

/**
 * A80: Kalender Iklan.
 *
 * Satu baris = satu deadline untuk satu batch per pengiklan. Event hanya
 * menjadi konteks/prefill; tanggal tayang dihitung database dari order/lead
 * pertama atau report spend pertama. Tabel tertutup untuk browser.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_BATCH = 32
const MAX_RANGE_DAYS = 400

type EventRow = {
  id: string
  product_code: string
  category: string
  event_date: string
  start_time: string
  location: string
}

type AdvertiserRow = { id: string; code: string; name: string }
type AdCalendarRow = { id: string }
type AdCalendarRecord = {
  id: string
  event_id: string | null
  advertiser_id: string | null
  product_code: string
  batch: string
  deadline_date: string
}

/** GET /api/ad-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function listAdCalendar(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.event_calendar')
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

  const page = await context.db.rpc<Record<string, unknown>>('ad_calendar_page', {
    p_actor: actor.id,
    p_from: from === '' ? null : from,
    p_to: to === '' ? null : to,
  })
  return ok(page)
}

/** POST /api/ad-calendar — satu baris deadline per pengiklan yang dipilih. */
export async function createAdCalendar(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.manage_ad_calendar')
  const input = await readAdCalendarInput(context, actor)

  const existing = await context.db.selectRows<{ id: string; advertiser_id: string }>(
    'ad_calendar',
    {
      product_code: `eq.${input.event.product_code}`,
      batch: `eq.${input.batch}`,
      advertiser_id: `in.(${input.advertisers.map((advertiser) => `"${advertiser.id}"`).join(',')})`,
    },
    'id,advertiser_id',
  )
  const existingIds = new Set(existing.map((row) => row.advertiser_id))
  const created: Array<Record<string, unknown>> = []
  const skipped: string[] = []

  for (const advertiser of input.advertisers) {
    if (existingIds.has(advertiser.id)) {
      skipped.push(advertiser.code)
      continue
    }
    const row = await context.db.insertRow<AdCalendarRow>(
      'ad_calendar',
      {
        event_id: input.event.id,
        advertiser_id: advertiser.id,
        product_code: input.event.product_code,
        batch: input.batch,
        deadline_date: input.deadlineDate,
        source: 'manual',
        created_by: actor.id,
        updated_by: actor.id,
      },
      'id',
    )
    created.push({
      ...row,
      product_code: input.event.product_code,
      product_name: input.event.product_code,
      advertiser_code: advertiser.code,
      advertiser_name: advertiser.name,
      batch: input.batch,
      deadline_date: input.deadlineDate,
    })
  }

  if (created.length === 0) throw new ApiFailure('AD_CALENDAR_EXISTS')
  return ok({ calendars: created, skipped }, { status: 201 })
}

/**
 * PATCH /api/ad-calendar/:id — edit satu deadline.
 *
 * A93: bila client mengirim `advertiser_codes[]`, edit berlaku untuk seluruh
 * pengiklan dalam deadline yang sama (event + produk + batch + tanggal):
 * pengiklan yang tetap dicentang diperbarui, pengiklan baru dibuatkan baris,
 * pengiklan yang dicabut centangnya dihapus. `advertiser_code` tunggal (client
 * lama) hanya menyentuh baris ini agar tidak menghapus pengiklan lain.
 */
export async function updateAdCalendar(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.manage_ad_calendar')
  const id = calendarId(context)
  const input = await readAdCalendarInput(context, actor)

  const currentRows = await context.db.selectRows<AdCalendarRecord>(
    'ad_calendar',
    { id: `eq.${id}` },
    'id,event_id,advertiser_id,product_code,batch,deadline_date',
  )
  const current = currentRows[0]
  if (current === undefined) throw new ApiFailure('RESOURCE_NOT_FOUND')

  const group = input.codeList ? await loadDeadlineGroup(context, current) : [current]
  const groupIds = new Set(group.map((row) => row.id))
  const activeIds = await activeAdvertiserIds(context, group)
  const targetIds = input.advertisers.map((advertiser) => advertiser.id)

  const duplicates = await context.db.selectRows<AdCalendarRow>(
    'ad_calendar',
    {
      product_code: `eq.${input.event.product_code}`,
      batch: `eq.${input.batch}`,
      advertiser_id: `in.(${targetIds.map((advertiserId) => `"${advertiserId}"`).join(',')})`,
    },
    'id',
  )
  if (duplicates.some((row) => !groupIds.has(row.id))) throw new ApiFailure('AD_CALENDAR_EXISTS')

  // Baris yang sedang diedit didahulukan supaya id-nya tetap bila pengiklannya
  // masih dipilih; baris tanpa pengiklan (deadline otomatis) dipakai ulang.
  const ordered = [...input.advertisers].sort((left, right) => {
    if (left.id === current.advertiser_id) return -1
    if (right.id === current.advertiser_id) return 1
    return 0
  })
  const byAdvertiser = new Map<string, AdCalendarRecord>()
  const unassigned: AdCalendarRecord[] = []
  for (const row of group) {
    // Deadline milik pengiklan nonaktif dibiarkan apa adanya: pengiklan itu
    // tidak muncul di daftar centang, jadi edit tidak boleh menghapusnya diam-diam.
    // Baris yang sedang diedit tetap boleh diperbarui.
    if (row.id !== current.id && row.advertiser_id !== null && !activeIds.has(row.advertiser_id)) continue
    if (row.advertiser_id === null) unassigned.push(row)
    else byAdvertiser.set(row.advertiser_id, row)
  }

  const patch = {
    event_id: input.event.id,
    product_code: input.event.product_code,
    batch: input.batch,
    deadline_date: input.deadlineDate,
    source: 'manual',
    updated_by: context.claims?.sub ?? null,
  }

  let reusableIndex = 0
  for (const advertiser of ordered) {
    const existing = byAdvertiser.get(advertiser.id)
    if (existing !== undefined) {
      byAdvertiser.delete(advertiser.id)
      await context.db.updateRows('ad_calendar', { id: `eq.${existing.id}` }, { ...patch, advertiser_id: advertiser.id })
      continue
    }
    const reusable = unassigned[reusableIndex]
    if (reusable !== undefined) {
      reusableIndex += 1
      await context.db.updateRows('ad_calendar', { id: `eq.${reusable.id}` }, { ...patch, advertiser_id: advertiser.id })
      continue
    }
    await context.db.insertRow(
      'ad_calendar',
      {
        event_id: input.event.id,
        advertiser_id: advertiser.id,
        product_code: input.event.product_code,
        batch: input.batch,
        deadline_date: input.deadlineDate,
        source: 'manual',
        created_by: actor.id,
        updated_by: actor.id,
      },
      'id',
    )
  }

  // Pengiklan yang dicabut centangnya tidak lagi punya deadline pada scope ini.
  for (const row of [...byAdvertiser.values(), ...unassigned.slice(reusableIndex)]) {
    await context.db.deleteRows('ad_calendar', { id: `eq.${row.id}` })
  }

  return ok({ id, updated: true, advertiser_codes: ordered.map((advertiser) => advertiser.code) })
}

/** Baris-baris deadline yang mewakili satu deadline: event + produk + batch + tanggal. */
async function loadDeadlineGroup(context: RouteContext, current: AdCalendarRecord): Promise<AdCalendarRecord[]> {
  return context.db.selectRows<AdCalendarRecord>(
    'ad_calendar',
    {
      event_id: current.event_id === null ? 'is.null' : `eq.${current.event_id}`,
      product_code: `eq.${current.product_code}`,
      batch: `eq.${current.batch}`,
      deadline_date: `eq.${current.deadline_date}`,
    },
    'id,event_id,advertiser_id,product_code,batch,deadline_date',
  )
}

async function activeAdvertiserIds(context: RouteContext, rows: AdCalendarRecord[]): Promise<Set<string>> {
  const ids = [...new Set(rows.map((row) => row.advertiser_id).filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Set()
  const active = await context.db.selectRows<{ id: string }>(
    'advertisers',
    { id: `in.(${ids.map((id) => `"${id}"`).join(',')})`, active: 'is.true' },
    'id',
  )
  return new Set(active.map((row) => row.id))
}

/** DELETE /api/ad-calendar/:id */
export async function deleteAdCalendar(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'action.manage_ad_calendar')
  const id = calendarId(context)
  await assertCalendarExists(context, id)
  await context.db.deleteRows('ad_calendar', { id: `eq.${id}` })
  return ok({ id, deleted: true })
}

async function readAdCalendarInput(context: RouteContext, actor: UserRow): Promise<{
  event: EventRow
  advertisers: AdvertiserRow[]
  batch: string
  deadlineDate: string
  /** True bila body memakai `advertiser_codes[]` (A93), bukan `advertiser_code` tunggal. */
  codeList: boolean
}> {
  const body = await readJsonObject(context.request)
  const eventId = (readString(body, 'event_id') ?? '').trim()
  const advertiserCodes = readAdvertiserCodes(body)
  const codeList = body['advertiser_codes'] !== undefined
  const batchRaw = (readString(body, 'batch') ?? '').trim()
  const deadlineDate = (readString(body, 'deadline_date') ?? '').trim()

  if (!UUID_PATTERN.test(eventId)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih event dari Kalender Event.')
  }
  if (!isDate(deadlineDate)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal deadline tidak valid.')

  const batch = normalizeBatch(batchRaw)
  if (batch === '' || batch.length > MAX_BATCH) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Batch wajib diisi (maks 32 karakter).')
  }

  const [events, advertisers] = await Promise.all([
    context.db.selectRows<EventRow>(
      'event_calendar',
      { id: `eq.${eventId}` },
      'id,product_code,category,event_date,start_time,location',
    ),
    context.db.selectRows<AdvertiserRow>(
      'advertisers',
      {
        code: `in.(${advertiserCodes.map((code) => `"${code}"`).join(',')})`,
        active: 'is.true',
      },
      'id,code,name',
    ),
  ])
  const event = events[0]
  if (event === undefined) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Event tidak dikenal.')

  const byCode = new Map(advertisers.map((row) => [normalizeCode(row.code), row]))
  const resolved: AdvertiserRow[] = []
  for (const code of advertiserCodes) {
    const advertiser = byCode.get(code)
    if (advertiser === undefined) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pengiklan tidak dikenal atau nonaktif.')
    }
    resolved.push(advertiser)
  }

  assertProductAccess(await productAccess(context, actor), event.product_code)

  return { event, advertisers: resolved, batch, deadlineDate, codeList }
}

/** Satu deadline boleh dibuat untuk beberapa pengiklan sekaligus (maks 50). */
const MAX_ADVERTISERS = 50

function readAdvertiserCodes(body: Record<string, unknown>): string[] {
  const raw = body['advertiser_codes']
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih minimal satu pengiklan.')
    }
    if (raw.length === 0 || raw.length > MAX_ADVERTISERS) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih minimal 1 dan maksimal 50 pengiklan.')
    }
    const codes: string[] = []
    for (const item of raw) {
      const value = typeof item === 'string' ? item.trim() : ''
      const code = value === '' ? null : normalizeCode(value)
      if (code === null) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Kode pengiklan tidak valid.')
      codes.push(code)
    }
    return [...new Set(codes)]
  }

  const single = (readString(body, 'advertiser_code') ?? '').trim()
  const code = single === '' ? null : normalizeCode(single)
  if (code === null) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih pengiklan.')
  return [code]
}

async function assertCalendarExists(context: RouteContext, id: string): Promise<void> {
  const rows = await context.db.selectRows<AdCalendarRow>('ad_calendar', { id: `eq.${id}` }, 'id')
  if (rows.length === 0) throw new ApiFailure('RESOURCE_NOT_FOUND')
}

function calendarId(context: RouteContext): string {
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
