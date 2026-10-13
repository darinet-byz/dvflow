import { createJwtSigner, type AccessTokenClaims, type JwtSigner } from './auth/jwt'
import type { Db } from './db/types'
import { DbError } from './db/types'
import type { Env } from './env'
import { ApiFailure, DB_SQLSTATE_TO_API_CODE } from './http/errors'
import { assertSameOrigin } from './http/origin'
import { fail } from './http/response'

/**
 * Router tipis untuk seluruh endpoint backend.
 *
 * Router tidak mengenal handler mana pun: tabel rute diberikan pemanggil
 * (`routes.ts`). Handler adalah fungsi murni `RouteContext -> Response`, tanpa
 * binding platform, sehingga `apps/worker` dan Pages Functions memakai router
 * yang sama (STATE.md K2).
 */
export type RouteAuth =
  /** Terbuka. */
  | 'none'
  /** Wajib access token `Authorization: Bearer`. */
  | 'access'

export type RouteContext = {
  request: Request
  env: Env
  db: Db
  url: URL
  params: Record<string, string>
  now: Date
  /** Signer dibuat lazily: endpoint yang tidak menandatangani token tidak membayarnya. */
  getSigner: () => Promise<JwtSigner>
  /** Terisi hanya untuk route dengan `auth: 'access'`. */
  claims: AccessTokenClaims | null
}

export type RouteHandler = (context: RouteContext) => Promise<Response>

export type Route = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Mendukung segmen `:nama` untuk path parameter (dipakai webhook & halaman peserta). */
  path: string
  handler: RouteHandler
  auth: RouteAuth
  /**
   * Wajib same-origin. Hanya untuk endpoint yang memakai COOKIE untuk mengubah
   * state (04 §8); endpoint ber-Bearer tidak dapat di-CSRF karena penyerang
   * lintas situs tidak dapat menyetel header `Authorization`.
   */
  sameOrigin?: boolean
}

export type ApiDeps = {
  env: Env
  db: Db
  routes: Route[]
  /** Disuntik di test supaya waktu dapat ditentukan. */
  now?: () => Date
}

export type Api = (request: Request) => Promise<Response>

export function createApi(deps: ApiDeps): Api {
  let signerPromise: Promise<JwtSigner> | null = null
  const getSigner = (): Promise<JwtSigner> => (signerPromise ??= createJwtSigner(deps.env))
  const now = deps.now ?? (() => new Date())

  return async function api(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const matched = matchRoute(deps.routes, request.method, url.pathname)

    if (matched === null) return fail('NOT_FOUND')

    try {
      if (matched.route.sameOrigin === true) assertSameOrigin(request, deps.env)

      const claims =
        matched.route.auth === 'access' ? await readAccessClaims(request, await getSigner(), now()) : null

      return await matched.route.handler({
        request,
        env: deps.env,
        db: deps.db,
        url,
        params: matched.params,
        now: now(),
        getSigner,
        claims,
      })
    } catch (error) {
      return toFailureResponse(error)
    }
  }
}

export type RouteMatch = { route: Route; params: Record<string, string> }

export function matchRoute(routeList: Route[], method: string, pathname: string): RouteMatch | null {
  const requestedMethod = method.toUpperCase()

  for (const route of routeList) {
    const params = matchPath(route.path, pathname)
    if (params === null) continue
    // Metode yang salah pada path yang ada tetap 404, bukan 405: kontrak tidak
    // mendefinisikan 405, dan 404 tidak memberi tahu penyerang rute mana yang ada.
    if (route.method !== requestedMethod) continue
    return { route, params }
  }
  return null
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternSegments = pattern.split('/')
  const pathSegments = pathname.split('/')

  if (patternSegments.length !== pathSegments.length) return null

  const params: Record<string, string> = {}
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index] as string
    const pathSegment = pathSegments[index] as string

    if (patternSegment.startsWith(':')) {
      if (pathSegment === '') return null
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment)
      continue
    }
    if (patternSegment !== pathSegment) return null
  }
  return params
}

async function readAccessClaims(request: Request, signer: JwtSigner, now: Date): Promise<AccessTokenClaims> {
  const header = request.headers.get('authorization')
  if (header === null) throw new ApiFailure('SESSION_INVALID', 'header Authorization tidak ada')

  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token === '') {
    throw new ApiFailure('SESSION_INVALID', 'format Authorization bukan Bearer')
  }

  return signer.verify(token, now)
}

/**
 * Satu-satunya tempat error berubah menjadi response.
 *
 * `ApiFailure.logContext` dan detail `DbError` sengaja hanya dibuang di sini —
 * tidak ada jalur yang meneruskan pesan internal ke klien.
 */
function toFailureResponse(error: unknown): Response {
  if (error instanceof ApiFailure) return fail(error.code)

  if (error instanceof DbError) {
    const mapped = DB_SQLSTATE_TO_API_CODE[error.sqlState]
    if (mapped !== undefined) return fail(mapped)
  }

  return fail('INTERNAL_ERROR')
}
