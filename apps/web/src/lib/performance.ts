import { parseIsoDate, toIsoDate } from './date-range'

/**
 * A46: angka dan tipe halaman "Performa / Analitik".
 *
 * Semua rumus yang bisa diuji tanpa DOM dikumpulkan di sini: closing rate, ROAS,
 * delta periode, dan pemilihan granularitas. Halaman hanya memformat hasilnya.
 */

export type Numeric = number | string

export type PerformanceMetrics = {
  spend: Numeric
  tax_amount: Numeric
  total_spend: Numeric
  leads: number
  paid: number
  tickets: number
  omzet: Numeric
  profit: Numeric
  /** Rasio tiket/leads (bisa > 1); null bila leads 0. */
  closing_rate: number | null
  /** Omzet / (spend + PPN); null bila spend 0. */
  roas: number | null
  /** Tiket Paid yang tercakup report spend / total tiket; null bila tiket 0. */
  coverage: number | null
}

export type TopProduct = {
  product_code: string | null
  product_name: string | null
  tickets: number
  omzet: Numeric
}

export type AdvertiserPerformance = PerformanceMetrics & {
  advertiser_code: string | null
  advertiser_name: string | null
  top_products: TopProduct[]
}

export type PerformanceDashboard = {
  advertisers: AdvertiserPerformance[]
}

export type PerformancePeriodRow = PerformanceMetrics & {
  period_start: string
  period_end: string
  /** Bucket pertama/terakhir yang tidak penuh; delta disembunyikan. */
  is_partial: boolean
  prev: PerformanceMetrics | null
  yoy: PerformanceMetrics | null
}

export type BatchPerformance = {
  batch: string | null
  spend: Numeric
  tax_amount: Numeric
  total_spend: Numeric
  tickets: number
  omzet: Numeric
  profit: Numeric
  roas: number | null
}

export type PerformanceDetail = {
  summary: PerformanceMetrics
  rows: PerformancePeriodRow[]
  top_products: TopProduct[]
  products: TopProduct[]
  batches: BatchPerformance[]
}

export type Granularity = 'day' | 'month' | 'year'

export type PeriodPresetKey =
  | 'thisMonth'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'last6m'
  | 'last12m'
  | 'last24m'
  | 'thisYear'
  | 'custom'

export const PERIOD_PRESETS: ReadonlyArray<{ key: PeriodPresetKey; label: string }> = [
  { key: 'thisMonth', label: 'Bulan Berjalan' },
  { key: 'last7', label: '7 Hari Terakhir' },
  { key: 'last30', label: '30 Hari Terakhir' },
  { key: 'last90', label: '90 Hari Terakhir' },
  { key: 'last6m', label: '6 Bulan Terakhir' },
  { key: 'last12m', label: '12 Bulan Terakhir' },
  { key: 'last24m', label: '24 Bulan Terakhir' },
  { key: 'thisYear', label: 'Tahun Berjalan' },
  { key: 'custom', label: 'Kustom' },
]

export const GRANULARITY_OPTIONS: ReadonlyArray<{ value: 'auto' | Granularity; label: string }> = [
  { value: 'auto', label: 'Otomatis' },
  { value: 'day', label: 'Harian' },
  { value: 'month', label: 'Bulanan' },
  { value: 'year', label: 'Tahunan' },
]

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

function firstOfMonth(date: Date, monthsBack: number): Date {
  return new Date(date.getFullYear(), date.getMonth() - monthsBack, 1)
}

/** Rentang preset halaman Performa. Default halaman: `thisMonth`. */
export function periodPresetRange(key: PeriodPresetKey, today: Date = new Date()): { from: string; to: string } {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  switch (key) {
    case 'last7':
      return { from: toIsoDate(addDays(end, -6)), to: toIsoDate(end) }
    case 'last30':
      return { from: toIsoDate(addDays(end, -29)), to: toIsoDate(end) }
    case 'last90':
      return { from: toIsoDate(addDays(end, -89)), to: toIsoDate(end) }
    case 'last6m':
      return { from: toIsoDate(firstOfMonth(end, 5)), to: toIsoDate(end) }
    case 'last12m':
      return { from: toIsoDate(firstOfMonth(end, 11)), to: toIsoDate(end) }
    case 'last24m':
      return { from: toIsoDate(firstOfMonth(end, 23)), to: toIsoDate(end) }
    case 'thisYear':
      return { from: toIsoDate(new Date(end.getFullYear(), 0, 1)), to: toIsoDate(end) }
    case 'thisMonth':
      return { from: toIsoDate(firstOfMonth(end, 0)), to: toIsoDate(end) }
    case 'custom':
    default:
      return { from: toIsoDate(firstOfMonth(end, 0)), to: toIsoDate(end) }
  }
}

