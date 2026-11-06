import { normalizeBatch } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requirePermission } from '../permissions'

/**
 * Advertiser Notes — tulis lewat Worker, baca lewat RPC service_role.
 *
 * Satu note selalu terikat ke satu pengiklan + satu produk + batch opsional.
 * Ringkasan order/report spend dihitung live oleh RPC; tabel ini tidak menyimpan
 * salinan data operasional.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const NOTE_STATUSES = ['Draft', 'Aktif', 'Selesai', 'Dibatalkan'] as const
const MAX_TITLE = 200
const MAX_DESCRIPTION = 4000
const MAX_LOCATION = 200
const MAX_BATCH = 32

/** GET /api/advertiser-notes — daftar note + ringkasan aktivitas. */
export async function listAdvertiserNotes(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.advertiser_notes')
  const params = context.url.searchParams
  const batch = normalizeBatch(params.get('batch') ?? '')
  const filters = {
    q: (params.get('q') ?? '').trim(),
    status: (params.get('status') ?? '').trim(),
    advertiser_code: (params.get('advertiser_code') ?? '').trim() || null,
    product_code: (params.get('product_code') ?? '').trim() || null,
    batch: batch === '' ? null : batch,
    deadline_from: (params.get('deadline_from') ?? '').trim() || null,
    deadline_to: (params.get('deadline_to') ?? '').trim() || null,
    page: Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1),
    pageSize: Math.min(200, Math.max(1, Number.parseInt(params.get('pageSize') ?? '50', 10) || 50)),
  }
  if (filters.deadline_from !== null && !isDate(filters.deadline_from)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal deadline awal tidak valid.')
  }
  if (filters.deadline_to !== null && !isDate(filters.deadline_to)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal deadline akhir tidak valid.')
  }
  if (filters.deadline_from !== null && filters.deadline_to !== null && filters.deadline_from > filters.deadline_to) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Rentang deadline tidak valid.')
  }
  const result = await context.db.rpc<Record<string, unknown>>('advertiser_notes_page', {
    p_actor: actor.id,
    p_filters: filters,
  })
  return ok(result)
}

/** POST /api/advertiser-notes — buat note baru. */
export async function createAdvertiserNote(context: RouteContext): Promise<Response> {
  const result = await saveAdvertiserNote(context, null)
  return ok(result, { status: 201 })
}

/** PATCH /api/advertiser-notes/:id — edit note. */
export async function updateAdvertiserNote(context: RouteContext): Promise<Response> {
  return ok(await saveAdvertiserNote(context, noteId(context)))
}

/** DELETE /api/advertiser-notes/:id — arsipkan note (soft delete). */
export async function archiveAdvertiserNote(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.manage_advertiser_notes')
  const result = await context.db.rpc<Record<string, unknown>>('archive_advertiser_note', {
    p_actor: actor.id,
    p_id: noteId(context),
  })
  return ok(result)
}

async function saveAdvertiserNote(context: RouteContext, id: string | null) {
  const actor = await requirePermission(context, 'action.manage_advertiser_notes')
  const body = await readJsonObject(context.request)
  const advertiserCode = (readString(body, 'advertiser_code') ?? '').trim()
  const productCode = (readString(body, 'product_code') ?? '').trim()
  const batch = normalizeBatch(readString(body, 'batch') ?? '')
  const title = (readString(body, 'title') ?? '').trim()
  const description = (readString(body, 'description') ?? '').trim()
  const eventAt = readTimestamp(body['event_at'])
  const location = (readString(body, 'location') ?? '').trim()
  const monitorFrom = (readString(body, 'monitor_from') ?? '').trim()
  const deadlineAt = readTimestamp(body['deadline_at'])
  const status = (readString(body, 'status') ?? 'Aktif').trim()

  if (advertiserCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih pengiklan terlebih dahulu.')
  if (productCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih produk terlebih dahulu.')
  if (batch !== '' && batch.length > MAX_BATCH) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Batch terlalu panjang (maks 32 karakter).')
  }
  if (title === '' || title.length > MAX_TITLE) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Judul wajib diisi (maks 200 karakter).')
  }
  if (description.length > MAX_DESCRIPTION) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Deskripsi terlalu panjang (maks 4.000 karakter).')
  }
  if (location.length > MAX_LOCATION) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Lokasi terlalu panjang (maks 200 karakter).')
  }
  if (eventAt === null) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal event wajib diisi.')
  if (deadlineAt === null) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Deadline iklan wajib diisi.')
  if (!(NOTE_STATUSES as readonly string[]).includes(status)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Status note tidak valid.')
  }
  if (monitorFrom !== '' && !isDate(monitorFrom)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal mulai pantau tidak valid.')
  }
  if (monitorFrom !== '' && wibDate(deadlineAt) < monitorFrom) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Deadline tidak boleh sebelum tanggal mulai pantau.')
  }

  const result = await context.db.rpc<Record<string, unknown>>('save_advertiser_note', {
    p_actor: actor.id,
    p_id: id,
    p_advertiser_code: advertiserCode,
    p_product_code: productCode,
    p_batch: batch === '' ? null : batch,
    p_title: title,
    p_description: description === '' ? null : description,
    p_event_at: eventAt,
    p_location: location === '' ? null : location,
    p_monitor_from: monitorFrom === '' ? null : monitorFrom,
    p_deadline_at: deadlineAt,
    p_status: status,
  })
  return result
}

function noteId(context: RouteContext): string {
  const id = (context.params['id'] ?? '').trim()
  if (!UUID_PATTERN.test(id)) throw new ApiFailure('ADVERTISER_NOTE_NOT_FOUND')
  return id
}

function isDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** Tanggal kalender WIB dari timestamp ISO; dipakai untuk validasi rentang. */
function wibDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(iso))
}
