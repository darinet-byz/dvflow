/**
 * Angka-angka yang ditetapkan dokumen sumber.
 *
 * Setiap konstanta menyebut asalnya supaya tidak ada nilai "ajaib" yang
 * diubah tanpa jejak, dan supaya SQL serta TypeScript memakai angka yang sama.
 */

/** Default baris per halaman tabel data (PRD §33, 06-RUNBOOK). */
export const DEFAULT_PAGE_SIZE = 50

/** Opsi ukuran halaman yang diizinkan (PRD §33). */
export const ALLOWED_PAGE_SIZES: readonly number[] = [50, 100]

/** Jeda debounce pencarian (01-IMPLEMENTATION-DECISIONS §7). */
export const SEARCH_DEBOUNCE_MS = 300

/** Panjang minimum teks pencarian; Order ID numerik boleh 1 karakter (01 §7). */
export const SEARCH_MIN_CHARS = 2

/** Batas hasil pencarian kandidat seminar di scanner (03-API-CONTRACT §10). */
export const SCANNER_SEARCH_LIMIT = 20

/** Jumlah timestamp terbaru yang ditampilkan UI; database tetap row-based (PRD §105). */
export const TIMESTAMP_DISPLAY_LIMIT = 10

/** Retensi raw attendance (PRD §106). Master Order tidak ikut terhapus. */
export const ATTENDANCE_RETENTION_DAYS = 60

/** Retensi webhook log (01-IMPLEMENTATION-DECISIONS §19). */
export const WEBHOOK_LOG_RETENTION_DAYS = 7

/** Masa hidup refresh session (01 §3). */
export const SESSION_LIFETIME_DAYS = 7

/** Masa hidup access JWT: 30 menit (01 §3). */
export const ACCESS_TOKEN_LIFETIME_SECONDS = 30 * 60

/** Panjang minimum password (01 §4). */
export const PASSWORD_MIN_LENGTH = 8

/** Panjang maksimum body webhook yang diproses; webhook adalah input tak terpercaya (04 §10). */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024

/** Batas panjang teks yang disimpan dari payload webhook (04 §10). */
export const MAX_TEXT_LENGTH = {
  orderId: 64,
  rawStatus: 32,
  name: 200,
  phone: 32,
  email: 200,
  productRaw: 200,
  paymentMethod: 100,
  paymentProvider: 100,
  paymentIdentifier: 200,
} as const
