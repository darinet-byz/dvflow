import { AD_SPEND_INPUT_PERMISSION, AD_SPEND_MANAGE_PERMISSION, normalizeBatch, roundMoney } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requireAnyPermission, requirePermission } from '../permissions'

/**
 * Report Spend Iklan (A37) — tulis saja. Laporan dibaca browser langsung lewat RPC `ad_spend_report`.
 *
 * Hanya akun Advertiser yang menginput, selalu untuk pengiklannya sendiri: pengiklan diambil dari
 * akun di database, tidak pernah dari body. Aturan & izin ditegakkan ulang di RPC (0048).
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SPEND = 9_999_999_999
const MAX_BATCH_LENGTH = 32

type SavedReport = {
  id: string
  action: 'created' | 'updated'
  product_code: string
  batch: string
  event_type: string
  date_from: string
  date_to: string
  spend: number | string
  tax_percent: number | string
}

/** Jenis acara yang dapat dipilih pada report spend; nilainya sama dengan orders.event_type. */
const AD_SPEND_EVENT_TYPES = ['Seminar Offline', 'Webinar Online', 'Hybrid'] as const

/** POST /api/ad-spend-reports — input spend baru. */
export async function createAdSpend(context: RouteContext): Promise<Response> {
  const result = await saveAdSpend(context, null)
  return ok(result, { status: 201 })
}

/** PATCH /api/ad-spend-reports/:id — edit report milik sendiri. */
export async function updateAdSpend(context: RouteContext): Promise<Response> {
  return ok(await saveAdSpend(context, reportId(context)))
}

/** DELETE /api/ad-spend-reports/:id — hapus report milik sendiri. */
export async function deleteAdSpend(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, AD_SPEND_INPUT_PERMISSION)
  const result = await context.db.rpc<{ id: string; deleted: boolean }>('delete_ad_spend_report', {
    p_actor: actor.id,
    p_id: reportId(context),
  })
  return ok(result)
}

type SavedCard = {
  action: 'created' | 'updated' | 'existing'
  id: string
  name: string
  status: 'berjalan' | 'selesai'
  spends: number
}

type SpendLineInput = {
  id: string | null
  date_from: string
  date_to: string
  spend: number
  tax_percent: number
}

const CARD_STATUSES = ['berjalan', 'selesai'] as const
const MAX_SPEND_LINES = 20
const MAX_CARD_NAME = 120

