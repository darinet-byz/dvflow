import {
  findAmbiguousCodeCombinations,
  normalizeCode,
  normalizePaymentIdentifier,
  type AdvertiserConfigRow,
  type EventKind,
  type EventTypeConfigRow,
  type ProductConfigRow,
} from '@dvflow/shared'
import type { Db } from '../db/types'
import { ApiFailure } from '../http/errors'
import { isUuid } from '../http/postgrest-filter'
import { ok, readJsonObject } from '../http/response'
import type { RouteContext } from '../router'
import { requirePermission, productAccess, assertProductAccess } from '../permissions'
import { findConfigResource, validateConfigBody, type ConfigResource } from './resources'

/**
 * Penulisan konfigurasi (03 §12, 01 §8).
 *
 * Empat aturan yang dijaga di sini:
 *   1. permission modul dan cakupan produk dari database — dan perannya dibaca dari BARIS DATABASE,
 *      bukan dari claim token, sehingga klaim yang berbohong tidak menolong
 *      (04 §5);
 *   2. `Delete` berarti `active = false`; tidak ada hard delete (01 §8);
 *   3. kode konfigurasi tidak boleh membuat kombinasi kode menjadi ambigu, kalau
 *      tidak parser tidak akan pernah dapat memetakan produk dengan pasti (D07);
 *   4. validasi dijalankan sebelum menulis, sehingga tidak ada baris setengah
 *      jadi yang perlu dibersihkan.
 *
 * Daftar (GET) TIDAK ada di sini dengan sengaja: browser membaca konfigurasi
 * langsung dari Supabase lewat RLS (02 §14, K11).
 */

export async function createConfig(context: RouteContext): Promise<Response> {
  const resource = requireResource(context)
  const actor = await requirePermission(context, resource.urlName === 'payment-fee-rules' ? 'config.tax' : 'config.produk')
  const access = await productAccess(context, actor)

  assertProductAccess(access, '*')
  const body = await readJsonObject(context.request)
  const values = validateConfigBody(resource, body, { partial: false })

  await assertIdentityAvailable(context.db, resource, { ignoringId: null, incoming: values })

  if (resource.participatesInCodeCombinations) {
    await assertCombinationsRemainUnambiguous(context.db, resource, { replacingCode: null, incoming: values })
  }

  const created = await context.db.insertRow<Record<string, unknown>>(
    resource.table,
    values,
    resource.columns.join(','),
  )

  return ok({ resource: resource.urlName, item: created }, { status: 201 })
}

export async function updateConfig(context: RouteContext): Promise<Response> {
  const resource = requireResource(context)
  const actor = await requirePermission(context, resource.urlName === 'payment-fee-rules' ? 'config.tax' : 'config.produk')
  const access = await productAccess(context, actor)

  const id = requireUuid(context)
  const existing = await loadRow(context.db, resource, id)
  if (existing === null) throw new ApiFailure('RESOURCE_NOT_FOUND', `id=${id}`)
  assertProductAccess(access, resource.urlName === 'products' ? String(existing['code']) : '*')

  const body = await readJsonObject(context.request)
  // An unchanged code is not an edit of the code: legacy rows stay renamable and
  // the strict format rule only applies to codes that are actually written.
  if (resource.identityColumn === 'code' && typeof body['code'] === 'string' &&
    body['code'].trim().toUpperCase() === String(existing['code']).toUpperCase()) delete body['code']
  if (Object.keys(body).length === 0) return ok({ resource: resource.urlName, item: existing })
  const values = validateConfigBody(resource, body, { partial: true })

  // Status produk/advertiser dikelola di halaman Status, bukan lewat toggle config.
  if (resource.urlName === 'products' && typeof values['active'] === 'boolean') {
    values['status'] = values['active'] ? 'Active' : 'In-Active'
  }
  if (resource.urlName === 'advertisers' && typeof values['active'] === 'boolean') {
    values['status'] = values['active'] ? 'In-House' : 'Resign'
  }

  // Re-activating a fee rule must respect the active-only unique identifier too.
  await assertIdentityAvailable(context.db, resource, {
    ignoringId: id,
    incoming: { [resource.identityColumn]: existing[resource.identityColumn], active: existing['active'], ...values },
  })

  // Pemeriksaan ambiguitas hanya dijalankan bila kodenya benar-benar berubah:
  // menyunting nama tidak boleh ikut terblokir oleh keadaan konfigurasi yang
  // sudah ada sebelumnya.
  const codeChanged =
    resource.identityColumn === 'code' && typeof values['code'] === 'string' && values['code'] !== existing['code']

  if (resource.participatesInCodeCombinations && codeChanged) {
    await assertCombinationsRemainUnambiguous(context.db, resource, {
      replacingCode: String(existing['code']),
      incoming: values,
    })
  }

  await context.db.updateRows(resource.table, { id: `eq.${id}` }, values)
  // Toggle config advertiser tetap sinkron dengan akses login (Resign/aktif).
  if (resource.urlName === 'advertisers' && typeof values['active'] === 'boolean') {
    await context.db.updateRows('users', { advertiser_id: `eq.${id}` }, { active: values['active'] })
  }

  const updated = await loadRow(context.db, resource, id)
  return ok({ resource: resource.urlName, item: updated })
}

