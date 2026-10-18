import { normalizeMasterCode, MASTER_CODE_RULES, type MasterCodeResource } from './config-code'
/**
 * Pembentuk canonical product name (PRD §54, 01-IMPLEMENTATION-DECISIONS §10).
 *
 *   [PRODUCT_CODE][ADVERTISER_CODE][TYPE_CODE][BATCH] - [SESSION_CODE] - [CITY]
 *
 * contoh: KM01SO392 - S1 - Solo
 *
 * Kontrak penting: nama yang dihasilkan builder ini HARUS selalu bisa diparse
 * kembali oleh product-parser. Karena itu batch dan city yang mengandung pemisah
 * ` - ` ditolak, dan city di-trim sebelum dipakai.
 */

import { isValidCodeFormat, toTrimmedOrNull, normalizeBatch } from './text'

/** Pemisah segmen kanonik. Harus persis ini (01 §10). */
export const PRODUCT_SEGMENT_SEPARATOR = ' - '

export type ProductNameInput = {
  productCode: string
  advertiserCode: string
  typeCode: string
  batch: string
  sessionCode: string
  city: string
}

export type ProductNameField = keyof ProductNameInput

export type ProductNameValidation =
  | { ok: true; value: string }
  | { ok: false; errors: Partial<Record<ProductNameField, string>> }

export class InvalidProductNameError extends Error {
  constructor(readonly errors: Partial<Record<ProductNameField, string>>) {
    super('Input product name tidak valid')
    this.name = 'InvalidProductNameError'
  }
}

function validateCodeField(
  field: ProductNameField,
  raw: unknown,
  label: string,
  errors: Partial<Record<ProductNameField, string>>,
): string | null {
  const value = toTrimmedOrNull(raw)
  if (value === null) {
    errors[field] = `${label} wajib dipilih.`
    return null
  }
  if (!isValidCodeFormat(value)) {
    errors[field] = `${label} hanya boleh huruf dan angka, tanpa spasi.`
    return null
  }
  return value
}

function validateTextSegment(
  field: ProductNameField,
  raw: unknown,
  label: string,
  errors: Partial<Record<ProductNameField, string>>,
): string | null {
  const value = toTrimmedOrNull(raw)
  if (value === null) {
    errors[field] = `${label} wajib diisi.`
    return null
  }
  if (value.includes(PRODUCT_SEGMENT_SEPARATOR)) {
    errors[field] = `${label} tidak boleh mengandung "${PRODUCT_SEGMENT_SEPARATOR.trim()}".`
    return null
  }
  return value
}

/**
 * Validasi input generator. Tidak pernah menghasilkan kode yang salah:
 * kalau ada field bermasalah, hasilnya daftar error per field dan tanpa nilai.
 */
export function validateProductNameInput(input: Partial<Record<ProductNameField, unknown>>, options: { strictCodes?: boolean } = {}): ProductNameValidation {
  const errors: Partial<Record<ProductNameField, string>> = {}
  if (options.strictCodes) {
    const fields: Array<[ProductNameField, MasterCodeResource]> = [['productCode','products'],['advertiserCode','advertisers'],['typeCode','event-types'],['sessionCode','sessions']]
    input = { ...input }
    for (const [field,resource] of fields) {
      const normalized = typeof input[field] === 'string' ? normalizeMasterCode(resource,input[field] as string) : null
      if (normalized === null) errors[field] = MASTER_CODE_RULES[resource].message
      else input[field] = normalized
    }
  }

  const productCode = validateCodeField('productCode', input.productCode, 'Produk', errors)
  const advertiserCode = validateCodeField('advertiserCode', input.advertiserCode, 'Pengiklan', errors)
  const typeCode = validateCodeField('typeCode', input.typeCode, 'Event Type', errors)
  const sessionCode = validateCodeField('sessionCode', input.sessionCode, 'Sesi', errors)
  const batch = validateTextSegment('batch', input.batch, 'Batch', errors)
  const city = validateTextSegment('city', input.city, 'Kota', errors)

  if (
    Object.keys(errors).length > 0 ||
    productCode === null ||
    advertiserCode === null ||
    typeCode === null ||
    sessionCode === null ||
    batch === null ||
    city === null
  ) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    // A33: batch dinormalisasi (058 -> 58) agar nama yang dibuat sama dengan hasil parser.
    value: `${productCode}${advertiserCode}${typeCode}${normalizeBatch(batch)}${PRODUCT_SEGMENT_SEPARATOR}${sessionCode}${PRODUCT_SEGMENT_SEPARATOR}${city}`,
  }
}

/**
 * Bentuk nama produk. Melempar bila input tidak valid — pemanggil UI harus
 * memakai validateProductNameInput lebih dulu untuk menampilkan error per field.
 */
export function buildProductName(input: Partial<Record<ProductNameField, unknown>>): string {
  const result = validateProductNameInput(input)
  if (!result.ok) throw new InvalidProductNameError(result.errors)
  return result.value
}
