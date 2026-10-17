import { isMasterAdminRole, type AppRole } from '@dvflow/shared'
import { createApi, type Api } from '../src/router'
import { ROUTES } from '../src/routes'
import { DbError, type Db } from '../src/db/types'
import type { Env } from '../src/env'

/**
 * Perkakas test.
 *
 * PENTING soal cakupan: `Db` di bawah adalah tiruan in-memory. Ia meniru
 * SEMANTIK yang dipakai handler (pencarian sesi aktif, pencabutan, akibat
 * `verify_login`/`change_password`/`admin_create_user`/`upsert_order_webhook`/
 * `checkin_seminar`, dan filter PostgREST yang kami pakai), bukan PostgreSQL.
 *
 * Kebenaran sisi database — RLS, idempotensi, aritmetika tax, unique index, dan
 * RPC itu sendiri — diuji di `supabase/tests/` (pgTAP) dan oleh
 * `test/integration/*` yang berjalan terhadap Supabase lokal.
 *
 * Pembagiannya disengaja: berkas ini menguji perilaku HTTP handler (kode status,
 * bentuk response, cookie, CSRF, batas peran, escaping HTML); berkas lain
 * menguji database.
 */

export type FakeUser = {
  id: string
  username: string
  display_name: string
  role: AppRole
  avatar_emoji: string | null
  active: boolean
  has_all_product_access?: boolean
  /** A20: hanya role advertiser. */
  advertiser_id?: string | null
  /** "Hash" di tiruan ini adalah plaintext; database sungguhan memakai bcrypt. */
  password: string
}

export type FakeSession = {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
}

export type FakeConfigRows = {
  products: Array<Record<string, unknown>>
  advertisers: Array<Record<string, unknown>>
  eventTypes: Array<Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
  feeRules: Array<Record<string, unknown>>
}

