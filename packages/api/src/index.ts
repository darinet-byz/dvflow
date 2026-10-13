/**
 * Permukaan publik `@dvflow/api`.
 *
 * `createHandler` adalah satu-satunya hal yang dibutuhkan entry platform
 * (`apps/worker`, Pages Functions): ia membangun Db dari environment lalu
 * mengembalikan fungsi `Request -> Response`.
 */

import { createPostgrestDb } from './db/postgrest'
import type { Db } from './db/types'
import type { Env } from './env'
import { createApi, type Api } from './router'
import { ROUTES } from './routes'

export type { Env } from './env'
export type { Db } from './db/types'
export { DbError } from './db/types'
export type { Api, Route, RouteContext, RouteHandler } from './router'
export { createApi, matchRoute } from './router'
export { ROUTES } from './routes'
export { createPostgrestDb } from './db/postgrest'
export { createJwtSigner, type AccessTokenClaims, type JwtSigner } from './auth/jwt'
export {
  adaptOrderOnlineWebhook,
  toIsoTimestamp,
  type AdapterOutcome,
  type AdapterShape,
} from './webhooks/adapter'
export { loadProductConfig } from './webhooks/handlers'
export { generateSessionToken, hashSessionToken } from './auth/session-token'
export { ApiFailure, ERROR_CATALOG, type ApiErrorCode } from './http/errors'
export { REFRESH_COOKIE_NAME } from './http/cookies'
export {
  AVATAR_EMOJI_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  type Profile,
} from './users'

export type CreateHandlerOptions = {
  /** Ganti bila ingin memakai Db lain (mis. di test). */
  db?: Db
  /** Disuntik di test. */
  now?: () => Date
  /** Ganti sumber `fetch` (mis. di test). */
  fetchImpl?: typeof fetch
}

/**
 * Bangun handler HTTP dari environment.
 *
 * Tidak memakai top-level await dan tidak menyentuh jaringan saat dipanggil,
 * sehingga aman dipakai sebagai entry point Worker maupun Pages Functions.
 */
export function createHandler(env: Env, options: CreateHandlerOptions = {}): Api {
  const db = options.db ?? createPostgrestDb(env, options.fetchImpl ?? fetch)
  return createApi({ env, db, routes: ROUTES, now: options.now })
}
