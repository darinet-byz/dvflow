import type { AppRole } from '@dvflow/shared'
import type { RouteContext } from './router'
import { ApiFailure } from './http/errors'

/**
 * Bentuk user di batas backend.
 *
 * Tiga bentuk yang berbeda dan sengaja dipisah:
 *   * `UserRow`        — baris tabel `users` (punya `id`, `active`);
 *   * `VerifiedUser`   — hasil RPC `verify_login` (memakai `user_id`);
 *   * `Profile`        — yang dikirim ke klien. HANYA kolom aman; `password_hash`
 *                        dan `password_algo` tidak pernah masuk ke sini (04 §6).
 */
export type UserRow = {
  id: string
  username: string
  display_name: string
  role: AppRole
  avatar_emoji: string | null
  active: boolean
}

export type VerifiedUser = {
  user_id: string
  username: string
  display_name: string
  role: AppRole
  avatar_emoji: string | null
}

export type Profile = {
  user_id: string
  username: string
  display_name: string
  role: AppRole
  avatar_emoji: string | null
}

/** Kolom aman saja — tidak memuat kolom kredensial. */
export const USER_COLUMNS = 'id,username,display_name,role,avatar_emoji,active'

export const DISPLAY_NAME_MAX_LENGTH = 200
export const AVATAR_EMOJI_MAX_LENGTH = 16
export const USERNAME_MAX_LENGTH = 64

export function profileFromRow(row: UserRow): Profile {
  return {
    user_id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    avatar_emoji: row.avatar_emoji,
  }
}

export function profileFromVerified(user: VerifiedUser): Profile {
  return {
    user_id: user.user_id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    avatar_emoji: user.avatar_emoji,
  }
}

/**
 * Ambil baris user pemanggil dan pastikan masih aktif.
 *
 * Access token berumur 30 menit, jadi akun yang dinonaktifkan di tengah jalan
 * masih memegang token yang sah. Setiap endpoint yang mengubah state
 * memanggil ini supaya penonaktifan berlaku segera, bukan setelah token
 * kedaluwarsa (01 §3).
 */
export async function requireActiveUser(context: RouteContext): Promise<UserRow> {
  const userId = context.claims?.sub
  if (userId === undefined) throw new ApiFailure('SESSION_INVALID', 'claims tidak ada')

  const rows = await context.db.selectRows<UserRow>('users', { id: `eq.${userId}` }, USER_COLUMNS)
  const user = rows[0]
  if (user === undefined) throw new ApiFailure('SESSION_INVALID', 'user tidak ditemukan')
  if (!user.active) throw new ApiFailure('USER_DISABLED', `user ${userId} nonaktif`)

  return user
}
