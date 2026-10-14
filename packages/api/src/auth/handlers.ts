import { requirePermission } from '../permissions'
import { ACCESS_TOKEN_LIFETIME_SECONDS } from '@dvflow/shared'
import {
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  readCookie,
  setRefreshCookie,
} from '../http/cookies'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { generateSessionToken, hashSessionToken } from './session-token'
import {
  USER_COLUMNS,
  buildUserProfile,
  type UserRow,
  type VerifiedUser,
} from '../users'

/**
 * POST /api/auth/login (03 §4).
 *
 * Urutannya: verifikasi (di database, A1) → buat refresh session → terbitkan
 * access JWT. Password TIDAK pernah dibandingkan di Worker; Worker hanya
 * meneruskan ke `verify_login`.
 */
export async function login(context: RouteContext): Promise<Response> {
  const body = await readJsonObject(context.request)
  const username = readString(body, 'username')
  const password = readString(body, 'password')

  if (username === null || username.trim() === '' || password === null || password === '') {
    throw new ApiFailure('INVALID_PAYLOAD', 'username/password tidak lengkap')
  }

  const verified = await context.db.rpc<VerifiedUser>('verify_login', {
    p_username: username,
    p_password: password,
  })

  if (verified === null || typeof verified.user_id !== 'string' || verified.user_id === '') {
    throw new ApiFailure('INTERNAL_ERROR', 'verify_login tidak mengembalikan user_id')
  }

  const token = generateSessionToken()
  const tokenHash = await hashSessionToken(token)

  await context.db.insertRow('app_sessions', {
    user_id: verified.user_id,
    token_hash: tokenHash,
    expires_at: new Date(context.now.getTime() + REFRESH_COOKIE_MAX_AGE_SECONDS * 1000).toISOString(),
  })

  const accessToken = await (
    await context.getSigner()
  ).mint({ userId: verified.user_id, appRole: verified.role, now: context.now })

  return ok(
    {
      profile: await buildUserProfile(context, verified),
      access_token: accessToken,
      expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
    },
    { headers: { 'set-cookie': setRefreshCookie(token) } },
  )
}

/**
 * POST /api/auth/refresh (03 §5).
 *
 * Hash cookie dicari di `app_sessions`; token mentah tidak pernah ada di
 * database. `last_used_at` diperbarui pada setiap refresh yang berhasil.
 */
export async function refresh(context: RouteContext): Promise<Response> {
  const token = readCookie(context.request, REFRESH_COOKIE_NAME)
  if (token === null) throw new ApiFailure('SESSION_INVALID', 'cookie refresh tidak ada')

  const tokenHash = await hashSessionToken(token)

  const sessions = await context.db.selectRows<{ id: string; user_id: string }>(
    'app_sessions',
    {
      token_hash: `eq.${tokenHash}`,
      revoked_at: 'is.null',
      expires_at: `gt.${context.now.toISOString()}`,
    },
    'id,user_id',
  )
  const session = sessions[0]
  if (session === undefined) throw new ApiFailure('SESSION_INVALID', 'sesi tidak ditemukan/kedaluwarsa/dicabut')

  // Tanpa filter `active` supaya "user nonaktif" (USER_DISABLED) dapat
  // dibedakan dari "sesi tidak valid" (SESSION_INVALID) seperti dikontrak 03 §5.
  const users = await context.db.selectRows<UserRow>('users', { id: `eq.${session.user_id}` }, USER_COLUMNS)
  const user = users[0]
  if (user === undefined) throw new ApiFailure('SESSION_INVALID', 'user sesi tidak ditemukan')
  if (!user.active) throw new ApiFailure('USER_DISABLED', `user ${user.id} nonaktif`)

  await context.db.updateRows('app_sessions', { id: `eq.${session.id}` }, { last_used_at: context.now.toISOString() })

  const accessToken = await (
    await context.getSigner()
  ).mint({ userId: user.id, appRole: user.role, now: context.now })

  return ok({
    profile: await buildUserProfile(context, user),
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
  })
}

/**
 * POST /api/auth/logout (03 §6).
 *
 * Idempoten: selalu 200, termasuk bila cookie tidak ada atau sesinya sudah tidak
 * berlaku. Cookie selalu dihapus supaya klien tidak menyimpan nilai basi.
 */
export async function logout(context: RouteContext): Promise<Response> {
  const token = readCookie(context.request, REFRESH_COOKIE_NAME)

  if (token !== null) {
    const tokenHash = await hashSessionToken(token)
    await context.db.updateRows(
      'app_sessions',
      { token_hash: `eq.${tokenHash}`, revoked_at: 'is.null' },
      { revoked_at: context.now.toISOString() },
    )
  }

  return ok({}, { headers: { 'set-cookie': clearRefreshCookie() } })
}

/**
 * POST /api/auth/change-password (03 §7).
 *
 * Panjang minimum, kecocokan konfirmasi, dan kebenaran password lama
 * diperiksa RPC `change_password` (satu sumber aturan). Efek sampingnya —
 * mencabut seluruh sesi user — juga dilakukan di sana, dalam satu transaksi.
 */
export async function changePassword(context: RouteContext): Promise<Response> {
  const user = await requirePermission(context, 'account.profile')
  const body = await readJsonObject(context.request)

  const currentPassword = readString(body, 'current_password')
  const newPassword = readString(body, 'new_password')
  const confirmation = readString(body, 'new_password_confirmation')

  if (currentPassword === null || newPassword === null || confirmation === null) {
    throw new ApiFailure('INVALID_PAYLOAD', 'current/new/confirmation wajib diisi')
  }

  const result = await context.db.rpc<{ user_id: string; revoked_sessions: number }>('change_password', {
    p_user_id: user.id,
    p_current_password: currentPassword,
    p_new_password: newPassword,
    p_new_password_confirmation: confirmation,
  })

  // Seluruh sesi sudah dicabut database, jadi cookie refresh milik klien ini
  // tidak berguna lagi. Menghapusnya membuat keadaan itu terlihat jelas.
  return ok({ revoked_sessions: result?.revoked_sessions ?? 0 }, { headers: { 'set-cookie': clearRefreshCookie() } })
}
