import { APP_ROLES, type AppRole } from '@dvflow/shared'
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
}

/**
 * POST /api/internal/users (03 §14).
 *
 * Provisioning melalui Add Team oleh Admin Master (AMENDMENTS A10). Pembuatan
 * Master Admin baru hanya bila environment mengizinkannya — dan keputusan itu
 * TIDAK diambil di sini saja: RPC `admin_create_user` memeriksa ulang peran
 * actor dan flag yang sama, sehingga melewati handler ini tidak menolong
 * (04 §5: permission ditegakkan server-side).
 *
 * Panjang minimum password dan validitas kode username diperiksa RPC.
 */
export async function createUser(context: RouteContext): Promise<Response> {
  if (context.claims?.app_role !== 'master_admin') {
    throw new ApiFailure('FORBIDDEN', `app_role=${context.claims?.app_role ?? 'tidak ada'}`)
  }

  const actor = await requireActiveUser(context)
  if (actor.role !== 'master_admin') throw new ApiFailure('FORBIDDEN', 'Admin Master diperlukan')

  const body = await readJsonObject(context.request)
  const username = readString(body, 'username')
  const displayName = readString(body, 'display_name')
  const initialPassword = readString(body, 'initial_password')
  const role = readString(body, 'role')

  if (username === null || displayName === null || initialPassword === null || role === null) {
    throw new ApiFailure('INVALID_PAYLOAD', 'username/display_name/initial_password/role wajib diisi')
  }
  if (!APP_ROLES.includes(role as AppRole)) {
    throw new ApiFailure('INVALID_ARGUMENT', `role=${role}`)
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

  const created = await context.db.rpc<CreatedUser>('admin_create_user', {
    p_actor_user_id: context.claims.sub,
    p_username: trimmedUsername,
    p_display_name: trimmedDisplayName,
    p_initial_password: initialPassword,
    p_role: role,
    p_avatar_emoji: avatarEmoji === null || avatarEmoji.trim() === '' ? null : avatarEmoji.trim(),
    // O3: default dokumen adalah `false`; hanya environment yang dapat membuka.
    p_allow_master: context.env.ALLOW_MASTER_ADMIN_CREATE_MASTER === 'true',
  })

  return ok({ user: created }, { status: 201 })
}

/** Add Team lists safe profile columns only, never credentials. */
export async function listUsers(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (actor.role !== 'master_admin') throw new ApiFailure('FORBIDDEN', 'Admin Master diperlukan')
  const users: UserRow[] = []
  for (let offset = 0; ; offset += 500) {
    const rows = await context.db.selectRows<UserRow>('users', { order: 'username.asc,id.asc', limit: '500', offset: String(offset) }, USER_COLUMNS)
    users.push(...rows.map(row => ({ id: row.id, username: row.username, display_name: row.display_name, role: row.role, avatar_emoji: row.avatar_emoji, active: row.active })))
    if (rows.length < 500) break
  }
  return ok({ users })
}

export async function updateUser(context: RouteContext): Promise<Response> {
  if (context.claims?.app_role !== 'master_admin') {
    throw new ApiFailure('FORBIDDEN', `app_role=${context.claims?.app_role ?? 'tidak ada'}`)
  }
  const actor = await requireActiveUser(context)
  if (actor.role !== 'master_admin') throw new ApiFailure('FORBIDDEN', 'Admin Master diperlukan')

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
  if (!APP_ROLES.includes(role as AppRole)) {
    throw new ApiFailure('INVALID_ARGUMENT', `role=${role}`)
  }
  if (actor.id === existing.id && (!active || role !== 'master_admin')) {
    throw new ApiFailure('FORBIDDEN', 'Tidak dapat menonaktifkan atau mengubah role akun Anda sendiri')
  }
  if (newPassword !== '' && newPassword.length < 8) {
    throw new ApiFailure('WEAK_PASSWORD', 'Password baru minimal 8 karakter')
  }

  const updated = await context.db.rpc<CreatedUser>('admin_update_user', {
    p_actor_user_id: actor.id,
    p_target_user_id: existing.id,
    p_display_name: displayName,
    p_role: role,
    p_active: active,
    p_new_password: newPassword === '' ? null : newPassword,
    p_allow_master: context.env.ALLOW_MASTER_ADMIN_CREATE_MASTER === 'true' || existing.role === 'master_admin',
  })

  return ok({ user: updated })
}

export async function deleteUser(context: RouteContext): Promise<Response> {
  if (context.claims?.app_role !== 'master_admin') {
    throw new ApiFailure('FORBIDDEN', `app_role=${context.claims?.app_role ?? 'tidak ada'}`)
  }
  const actor = await requireActiveUser(context)
  if (actor.role !== 'master_admin') throw new ApiFailure('FORBIDDEN', 'Admin Master diperlukan')

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

