/**
 * Normalisasi payment identifier (01-IMPLEMENTATION-DECISIONS §11).
 *
 * Aturan: trim, lowercase, rapatkan spasi ganda menjadi satu.
 * Pencocokan fee rule adalah EXACT match atas hasil normalisasi — tidak ada
 * fuzzy matching, prioritas, atau fallback (PRD §83).
 */

import { collapseWhitespace } from './text'

export function normalizePaymentIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = collapseWhitespace(String(value).trim()).toLowerCase()
  return normalized.length > 0 ? normalized : null
}

/**
 * Perbandingan identifier yang sudah dinormalisasi.
 *
 * Nilai null berarti "tidak disebutkan", bukan "identifier kosong". Dua null
 * dianggap sama supaya webhook tanpa identifier tidak dianggap mengubah apa pun.
 */
export function paymentIdentifiersEqual(a: string | null, b: string | null): boolean {
  return a === b
}