export const DEFAULT_ROLES = [
  { id: 'developer', name: 'Developer', description: 'Akses teknis sistem', is_system: true, created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' },
  { id: 'owner', name: 'Owner', description: 'Pemilik bisnis', is_system: true, created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' },
  { id: 'manajer', name: 'Manajer', description: 'Pengelola operasional', is_system: true, created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' },
  { id: 'admin', name: 'Admin', description: 'Administrasi harian acara', is_system: true, created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' },
  { id: 'pimpro', name: 'Pimpro', description: 'Pimpinan proyek produk', is_system: true, created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' },
  { id: 'member', name: 'Member', description: 'Operator registrasi', is_system: true, created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' },
  { id: 'master_admin', name: 'Admin Master (Legacy)', description: 'Role legacy setara Owner/Developer', is_system: true, created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' },
  { id: 'staff', name: 'Staff (Legacy)', description: 'Role legacy setara Member', is_system: true, created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' },
  { id: 'advertiser', name: 'Advertiser', description: 'Pengiklan', is_system: true, created_at: '2026-10-16T08:00:00Z', updated_at: '2026-10-16T08:00:00Z' },
]

export const DEFAULT_PERMISSIONS = [
  { key: 'operasional.scan_qr', name: 'Scan QR Tiket', module: 'operasional', description: 'Memindai QR tiket', sort_order: 1 },
  { key: 'operasional.dashboard', name: 'Dashboard Resume', module: 'operasional', description: 'Melihat dashboard', sort_order: 2 },
  { key: 'operasional.order', name: 'Data Order', module: 'operasional', description: 'Melihat order', sort_order: 3 },
  { key: 'operasional.presensi', name: 'Presensi Acara', module: 'operasional', description: 'Melihat presensi', sort_order: 4 },
  { key: 'operasional.generator', name: 'Product Name Generator', module: 'operasional', description: 'Generator nama produk', sort_order: 5 },
  { key: 'config.produk', name: 'Konfigurasi Produk', module: 'konfigurasi', description: 'Kelola produk', sort_order: 10 },
  { key: 'config.tax', name: 'Konfigurasi Tax & Fee', module: 'konfigurasi', description: 'Kelola tax fee', sort_order: 11 },
  { key: 'config.report_tax', name: 'Report Tax', module: 'konfigurasi', description: 'Laporan pajak', sort_order: 12 },
  { key: 'config.zoom', name: 'Konfigurasi Link Zoom', module: 'konfigurasi', description: 'Kelola link zoom', sort_order: 13 },
  { key: 'config.tiket', name: 'Konfigurasi Tiket Seminar', module: 'konfigurasi', description: 'Kelola tiket', sort_order: 14 },
  { key: 'config.integrasi', name: 'API & Webhook', module: 'konfigurasi', description: 'Kelola integrasi', sort_order: 15 },
  { key: 'config.roles', name: 'Konfigurasi Role & Permission', module: 'konfigurasi', description: 'Kelola role & permissions', sort_order: 16 },
  { key: 'team.manage', name: 'Manajemen Tim', module: 'team', description: 'Kelola tim', sort_order: 20 },
  { key: 'account.profile', name: 'Profil & Password', module: 'account', description: 'Kelola profil', sort_order: 30 },
  { key: 'action.export_data', name: 'Export Data Order & Presensi', module: 'aksi', description: 'Export data', sort_order: 40 },
  { key: 'action.manual_checkin', name: 'Manual Check-in', module: 'aksi', description: 'Check-in manual', sort_order: 41 },
  { key: 'action.delete_master', name: 'Hapus Data Master', module: 'aksi', description: 'Hapus master', sort_order: 42 },
]

export const DEFAULT_ROLE_PERMISSIONS: Array<{ role_id: string; permission_key: string }> = [
  ...DEFAULT_PERMISSIONS.flatMap((p) => [
    { role_id: 'developer', permission_key: p.key },
    { role_id: 'owner', permission_key: p.key },
    { role_id: 'master_admin', permission_key: p.key },
  ]),
  ...[
    'operasional.scan_qr', 'operasional.dashboard', 'operasional.order', 'operasional.presensi', 'operasional.generator',
    'config.produk', 'config.zoom', 'config.tiket',
    'account.profile', 'action.export_data', 'action.manual_checkin'
  ].map((key) => ({ role_id: 'manajer', permission_key: key })),
  ...[
    'operasional.scan_qr', 'operasional.dashboard', 'operasional.order', 'operasional.presensi', 'operasional.generator',
    'config.zoom', 'config.tiket',
    'account.profile', 'action.export_data', 'action.manual_checkin'
  ].map((key) => ({ role_id: 'admin', permission_key: key })),
  ...[
    'operasional.scan_qr', 'operasional.dashboard', 'operasional.order', 'operasional.presensi', 'operasional.generator',
    'account.profile', 'action.export_data', 'action.manual_checkin'
  ].map((key) => ({ role_id: 'pimpro', permission_key: key })),
  ...[
    'operasional.scan_qr', 'operasional.presensi', 'account.profile', 'action.manual_checkin'
  ].flatMap((key) => [
    { role_id: 'member', permission_key: key },
    { role_id: 'staff', permission_key: key },
  ]),
]

export type FakeState = {
  users: FakeUser[]
  sessions: FakeSession[]
  config: FakeConfigRows
  orders: Array<Record<string, unknown>>
  attendanceEvents: Array<Record<string, unknown>>
  appSettings: Array<Record<string, unknown>>
  webhookLogs: Array<Record<string, unknown>>
  roles: Array<Record<string, unknown>>
  permissions: Array<Record<string, unknown>>
  rolePermissions: Array<Record<string, unknown>>
  userProductAccess: Array<Record<string, unknown>>
  orderonlineConnections: Array<Record<string, unknown>>
  productAliases: Array<Record<string, unknown>>
  /** Semua panggilan RPC, untuk memastikan handler tidak melewati database. */
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
}

export function createFakeState(
  seed: {
    users?: FakeUser[]
    sessions?: FakeSession[]
    config?: Partial<FakeConfigRows>
    orders?: Array<Record<string, unknown>>
    attendanceEvents?: Array<Record<string, unknown>>
    appSettings?: Array<Record<string, unknown>>
    roles?: Array<Record<string, unknown>>
    permissions?: Array<Record<string, unknown>>
    rolePermissions?: Array<Record<string, unknown>>
    userProductAccess?: Array<Record<string, unknown>>
  } = {},
): FakeState {
  return {
    users: seed.users ?? [],
    sessions: seed.sessions ?? [],
    config: {
      products: seed.config?.products ?? [],
      advertisers: seed.config?.advertisers ?? [],
      eventTypes: seed.config?.eventTypes ?? [],
      sessions: seed.config?.sessions ?? [],
      feeRules: seed.config?.feeRules ?? [],
    },
    orders: seed.orders ?? [],
    attendanceEvents: seed.attendanceEvents ?? [],
    appSettings: seed.appSettings ?? [],
    webhookLogs: [],
    roles: seed.roles ?? [...DEFAULT_ROLES],
    permissions: seed.permissions ?? [...DEFAULT_PERMISSIONS],
    rolePermissions: seed.rolePermissions ?? [...DEFAULT_ROLE_PERMISSIONS],
    userProductAccess: seed.userProductAccess ?? [],
    orderonlineConnections: [],
    productAliases: [],
    rpcCalls: [],
  }
}

/**
 * Konfigurasi contoh yang membuat `KM01SO392 - S1 - Solo` terbaca.
 *
 * Salah satu produknya sengaja NONAKTIF: parser harus tetap memakainya
 * (STATE.md K8 — menonaktifkan produk tidak boleh mencabut akses order lama).
 */
/** UUID deterministik untuk fixture (id konfigurasi harus berbentuk UUID). */
function fixtureUuid(n: number): string {
  const digit = String(n)
  return `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`
}

/** UUID deterministik untuk baris yang dibuat tiruan; tidak bertabrakan dengan fixture. */
function generatedUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

export function sampleConfig(): FakeConfigRows {
  return {
    products: [
      { id: fixtureUuid(1), name: 'Kuliner Masteri', code: 'KM', active: false },
      { id: fixtureUuid(2), name: 'Bisnis Masteri', code: 'BM', active: true },
    ],
    advertisers: [{ id: fixtureUuid(3), name: 'Zul', code: '01', active: true }],
    eventTypes: [
      { id: fixtureUuid(4), name: 'Seminar Offline', code: 'SO', kind: 'seminar', active: true },
      { id: fixtureUuid(5), name: 'Webinar Online', code: 'WO', kind: 'webinar', active: true },
    ],
    sessions: [
      { id: fixtureUuid(6), name: 'Sesi 1', code: 'S1', active: true },
      { id: fixtureUuid(7), name: 'Sesi Tunggal', code: 'ST', active: true },
    ],
    feeRules: [
      { id: fixtureUuid(8), name: 'Admin Bank Transfer', identifier: 'bank_transfer', fee_type: 'flat', fee_value: 4000, active: true },
      { id: fixtureUuid(9), name: 'Fee QRIS 0.7%', identifier: 'qris', fee_type: 'percentage', fee_value: 0.7, active: true },
    ],
  }
}

/** Baris order siap pakai untuk menguji rute peserta/scanner. */
export function fakeOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-uuid-1',
    order_id: '283033796',
    name: 'Ahmad',
    phone: '+628111',
    app_status: 'Paid',
    event_type: 'Seminar Offline',
    product_raw: 'KM01SO392 - S1 - Solo',
    product_parse_status: 'valid',
    product_code: 'KM',
    product_name: 'Kuliner Masteri',
    advertiser_code: '01',
    advertiser_name: 'Zul',
    batch: '392',
    session: 'S1',
    city: 'Solo',
    gross_amount: 300000,
    quantity: 1,
    tax_amount: 4000,
    net_amount: 296000,
    ...overrides,
  }
}

const USER_DISABLED = 'DF005'
const INVALID_CREDENTIALS = 'DF004'
const WEAK_PASSWORD = 'DF007'
const MASTER_ADMIN_CREATE_FORBIDDEN = 'DF008'
const USERNAME_TAKEN = 'DF009'
const PASSWORD_MISMATCH = 'DF010'
const FORBIDDEN = 'DF006'

export function createFakeDb(state: FakeState): Db {
  const normalizeUsername = (value: string): string => value.trim().toLowerCase()
  let nextId = state.users.length + state.sessions.length + state.orders.length + 1

  return {
    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      state.rpcCalls.push({ name, args })

      if (name === 'save_role_permissions') {
        const keys = args['p_permissions'] as string[]
        if (keys.some(key => !state.permissions.some(p => p['key'] === key))) throw new DbError('DF011', 'invalid permission')
        let role = state.roles.find(r => r['id'] === args['p_role'])
        if (args['p_create']) {
          role = { id: args['p_role'], name: args['p_name'], description: args['p_description'], is_system: false }
          state.roles.push(role)
        }
        if (!role) throw new DbError('DF011', 'role not found')
        state.rolePermissions = state.rolePermissions.filter(p => p['role_id'] !== args['p_role'])
        state.rolePermissions.push(...keys.map(key => ({ role_id: args['p_role'], permission_key: key })))
        return role as T
      }
      if (name === 'delete_config_master') {
        const table = String(args['p_resource']).replace('event-types','event_types').replace('sessions','sessions_config').replace('payment-fee-rules','payment_fee_rules')
        const rows = rowsOf(state, table)
        const index = rows.findIndex(r => r['id'] === args['p_id'])
        if (index >= 0) rows.splice(index,1)
        return undefined as T
      }
      if (name === 'admin_delete_user') {
        // Meniru 0029: role penuh hanya dapat dihapus Developer; sesi ikut terhapus.
        const full = ['developer', 'owner', 'master_admin']
        const actor = state.users.find((u) => u.id === args['p_actor'])
        const target = state.users.find((u) => u.id === args['p_target'])
        if (!actor || !full.includes(actor.role) || actor.id === args['p_target']) throw new DbError('DF006', 'FORBIDDEN')
        if (!target) throw new DbError('DF005', 'USER_NOT_FOUND')
        if (full.includes(target.role) && actor.role !== 'developer') throw new DbError('DF006', 'FORBIDDEN')
        state.users.splice(state.users.indexOf(target), 1)
        for (let i = state.sessions.length - 1; i >= 0; i--) if (state.sessions[i]?.user_id === target.id) state.sessions.splice(i, 1)
        return undefined as T
      }
      if (name === 'verify_login') {
        const username = normalizeUsername(String(args['p_username'] ?? ''))
        const password = String(args['p_password'] ?? '')
        const user = state.users.find((candidate) => normalizeUsername(candidate.username) === username)

        // Pesan gagal selalu sama untuk user tidak dikenal dan password salah.
        if (user === undefined || user.password !== password) throw new DbError(INVALID_CREDENTIALS, 'fake')
        if (!user.active) throw new DbError(USER_DISABLED, 'fake')

        return {
          user_id: user.id,
          username: user.username,
          display_name: user.display_name,
          role: user.role,
          avatar_emoji: user.avatar_emoji,
        } as T
      }

      if (name === 'save_webinar_destination') {
        const key = 'webinar_destination::' + String(args['p_product_raw'])
        const row = { key, value_text: args['p_destination'], updated_by: args['p_actor'] }
        const existing = state.appSettings.find(item => item['key'] === key)
        if (existing) Object.assign(existing, row)
        else state.appSettings.push(row)
        return undefined as T
      }

      if (name === 'save_seminar_ticket') {
        const key = 'seminar_ticket::' + String(args['p_scope_key'])
        const row = { key, value_text: args['p_value_json'], updated_by: args['p_actor'] }
        const existing = state.appSettings.find(item => item['key'] === key)
        if (existing) Object.assign(existing, row)
        else state.appSettings.push(row)
        return undefined as T
      }

      if (name === 'upsert_order_webhook') {
        const payload = args['p_payload']
        if (!isFakeObject(payload)) throw new DbError('DF014', 'fake: payload bukan objek')

        const orderId = payload['orderId']
        if (typeof orderId !== 'string' || orderId === '') throw new DbError('DF014', 'fake: orderId kosong')
        if (typeof payload['appStatus'] !== 'string') throw new DbError('DF014', 'fake: appStatus kosong')
        // Kontrak 0017: productRaw hanya boleh dikirim bersama blok parse.
        if (payload['productRaw'] !== null && payload['productRaw'] !== undefined && !isFakeObject(payload['parse'])) {
          throw new DbError('DF014', 'fake: productRaw tanpa blok parse')
        }

        const existing = state.orders.find((row) => row['order_id'] === orderId)
        const incomingParse = isFakeObject(payload['parse']) ? payload['parse'] : null
        // Meniru 0034 (A17): parse invalid untuk nama produk yang sama tidak menghapus pemetaan valid.
        const sameRaw = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
        const mappingKept = existing !== undefined && incomingParse !== null && incomingParse['status'] !== 'valid' &&
          existing['product_parse_status'] === 'valid' && sameRaw(payload['productRaw'], existing['product_raw'])
        const parse = mappingKept ? {
          status: 'valid', productCode: existing['product_code'], productName: existing['product_name'],
          advertiserCode: existing['advertiser_code'], advertiserName: existing['advertiser_name'], eventType: existing['event_type'],
          batch: existing['batch'], session: existing['session'], city: existing['city'],
        } : incomingParse

        const row: Record<string, unknown> = {
          id: existing?.['id'] ?? generatedUuid((nextId += 1)),
          order_id: orderId,
          name: payload['customerName'] ?? existing?.['name'] ?? null,
          phone: payload['phone'] ?? existing?.['phone'] ?? null,
          app_status: payload['appStatus'],
          raw_status: payload['rawStatus'],
          product_raw: payload['productRaw'] ?? existing?.['product_raw'] ?? null,
          product_parse_status: parse === null ? (existing?.['product_parse_status'] ?? 'invalid') : parse['status'],
          product_code: parse?.['productCode'] ?? null,
          product_name: parse?.['productName'] ?? null,
          advertiser_code: parse?.['advertiserCode'] ?? null,
          advertiser_name: parse?.['advertiserName'] ?? null,
          event_type: parse?.['eventType'] ?? null,
          batch: parse?.['batch'] ?? null,
          session: parse?.['session'] ?? null,
          city: parse?.['city'] ?? null,
          payment_method: payload['paymentMethod'] ?? existing?.['payment_method'] ?? null,
          payment_provider: payload['paymentProvider'] ?? null,
          payment_identifier: payload['paymentIdentifier'] ?? existing?.['payment_identifier'] ?? null,
          gross_amount: payload['grossAmount'] ?? 0,
          quantity: payload['quantity'] ?? existing?.['quantity'] ?? 1,
          tax_amount: existing?.['tax_amount'] ?? 0,
          net_amount: existing?.['net_amount'] ?? payload['grossAmount'] ?? 0,
        }

        if (existing === undefined) state.orders.push(row)
        else Object.assign(existing, row)

        return { order_id: orderId, action: existing === undefined ? 'inserted' : 'updated', mapping_kept: mappingKept } as T
      }

      // A29: tiruan save/delete_ots_registration (aturan lengkap diuji pgTAP 19_ots.sql).
      if (name === 'save_ots_registration') {
        const actorId = String(args['p_actor'] ?? '')
        const actor = state.users.find((candidate) => candidate.id === actorId)
        const granted = actor !== undefined && (isMasterAdminRole(actor.role) ||
          state.rolePermissions.some((row) => row.role_id === actor.role && row.permission_key === 'action.ots'))
        if (!granted) throw new DbError(FORBIDDEN, 'fake')
        const existingId = args['p_order_id'] as string | null
        const fields = {
          name: args['p_name'], phone: args['p_phone'] ?? null, product_code: String(args['p_product_code']).toUpperCase(),
          batch: args['p_batch'] ?? null, session: args['p_session'] ?? null, city: args['p_city'] ?? null, event_type: args['p_event_type'],
          gross_amount: args['p_amount'], net_amount: args['p_amount'], payment_method: args['p_method'],
        }
        if (existingId) {
          const order = state.orders.find((row) => row['order_id'] === existingId)
          if (order === undefined || order['source'] !== 'ots') throw new DbError('DF001', 'fake')
          Object.assign(order, fields)
          return { order_id: existingId, action: 'updated', checked_in_at: null } as T
        }
        nextId += 1
        const orderId = 'OTS-' + String(nextId).padStart(6, '0')
        state.orders.push({ order_id: orderId, source: 'ots', app_status: 'Paid', quantity: 1, product_parse_status: 'valid',
          ots_collected_by: actorId, created_at: new Date().toISOString(), ...fields })
        const created = insertAttendance(state, { order_id: orderId, attendance_type: 'seminar', source: 'seminar_ots', scanner_user_id: actorId })
        return { order_id: orderId, action: 'created', checked_in_at: created['clicked_at'] } as T
      }

      if (name === 'delete_ots_registration') {
        const actor = state.users.find((candidate) => candidate.id === String(args['p_actor'] ?? ''))
        if (actor === undefined || !isMasterAdminRole(actor.role)) throw new DbError(FORBIDDEN, 'fake')
        const index = state.orders.findIndex((row) => row['order_id'] === args['p_order_id'] && row['source'] === 'ots')
        if (index < 0) throw new DbError('DF001', 'fake')
        state.orders.splice(index, 1)
        return { order_id: args['p_order_id'], deleted: true } as T
      }

      if (name === 'checkin_seminar') {
        const orderId = String(args['p_order_id'] ?? '')
        const order = state.orders.find((row) => row['order_id'] === orderId)

        if (order === undefined) throw new DbError('DF001', 'fake')
        if (order['app_status'] !== 'Paid') throw new DbError('DF002', 'fake')
        if (order['event_type'] !== 'Seminar Offline' && order['event_type'] !== 'Hybrid') throw new DbError('DF003', 'fake')

        const existing = state.attendanceEvents.find(
          (event) => event['order_id'] === orderId && event['attendance_type'] === 'seminar',
        )
        if (existing !== undefined) {
          return {
            order_id: orderId,
            state: 'ALREADY_CHECKED_IN',
            attendance_id: existing['id'],
            clicked_at: existing['clicked_at'],
            scanner_user_id: existing['scanner_user_id'],
          } as T
        }

        const created = insertAttendance(state, {
          order_id: orderId,
          attendance_type: 'seminar',
          source: args['p_source'],
          scanner_user_id: args['p_scanner_user_id'],
        })

        return {
          order_id: orderId,
          state: 'CHECKIN_SUCCESS',
          attendance_id: created['id'],
          clicked_at: created['clicked_at'],
          scanner_user_id: created['scanner_user_id'],
        } as T
      }

      if (name === 'change_password') {
        const userId = String(args['p_user_id'] ?? '')
        const currentPassword = String(args['p_current_password'] ?? '')
        const newPassword = String(args['p_new_password'] ?? '')
        const confirmation = String(args['p_new_password_confirmation'] ?? '')

        if (newPassword !== confirmation) throw new DbError(PASSWORD_MISMATCH, 'fake')
        if (newPassword.length < 8) throw new DbError(WEAK_PASSWORD, 'fake')

        const user = state.users.find((candidate) => candidate.id === userId)
        if (user === undefined) throw new DbError(FORBIDDEN, 'fake')
        if (user.password !== currentPassword) throw new DbError(INVALID_CREDENTIALS, 'fake')

        user.password = newPassword
        let revoked = 0
        for (const session of state.sessions) {
          if (session.user_id === userId && session.revoked_at === null) {
            session.revoked_at = new Date().toISOString()
            revoked += 1
          }
        }
        return { user_id: userId, revoked_sessions: revoked } as T
      }

      if (name === 'admin_create_user') {
        const actorId = String(args['p_actor_user_id'] ?? '')
        const actor = state.users.find((candidate) => candidate.id === actorId)
        if (actor === undefined || !actor.active || !isMasterAdminRole(actor.role)) {
          throw new DbError(FORBIDDEN, 'fake')
        }

        const role = String(args['p_role'] ?? '')
        if (isMasterAdminRole(role) && args['p_allow_master'] !== true) {
          throw new DbError(MASTER_ADMIN_CREATE_FORBIDDEN, 'fake')
        }

        const username = String(args['p_username'] ?? '')
        if (state.users.some((candidate) => normalizeUsername(candidate.username) === normalizeUsername(username))) {
          throw new DbError(USERNAME_TAKEN, 'fake')
        }

        const password = String(args['p_initial_password'] ?? '')
        if (password.length < 8) throw new DbError(WEAK_PASSWORD, 'fake')

        nextId += 1
        const hasAll = args['p_has_all_product_access'] !== false
        const created: FakeUser = {
          id: `user-${nextId}`,
          username,
          display_name: String(args['p_display_name'] ?? ''),
          role: role as AppRole,
          avatar_emoji: (args['p_avatar_emoji'] as string | null) ?? null,
          active: true,
          has_all_product_access: hasAll,
          advertiser_id: (args['p_advertiser_id'] as string | null | undefined) ?? null,
          password,
        }
        state.users.push(created)

        if (!hasAll && Array.isArray(args['p_product_codes'])) {
          for (const pc of args['p_product_codes']) {
            state.userProductAccess.push({ user_id: created.id, product_code: String(pc) })
          }
        }

        return {
          user_id: created.id,
          username: created.username,
          display_name: created.display_name,
          role: created.role,
          avatar_emoji: created.avatar_emoji,
          active: true,
          has_all_product_access: hasAll,
        } as T
      }

      if (name === 'admin_update_user') {
        const actorId = String(args['p_actor_user_id'] ?? '')
        const targetId = String(args['p_target_user_id'] ?? '')
        const actor = state.users.find((candidate) => candidate.id === actorId)
        if (actor === undefined || !actor.active || !isMasterAdminRole(actor.role)) {
          throw new DbError(FORBIDDEN, 'fake')
        }

        const target = state.users.find((candidate) => candidate.id === targetId)
        if (target === undefined) throw new DbError('DF011', 'fake')

        const role = String(args['p_role'] ?? '')
        const active = Boolean(args['p_active'])
        if (actorId === targetId && (!active || !isMasterAdminRole(role))) {
          throw new DbError(FORBIDDEN, 'fake')
        }
        if (isMasterAdminRole(role) && !isMasterAdminRole(target.role) && args['p_allow_master'] !== true) {
          throw new DbError(MASTER_ADMIN_CREATE_FORBIDDEN, 'fake')
        }

        const newPassword = args['p_new_password']
        if (typeof newPassword === 'string' && newPassword !== '') {
          if (newPassword.length < 8) throw new DbError(WEAK_PASSWORD, 'fake')
          target.password = newPassword
          for (const session of state.sessions) {
            if (session.user_id === target.id && session.revoked_at === null) {
              session.revoked_at = new Date().toISOString()
            }
          }
        } else if (!active) {
          for (const session of state.sessions) {
            if (session.user_id === target.id && session.revoked_at === null) {
              session.revoked_at = new Date().toISOString()
            }
          }
        }

        target.display_name = String(args['p_display_name'] ?? target.display_name)
        target.role = role as AppRole
        target.active = active
        const hasAll = args['p_has_all_product_access'] !== false
        target.has_all_product_access = hasAll
        target.advertiser_id = (args['p_advertiser_id'] as string | null | undefined) ?? null

        for (let i = state.userProductAccess.length - 1; i >= 0; i--) {
          if (state.userProductAccess[i]?.user_id === target.id) {
            state.userProductAccess.splice(i, 1)
          }
        }
        if (!hasAll && Array.isArray(args['p_product_codes'])) {
          for (const pc of args['p_product_codes']) {
            state.userProductAccess.push({ user_id: target.id, product_code: String(pc) })
          }
        }

        return {
          id: target.id,
          user_id: target.id,
          username: target.username,
          display_name: target.display_name,
          role: target.role,
          avatar_emoji: target.avatar_emoji,
          active: target.active,
          has_all_product_access: hasAll,
        } as T
      }

      throw new Error(`RPC tidak dikenal di tiruan: ${name}`)
    },

    async selectRows<T>(table: string, query: Record<string, string>, columns: string): Promise<T[]> {
      const rows = rowsOf(state, table)
      const matched = rows.filter((row) => matchesQuery(row, query))
      const offset = Number(query['offset'] ?? 0)
      const end = query['limit'] === undefined ? undefined : offset + Number(query['limit'])
      return matched.slice(offset, end).map((row) => project(row, columns) as T)
    },

    async countRows(table: string, query: Record<string, string>): Promise<number> {
      return rowsOf(state, table).filter((row) => matchesQuery(row, query)).length
    },

    async insertRow<T>(table: string, row: Record<string, unknown>, columns = '*'): Promise<T> {
      nextId += 1

      if (table === 'app_sessions') {
        const session: FakeSession = {
          id: `session-${nextId}`,
          user_id: String(row['user_id']),
          token_hash: String(row['token_hash']),
          expires_at: String(row['expires_at']),
          revoked_at: null,
          last_used_at: null,
        }
        state.sessions.push(session)
        return project(session as unknown as Record<string, unknown>, columns) as T
      }

      if (table === 'attendance_events') {
        return project(insertAttendance(state, row), columns) as T
      }

      if (table === 'users') {
        const user: FakeUser = { ...(row as unknown as FakeUser), id: `user-${nextId}` }
        state.users.push(user)
        return project(user as unknown as Record<string, unknown>, columns) as T
      }

      if (table === 'webhook_logs') {
        state.webhookLogs.push({ id: `log-${nextId}`, ...row })
        return project(row, columns) as T
      }

      // Tabel konfigurasi atau tabel dinamis lainnya.
      const configRows = rowsOf(state, table)
      const created = { id: row['id'] ?? generatedUuid(nextId), active: true, ...row }
      assertFakeUnique(table, configRows, created)
      configRows.push(created)
      return project(created, columns) as T
    },

    async updateRows(table: string, query: Record<string, string>, patch: Record<string, unknown>): Promise<void> {
      const rows = rowsOf(state, table)

      for (const row of rows) {
        if (!matchesQuery(row, query)) continue
        // Perubahan kode tetap melewati aturan unik, seperti di database.
        assertFakeUnique(table, rows, { ...row, ...patch })
        Object.assign(row, patch)
      }
    },

    async deleteRows(table: string, query: Record<string, string>): Promise<void> {
      const rows = rowsOf(state, table)
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i]
        if (row !== undefined && matchesQuery(row, query)) {
          rows.splice(i, 1)
        }
      }
    },
  }
}

function insertAttendance(state: FakeState, row: Record<string, unknown>): Record<string, unknown> {
  const created: Record<string, unknown> = {
    id: generatedUuid(state.attendanceEvents.length + 100),
    clicked_at: '2026-10-13T08:00:00.000Z',
    scanner_user_id: null,
    ...row,
  }
  state.attendanceEvents.push(created)
  return created
}

function isFakeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rowsOf(state: FakeState, table: string): Array<Record<string, unknown>> {
  switch (table) {
    case 'users':
      return state.users as unknown as Array<Record<string, unknown>>
    case 'app_sessions':
      return state.sessions as unknown as Array<Record<string, unknown>>
    case 'orders':
      return state.orders
    case 'attendance_events':
      return state.attendanceEvents
    case 'app_settings':
      return state.appSettings
    case 'products':
      return state.config.products
    case 'advertisers':
      return state.config.advertisers
    case 'event_types':
      return state.config.eventTypes
    case 'sessions_config':
      return state.config.sessions
    case 'payment_fee_rules':
      return state.config.feeRules
    case 'app_roles':
      return state.roles
    case 'app_permissions':
      return state.permissions
    case 'app_role_permissions':
      return state.rolePermissions
    case 'orderonline_connections':
      return state.orderonlineConnections
    case 'product_aliases':
      return state.productAliases
    case 'user_product_access':
      return state.userProductAccess
    default:
      throw new Error(`tabel tidak dikenal di tiruan: ${table}`)
  }
}

const CONFIG_TABLES = ['products', 'advertisers', 'event_types', 'sessions_config', 'payment_fee_rules']

/** Unik `code_normalized` (atau `identifier_normalized` untuk fee rule) — meniru index unik database. */
function assertFakeUnique(table: string, rows: Array<Record<string, unknown>>, row: Record<string, unknown>): void {
  if (!CONFIG_TABLES.includes(table)) return

  const isFeeRule = table === 'payment_fee_rules'
  const field = isFeeRule ? 'identifier' : 'code'
  const key = isFeeRule
    ? normalizeFakeIdentifier(String(row[field] ?? ''))
    : normalizeFakeCode(String(row[field] ?? ''))

  const clash = rows.some((existing) => {
    // Baris yang sedang diubah tidak dibandingkan dengan dirinya sendiri.
    if (existing['id'] !== undefined && existing['id'] === row['id']) return false
    const existingKey = isFeeRule
      ? normalizeFakeIdentifier(String(existing[field] ?? ''))
      : normalizeFakeCode(String(existing[field] ?? ''))
    if (existingKey !== key) return false
    // Pada fee rule, yang unik hanyalah rule AKTIF (index parsial di 0008).
    if (isFeeRule) return (row['active'] ?? true) === true && (existing['active'] ?? true) === true
    return true
  })

  if (clash) throw new DbError('23505', `fake: ${field} ${key} sudah ada`)
}

function normalizeFakeCode(value: string): string {
  return value.trim().toUpperCase()
}

function normalizeFakeIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Filter PostgREST seperlunya.
 *
 * Mendukung `eq.`, `is.null`, `is.true`, `gt.`, `in.(...)`, `ilike.<pola>` dengan
 * `*` sebagai wildcard, dan `or=(...)`. Cukup untuk filter yang benar-benar
 * dipakai handler; bukan implementasi PostgREST yang lengkap.
 */
function matchesQuery(row: Record<string, unknown>, query: Record<string, string>): boolean {
  return Object.entries(query).every(([key, expression]) => {
    if (['order', 'offset', 'limit'].includes(key)) return true
    if (expression.startsWith('like.')) return String(row[key] ?? '').startsWith(expression.slice(5).replace(/\*$/, ''))
    if (key === 'or') return matchesOrExpression(row, expression)

    const value = row[key]

    if (expression === 'is.null') return value === null || value === undefined
    if (expression === 'is.true') return value === true
    if (expression.startsWith('gte.')) return typeof value === 'string' && value >= expression.slice(4)
    if (expression.startsWith('gt.')) return typeof value === 'string' && value > expression.slice(3)
    if (expression.startsWith('eq.')) return String(value ?? '') === expression.slice(3)
    if (expression.startsWith('in.')) {
      // PostgREST membuang tanda kutip ganda di sekitar nilai daftar.
      const list = expression.slice(3).replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, ''))
      return list.includes(String(value ?? ''))
    }
    if (expression.startsWith('ilike.')) return matchesIlike(value, expression.slice(6))

    throw new Error(`operator filter tidak dikenal di tiruan: ${expression}`)
  })
}

function matchesOrExpression(row: Record<string, unknown>, expression: string): boolean {
  const inner = expression.replace(/^\(|\)$/g, '')
  return inner.split(',').some((clause) => {
    const separator = clause.indexOf('.')
    if (separator === -1) return false
    const column = clause.slice(0, separator)
    const operator = clause.slice(separator + 1)
    if (!operator.startsWith('ilike.')) throw new Error(`or: operator tidak didukung: ${operator}`)
    return matchesIlike(row[column], operator.slice(6))
  })
}

function matchesIlike(value: unknown, pattern: string): boolean {
  const text = String(value ?? '').toLowerCase()
  const needle = pattern.replace(/^\*|\*$/g, '').toLowerCase()
  return text.includes(needle)
}

function project(row: Record<string, unknown>, columns: string): Record<string, unknown> {
  if (columns === '*') return { ...row }
  const selected: Record<string, unknown> = {}
  for (const column of columns.split(',').map((value) => value.trim())) {
    if (column in row) selected[column] = row[column]
  }
  return selected
}

/** Base64 standar (bukan base64url) untuk badan PEM. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function toPem(der: ArrayBuffer, label: string): string {
  const base64 = toBase64(new Uint8Array(der))
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

/** Pasangan kunci ES256 baru, dalam bentuk yang diterima `Env`. */
export async function createTestKeyPair(): Promise<{ privatePem: string; keyId: string }> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  return { privatePem: toPem(pkcs8, 'PRIVATE KEY'), keyId: 'test-key-1' }
}

