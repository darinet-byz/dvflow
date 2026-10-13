import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS, DEFAULT_PAGE_SIZE, ALLOWED_PAGE_SIZES } from '@dvflow/shared'

/**
 * Model filter halaman baca (PRD §34–§37, §41, §47, §108; 01 §6–§7).
 *
 * Satu model dipakai bersama oleh Dashboard, Order, dan Presensi, sehingga
 * "Kuliner Masteri + Batch 392 + Zul + Paid" berarti hal yang sama di mana pun,
 * dan pemetaannya ke argumen RPC hanya ditulis sekali.
 *
 * Semua nilai kosong berarti "filter tidak aktif" — bukan "cari yang kosong".
 */

export type CommonFilters = {
  search: string
  dateFrom: string
  dateTo: string
  productCode: string
  advertiserCode: string
  eventType: string
  batch: string
  session: string
  city: string
}

export type OrderFilters = CommonFilters & {
  appStatus: string
  paymentMethod: string
}

export type PresensiFilters = CommonFilters & {
  attendanceStatus: string
}

export const EMPTY_COMMON_FILTERS: CommonFilters = {
  search: '',
  dateFrom: '',
  dateTo: '',
  productCode: '',
  advertiserCode: '',
  eventType: '',
  batch: '',
  session: '',
  city: '',
}

export const EMPTY_ORDER_FILTERS: OrderFilters = {
  ...EMPTY_COMMON_FILTERS,
  appStatus: '',
  paymentMethod: '',
}

export const EMPTY_PRESENSI_FILTERS: PresensiFilters = {
  ...EMPTY_COMMON_FILTERS,
  attendanceStatus: '',
}

export type PageSize = (typeof ALLOWED_PAGE_SIZES)[number]

export { DEFAULT_PAGE_SIZE, SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS }

/**
 * Teks pencarian yang benar-benar dikirim ke server (01 §7).
 *
 * Minimal 2 karakter, KECUALI Order ID numerik yang boleh 1 karakter. Aturan ini
 * ditegakkan di klien supaya mengetik satu huruf tidak memicu permintaan ke
 * server; server tetap menerima apa pun yang dikirim.
 */
export function effectiveSearch(search: string): string {
  const trimmed = search.trim()
  if (trimmed === '') return ''
  if (/^[0-9]+$/.test(trimmed)) return trimmed
  return trimmed.length >= SEARCH_MIN_CHARS ? trimmed : ''
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Ubah filter menjadi argumen RPC.
 *
 * Nama argumennya adalah tanda tangan fungsi di database
 * (`0016_read_rpcs.sql`, `0020_orders_page.sql`). Nilai kosong dikirim sebagai
 * `null` — bukan string kosong — karena `null` berarti "filter tidak aktif".
 */
export function toFilterArgs(filters: CommonFilters): Record<string, unknown> {
  return {
    p_search: emptyToNull(effectiveSearch(filters.search)),
    p_date_from: emptyToNull(filters.dateFrom),
    p_date_to: emptyToNull(filters.dateTo),
    p_product_code: emptyToNull(filters.productCode),
    p_advertiser_code: emptyToNull(filters.advertiserCode),
    p_event_type: emptyToNull(filters.eventType),
    p_batch: emptyToNull(filters.batch),
    p_session: emptyToNull(filters.session),
    p_city: emptyToNull(filters.city),
  }
}

export function toOrderArgs(filters: OrderFilters): Record<string, unknown> {
  return {
    ...toFilterArgs(filters),
    p_app_status: emptyToNull(filters.appStatus),
    p_payment_method: emptyToNull(filters.paymentMethod),
  }
}

export function toPresensiArgs(filters: PresensiFilters): Record<string, unknown> {
  return {
    ...toFilterArgs(filters),
    p_attendance_status: emptyToNull(filters.attendanceStatus),
  }
}

/**
 * Ambil hanya field filter bersama.
 *
 * Dipakai halaman Presensi untuk KPI: filter "Hadir/Belum Hadir" adalah pemilih
 * BARIS, bukan filter KPI, jadi ia sengaja dibuang sebelum memanggil
 * `dashboard_summary`. Dibuat eksplisit di sini supaya pembuangannya terlihat,
 * bukan tersembunyi di dalam pemanggilan.
 */
export function toCommonFilters(filters: CommonFilters): CommonFilters {
  return {
    search: filters.search,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    productCode: filters.productCode,
    advertiserCode: filters.advertiserCode,
    eventType: filters.eventType,
    batch: filters.batch,
    session: filters.session,
    city: filters.city,
  }
}

/** Chip filter yang sedang aktif, siap ditampilkan (PRD §35). */
export type ActiveFilter = { key: string; label: string }

export type FilterLabels = {
  product?: string
  advertiser?: string
  session?: string
}

export function activeCommonFilters(filters: CommonFilters, labels: FilterLabels = {}): ActiveFilter[] {
  const chips: ActiveFilter[] = []
  const push = (key: string, prefix: string, value: string, mapped?: string): void => {
    const trimmed = value.trim()
    if (trimmed === '') return
    chips.push({ key, label: `${prefix}${mapped ?? trimmed}` })
  }

  push('dateFrom', 'Dari ', filters.dateFrom)
  push('dateTo', 'Sampai ', filters.dateTo)
  push('productCode', 'Produk: ', filters.productCode, labels.product ?? filters.productCode)
  push('advertiserCode', 'Pengiklan: ', filters.advertiserCode, labels.advertiser ?? filters.advertiserCode)
  push('eventType', 'Jenis: ', filters.eventType)
  push('batch', 'Batch ', filters.batch)
  push('session', 'Sesi ', filters.session, labels.session ?? filters.session)
  push('city', 'Kota ', filters.city)

  return chips
}

/**
 * Hapus satu filter — chip dibuang satu per satu, filter lain tetap aktif
 * (PRD §36).
 */
export function clearFilter<T extends CommonFilters>(filters: T, key: string): T {
  if (!(key in filters)) return filters
  return { ...filters, [key]: '' }
}

/**
 * `Clear All` menghapus seluruh filter TERSTRUKTUR, tetapi **tidak** menghapus
 * teks pencarian global (PRD §37, 01 §7). Teks pencarian hanya hilang lewat
 * tombol clear pada input pencariannya.
 */
export function clearAllFilters<T extends CommonFilters>(filters: T): T {
  const cleared = { ...filters }
  for (const key of Object.keys(cleared) as Array<keyof T>) {
    if (key === 'search') continue
    cleared[key] = '' as T[keyof T]
  }
  return cleared
}

/** Apakah ada filter terstruktur yang aktif (tanpa menghitung teks pencarian). */
export function hasStructuredFilters(filters: CommonFilters): boolean {
  return Object.entries(filters).some(([key, value]) => key !== 'search' && String(value).trim() !== '')
}

export function totalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

/** Rentang baris yang sedang ditampilkan, untuk keterangan pagination. */
export function pageRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 }
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return { from, to }
}
