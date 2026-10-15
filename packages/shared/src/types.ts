/**
 * Tipe kanonik lintas layer.
 *
 * Tipe di sini adalah kontrak antara packages/api, apps/web, dan SQL.
 * Jangan menambah field yang tidak ada di
 * docs/02-DATABASE-SCHEMA-AND-DATA-DICTIONARY.md tanpa amendemen (docs/AMENDMENTS.md).
 */

export type StandardAppRole =
  | 'developer'
  | 'owner'
  | 'manajer'
  | 'admin'
  | 'pimpro'
  | 'member'
  | 'master_admin'
  | 'staff'

export type AppRole = StandardAppRole | string

export const APP_ROLES: readonly string[] = [
  'developer',
  'owner',
  'manajer',
  'admin',
  'pimpro',
  'member',
  'master_admin',
  'staff',
]

export function isMasterAdminRole(role: string | null | undefined): boolean {
  return role === 'master_admin' || role === 'developer' || role === 'owner'
}

export type AppPermissionKey =
  | 'operasional.scan_qr'
  | 'operasional.dashboard'
  | 'operasional.order'
  | 'operasional.presensi'
  | 'operasional.generator'
  | 'config.produk'
  | 'config.tax'
  | 'config.report_tax'
  | 'config.zoom'
  | 'config.tiket'
  | 'config.integrasi'
  | 'config.roles'
  | 'team.manage'
  | 'account.profile'
  | 'action.export_data'
  | 'action.manual_checkin'
  | 'action.delete_master'

export type AppRoleItem = {
  id: string
  name: string
  description?: string | null
  is_system: boolean
  user_count?: number
  permission_count?: number
  permissions?: string[]
  created_at?: string
  updated_at?: string
}

export type AppPermissionItem = {
  key: string
  name: string
  module: string
  description?: string | null
  sort_order: number
}

export type AppPermissionModuleGroup = {
  module: string
  module_name: string
  permissions: AppPermissionItem[]
}

/** Nilai app_status. Hanya tiga ini (02-DATABASE-SCHEMA §9). */
export type AppStatus = 'Pending' | 'Paid' | 'Cancelled'

export type ProductParseStatus = 'valid' | 'invalid'
export type TaxMappingStatus = 'mapped' | 'unmapped'
export type FeeType = 'flat' | 'percentage'
/** E-payment fee boleh kombinasi: gross × persen + flat (A16, 0032). */
export type EpaymentFeeType = FeeType | 'percentage_flat'

/** `hybrid`: satu order berlaku untuk tiket QR (check-in di lokasi) DAN link Zoom (A14). */
export type EventKind = 'seminar' | 'webinar' | 'hybrid'

/**
 * Nilai orders.event_type dipatok oleh CHECK constraint ke dua literal ini
 * (02-DATABASE-SCHEMA §9), jadi ia diturunkan dari `kind`, bukan dari nama baris
 * konfigurasi. Dengan begitu mengganti nama event type di konfigurasi tidak
 * merusak ingestion webhook.
 */
export type EventTypeName = 'Seminar Offline' | 'Webinar Online' | 'Hybrid'

export const EVENT_TYPE_NAME_BY_KIND: Record<EventKind, EventTypeName> = {
  seminar: 'Seminar Offline',
  webinar: 'Webinar Online',
  hybrid: 'Hybrid',
}

export const EVENT_KIND_BY_EVENT_TYPE_NAME: Record<EventTypeName, EventKind> = {
  'Seminar Offline': 'seminar',
  'Webinar Online': 'webinar',
  Hybrid: 'hybrid',
}

export type AttendanceType = 'webinar' | 'seminar'

/** Order dengan jalur tiket QR + check-in di lokasi (Seminar Offline, Hybrid). */
export function allowsOnsiteCheckin(eventType: string | null | undefined): boolean {
  return eventType === 'Seminar Offline' || eventType === 'Hybrid'
}

/** Order dengan jalur link Zoom (Webinar Online, Hybrid). */
export function allowsOnlineAccess(eventType: string | null | undefined): boolean {
  return eventType === 'Webinar Online' || eventType === 'Hybrid'
}
export type AttendanceSource = 'webinar_redirect' | 'seminar_qr' | 'seminar_manual'

export const ATTENDANCE_SOURCE_BY_TYPE: Record<AttendanceType, AttendanceSource> = {
  webinar: 'webinar_redirect',
  seminar: 'seminar_qr',
}

/**
 * Objek kanonik webhook (03-WORKER-API-CONTRACT §2).
 *
 * Business logic HANYA boleh membaca objek ini, tidak pernah key mentah provider.
 * Nama key eksternal OrderOnline belum tersedia dan DILARANG ditebak —
 * lihat BLOCKED_BY_EXTERNAL_ORDERONLINE_PAYLOAD.
 */
export type CanonicalOrderWebhook = {
  orderId: string
  customerName?: string | null
  phone?: string | null
  email?: string | null
  productRaw?: string | null
  rawStatus: string
  paymentMethod?: string | null
  paymentProvider?: string | null
  paymentIdentifier?: string | null
  grossAmount: number
  sourceCreatedAt?: string | null
  sourceUpdatedAt?: string | null
}

/**
 * Baris konfigurasi yang dibutuhkan parser/validator.
 *
 * Sengaja hanya memuat field yang dipakai logika. Bentuk lengkap baris database
 * ditangani di layer SQL/api.
 */
export type ProductConfigRow = {
  name: string
  code: string
  active: boolean
}

export type AdvertiserConfigRow = {
  name: string
  code: string
  active: boolean
}

export type EventTypeConfigRow = {
  name: string
  code: string
  kind: EventKind
  active: boolean
}

export type SessionConfigRow = {
  name: string
  code: string
  active: boolean
}

export type ProductConfigSet = {
  products: readonly ProductConfigRow[]
  advertisers: readonly AdvertiserConfigRow[]
  eventTypes: readonly EventTypeConfigRow[]
  sessions: readonly SessionConfigRow[]
}

/** Fee rule yang sudah dicocokkan exact dengan payment identifier sebuah order. */
export type MatchedFeeRule = {
  id: string | null
  name: string
  fee_type: EpaymentFeeType
  fee_value: number
  /** Bagian flat untuk `percentage_flat`; 0 untuk tipe lain. */
  fee_flat_value?: number
}

export type ProductAliasItem = {
  id: string
  alias_name: string
  alias_name_normalized: string
  canonical_target: string
  created_at: string
  updated_at: string
  created_by?: string | null
}

export type UnmappedOrderItem = {
  id: string
  order_id: string
  raw_order_id?: string | null
  connection_id?: string | null
  name?: string | null
  phone?: string | null
  email?: string | null
  product_raw?: string | null
  app_status: AppStatus
  gross_amount: number
  created_at: string
}

export type ResetDataScope =
  | 'orders_all'
  | 'orders_unmapped'
  | 'webhook_logs'
  | 'product_aliases'
  | 'connections'
  | 'products_master'
  | 'all_test_data'

export type DataSummaryResult = {
  orders_count: number
  unmapped_orders_count: number
  attendance_events_count: number
  order_sources_count: number
  webhook_logs_count: number
  product_aliases_count: number
  connections_count: number
  products_count: number
}

export type ResetDataResult = {
  success: boolean
  deleted: Record<string, number>
}
