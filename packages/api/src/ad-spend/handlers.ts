import { AD_SPEND_INPUT_PERMISSION, normalizeBatch, roundMoney } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requirePermission } from '../permissions'

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
  date_from: string
  date_to: string
  spend: number | string
  tax_percent: number | string
}

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

async function saveAdSpend(context: RouteContext, id: string | null) {
  const actor = await requirePermission(context, AD_SPEND_INPUT_PERMISSION)
  const body = await readJsonObject(context.request)
  const productCode = (readString(body, 'product_code') ?? '').trim()
  const batch = normalizeBatch(readString(body, 'batch') ?? '')
  const dateFrom = (readString(body, 'date_from') ?? '').trim()
  const dateTo = (readString(body, 'date_to') ?? '').trim()
  const spend = readNumber(body, 'spend')
  const taxPercent = readNumber(body, 'tax_percent')

  if (productCode === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih produk terlebih dahulu.')
  if (batch === '' || batch.length > MAX_BATCH_LENGTH) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Batch wajib diisi (maks 32 karakter).')
  if (!isDate(dateFrom) || !isDate(dateTo)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal awal dan akhir wajib diisi.')
  if (dateTo < dateFrom) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal akhir tidak boleh sebelum tanggal awal.')
  if (spend === null || spend < 0 || spend > MAX_SPEND) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Biaya iklan harus berupa angka 0 atau lebih.')
  if (taxPercent === null || taxPercent < 0 || taxPercent > 100) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'PPN iklan harus berupa persen 0–100.')

  const result = await context.db.rpc<SavedReport>('save_ad_spend_report', {
    p_actor: actor.id,
    p_id: id,
    p_product_code: productCode,
    p_batch: batch,
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
