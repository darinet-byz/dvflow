import { isMasterAdminRole, normalizeCode } from '@dvflow/shared'
import { ApiFailure } from './http/errors'
import type { RouteContext } from './router'
import { requireActiveUser, type UserRow } from './users'

/** Always resolve authority from the current database row, never the JWT role. */
export async function requirePermission(context: RouteContext, permission: string): Promise<UserRow> {
  const actor = await requireActiveUser(context)
  if (isMasterAdminRole(actor.role)) return actor
  if (permission === 'config.roles') throw new ApiFailure('FORBIDDEN')
  const rows = await context.db.selectRows<{ permission_key: string }>(
    'app_role_permissions', { role_id: `eq.${actor.role}`, permission_key: `eq.${permission}` }, 'permission_key',
  )
  if (!rows.some((row) => row.permission_key === permission)) throw new ApiFailure('FORBIDDEN')
  return actor
}

/** Several permissions at once (e.g. module + action.delete_master) with one user lookup. */
export async function requirePermissions(context: RouteContext, permissions: string[]): Promise<UserRow> {
  const actor = await requireActiveUser(context)
  if (isMasterAdminRole(actor.role)) return actor
  if (permissions.some((permission) => permission === 'config.roles')) throw new ApiFailure('FORBIDDEN')
  const rows = await context.db.selectRows<{ permission_key: string }>(
    'app_role_permissions', { role_id: `eq.${actor.role}` }, 'permission_key',
  )
  const granted = new Set(rows.map((row) => row.permission_key))
  if (!permissions.every((permission) => granted.has(permission))) throw new ApiFailure('FORBIDDEN')
  return actor
}

/**
 * Scope data order seorang aktor.
 *   * `all`/`codes` — produk (Pimpro, Member, …);
 *   * `advertiserCode` — pengiklan akun Advertiser (`null` = bukan akun pengiklan). Sejak A44 tidak lagi
 *     membatasi baca: produk dikontrol bersama, jadi akun Advertiser melihat semua pengiklan di produknya.
 *     Masih dipakai untuk menolak tulis global (alias).
 * Cermin dari `actor_can_order` di DB (0054); RLS tetap penegak utama.
 */
export type ProductAccess = { all: boolean; codes: string[]; advertiserCode: string | null }

export async function productAccess(context: RouteContext, actor: UserRow): Promise<ProductAccess> {
  const advertiserCode = await loadAdvertiserCode(context, actor)
  if (isMasterAdminRole(actor.role) || actor.has_all_product_access === true) return { all: true, codes: [], advertiserCode }
  const rows = await context.db.selectRows<{ product_code: string }>(
    'user_product_access', { user_id: `eq.${actor.id}` }, 'product_code',
  )
  return { all: false, codes: rows.map((row) => normalizeCode(row.product_code) ?? ''), advertiserCode }
}

async function loadAdvertiserCode(context: RouteContext, actor: UserRow): Promise<string | null> {
  if (!actor.advertiser_id) return null
  const rows = await context.db.selectRows<{ code: string }>('advertisers', { id: `eq.${actor.advertiser_id}` }, 'code')
  // Akun ber-pengiklan yang pengiklannya tak terbaca tidak boleh jatuh ke "tanpa batas".
  return rows[0]?.code ? normalizeCode(rows[0].code) : '__NO_ADVERTISER__'
}

/** Order boleh diakses aktor ini: cukup produknya (A44, semua pengiklan di produk yang sama). */
export function allowsOrder(access: ProductAccess, order: { product_code: string | null; advertiser_code: string | null }): boolean {
  return allowsProduct(access, order.product_code)
}

export function assertOrderAccess(access: ProductAccess, order: { product_code: string | null; advertiser_code: string | null }): void {
  assertProductAccess(access, order.product_code)
  if (!allowsOrder(access, order)) throw new ApiFailure('FORBIDDEN')
}

export function allowsProduct(access: ProductAccess, code: string | null | undefined): boolean {
  return access.all || (!!code && code !== '*' && access.codes.includes(normalizeCode(code) ?? ''))
}

export function assertProductAccess(access: ProductAccess, code: string | null | undefined): void {
  // '*' is a global write, not a product: plain FORBIDDEN. A concrete product uses the 05 §4 code.
  if (!allowsProduct(access, code)) throw new ApiFailure(code && code !== '*' ? 'FORBIDDEN_PRODUCT_ACCESS' : 'FORBIDDEN')
}

/** Values come from the master table, but are still quoted for PostgREST's filter grammar. */
export function productFilter(access: ProductAccess): Record<string, string> {
  const quoteList = (values: string[]) => `in.(${values.map((c) => `"${c.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')})`
  if (access.all) return {}
  return { product_code: access.codes.length ? quoteList(access.codes) : 'eq.__NO_PRODUCT_ACCESS__' }
}
