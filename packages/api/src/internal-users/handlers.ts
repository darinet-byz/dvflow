import { APP_ROLES, isMasterAdminRole, normalizeCode, type AppRole } from '@dvflow/shared'
import { DbError } from '../db/types'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import { allowsProduct, productAccess, requirePermission } from '../permissions'
import type { RouteContext } from '../router'
import { requireActiveUser, USER_COLUMNS, type UserRow } from '../users'
import { AVATAR_EMOJI_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH, USERNAME_MAX_LENGTH } from '../users'

/** The RPC silently skips unknown codes; reject them so a typo cannot create a zero-product user. */
async function assertKnownProducts(context: RouteContext, codes: string[]): Promise<void> {
  if (codes.length === 0) return
  const rows = await context.db.selectRows<{ code: string }>('products', {}, 'code')
  const known = new Set(rows.map((row) => row.code.toUpperCase()))
  if (codes.some((code) => !known.has(code))) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Kode produk tidak dikenal')
}

/** Role yang wajib memegang satu pengiklan (A20). */
export const ADVERTISER_ROLE = 'advertiser'

/**
 * A20: role advertiser wajib memegang tepat satu pengiklan aktif (atau tetap yang lama saat edit);
 * role lain tidak memegang pengiklan. DB menegakkan hal yang sama (constraint + RPC 0037).
 */
async function resolveAdvertiserId(
  context: RouteContext,
  role: string,
  body: Record<string, unknown>,
  currentId: string | null = null,
): Promise<string | null> {
  if (role !== ADVERTISER_ROLE) return null
  const requested = readString(body, 'advertiser_id')?.trim() || currentId
  if (!requested) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih pengiklan untuk role Advertiser')
  const [row] = await context.db.selectRows<{ id: string; active: boolean }>('advertisers', { id: `eq.${requested}` }, 'id,active')
  if (!row || (!row.active && row.id !== currentId)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pengiklan tidak dikenal atau nonaktif')
  }
  return row.id
}

const BLOCKED_ASSIGN_ROLES = new Set(['developer', 'owner', 'manajer', 'admin'])
const ROLE_INTRINSIC_PERMISSIONS = new Set(['ui.field_app', 'action.input_spend'])

/**
 * A50: pemegang team.manage hanya boleh memberikan role yang tidak lebih tinggi
 * dari dirinya. Role master/Admin/Manajer diblokir; role kustom harus subset.
 */
async function canAssignRole(
  context: RouteContext,
  actor: UserRow,
  roleId: string,
): Promise<boolean> {
  if (isMasterAdminRole(actor.role)) return true
  if (BLOCKED_ASSIGN_ROLES.has(roleId)) return false
  const [actorRows, roleRows] = await Promise.all([
    context.db.selectRows<{ permission_key: string }>(
      'app_role_permissions',
      { role_id: `eq.${actor.role}` },
      'permission_key',
    ),
    context.db.selectRows<{ permission_key: string }>(
      'app_role_permissions',
      { role_id: `eq.${roleId}` },
      'permission_key',
    ),
  ])
  const actorPerms = new Set(actorRows.map((row) => row.permission_key))
  const targetPerms = roleRows.map((row) => row.permission_key)
  if (targetPerms.some((key) => key === 'config.roles' || key === 'team.manage')) return false
  return targetPerms.every((key) => ROLE_INTRINSIC_PERMISSIONS.has(key) || actorPerms.has(key))
}

function assertCanAssignProducts(
  access: Awaited<ReturnType<typeof productAccess>>,
  hasAll: boolean,
  codes: string[],
): void {
  if (hasAll && !access.all) {
    throw new ApiFailure('FORBIDDEN', undefined, 'Anda hanya dapat memberikan produk yang Anda pegang.')
  }
  if (!hasAll && codes.some((code) => !allowsProduct(access, code))) {
    throw new ApiFailure('FORBIDDEN', undefined, 'Anda hanya dapat memberikan produk yang Anda pegang.')
  }
}

type CreatedUser = {
  user_id: string
  username: string
  display_name: string
  role: AppRole
  avatar_emoji: string | null
  active: boolean
  has_all_product_access?: boolean
  allowed_product_codes?: string[]
}

export type ListedUser = {
  id: string
  username: string
  display_name: string
  role: AppRole
  avatar_emoji: string | null
  active: boolean
  has_all_product_access: boolean
  allowed_product_codes: string[]
  advertiser_id: string | null
}

/**
 * POST /api/internal/users (03 §14, Fitur 2.0).
 *
 * Provisioning melalui Add Team oleh Master Admin tier (developer, owner).
 */
