import { EVENT_TYPE_NAME_BY_KIND, type EventKind } from '@dvflow/shared'
import { supabaseRpc, supabaseSelect } from './supabase-rest'
import type { CommonFilters, OrderFilters, PageSize, PresensiFilters } from './filters'
import { toFilterArgs, toOrderArgs, toPresensiArgs } from './filters'

/**
 * Akses data halaman baca.
 *
 * Semuanya lewat RPC yang sudah ada di database (SECURITY INVOKER, jadi RLS
 * tetap berlaku) — bukan query PostgREST yang disusun di browser. Alasannya ada
 * di header `0020_orders_page.sql`: satu definisi filter, whitelist sort
 * ditegakkan server, dan ringkasan dihitung dari himpunan yang sama.
 */

export type DashboardSummary = {
  leads: number
  paid: number
  /** A25: total quantity order Paid (tiket terjual); 1 Order ID bisa 2+ tiket. */
  paid_tickets?: number
  pending: number
  cancelled: number
  conversion_rate: number | null
  gross_amount: number
  tax_amount: number
  epayment_tax_amount?: number
  platform_fee_amount?: number
  net_amount: number
  sudah_hadir: number
  belum_hadir: number
  attendance_rate: number | null
}

/** A23: ringkasan kehadiran halaman Presensi (cukup izin Presensi, tanpa angka keuangan). */
export type PresensiSummary = Pick<DashboardSummary, 'paid' | 'sudah_hadir' | 'belum_hadir' | 'attendance_rate'>

export type AppStatus = 'Pending' | 'Paid' | 'Cancelled' | 'Refund'
export type EventTypeName = 'Seminar Offline' | 'Webinar Online' | 'Hybrid'
export type AttendanceStatus =
  | 'Hadir'
  | 'Belum Hadir'
  | 'Reschedule'
  | 'Refund'
  | 'Pending'
  | 'Cancelled'

/** Satu baris Master Order (PRD §45 + data snapshot untuk drawer). */
export type OrderRow = {
  id: string
  order_id: string
  name: string | null
  phone: string | null
  email: string | null
  product_raw: string | null
  product_parse_status: 'valid' | 'invalid'
  product_code: string | null
  product_name: string | null
  advertiser_code: string | null
  advertiser_name: string | null
  event_type: EventTypeName | null
  /** Batch/sesi/kota ASAL — dipakai laporan penjualan/iklan (A58). */
  batch: string | null
  session: string | null
  city: string | null
  /** Override acara tujuan reschedule; null bila tidak pernah reschedule. */
  event_batch?: string | null
  event_session?: string | null
  event_city?: string | null
  /** Acara efektif = tujuan bila ada, jika tidak asal. */
  effective_batch?: string | null
  effective_session?: string | null
  effective_city?: string | null
  rescheduled?: boolean
  has_attendance?: boolean
  raw_status: string | null
  app_status: AppStatus
  payment_method: string | null
  payment_provider: string | null
  payment_identifier: string | null
  gross_amount: number
  tax_amount: number
  net_amount: number
  /** A15 (0031): e-payment fee tax dan platform fee. */
  epayment_tax_amount?: number
  platform_fee_amount?: number
  epayment_tax_type_snapshot?: 'flat' | 'percentage' | null
  epayment_tax_value_snapshot?: number | null
  platform_fee_percent_snapshot?: number | null
  tax_mapping_status: 'mapped' | 'unmapped'
  fee_rule_name_snapshot: string | null
  fee_type_snapshot: 'flat' | 'percentage' | null
  fee_value_snapshot: number | null
  source_created_at: string | null
  source_updated_at: string | null
  created_at: string
  paid_at: string | null
  updated_at: string
}

export type OrdersPage = {
  rows: OrderRow[]
  total: number
  summary: { total: number; paid: number; pending: number }
}

export type OrderSortKey =
  | 'order_id'
  | 'name'
  | 'app_status'
  | 'gross_amount'
  | 'tax_amount'
  | 'net_amount'
  | 'created_at'
  | 'paid_at'
  | 'updated_at'