/**
 * Granularitas otomatis: ≤31 hari harian, ≤24 bulan bulanan, selebihnya tahunan.
 * Batas 24 bulan memakai 731 hari agar tahun kabisat tidak memotong satu bulan.
 */
export function autoGranularity(from: string, to: string): Granularity {
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)
  if (start === null || end === null) return 'month'
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (days <= 31) return 'day'
  if (days <= 731) return 'month'
  return 'year'
}

export function resolveGranularity(mode: 'auto' | Granularity, from: string, to: string): Granularity {
  return mode === 'auto' ? autoGranularity(from, to) : mode
}

/** Angka aman untuk perhitungan; nilai kosong/NaN menjadi 0. */
export function metricNumber(value: Numeric | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function costPerTicket(metrics: Pick<PerformanceMetrics, 'total_spend' | 'tickets'>): number | null {
  const tickets = metrics.tickets
  if (!Number.isFinite(tickets) || tickets <= 0) return null
  return metricNumber(metrics.total_spend) / tickets
}

/** "3,2x"; null/NaN menjadi "-". Bukan persen — ROAS adalah kelipatan omzet terhadap spend. */
export function formatRoas(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}x`
}

/** Perubahan persen terhadap periode pembanding; pembanding 0 tidak punya persentase. */
export function deltaPercent(current: Numeric | null | undefined, previous: Numeric | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null
  const now = metricNumber(current)
  const before = metricNumber(previous)
  if (before === 0) return null
  return ((now - before) / Math.abs(before)) * 100
}

/** "+12,4%" / "-5,0%"; tidak ada pembanding menjadi "-". */
export function formatDeltaPercent(current: Numeric | null | undefined, previous: Numeric | null | undefined): string {
  const delta = deltaPercent(current, previous)
  if (delta === null) return '-'
  const formatted = delta.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${delta > 0 ? '+' : ''}${formatted}%`
}

export function deltaClass(current: Numeric | null | undefined, previous: Numeric | null | undefined): string {
  const delta = deltaPercent(current, previous)
  if (delta === null || delta === 0) return ''
  return delta > 0 ? 'text-success' : 'text-danger'
}

export type AdvertiserSortKey = 'omzet' | 'tickets' | 'roas' | 'profit' | 'spend'

export const ADVERTISER_SORT_OPTIONS: ReadonlyArray<{ value: AdvertiserSortKey; label: string }> = [
  { value: 'omzet', label: 'Omzet' },
  { value: 'tickets', label: 'Tiket' },
  { value: 'roas', label: 'ROAS' },
  { value: 'profit', label: 'Profit' },
  { value: 'spend', label: 'Spend' },
]

function sortValue(row: AdvertiserPerformance, key: AdvertiserSortKey): number {
  if (key === 'tickets') return row.tickets
  if (key === 'roas') return row.roas ?? Number.NEGATIVE_INFINITY
  if (key === 'profit') return metricNumber(row.profit)
  if (key === 'spend') return metricNumber(row.total_spend)
  return metricNumber(row.omzet)
}

/** Urut menurun; ROAS kosong selalu di bawah. */
export function sortAdvertisers(rows: readonly AdvertiserPerformance[], key: AdvertiserSortKey): AdvertiserPerformance[] {
  return [...rows].sort((left, right) => {
    const diff = sortValue(right, key) - sortValue(left, key)
    if (diff !== 0) return diff
    return (left.advertiser_name ?? left.advertiser_code ?? '').localeCompare(
      right.advertiser_name ?? right.advertiser_code ?? '',
      'id',
    )
  })
}

export function advertiserLabel(row: Pick<AdvertiserPerformance, 'advertiser_name' | 'advertiser_code'>): string {
  const name = (row.advertiser_name ?? '').trim()
  const code = (row.advertiser_code ?? '').trim()
  if (name !== '' && code !== '') return `${name} (${code})`
  if (name !== '') return name
  if (code !== '') return code
  return 'Tanpa pengiklan'
}

export function productLabel(product: Pick<TopProduct, 'product_name' | 'product_code'>): string {
  const name = (product.product_name ?? '').trim()
  if (name !== '') return name
  const code = (product.product_code ?? '').trim()
  return code !== '' ? code : 'Tanpa produk'
}
