import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import {
  AVATAR_EMOJI_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  USER_COLUMNS,
  profileFromRow,
  requireActiveUser,
  type UserRow,
} from '../users'

/** GET /api/profile (03 §13). */
export async function getProfile(context: RouteContext): Promise<Response> {
  const user = await requireActiveUser(context)
  return ok({ profile: profileFromRow(user) })
}

/**
 * PATCH /api/profile (03 §13).
 *
 * Hanya `display_name` dan `avatar_emoji` yang dapat diubah. Username TIDAK
 * dapat diubah lewat Profile pada MVP — kalau field itu dikirim, ia diabaikan
 * dengan sengaja dan bukan diterapkan diam-diam.
 */
export async function updateProfile(context: RouteContext): Promise<Response> {
  const user = await requireActiveUser(context)
  const body = await readJsonObject(context.request)

  const hasDisplayName = Object.hasOwn(body, 'display_name')
  const hasAvatarEmoji = Object.hasOwn(body, 'avatar_emoji')

  if (!hasDisplayName && !hasAvatarEmoji) {
    throw new ApiFailure('INVALID_PAYLOAD', 'tidak ada field yang dapat diubah')
  }

  const patch: Record<string, unknown> = {}

  if (hasDisplayName) {
    const value = readString(body, 'display_name')
    const displayName = (value ?? '').trim()
    if (displayName === '' || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new ApiFailure('INVALID_ARGUMENT', 'display_name kosong atau terlalu panjang')
    }
    patch['display_name'] = displayName
  }

  if (hasAvatarEmoji) {
    const value = body['avatar_emoji']
    if (value === null) {
      patch['avatar_emoji'] = null
    } else if (typeof value === 'string' && value.trim().length <= AVATAR_EMOJI_MAX_LENGTH) {
      // String kosong berarti "hapus", bukan menyimpan emoji kosong.
      patch['avatar_emoji'] = value.trim() === '' ? null : value.trim()
    } else {
      throw new ApiFailure('INVALID_ARGUMENT', 'avatar_emoji tidak valid')
    }
  }

  await context.db.updateRows('users', { id: `eq.${user.id}` }, patch)

  // Baca ulang supaya yang dikembalikan adalah keadaan sebenarnya di database,
  // bukan tebakan dari patch.
  const rows = await context.db.selectRows<UserRow>('users', { id: `eq.${user.id}` }, USER_COLUMNS)
  const updated = rows[0]
  if (updated === undefined) throw new ApiFailure('SESSION_INVALID', 'user menghilang saat update')

  return ok({ profile: profileFromRow(updated) })
}