/** Baris presensi (PRD §103). `timestamps` sudah 10 terbaru dari database. */
export type PresensiRow = {
  order_id: string
  name: string | null
  phone: string | null
  product_code: string | null
  product_name: string | null
  advertiser_code: string | null
  advertiser_name: string | null
  event_type: EventTypeName | null
  /** Batch/sesi/kota acara EFEKTIF (tujuan reschedule bila ada). */
  batch: string | null
  session: string | null
  city: string | null
  /** Nilai asal untuk konteks drawer saat sudah reschedule. */
  original_batch?: string | null
  original_session?: string | null
  original_city?: string | null
  rescheduled?: boolean
  product_parse_status: 'valid' | 'invalid'
  app_status: AppStatus
  /** Nominal & jumlah tiket dibutuhkan modal Refund di drawer Presensi. */
  gross_amount: number
  quantity: number
  attendance_status: AttendanceStatus
  total_activity: number
  latest_activity: string | null
  timestamps: string[] | null
  created_at: string
  paid_at: string | null
  updated_at: string
}

export type PresensiPage = {
  rows: PresensiRow[]
  total: number
  page: number
  page_size: number
}

export type PresensiSortKey =
  | 'order_id'
  | 'name'
  | 'total_activity'
  | 'latest_activity'
  | 'product_name'
  | 'batch'
  | 'session'
  | 'city'

export type SortDirection = 'asc' | 'desc'

/** A58: satu baris halaman Order Refund. Filter tanggal memakai tanggal refund. */
export type RefundRow = {
  order_id: string
  name: string | null
  phone: string | null
  product_code: string | null
  product_name: string | null
  advertiser_code: string | null
  advertiser_name: string | null
  event_type: EventTypeName | null
  batch: string | null
  session: string | null
  city: string | null
  event_batch: string | null
  event_session: string | null
  event_city: string | null
  rescheduled: boolean
  quantity: number
  gross_amount: number
  refund_amount: number
  refund_reason: string
  refunded_at: string
  refunded_by_name: string | null
  previous_status: AppStatus
}

export type RefundPage = {
  rows: RefundRow[]
  total: number
  page: number
  page_size: number
  summary: { total: number; tickets: number; amount: number }
}

export type RefundSortKey =
  | 'order_id'
  | 'name'
  | 'refunded_at'
  | 'amount'
  | 'product_name'
  | 'batch'
  | 'session'
  | 'city'

/** Riwayat reschedule (append-only), dibaca langsung lewat RLS. */
export type RescheduleHistoryRow = {
  id: string
  from_batch: string | null
  from_session: string | null
  from_city: string | null
  to_batch: string | null
  to_session: string | null
  to_city: string | null
  reason: string | null
  actor_name: string | null
  created_at: string
}

/**
 * PRD §41: Dashboard memakai satu set filter yang sama untuk seluruh KPI.
 * Tidak ada KPI yang boleh memakai filter sendiri.
 */
export async function fetchDashboardSummary(filters: CommonFilters): Promise<DashboardSummary> {
  return supabaseRpc<DashboardSummary>('dashboard_summary', toFilterArgs(filters))
}

export async function fetchPresensiSummary(filters: CommonFilters): Promise<PresensiSummary> {
  return supabaseRpc<PresensiSummary>('presensi_summary', toFilterArgs(filters))
}

export async function fetchOrdersPage(
  filters: OrderFilters,
  options: { sort: OrderSortKey; direction: SortDirection; page: number; pageSize: PageSize; exporting?: boolean },
): Promise<OrdersPage> {
  return supabaseRpc<OrdersPage>(options.exporting ? 'export_orders_page' : 'orders_page', {
    ...toOrderArgs(filters),
    p_sort: options.sort,
    p_sort_dir: options.direction,
    p_page: options.page,
    p_page_size: options.pageSize,
  })
}

export async function fetchPresensiPage(
  filters: PresensiFilters,
  options: { sort: PresensiSortKey; direction: SortDirection; page: number; pageSize: PageSize; exporting?: boolean },
): Promise<PresensiPage> {
  return supabaseRpc<PresensiPage>(options.exporting ? 'export_presensi_page' : 'presensi_page', {
    ...toPresensiArgs(filters),
    p_sort: options.sort,
    p_sort_dir: options.direction,
    p_page: options.page,
    p_page_size: options.pageSize,
  })
}

export async function fetchRefundPage(
  filters: CommonFilters,
  options: { sort: RefundSortKey; direction: SortDirection; page: number; pageSize: PageSize; exporting?: boolean },
): Promise<RefundPage> {
  return supabaseRpc<RefundPage>(options.exporting ? 'export_refund_page' : 'refund_page', {
    ...toFilterArgs(filters),
    p_sort: options.sort,
    p_sort_dir: options.direction,
    p_page: options.page,
    p_page_size: options.pageSize,
  })
}

