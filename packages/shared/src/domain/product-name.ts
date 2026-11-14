import { normalizeMasterCode, MASTER_CODE_RULES, type MasterCodeResource } from './config-code'
/**
 * Pembentuk canonical product name (PRD §54, 01-IMPLEMENTATION-DECISIONS §10).
 *
 * Dua format yang SAMA-SAMA sah (A75):
 *
 *   1. Berbasis kode (format lama):
 *      [PRODUCT_CODE][ADVERTISER_CODE][TYPE_CODE][BATCH] - [SESSION_CODE] - [CITY]
 *      contoh: KM01SO392 - S1 - Solo
 *
 *   2. Berbasis nama produk (format baru):
 *      [ADVERTISER_CODE] - [TYPE_CODE][BATCH] - [PRODUCT_NAME] - [SESSION_CODE] - [CITY]
 *      contoh: 01 - SO392 - Kuliner Masteri - S1 - Solo
 *
 * Kontrak penting: nama yang dihasilkan builder ini HARUS selalu bisa diparse
 * kembali oleh product-parser. Karena itu batch, kota, dan NAMA PRODUK yang
 * mengandung pemisah ` - ` ditolak, dan kota di-trim sebelum dipakai.
 *
 * Format baru memakai `products.name` apa adanya. Karena itu nama produk tidak
 * boleh diubah setelah produk dipakai (A75) — kalau berubah, nama produk yang
 * sudah ditulis di OrderOnline tidak lagi menunjuk produk yang sama.
 */

import { isValidCodeFormat, normalizeBatch, toTrimmedOrNull } from './text'

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

/** Input format baru: field lama + nama produk dari konfigurasi produk. */
export type ProductNameDetailedField = ProductNameField | 'productName'

export type ProductNameVariants = {
  /** Format lama, berbasis kode produk. */
  legacy: string
  /** Format baru, berbasis nama produk. */
  detailed: string
}

export type ProductNameValidation =
  | { ok: true; value: string }
  | { ok: false; errors: Partial<Record<ProductNameField, string>> }

export type ProductNameVariantsValidation =
  | { ok: true; value: ProductNameVariants }
  | { ok: false; errors: Partial<Record<ProductNameDetailedField, string>> }

export class InvalidProductNameError extends Error {
  constructor(readonly errors: Partial<Record<ProductNameDetailedField, string>>) {
    super('Input product name tidak valid')
    this.name = 'InvalidProductNameError'
  }
}

function validateCodeField(
  field: ProductNameField,
  raw: unknown,
  label: string,
  errors: Partial<Record<ProductNameDetailedField, string>>,
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
  field: ProductNameDetailedField,
  raw: unknown,
  label: string,
  errors: Partial<Record<ProductNameDetailedField, string>>,
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

type ValidatedFields = {
  productCode: string
  advertiserCode: string
  typeCode: string
  batch: string
  sessionCode: string
  city: string
}

/**
 * Validasi enam field bersama kedua format. Mengisi `errors` dan mengembalikan
 * null bila ada yang bermasalah, sehingga kedua builder memakai aturan yang
 * benar-benar sama.
 */
function validateFields(
  rawInput: Partial<Record<ProductNameDetailedField, unknown>>,
  options: { strictCodes?: boolean },
  errors: Partial<Record<ProductNameDetailedField, string>>,
): ValidatedFields | null {
  let input = rawInput
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
    return null
  }

  return { productCode, advertiserCode, typeCode, batch, sessionCode, city }
}

/** Format lama: KM01SO392 - S1 - Solo */
function buildLegacyName(fields: ValidatedFields): string {
  // A33: batch dinormalisasi (058 -> 58) agar nama yang dibuat sama dengan hasil parser.
  return `${fields.productCode}${fields.advertiserCode}${fields.typeCode}${normalizeBatch(fields.batch)}${PRODUCT_SEGMENT_SEPARATOR}${fields.sessionCode}${PRODUCT_SEGMENT_SEPARATOR}${fields.city}`
}

/** Format baru: 01 - SO392 - Kuliner Masteri - S1 - Solo */
function buildDetailedName(fields: ValidatedFields, productName: string): string {
  return `${fields.advertiserCode}${PRODUCT_SEGMENT_SEPARATOR}${fields.typeCode}${normalizeBatch(fields.batch)}${PRODUCT_SEGMENT_SEPARATOR}${productName}${PRODUCT_SEGMENT_SEPARATOR}${fields.sessionCode}${PRODUCT_SEGMENT_SEPARATOR}${fields.city}`
}

/**
 * Validasi input generator format lama. Tidak pernah menghasilkan kode yang salah:
 * kalau ada field bermasalah, hasilnya daftar error per field dan tanpa nilai.
 */
export function validateProductNameInput(input: Partial<Record<ProductNameDetailedField, unknown>>, options: { strictCodes?: boolean } = {}): ProductNameValidation {
  const errors: Partial<Record<ProductNameDetailedField, string>> = {}
  const fields = validateFields(input, options, errors)
  if (fields === null) return { ok: false, errors }
  return { ok: true, value: buildLegacyName(fields) }
}

/**
 * Validasi input generator DUA format (A75).
 *
 * Enam field pertama wajib seperti format lama; `productName` hanya diperiksa
 * setelah field lain valid, supaya form yang belum lengkap tidak menampilkan
 * error nama produk yang membingungkan.
 */
export function validateProductNameVariants(
  input: Partial<Record<ProductNameDetailedField, unknown>>,
  options: { strictCodes?: boolean } = {},
): ProductNameVariantsValidation {
  const errors: Partial<Record<ProductNameDetailedField, string>> = {}
  const fields = validateFields(input, options, errors)
  if (fields === null) return { ok: false, errors }

  const productName = validateTextSegment('productName', input.productName, 'Nama produk', errors)
  if (productName === null) return { ok: false, errors }

  return {
    ok: true,
    value: {
      legacy: buildLegacyName(fields),
      detailed: buildDetailedName(fields, productName),
    },
  }
}

/**
 * Bentuk nama produk format lama. Melempar bila input tidak valid — pemanggil UI
 * harus memakai validateProductNameInput lebih dulu untuk menampilkan error per field.
 *
 * Dipakai alias produk, remap Order Unmapped, dan OTS: target kanonik di sana
 * tetap format lama supaya stabil terhadap penggantian nama produk.
 */
export function buildProductName(input: Partial<Record<ProductNameDetailedField, unknown>>): string {
  const result = validateProductNameInput(input)
  if (!result.ok) throw new InvalidProductNameError(result.errors)
  return result.value
}

/**
 * Bentuk KEDUA nama produk sekaligus. Melempar bila input tidak valid.
 * Pemanggil UI harus memakai validateProductNameVariants lebih dulu.
 */
export function buildProductNameVariants(input: Partial<Record<ProductNameDetailedField, unknown>>): ProductNameVariants {
  const result = validateProductNameVariants(input)
  if (!result.ok) throw new InvalidProductNameError(result.errors)
  return result.value
}