export async function createTestEnv(overrides: Partial<Env> = {}): Promise<Env> {
  const { privatePem, keyId } = await createTestKeyPair()
  return {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'service-key-yang-tidak-boleh-bocor',
    APP_JWT_PRIVATE_KEY: privatePem,
    APP_JWT_KEY_ID: keyId,
    ...overrides,
  }
}

export const TEST_ORIGIN = 'https://app.example.com'

export function makeRequest(options: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  path: string
  /** Body yang akan di-JSON-stringify. */
  body?: unknown
  /** Body mentah, untuk menguji payload yang bukan JSON. */
  rawBody?: string
  headers?: Record<string, string>
  /** `null` berarti header Origin sengaja tidak dikirim. */
  origin?: string | null
}): Request {
  const headers = new Headers(options.headers ?? {})
  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin
  if (origin !== null) headers.set('origin', origin)

  const init: RequestInit = { method: options.method, headers }
  if (options.rawBody !== undefined) {
    init.body = options.rawBody
  } else if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(options.body)
  }

  return new Request(`${TEST_ORIGIN}${options.path}`, init)
}

export const FIXED_NOW = (): Date => new Date('2026-10-13T08:00:00.000Z')

/**
 * Bangun API dari environment yang SUDAH ada.
 *
 * Dipakai test yang perlu menandatangani token sendiri dengan kunci yang sama
 * dengan yang dipakai handler — kalau env-nya berbeda, token akan ditolak
 * karena `kid`/kunci tidak cocok dan test menjadi tidak bermakna.
 */
