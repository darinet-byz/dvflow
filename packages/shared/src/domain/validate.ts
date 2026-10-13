/**
 * Validator input tak terpercaya.
 *
 * Webhook adalah input paling tidak terpercaya di sistem ini (04 §10): divalidasi
 * sebelum pernah menyentuh database. Validasi ditulis eksplisit tanpa library
 * supaya perilakunya jelas dan tidak ada dependensi tambahan.
 */

import { MAX_TEXT_LENGTH, PASSWORD_MIN_LENGTH } from './constants'
import { roundMoney } from './tax'
import { isValidCodeFormat, toTrimmedOrNull } from './text'
import type { CanonicalOrderWebhook } from '../types'

export const INVALID_PAYLOAD = 'INVALID_PAYLOAD'

export type ValidationFailure = {
  ok: false
  code: typeof INVALID_PAYLOAD
  message: string
}

export type CanonicalValidationResult =
  | { ok: true; value: CanonicalOrderWebhook }
  | ValidationFailure

function fail(message: string): ValidationFailure {
  return { ok: false, code: INVALID_PAYLOAD, message }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequiredText(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
  label: string,
): { ok: true; value: string } | ValidationFailure {
  const raw = input[key]
  if (typeof raw !== 'string') return fail(`${label} wajib diisi.`)
  const trimmed = raw.trim()
  if (trimmed.length === 0) return fail(`${label} wajib diisi.`)
  if (trimmed.length > maxLength) return fail(`${label} terlalu panjang.`)
  return { ok: true, value: trimmed }
}

function readOptionalText(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
  label: string,
): { ok: true; value: string | null } | ValidationFailure {
  const raw = input[key]
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return fail(`${label} harus berupa teks.`)
  const trimmed = toTrimmedOrNull(raw)
  if (trimmed === null) return { ok: true, value: null }
  if (trimmed.length > maxLength) return fail(`${label} terlalu panjang.`)
  return { ok: true, value: trimmed }
}

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/**
 * Timestamp sumber harus ISO-8601 UTC/offset.
 *
 * Adapter bertanggung jawab menormalkan format provider ke ISO-8601; menolak di
 * sini lebih baik daripada meneruskan nilai yang nanti gagal saat cast ke
 * TIMESTAMPTZ di PostgreSQL.
 */
function readOptionalTimestamp(
  input: Record<string, unknown>,
  key: string,
  label: string,
): { ok: true; value: string | null } | ValidationFailure {
  const raw = input[key]
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return fail(`${label} harus berupa teks.`)
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (!ISO_TIMESTAMP_PATTERN.test(trimmed) || Number.isNaN(Date.parse(trimmed))) {
    return fail(`${label} harus berformat ISO-8601.`)
  }
  return { ok: true, value: trimmed }
}

/**
 * Validasi objek kanonik webhook (03-WORKER-API-CONTRACT §3 langkah 4).
 *
 * Field wajib: orderId, rawStatus, grossAmount.
 * Field lain opsional dan boleh null.
 */
export function validateCanonicalOrderWebhook(input: unknown): CanonicalValidationResult {
  if (!isPlainObject(input)) return fail('Payload webhook tidak valid.')

  const orderId = readRequiredText(input, 'orderId', MAX_TEXT_LENGTH.orderId, 'Order ID')
  if (!orderId.ok) return orderId
  if (/\s/.test(orderId.value)) return fail('Order ID tidak boleh mengandung spasi.')

  const rawStatus = readRequiredText(input, 'rawStatus', MAX_TEXT_LENGTH.rawStatus, 'Status order')
  if (!rawStatus.ok) return rawStatus

  const grossRaw = input['grossAmount']
  if (typeof grossRaw !== 'number' || !Number.isFinite(grossRaw)) {
    return fail('Jumlah gross tidak valid.')
  }
  if (grossRaw < 0) return fail('Jumlah gross tidak boleh negatif.')

  const customerName = readOptionalText(input, 'customerName', MAX_TEXT_LENGTH.name, 'Nama')
  if (!customerName.ok) return customerName

  const phone = readOptionalText(input, 'phone', MAX_TEXT_LENGTH.phone, 'Nomor WA')
  if (!phone.ok) return phone

  const email = readOptionalText(input, 'email', MAX_TEXT_LENGTH.email, 'Email')
  if (!email.ok) return email

  const productRaw = readOptionalText(input, 'productRaw', MAX_TEXT_LENGTH.productRaw, 'Product raw')
  if (!productRaw.ok) return productRaw

  const paymentMethod = readOptionalText(input, 'paymentMethod', MAX_TEXT_LENGTH.paymentMethod, 'Payment method')
  if (!paymentMethod.ok) return paymentMethod

  const paymentProvider = readOptionalText(
    input,
    'paymentProvider',
    MAX_TEXT_LENGTH.paymentProvider,
    'Payment provider',
  )
  if (!paymentProvider.ok) return paymentProvider

  const paymentIdentifier = readOptionalText(
    input,
    'paymentIdentifier',
    MAX_TEXT_LENGTH.paymentIdentifier,
    'Payment identifier',
  )
  if (!paymentIdentifier.ok) return paymentIdentifier

  const sourceCreatedAt = readOptionalTimestamp(input, 'sourceCreatedAt', 'Waktu dibuat sumber')
  if (!sourceCreatedAt.ok) return sourceCreatedAt

  const sourceUpdatedAt = readOptionalTimestamp(input, 'sourceUpdatedAt', 'Waktu diubah sumber')
  if (!sourceUpdatedAt.ok) return sourceUpdatedAt

  return {
    ok: true,
    value: {
      orderId: orderId.value,
      customerName: customerName.value,
      phone: phone.value,
      email: email.value,
      productRaw: productRaw.value,
      rawStatus: rawStatus.value,
      paymentMethod: paymentMethod.value,
      paymentProvider: paymentProvider.value,
      paymentIdentifier: paymentIdentifier.value,
      grossAmount: roundMoney(grossRaw),
      sourceCreatedAt: sourceCreatedAt.value,
      sourceUpdatedAt: sourceUpdatedAt.value,
    },
  }
}

export type PasswordChangeInput = {
  currentPassword: string
  newPassword: string
}

/**
 * Validasi ganti password (01-IMPLEMENTATION-DECISIONS §4).
 *
 * Tanpa aturan kompleksitas tambahan: cukup minimal 8 karakter dan konfirmasi sama.
 */
export function validatePasswordChangeInput(
  input: unknown,
): { ok: true; value: PasswordChangeInput } | ValidationFailure {
  if (!isPlainObject(input)) return fail('Data tidak valid.')

  const current = toTrimmedOrNull(input['current_password'])
  if (current === null) return fail('Password saat ini wajib diisi.')

  const next = input['new_password']
  if (typeof next !== 'string' || next.length === 0) return fail('Password baru wajib diisi.')
  if (next.length < PASSWORD_MIN_LENGTH) {
    return fail(`Password baru minimal ${PASSWORD_MIN_LENGTH} karakter.`)
  }

  const confirmation = input['new_password_confirmation']
  if (typeof confirmation !== 'string' || confirmation.length === 0) {
    return fail('Konfirmasi password wajib diisi.')
  }
  if (confirmation !== next) return fail('Konfirmasi password tidak sama.')

  if (next === current) return fail('Password baru harus berbeda dari password saat ini.')

  return { ok: true, value: { currentPassword: current, newPassword: next } }
}

/**
 * Validasi kode konfigurasi baru.
 *
 * Kode tanpa spasi dan tanpa tanda hubung: prasyarat determinisme parser dan
 * pemisah ` - ` pada product_raw (01-IMPLEMENTATION-DECISIONS §10).
 */
export function validateConfigCode(
  value: unknown,
  label: string,
): { ok: true; value: string } | ValidationFailure {
  const code = toTrimmedOrNull(value)
  if (code === null) return fail(`${label} wajib diisi.`)
  if (!isValidCodeFormat(code)) {
    return fail(`${label} hanya boleh huruf dan angka, tanpa spasi atau tanda hubung.`)
  }
  return { ok: true, value: code }
}
