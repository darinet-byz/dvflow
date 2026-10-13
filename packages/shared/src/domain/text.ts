/**
 * Helper teks yang dipakai bersama parser, normalisasi identifier, dan validator.
 *
 * Normalisasi di sini sengaja konservatif: hanya trim, uppercase untuk kode,
 * dan collapse spasi untuk identifier. Tidak ada fuzzy matching di mana pun.
 */

/** Ubah nilai tak dikenal menjadi string yang sudah di-trim; null bila kosong. */
export function toTrimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Rapatkan seluruh rangkaian spasi menjadi satu spasi. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ')
}

/**
 * Normalisasi kode konfigurasi untuk perbandingan.
 *
 * Hanya trim + uppercase, TANPA membuang spasi di tengah — supaya "S 1" tidak
 * pernah dianggap sama dengan "S1". Penulisan konfigurasi menolak kode yang
 * mengandung spasi, sehingga operasi ini tidak menghilangkan informasi.
 */
export function normalizeCode(value: string): string {
  return value.trim().toUpperCase()
}

/**
 * Pola kode konfigurasi yang diizinkan.
 *
 * Tanpa spasi dan tanpa tanda hubung, supaya pemisah ` - ` pada product_raw
 * tidak pernah ambigu dan pemisahan segmen selalu deterministik.
 */
export const CODE_PATTERN = /^[A-Za-z0-9]+$/

export function isValidCodeFormat(value: string): boolean {
  return CODE_PATTERN.test(value)
}