/**
 * DELETE = nonaktifkan (01 §8).
 *
 * Baris TIDAK dihapus: order historis tetap dapat dijelaskan oleh baris
 * konfigurasi yang dahulu dipakainya, dan parser tetap memakai baris nonaktif
 * (K8). Tidak ada endpoint hard delete, sesuai 03 §12.
 */
export async function deactivateConfig(context: RouteContext): Promise<Response> {
  const resource = requireResource(context)
  const actor = await requirePermission(context, resource.urlName === 'payment-fee-rules' ? 'config.tax' : 'config.produk')
  const access = await productAccess(context, actor)

  const id = requireUuid(context)
  const existing = await loadRow(context.db, resource, id)
  if (existing === null) throw new ApiFailure('RESOURCE_NOT_FOUND', `id=${id}`)
  assertProductAccess(access, resource.urlName === 'products' ? String(existing['code']) : '*')

  if (context.url.searchParams.get('permanent') === 'true') {
    await requirePermission(context, 'action.delete_master')
    await context.db.rpc('delete_config_master', { p_actor: actor.id, p_resource: resource.urlName, p_id: id })
    return ok({ resource: resource.urlName, deleted: id })
  }

  const deactivateValues: Record<string, unknown> = { active: false }
  if (resource.urlName === 'products') deactivateValues['status'] = 'In-Active'
  if (resource.urlName === 'advertisers') deactivateValues['status'] = 'Resign'
  await context.db.updateRows(resource.table, { id: `eq.${id}` }, deactivateValues)
  // Resign dari halaman konfigurasi tetap menutup akses akun login.
  if (resource.urlName === 'advertisers') {
    await context.db.updateRows('users', { advertiser_id: `eq.${id}` }, { active: false })
  }

  const updated = await loadRow(context.db, resource, id)
  return ok({ resource: resource.urlName, item: updated })
}

function requireResource(context: RouteContext): ConfigResource {
  const resource = findConfigResource(context.params['resource'])
  if (resource === null) throw new ApiFailure('RESOURCE_NOT_FOUND', `resource=${context.params['resource']}`)
  return resource
}

function requireUuid(context: RouteContext): string {
  const id = context.params['id'] ?? ''
  if (!isUuid(id)) throw new ApiFailure('RESOURCE_NOT_FOUND', 'id bukan UUID')
  return id
}

async function loadRow(db: Db, resource: ConfigResource, id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.selectRows<Record<string, unknown>>(
    resource.table,
    { id: `eq.${id}` },
    resource.columns.join(','),
  )
  return rows[0] ?? null
}

type CodeChange = { replacingCode: string | null; incoming: Record<string, unknown> }

/**
 * Identitas (kode / identifier) harus belum dipakai baris lain.
 *
 * Diperiksa di sini — bukan hanya mengandalkan unique index database — karena
 * pesannya berbeda: "kode sudah dipakai" jauh lebih berguna bagi operator
 * daripada kegagalan constraint, dan pemeriksaan ini juga mencegah guard
 * ambiguitas di bawah melaporkan "kombinasi ambigu" untuk sesuatu yang
 * sebenarnya hanya duplikat.
 *
 * Unique index database tetap menjadi jaring terakhir (termasuk untuk balapan
 * antar dua admin), dan pelanggarannya dipetakan ke `CODE_TAKEN`.
 */
async function assertIdentityAvailable(
  db: Db,
  resource: ConfigResource,
  change: { ignoringId: string | null; incoming: Record<string, unknown> },
): Promise<void> {
  const field = resource.identityColumn
  if (!(field in change.incoming)) return

  const isFeeRule = resource.urlName === 'payment-fee-rules'
  const normalize = (value: unknown): string | null =>
    isFeeRule ? normalizePaymentIdentifier(String(value ?? '')) : normalizeCode(String(value ?? ''))
  const key = normalize(change.incoming[field])
  if (key === null) return

  const rows = await db.selectRows<Record<string, unknown>>(resource.table, {}, resource.columns.join(','))
  const incomingActive = (change.incoming['active'] ?? true) === true

  for (const row of rows) {
    if (change.ignoringId !== null && String(row['id']) === change.ignoringId) continue
    if (normalize(row[field]) !== key) continue

    // Identifier fee rule hanya unik di antara rule AKTIF (index parsial, 0008).
    if (isFeeRule) {
      if (!incomingActive || row['active'] !== true) continue
      throw new ApiFailure('IDENTIFIER_TAKEN', `identifier=${key}`)
    }

    throw new ApiFailure('CODE_TAKEN', `code=${key}`)
  }
}

