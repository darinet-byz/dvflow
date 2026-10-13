import { APP_ROLES, type AppRole } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
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
 * Provisioning admin/staff oleh Master Admin, tanpa menu sidebar. Pembuatan
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
