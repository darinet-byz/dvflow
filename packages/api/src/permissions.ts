import { isMasterAdminRole, normalizeCode } from '@dvflow/shared'
import { ApiFailure } from './http/errors'
import type { RouteContext } from './router'
import { requireActiveUser, type UserRow } from './users'

/** Always resolve authority from the current database row, never the JWT role. */
export async function requirePermission(context: RouteContext, permission: string): Promise<UserRow> {
  const actor = await requireActiveUser(context)
  if (isMasterAdminRole(actor.role)) return actor
  if (permission === 'config.roles' || permission === 'team.manage') throw new ApiFailure('FORBIDDEN')
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
  if (permissions.some((permission) => permission === 'config.roles' || permission === 'team.manage')) throw new ApiFailure('FORBIDDEN')
  const rows = await context.db.selectRows<{ permission_key: string }>(
    'app_role_permissions', { role_id: `eq.${actor.role}` }, 'permission_key',
  )
  const granted = new Set(rows.map((row) => row.permission_key))
  if (!permissions.every((permission) => granted.has(permission))) throw new ApiFailure('FORBIDDEN')
  return actor
}

export type ProductAccess = { all: boolean; codes: string[] }

export async function productAccess(context: RouteContext, actor: UserRow): Promise<ProductAccess> {
  if (isMasterAdminRole(actor.role) || actor.has_all_product_access === true) return { all: true, codes: [] }
  const rows = await context.db.selectRows<{ product_code: string }>(
    'user_product_access', { user_id: `eq.${actor.id}` }, 'product_code',
  )
  return { all: false, codes: rows.map((row) => normalizeCode(row.product_code) ?? '') }
}

export function allowsProduct(access: ProductAccess, code: string | null | undefined): boolean {
  return access.all || (!!code && code !== '*' && access.codes.includes(normalizeCode(code) ?? ''))
}

export function assertProductAccess(access: ProductAccess, code: string | null | undefined): void {
  if (!allowsProduct(access, code)) throw new ApiFailure('FORBIDDEN')
}

/** Values come from the master table, but are still quoted for PostgREST's filter grammar. */
export function productFilter(access: ProductAccess): Record<string, string> {
  if (access.all) return {}
  return { product_code: access.codes.length ? `in.(${access.codes.map((c) => `"${c.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')})` : 'eq.__NO_PRODUCT_ACCESS__' }
}