/**
 * Daftar konfigurasi untuk pilihan filter dan generator.
 *
 * Hanya baris AKTIF yang ditawarkan (05 §D02: "inactive product not offered in
 * selector"). Baris nonaktif tetap dipakai parser untuk order lama (K8) — itu
 * urusan ingestion, bukan urusan selector.
 *
 * Perhatikan `eventTypes` vs `eventTypeNames`: keduanya dibutuhkan dan nilainya
 * BERBEDA.
 *   * Generator butuh **kode** (`SO`), karena nama produk kanonik memakai kode —
 *     dan nama seperti "Seminar Offline" mengandung spasi sehingga selalu
 *     ditolak validator kode (01 §10).
 *   * Filter Order/Presensi butuh **nama** (`Seminar Offline`), karena itulah
 *     isi kolom `orders.event_type` (02 §9, K7).
 * Menukar keduanya adalah bug yang sulit terlihat: generator akan menolak
 * setiap input, dan filter tidak akan pernah cocok.
 */
export type ConfigOption = { value: string; label: string }

export type ConfigLists = {
  /** value = KODE produk. */
  products: ConfigOption[]
  /** value = KODE pengiklan. */
  advertisers: ConfigOption[]
  /** value = KODE event type (`SO`/`WO`) — untuk generator. */
  eventTypes: ConfigOption[]
  /** value = NAMA event type (`Seminar Offline`) — untuk filter. */
  eventTypeNames: ConfigOption[]
  /** value = KODE sesi. */
  sessions: ConfigOption[]
  /** Saran payment method dari identifier fee rule yang aktif. */
  paymentMethods: string[]
}

type CodeRow = { code: string; name: string }
type EventTypeRow = { code: string; name: string; kind: EventKind }

export async function fetchConfigLists(): Promise<ConfigLists> {
  const [products, advertisers, eventTypes, sessions, feeRules] = await Promise.all([
    supabaseSelect<CodeRow>('products', { active: 'is.true' }, 'code,name'),
    supabaseSelect<CodeRow>('advertisers', { active: 'is.true' }, 'code,name'),
    supabaseSelect<EventTypeRow>('event_types', { active: 'is.true' }, 'code,name,kind'),
    supabaseSelect<CodeRow>('sessions_config', { active: 'is.true' }, 'code,name'),
    supabaseSelect<{ identifier: string }>('payment_fee_rules', { active: 'is.true' }, 'identifier'),
  ])

  return {
    products: toOptions(products),
    advertisers: toOptions(advertisers),
    eventTypes: toOptions(eventTypes),
    // orders.event_type diturunkan dari kind (Seminar Offline/Webinar Online/Hybrid), bukan
    // dari nama baris konfigurasi — filter harus memakai nilai turunan itu agar cocok.
    eventTypeNames: [...new Set(eventTypes.map((row) => EVENT_TYPE_NAME_BY_KIND[row.kind]).filter(Boolean))]
      .map((name) => ({ value: name, label: name }))
      .sort((left, right) => left.label.localeCompare(right.label, 'id')),
    sessions: toOptions(sessions),
    paymentMethods: [...new Set(feeRules.map((row) => row.identifier))].sort(),
  }
}

/** A34: daftar produk & sesi untuk form OTS. RLS tetap membatasi produk sesuai scope user. */
export type OtsReferenceData = {
  products: Array<{ code: string; name: string }>
  sessions: Array<{ code: string; name: string }>
}

export async function fetchOtsReferenceData(): Promise<OtsReferenceData> {
  const [products, sessions] = await Promise.all([
    supabaseSelect<{ code: string; name: string }>('products', { active: 'is.true', order: 'code.asc' }, 'code,name'),
    supabaseSelect<{ code: string; name: string }>('sessions_config', { active: 'is.true', order: 'code.asc' }, 'code,name'),
  ])
  return { products, sessions }
}

export type AdvertiserChoice = { id: string; code: string; name: string; active: boolean }

/** A20: pilihan pengiklan untuk akun role Advertiser (Add Team). Termasuk nonaktif agar akun lama tetap terbaca. */
export async function fetchAdvertiserChoices(): Promise<AdvertiserChoice[]> {
  const rows = await supabaseSelect<AdvertiserChoice>('advertisers', { order: 'code.asc' }, 'id,code,name,active')
  return rows
}

/** Label pilihan: "Kode — Nama" supaya kode dan namanya sama-sama terbaca. */
function toOptions(rows: CodeRow[]): ConfigOption[] {
  return rows
    .map((row) => ({ value: row.code, label: `${row.code} — ${row.name}` }))
    .sort((left, right) => left.value.localeCompare(right.value, 'id'))
}