/** POST /api/ad-spend-cards — buat Card Report baru (hanya advertiser). */
export async function createAdSpendCard(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, AD_SPEND_INPUT_PERMISSION)
  const body = await readJsonObject(context.request)
  const productCode = (readString(body, 'product_code') ?? '').trim()
  const batch = normalizeBatch(readString(body, 'batch') ?? '')
  const eventType = (readString(body, 'event_type') ?? '').trim()
  const name = (readString(body, 'name') ?? '').trim()

  if (productCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih produk terlebih dahulu.')
  if (batch === '' || batch.length > MAX_BATCH_LENGTH) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Batch wajib diisi (maks 32 karakter).')
  if (!(AD_SPEND_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih jenis acara: Seminar Offline, Webinar Online, atau Hybrid.')
  }
  if (name.length > MAX_CARD_NAME) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama card maksimal 120 karakter.')
  const spends = readSpendLines(body)

  const result = await context.db.rpc<SavedCard>('save_ad_spend_card', {
    p_actor: actor.id,
    p_card_id: null,
    p_name: name === '' ? null : name,
    p_product_code: productCode,
    p_batch: batch,
    p_event_type: eventType,
    p_status: 'berjalan',
    p_spends: spends,
  })
  return ok(result, { status: result.action === 'created' ? 201 : 200 })
}

/** PATCH /api/ad-spend-cards/:id — ubah nama/status/baris budget milik card. */
export async function updateAdSpendCard(context: RouteContext): Promise<Response> {
  const actor = await requireAnyPermission(context, [AD_SPEND_INPUT_PERMISSION, AD_SPEND_MANAGE_PERMISSION])
  const body = await readJsonObject(context.request)
  const name = (readString(body, 'name') ?? '').trim()
  const status = (readString(body, 'status') ?? '').trim()
  if (name.length > MAX_CARD_NAME) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama card maksimal 120 karakter.')
  if (status !== '' && !(CARD_STATUSES as readonly string[]).includes(status)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Status card harus Berjalan atau Selesai.')
  }
  const spends = readSpendLines(body)

  const result = await context.db.rpc<SavedCard>('save_ad_spend_card', {
    p_actor: actor.id,
    p_card_id: cardId(context),
    p_name: name === '' ? null : name,
    // Scope card terkunci; produk/batch/jenis acara tidak pernah diambil dari body edit.
    p_product_code: null,
    p_batch: null,
    p_event_type: null,
    p_status: status === '' ? null : status,
    p_spends: spends,
  })
  return ok(result)
}

/** DELETE /api/ad-spend-cards/:id — hapus card beserta semua baris budget. */
export async function deleteAdSpendCard(context: RouteContext): Promise<Response> {
  const actor = await requireAnyPermission(context, [AD_SPEND_INPUT_PERMISSION, AD_SPEND_MANAGE_PERMISSION])
  const result = await context.db.rpc<{ id: string; deleted: boolean }>('delete_ad_spend_card', {
    p_actor: actor.id,
    p_card_id: cardId(context),
  })
  return ok(result)
}

async function saveAdSpend(context: RouteContext, id: string | null) {
  const actor = await requirePermission(context, AD_SPEND_INPUT_PERMISSION)
  const body = await readJsonObject(context.request)
  const productCode = (readString(body, 'product_code') ?? '').trim()
  const batch = normalizeBatch(readString(body, 'batch') ?? '')
  const eventType = (readString(body, 'event_type') ?? '').trim()
  const dateFrom = (readString(body, 'date_from') ?? '').trim()
  const dateTo = (readString(body, 'date_to') ?? '').trim()
  const spend = readNumber(body, 'spend')
  const taxPercent = readNumber(body, 'tax_percent')

  if (productCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih produk terlebih dahulu.')
  if (batch === '' || batch.length > MAX_BATCH_LENGTH) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Batch wajib diisi (maks 32 karakter).')
  if (!(AD_SPEND_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih jenis acara: Seminar Offline, Webinar Online, atau Hybrid.')
  }
  if (!isDate(dateFrom) || !isDate(dateTo)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal awal dan akhir wajib diisi.')
  if (dateTo < dateFrom) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal akhir tidak boleh sebelum tanggal awal.')
  if (spend === null || spend < 0 || spend > MAX_SPEND) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Biaya iklan harus berupa angka 0 atau lebih.')
  if (taxPercent === null || taxPercent < 0 || taxPercent > 100) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'PPN iklan harus berupa persen 0–100.')

  const result = await context.db.rpc<SavedReport>('save_ad_spend_report', {
    p_actor: actor.id,
    p_id: id,
    p_product_code: productCode,
    p_batch: batch,
    p_event_type: eventType,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_spend: roundMoney(spend),
    // Spend sebelum PPN; PPN dalam persen (11 = 11%), berbeda per akun iklan (A37).
    p_tax_percent: roundMoney(taxPercent),
    // "Tambahkan Data Ini": pengiklan sudah melihat notif rentang yang bertumpuk dan tetap menyimpan.
    p_confirm_overlap: body['confirm_overlap'] === true,
  })
  return { ...result, spend: Number(result.spend), tax_percent: Number(result.tax_percent) }
}

function reportId(context: RouteContext): string {
  const id = (context.params['id'] ?? '').trim()
  if (!UUID_PATTERN.test(id)) throw new ApiFailure('AD_SPEND_NOT_FOUND')
  return id
}

function cardId(context: RouteContext): string {
  const id = (context.params['id'] ?? '').trim()
  if (!UUID_PATTERN.test(id)) throw new ApiFailure('AD_SPEND_NOT_FOUND')
  return id
}

/**
 * Baris budget per card. Setiap baris punya tanggal, spend, dan PPN sendiri — tidak ada
 * satu nilai PPN yang dipakai ulang untuk baris lain.
 */
function readSpendLines(body: Record<string, unknown>): SpendLineInput[] {
  const raw = body['spends']
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SPEND_LINES) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Isi minimal 1 dan maksimal 20 baris budget.')
  }
  return raw.map((item, index) => {
    const number = index + 1
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, `Baris budget ${number} tidak valid.`)
    }
    const line = item as Record<string, unknown>
    const dateFrom = (readString(line, 'date_from') ?? '').trim()
    const dateTo = (readString(line, 'date_to') ?? '').trim()
    const spend = readNumber(line, 'spend')
    const taxPercent = readNumber(line, 'tax_percent')
    const rawId = (readString(line, 'id') ?? '').trim()
    if (!isDate(dateFrom) || !isDate(dateTo)) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, `Tanggal baris budget ${number} wajib diisi.`)
    }
    if (dateTo < dateFrom) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, `Tanggal akhir baris budget ${number} tidak boleh sebelum tanggal awal.`)
    }
    if (spend === null || spend < 0 || spend > MAX_SPEND) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, `Budget baris ${number} harus berupa angka 0 atau lebih.`)
    }
    if (taxPercent === null || taxPercent < 0 || taxPercent > 100) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, `PPN baris ${number} harus berupa persen 0–100.`)
    }
    if (rawId !== '' && !UUID_PATTERN.test(rawId)) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, `ID baris budget ${number} tidak valid.`)
    }
    return {
      id: rawId === '' ? null : rawId,
      date_from: dateFrom,
      date_to: dateTo,
      spend: roundMoney(spend),
      tax_percent: roundMoney(taxPercent),
    }
  })
}

function isDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
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