/**
 * Tolak penulisan kode yang membuat dua kombinasi saling menaungi (D07).
 *
 * Contoh yang ditolak: produk `K` + pengiklan `M01` dan produk `KM` + pengiklan
 * `01` menghasilkan blok kode yang identik, sehingga `KM01SO392` tidak lagi
 * punya arti tunggal. Parser memang akan menandainya `invalid` (tidak pernah
 * menebak), tetapi membiarkannya berarti setiap order menjadi tidak terbaca —
 * jadi lebih baik ditolak di titik tulisnya, saat masih ada orang yang dapat
 * memperbaikinya.
 *
 * Hanya KODE yang diperhitungkan, jadi memperbarui nama/status tidak pernah
 * mengubah hasil pemeriksaan ini.
 */
async function assertCombinationsRemainUnambiguous(
  db: Db,
  resource: ConfigResource,
  change: CodeChange,
): Promise<void> {
  const [products, advertisers, eventTypes] = await Promise.all([
    db.selectRows<ProductConfigRow>('products', {}, 'name,code,active'),
    db.selectRows<AdvertiserConfigRow>('advertisers', {}, 'name,code,active'),
    db.selectRows<EventTypeConfigRow>('event_types', {}, 'name,code,kind,active'),
  ])

  const incomingCode = String(change.incoming['code'] ?? '')
  const incomingKind = (change.incoming['kind'] ?? 'seminar') as EventKind

  const prospective = {
    products:
      resource.table === 'products'
        ? withCodeChange(products, change, () => ({ name: '', code: incomingCode, active: true }))
        : products,
    advertisers:
      resource.table === 'advertisers'
        ? withCodeChange(advertisers, change, () => ({ name: '', code: incomingCode, active: true }))
        : advertisers,
    eventTypes:
      resource.table === 'event_types'
        ? withCodeChange(eventTypes, change, () => ({
            name: '',
            code: incomingCode,
            kind: incomingKind,
            active: true,
          }))
        : eventTypes,
  }

  const conflicts = findAmbiguousCodeCombinations(prospective)
  if (conflicts.length === 0) return

  throw new ApiFailure(
    'CODE_AMBIGUOUS',
    conflicts.map((conflict) => `${conflict.first} vs ${conflict.second}`).join('; '),
  )
}

/**
 * Terapkan perubahan kode pada daftar yang akan diperiksa.
 *
 * Hanya `code` yang diubah — cukup, karena pemeriksaan ambiguitas memang hanya
 * membaca kode, dan dengan begitu tidak ada kolom lain yang perlu dikarang.
 */
function withCodeChange<T extends { code: string }>(
  rows: readonly T[],
  change: CodeChange,
  buildNewRow: () => T,
): T[] {
  if (change.replacingCode === null) return [...rows, buildNewRow()]

  const index = rows.findIndex((row) => row.code === change.replacingCode)
  if (index === -1) return [...rows, buildNewRow()]

  const next = [...rows]
  const current = rows[index] as T
  next[index] = { ...current, code: String(change.incoming['code'] ?? current.code) }
  return next
}

/** A15: PLATFORM FEE global (persen dari gross) — `app_settings` key ini dibaca `platform_fee_percent()` (0031). */
const PLATFORM_FEE_KEY = 'fee_setting::platform_fee_percent'

/** GET /api/config/platform-fee */
export async function getPlatformFee(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.tax')
  const [row] = await context.db.selectRows<{ value_text: string | null }>('app_settings', { key: `eq.${PLATFORM_FEE_KEY}` }, 'value_text')
  const percent = Number(row?.value_text ?? 0)
  return ok({ percent: Number.isFinite(percent) ? percent : 0 })
}

/** PUT /api/config/platform-fee — berlaku untuk order yang dihitung berikutnya; snapshot lama tidak berubah. */
export async function savePlatformFee(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'config.tax')
  // Setting global, sama seperti menulis fee rule: perlu akses semua produk.
  assertProductAccess(await productAccess(context, actor), '*')
  const body = await readJsonObject(context.request)
  const percent = body['percent']
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Platform Fee wajib angka 0–100 (%).')
  }
  const value = String(Math.round(percent * 10000) / 10000)
  const [existing] = await context.db.selectRows<{ key: string }>('app_settings', { key: `eq.${PLATFORM_FEE_KEY}` }, 'key')
  if (existing) {
    await context.db.updateRows('app_settings', { key: `eq.${PLATFORM_FEE_KEY}` }, { value_text: value, updated_by: actor.id })
  } else {
    await context.db.insertRow('app_settings', { key: PLATFORM_FEE_KEY, value_text: value, updated_by: actor.id }, 'key')
  }
  return ok({ percent: Number(value) })
}
