import { APP_ROLES, isMasterAdminRole, type AppRole } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requireActiveUser, USER_COLUMNS, type UserRow } from '../users'
import { AVATAR_EMOJI_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH, USERNAME_MAX_LENGTH } from '../users'

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
}

/**
 * POST /api/internal/users (03 §14, Fitur 2.0).
 *
 * Provisioning melalui Add Team oleh Master Admin tier (developer, owner, master_admin).
 */
export async function createUser(context: RouteContext): Promise<Response> {
  if (!isMasterAdminRole(context.claims?.app_role)) {
    throw new ApiFailure('FORBIDDEN', `app_role=${context.claims?.app_role ?? 'tidak ada'}`)
  }

  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) throw new ApiFailure('FORBIDDEN', 'Master Admin diperlukan')

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
    throw new ApiFailure('INVALID_ARGUMENT', 'Pilih minimal satu produk jika akses dibatasi')
  }

  const isMasterRole = isMasterAdminRole(trimmedRole)
  const allowMaster = context.env.ALLOW_MASTER_ADMIN_CREATE_MASTER === 'true'

  const created = await context.db.rpc<CreatedUser>('admin_create_user', {
    p_actor_user_id: actor.id,
    p_username: trimmedUsername,
    p_display_name: trimmedDisplayName,
    p_initial_password: initialPassword,
    p_role: trimmedRole,
    p_avatar_emoji: avatarEmoji === null || avatarEmoji.trim() === '' ? null : avatarEmoji.trim(),
    p_allow_master: isMasterRole ? allowMaster : false,
    p_has_all_product_access: hasAllProductAccess,
    p_product_codes: productCodes,
  })

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
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) throw new ApiFailure('FORBIDDEN', 'Master Admin diperlukan')

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
      })),
    )
    if (rows.length < 500) break
  }
  return ok({ users })
}

export async function updateUser(context: RouteContext): Promise<Response> {
  if (!isMasterAdminRole(context.claims?.app_role)) {
    throw new ApiFailure('FORBIDDEN', `app_role=${context.claims?.app_role ?? 'tidak ada'}`)
  }
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) throw new ApiFailure('FORBIDDEN', 'Master Admin diperlukan')

  const targetId = (context.params['id'] ?? '').trim()
  if (targetId === '') throw new ApiFailure('RESOURCE_NOT_FOUND', 'User tidak ditemukan')

  const [existing] = await context.db.selectRows<UserRow>('users', { id: `eq.${targetId}` }, USER_COLUMNS)
  if (!existing) throw new ApiFailure('RESOURCE_NOT_FOUND', 'User tidak ditemukan')

  const body = await readJsonObject(context.request)
  const displayName = (readString(body, 'display_name') ?? existing.display_name).trim()
  const role = (readString(body, 'role') ?? existing.role).trim()
  const active = typeof body['active'] === 'boolean' ? body['active'] : existing.active
  const newPassword = readString(body, 'new_password') ?? ''

  if (displayName === '' || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Nama tampilan wajib diisi (maks 200 karakter)')
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
    throw new ApiFailure('WEAK_PASSWORD', 'Password baru minimal 8 karakter')
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
    throw new ApiFailure('INVALID_ARGUMENT', 'Pilih minimal satu produk jika akses dibatasi')
  }

  const isMasterTarget = isMasterAdminRole(role)
  const allowMaster =
    context.env.ALLOW_MASTER_ADMIN_CREATE_MASTER === 'true' || isMasterAdminRole(existing.role)

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
  if (!isMasterAdminRole(context.claims?.app_role)) {
    throw new ApiFailure('FORBIDDEN', `app_role=${context.claims?.app_role ?? 'tidak ada'}`)
  }
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) throw new ApiFailure('FORBIDDEN', 'Master Admin diperlukan')

  const targetId = (context.params['id'] ?? '').trim()
  if (targetId === '') throw new ApiFailure('RESOURCE_NOT_FOUND', 'User tidak ditemukan')
  if (targetId === actor.id) {
    throw new ApiFailure('FORBIDDEN', 'Tidak dapat menghapus akun Anda sendiri')
  }

  const [existing] = await context.db.selectRows<UserRow>('users', { id: `eq.${targetId}` }, USER_COLUMNS)
  if (!existing) throw new ApiFailure('RESOURCE_NOT_FOUND', 'User tidak ditemukan')

  await context.db.deleteRows('app_sessions', { user_id: `eq.${existing.id}` })
  await context.db.deleteRows('users', { id: `eq.${existing.id}` })
  return ok({ deleted: existing.id })
}
