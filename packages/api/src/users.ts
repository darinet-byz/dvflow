import { isMasterAdminRole, type AppRole } from '@dvflow/shared'
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
  has_all_product_access?: boolean
  /** A20: hanya role advertiser; menentukan scope order. */
  advertiser_id?: string | null
}

export type VerifiedUser = {
  user_id: string
  username: string
  display_name: string
  role: AppRole
  avatar_emoji: string | null
  has_all_product_access?: boolean
}

export type Profile = {
  user_id: string
  username: string
  display_name: string
  role: AppRole
  avatar_emoji: string | null
  has_all_product_access?: boolean
  allowed_product_codes?: string[]
  /** A20: pengiklan yang dipegang akun Advertiser. */
  advertiser_code?: string | null
  advertiser_name?: string | null
  permissions?: string[]
}

/** Kolom aman saja — tidak memuat kolom kredensial. */
export const USER_COLUMNS = 'id,username,display_name,role,avatar_emoji,active,has_all_product_access,advertiser_id'

export const DISPLAY_NAME_MAX_LENGTH = 200
export const AVATAR_EMOJI_MAX_LENGTH = 16
export const USERNAME_MAX_LENGTH = 64

export async function buildUserProfile(
  context: RouteContext,
  user: {
    id?: string
    user_id?: string
    username: string
    display_name: string
    role: AppRole
    avatar_emoji: string | null
    has_all_product_access?: boolean
  },
): Promise<Profile> {
  const userId = user.id ?? user.user_id ?? ''
  let hasAll = user.has_all_product_access

  if (hasAll === undefined && userId) {
    try {
      const userRows = await context.db.selectRows<{ has_all_product_access: boolean }>(
        'users',
        { id: `eq.${userId}` },
        'has_all_product_access',
      )
      if (userRows[0]?.has_all_product_access !== undefined) {
        hasAll = Boolean(userRows[0].has_all_product_access)
      }
    } catch {
      // fallback
    }
  }

  const hasAllProductAccess = isMasterAdminRole(user.role) || hasAll === true
  let allowed_product_codes: string[] = []
  let permissions: string[] = []

  if (isMasterAdminRole(user.role)) {
    const rows = await context.db.selectRows<{ key: string }>('app_permissions', {}, 'key')
    permissions = rows.map((r) => r.key)
  } else {
    const rows = await context.db.selectRows<{ permission_key: string }>(
      'app_role_permissions', { role_id: `eq.${user.role}` }, 'permission_key',
    )
    permissions = rows.map((r) => r.permission_key)
  }

  if (!hasAllProductAccess && userId) {
    try {
      const accessRows = await context.db.selectRows<{ product_code: string }>(
        'user_product_access',
        { user_id: `eq.${userId}` },
        'product_code',
      )
      allowed_product_codes = accessRows.map((r) => r.product_code)
    } catch {
      // ignore
    }
  }

  let advertiser: { code: string; name: string } | null = null
  if (userId && !isMasterAdminRole(user.role)) {
    const rows = await context.db.selectRows<{ advertiser_id: string | null }>('users', { id: `eq.${userId}` }, 'advertiser_id')
    const advertiserId = rows[0]?.advertiser_id
    if (advertiserId) {
      advertiser = (await context.db.selectRows<{ code: string; name: string }>('advertisers', { id: `eq.${advertiserId}` }, 'code,name'))[0] ?? null
    }
  }

  return {
    user_id: userId,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    avatar_emoji: user.avatar_emoji,
    has_all_product_access: hasAllProductAccess,
    allowed_product_codes,
    advertiser_code: advertiser?.code ?? null,
    advertiser_name: advertiser?.name ?? null,
    permissions,
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