export async function createUser(context: RouteContext): Promise<Response> {

  const actor = await requirePermission(context, 'team.manage')

  const body = await readJsonObject(context.request)
  const username = readString(body, 'username')
  const displayName = readString(body, 'display_name')
  const initialPassword = readString(body, 'initial_password')
  const role = readString(body, 'role')

  if (username === null || displayName === null || initialPassword === null || role === null) {
    throw new ApiFailure('INVALID_PAYLOAD', 'username/display_name/initial_password/role wajib diisi')
  }

  const trimmedRole = role.trim()
  const isKnownRole = APP_ROLES.includes(trimmedRole as AppRole)
  if (!isKnownRole) {
    const roles = await context.db.selectRows<{ id: string }>('app_roles', { id: `eq.${trimmedRole}` }, 'id')
    if (roles.length === 0) {
      throw new ApiFailure('INVALID_ARGUMENT', `role=${trimmedRole}`)
    }
  }

  const trimmedUsername = username.trim()
  const trimmedDisplayName = displayName.trim()
  if (
    trimmedUsername === '' ||
    trimmedUsername.length > USERNAME_MAX_LENGTH ||
    /\s/.test(trimmedUsername) ||
    trimmedDisplayName === '' ||
    trimmedDisplayName.length > DISPLAY_NAME_MAX_LENGTH
  ) {
    throw new ApiFailure('INVALID_ARGUMENT', 'username/display_name tidak valid')
  }

  const avatarEmoji = readString(body, 'avatar_emoji')
  if (avatarEmoji !== null && avatarEmoji.trim().length > AVATAR_EMOJI_MAX_LENGTH) {
    throw new ApiFailure('INVALID_ARGUMENT', 'avatar_emoji tidak valid')
  }

  const hasAllProductAccess = typeof body['has_all_product_access'] === 'boolean' ? body['has_all_product_access'] : true
  const productCodes: string[] = []
  if (Array.isArray(body['product_codes'])) {
    for (const pc of body['product_codes']) {
      if (typeof pc === 'string' && pc.trim() !== '') {
        productCodes.push(pc.trim().toUpperCase())
      }
    }
  }

  if (!hasAllProductAccess && productCodes.length === 0) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih minimal satu produk jika akses dibatasi')
  }
  if (!hasAllProductAccess) await assertKnownProducts(context, productCodes)

  const isMasterRole = isMasterAdminRole(trimmedRole)
  const allowMaster = context.env.ALLOW_MASTER_ADMIN_CREATE_MASTER === 'true'

  if (!isMasterAdminRole(actor.role)) {
    const roleAllowed = await canAssignRole(context, actor, trimmedRole)
    if (!roleAllowed) {
      throw new ApiFailure('FORBIDDEN', undefined, 'Role ini tidak dapat Anda berikan.')
    }
    assertCanAssignProducts(await productAccess(context, actor), hasAllProductAccess, productCodes)
  }

  const advertiserId = await resolveAdvertiserId(context, trimmedRole, body)

  let created: CreatedUser
  try {
    created = await context.db.rpc<CreatedUser>('admin_create_user', {
      p_actor_user_id: actor.id,
      p_username: trimmedUsername,
      p_display_name: trimmedDisplayName,
      p_initial_password: initialPassword,
      p_role: trimmedRole,
      p_avatar_emoji: avatarEmoji === null || avatarEmoji.trim() === '' ? null : avatarEmoji.trim(),
      p_allow_master: isMasterRole ? allowMaster : false,
      p_has_all_product_access: hasAllProductAccess,
      p_product_codes: productCodes,
      p_advertiser_id: advertiserId,
    })
  } catch (error) {
    // Race dua request dengan username sama: unique constraint tetap menang.
    if (error instanceof DbError && error.sqlState === '23505') {
      throw new ApiFailure('USERNAME_TAKEN')
    }
    throw error
  }

  return ok(
    {
      user: {
        ...created,
        has_all_product_access: hasAllProductAccess,
        allowed_product_codes: hasAllProductAccess ? [] : productCodes,
      },
    },
    { status: 201 },
  )
}

/** Add Team lists safe profile columns only, plus product scope for Fitur 2.0. */
export async function listUsers(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'team.manage')
  const access = await productAccess(context, actor)

  const accessRows = await context.db.selectRows<{ user_id: string; product_code: string }>(
    'user_product_access',
    {},
    'user_id,product_code',
  ).catch(() => [])

  const userProductMap: Record<string, string[]> = {}
  for (const ar of accessRows) {
    const list = userProductMap[ar.user_id] ?? []
    list.push(ar.product_code)
    userProductMap[ar.user_id] = list
  }

  const users: ListedUser[] = []
  for (let offset = 0; ; offset += 500) {
    const rows = await context.db.selectRows<UserRow>(
      'users',
      { order: 'username.asc,id.asc', limit: '500', offset: String(offset) },
      USER_COLUMNS,
    )
    users.push(
      ...rows.map((row) => ({
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        avatar_emoji: row.avatar_emoji,
        active: row.active,
        has_all_product_access: row.has_all_product_access ?? true,
        allowed_product_codes: userProductMap[row.id] ?? [],
        advertiser_id: row.advertiser_id ?? null,
      })),
    )
    if (rows.length < 500) break
  }
  if (isMasterAdminRole(actor.role)) return ok({ users })

  // Pemegang team.manage tidak melihat akun master, dan hanya melihat produk
  // yang juga ia pegang. Ini batas tampilan; penegak utama tetap create.
  const visible = users
    .filter((user) => !isMasterAdminRole(user.role))
    .map((user) => ({
      ...user,
      allowed_product_codes: access.all
        ? user.allowed_product_codes
        : user.allowed_product_codes.filter((code) => access.codes.includes(normalizeCode(code) ?? '')),
    }))
  return ok({ users: visible })
}

