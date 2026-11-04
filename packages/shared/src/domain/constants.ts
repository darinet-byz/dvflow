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

/** Batas baris yang bisa dibuka lewat pagination list (A18): 10 halaman x 50. Ringkasan tetap angka asli. */
export const MAX_LIST_ROWS = 500

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

/** Retensi unmapped orders: 90 hari (kebijakan evergreen). */
export const UNMAPPED_ORDER_RETENTION_DAYS = 90

/**
 * Masa hidup refresh session: 14 hari.
 *
 * Satu event biasanya berlangsung 7-10 hari; 14 hari memberi ruang tanpa
 * memaksa operator login ulang di tengah rangkaian acara.
 */
export const SESSION_LIFETIME_HOURS = 14 * 24
export const SESSION_LIFETIME_DAYS = 14
export const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_HOURS * 60 * 60

/** Sesi paten yang valid di sistem. */
export const PATENT_SESSIONS = ['ST', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const

/** Masa hidup access JWT: 30 menit (01 §3). */
export const ACCESS_TOKEN_LIFETIME_SECONDS = 30 * 60

/**
 * Versi aset skrip QR halaman tiket.
 *
 * Skrip ini TIDAK ber-hash dan dulu di-cache `immutable` selama satu tahun,
 * sehingga perubahan kode tidak sampai ke HP peserta. URL-nya sekarang memakai
 * `?v=`; di produksi nilai ini diisi commit deploy, sedangkan nilai di bawah
 * menjadi fallback untuk pengembangan/test.
 */
export const TICKET_QR_ASSET_VERSION = 'qr-3'

/** Panjang minimum password (01 §4). */
export const PASSWORD_MIN_LENGTH = 8

/** Panjang maksimum body webhook yang diproses; webhook adalah input tak terpercaya (04 §10). */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024

/**
 * Preset harga per tiket pada form OTS (A34).
 *
 * Ini hanya jalan pintas UI, bukan aturan validasi: harga tersimpan per order dan server
 * menerima harga positif lain untuk kompatibilitas data lama. Kalau daftar ini berubah,
 * perubahan harus disertai catatan di `docs/AMENDMENTS.md`.
 */
export const OTS_UNIT_PRICE_OPTIONS = [99_000, 100_000, 149_000, 150_000] as const

/** Batas jumlah tiket per transaksi OTS (A34) — guard salah ketik di meja registrasi. */
export const OTS_MAX_QUANTITY = 100

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
