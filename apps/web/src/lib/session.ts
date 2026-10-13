import { ApiError, apiRequest, type Profile, type SessionPayload } from './api'

/**
 * Sesi aplikasi (01 §2, 04 §7).
 *
 * Model dua lapis yang dijaga di sini:
 *   * **refresh session** — token opaque, `HttpOnly` + `Secure` + `SameSite=Lax`,
 *     hanya dipegang browser dan hanya dikenal server (7 hari);
 *   * **access JWT** — 30 menit, HANYA di memori. Tidak pernah masuk
 *     `localStorage`/`sessionStorage`/cookie, sehingga XSS tidak dapat mengambil
 *     kredensial yang berumur panjang (CLAUDE.md §8).
 *
 * Konsekuensi yang disengaja: memuat ulang halaman memaksa satu panggilan
 * `POST /api/auth/refresh` (cookie) untuk mendapatkan token baru — bukan
 * membaca token dari penyimpanan.
 */
export type SessionStatus = 'unknown' | 'anonymous' | 'authenticated'

export type SessionSnapshot = {
  status: SessionStatus
  profile: Profile | null
}

let snapshot: SessionSnapshot = { status: 'unknown', profile: null }
let accessToken: string | null = null

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function setSession(next: SessionSnapshot, token: string | null): void {
  snapshot = next
  accessToken = token
  emit()
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Access token hanya untuk dipakai klien data; tidak pernah dipersistensi. */
export function getAccessToken(): string | null {
  return accessToken
}

function applySessionPayload(payload: SessionPayload): void {
  setSession({ status: 'authenticated', profile: payload.profile }, payload.access_token)
}

/**
 * Pulihkan sesi saat aplikasi dimuat.
 *
 * Satu-satunya sumber token awal adalah refresh endpoint; bila cookie-nya tidak
 * ada atau sudah dicabut, aplikasi jatuh ke keadaan anonim — bukan error.
 */
export async function bootstrapSession(): Promise<void> {
  try {
    applySessionPayload(await apiRequest<SessionPayload>('/api/auth/refresh', { method: 'POST' }))
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'SESSION_INVALID' || error.code === 'USER_DISABLED')) {
      setSession({ status: 'anonymous', profile: null }, null)
      return
    }
    // Gangguan jaringan bukan berarti "belum login"; biarkan status tidak pasti
    // supaya halaman dapat menampilkan kesalahan yang jujur alih-alih
    // melempar pengguna ke halaman login tanpa sebab.
    setSession({ status: 'unknown', profile: null }, null)
  }
}

export async function login(username: string, password: string): Promise<void> {
  const payload = await apiRequest<SessionPayload>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  })
  applySessionPayload(payload)
}

/**
 * Logout.
 *
 * Endpoint logout idempoten (03 §6), jadi kegagalan jaringan tetap dianggap
 * selesai: sesi lokal dibersihkan apa pun yang terjadi.
 */
export async function logout(): Promise<void> {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' })
  } catch {
    // diabaikan dengan sengaja
  }
  setSession({ status: 'anonymous', profile: null }, null)
}

export type ChangePasswordInput = {
  currentPassword: string
  newPassword: string
  newPasswordConfirmation: string
}

/**
 * Ganti password.
 *
 * Server mencabut SELURUH sesi user (01 §3), jadi klien wajib login ulang —
 * termasuk sesi yang sedang dipakai.
 */
export async function changePassword(input: ChangePasswordInput): Promise<{ revokedSessions: number }> {
  const result = await apiRequest<{ revoked_sessions: number }>('/api/auth/change-password', {
    method: 'POST',
    body: {
      current_password: input.currentPassword,
      new_password: input.newPassword,
      new_password_confirmation: input.newPasswordConfirmation,
    },
    accessToken,
  })

  setSession({ status: 'anonymous', profile: null }, null)
  return { revokedSessions: result.revoked_sessions }
}

/**
 * Permintaan terautentikasi dengan satu percobaan refresh.
 *
 * Access token berumur 30 menit; ketika kedaluwarsa, pengguna tidak boleh
 * dipaksa login ulang selama refresh session-nya masih hidup. Hanya satu
 * percobaan: percobaan berulang akan menyembunyikan sesi yang benar-benar mati.
 */
export async function authorizedRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  if (accessToken === null) throw new ApiError('SESSION_INVALID', 'Belum login.', 401)

  try {
    return await apiRequest<T>(path, { ...options, accessToken })
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'SESSION_INVALID') throw error
  }

  try {
    applySessionPayload(await apiRequest<SessionPayload>('/api/auth/refresh', { method: 'POST' }))
  } catch {
    setSession({ status: 'anonymous', profile: null }, null)
    throw new ApiError('SESSION_INVALID', 'Sesi berakhir. Silakan login kembali.', 401)
  }

  if (accessToken === null) throw new ApiError('SESSION_INVALID', 'Sesi berakhir. Silakan login kembali.', 401)
  return apiRequest<T>(path, { ...options, accessToken })
}

/**
 * Ubah profil sendiri (03 §13).
 *
 * Hanya `display_name` dan `avatar_emoji`; username tidak dapat diubah pada MVP.
 * Snapshot sesi diperbarui dari respons server supaya sidebar langsung
 * menampilkan nama/emoji yang baru.
 */
export async function updateProfile(input: {
  displayName?: string
  avatarEmoji?: string | null
}): Promise<Profile> {
  const body: Record<string, unknown> = {}
  if (input.displayName !== undefined) body['display_name'] = input.displayName
  if (input.avatarEmoji !== undefined) body['avatar_emoji'] = input.avatarEmoji

  const result = await authorizedRequest<{ profile: Profile }>('/api/profile', { method: 'PATCH', body })
  setSession({ status: 'authenticated', profile: result.profile }, accessToken)
  return result.profile
}

/** Hanya untuk test: kembalikan modul ke keadaan awal. */
export function resetSessionForTests(): void {
  snapshot = { status: 'unknown', profile: null }
  accessToken = null
  listeners.clear()
}