export function createApiWithEnv(env: Env, state: FakeState, now: () => Date = FIXED_NOW): Api {
  return createApi({ env, db: createFakeDb(state), routes: ROUTES, now })
}

export async function createTestApi(
  state: FakeState,
  options: { env?: Partial<Env>; now?: () => Date } = {},
): Promise<{ api: Api; env: Env }> {
  const env = await createTestEnv(options.env)
  const api = createApiWithEnv(env, state, options.now ?? FIXED_NOW)
  return { api, env }
}

/** Ekstrak nilai cookie dari header `set-cookie`. */
export function readSetCookie(response: Response, name: string): string | null {
  const header = response.headers.get('set-cookie')
  if (header === null) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export async function readBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** Pengguna uji standar. */
export function fakeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'user-admin',
    username: 'admin1',
    display_name: 'Admin Satu',
    role: 'admin',
    avatar_emoji: null,
    active: true,
    has_all_product_access: true,
    password: 'rahasia123',
    ...overrides,
  }
}

/** Login sebagai user uji dan kembalikan access token-nya. */
export async function loginAndGetToken(
  api: Api,
  username: string,
  password = 'rahasia123',
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const response = await api(
    makeRequest({ method: 'POST', path: '/api/auth/login', body: { username, password } }),
  )
  const body = (await response.json()) as { ok: boolean; data?: { access_token: string } }
  if (!body.ok || body.data === undefined) throw new Error(`login gagal untuk ${username}`)

  return {
    accessToken: body.data.access_token,
    refreshToken: readSetCookie(response, 'dvflow_refresh'),
  }
}