export async function updateUser(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) throw new ApiFailure('FORBIDDEN', 'Master Admin diperlukan')

  const targetId = (context.params['id'] ?? '').trim()
  if (targetId === '') throw new ApiFailure('RESOURCE_NOT_FOUND', undefined, 'User tidak ditemukan')

  const [existing] = await context.db.selectRows<UserRow>('users', { id: `eq.${targetId}` }, USER_COLUMNS)
  if (!existing) throw new ApiFailure('RESOURCE_NOT_FOUND', undefined, 'User tidak ditemukan')

  const body = await readJsonObject(context.request)
  const displayName = (readString(body, 'display_name') ?? existing.display_name).trim()
  const role = (readString(body, 'role') ?? existing.role).trim()
  const active = typeof body['active'] === 'boolean' ? body['active'] : existing.active
  const newPassword = readString(body, 'new_password') ?? ''

  if (displayName === '' || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama tampilan wajib diisi (maks 200 karakter)')
  }

  const isKnownRole = APP_ROLES.includes(role as AppRole)
  if (!isKnownRole) {
    const roles = await context.db.selectRows<{ id: string }>('app_roles', { id: `eq.${role}` }, 'id')
    if (roles.length === 0) {
      throw new ApiFailure('INVALID_ARGUMENT', `role=${role}`)
    }
  }

  if (actor.id === existing.id && (!active || !isMasterAdminRole(role))) {
    throw new ApiFailure('FORBIDDEN', 'Tidak dapat menonaktifkan atau mengubah role akun Anda sendiri')
  }
  if (newPassword !== '' && newPassword.length < 8) {
    throw new ApiFailure('WEAK_PASSWORD', undefined, 'Password baru minimal 8 karakter')
  }

  const hasAllProductAccess =
    typeof body['has_all_product_access'] === 'boolean'
      ? body['has_all_product_access']
      : existing.has_all_product_access ?? true

  const productCodes: string[] = []
  if (Array.isArray(body['product_codes'])) {
    for (const pc of body['product_codes']) {
      if (typeof pc === 'string' && pc.trim() !== '') {
        productCodes.push(pc.trim().toUpperCase())
      }
    }
  }

  if (!hasAllProductAccess && productCodes.length === 0) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih minimal satu produk jika akses dibatasi')
  }
  if (!hasAllProductAccess) await assertKnownProducts(context, productCodes)

  const isMasterTarget = isMasterAdminRole(role)
  const allowMaster =
    context.env.ALLOW_MASTER_ADMIN_CREATE_MASTER === 'true' || isMasterAdminRole(existing.role)
  const advertiserId = await resolveAdvertiserId(context, role, body, existing.advertiser_id ?? null)

  const updated = await context.db.rpc<CreatedUser>('admin_update_user', {
    p_actor_user_id: actor.id,
    p_target_user_id: existing.id,
    p_display_name: displayName,
    p_role: role,
    p_active: active,
    p_new_password: newPassword === '' ? null : newPassword,
    p_allow_master: isMasterTarget ? allowMaster : false,
    p_has_all_product_access: hasAllProductAccess,
    p_product_codes: productCodes,
    p_advertiser_id: advertiserId,
  })

  return ok({
    user: {
      ...updated,
      has_all_product_access: hasAllProductAccess,
      allowed_product_codes: hasAllProductAccess ? [] : productCodes,
    },
  })
}

export async function deleteUser(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) throw new ApiFailure('FORBIDDEN', 'Master Admin diperlukan')

  const targetId = (context.params['id'] ?? '').trim()
  if (targetId === '') throw new ApiFailure('RESOURCE_NOT_FOUND', undefined, 'User tidak ditemukan')
  if (targetId === actor.id) {
    throw new ApiFailure('FORBIDDEN', 'Tidak dapat menghapus akun Anda sendiri')
  }

  const [existing] = await context.db.selectRows<UserRow>('users', { id: `eq.${targetId}` }, USER_COLUMNS)
  if (!existing) throw new ApiFailure('RESOURCE_NOT_FOUND', undefined, 'User tidak ditemukan')

  // Hierarchy (full roles only by Developer) is enforced in the RPC; sessions cascade.
  await context.db.rpc('admin_delete_user', { p_actor: actor.id, p_target: existing.id })
  return ok({ deleted: existing.id })
}
