import { ACCESS_TOKEN_LIFETIME_SECONDS, APP_ROLES, type AppRole } from '@dvflow/shared'
import type { Env } from '../env'
import { ApiFailure } from '../http/errors'
import { base64UrlDecode, base64UrlDecodeUtf8, base64UrlEncode, base64UrlEncodeUtf8, utf8Bytes } from './base64url'

/**
 * Access JWT (01 §2, 04 §4, AMENDMENTS A3).
 *
 * Ditandatangani ES256 di Worker dengan private key yang juga di-trust Supabase,
 * berumur 30 menit, dan hanya hidup di memori aplikasi (tidak pernah
 * localStorage). Token yang tidak memuat `iss`/`aud`/`kid` akan ditolak
 * PostgREST, jadi ketiganya wajib.
 */
export type AccessTokenClaims = {
  sub: string
  role: 'authenticated'
  app_user_id: string
  app_role: AppRole
  iss: string
  aud: 'authenticated'
  iat: number
  exp: number
}

export type JwtSigner = {
  mint(params: { userId: string; appRole: AppRole; now: Date }): Promise<string>
  verify(token: string, now: Date): Promise<AccessTokenClaims>
}

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const
const JWT_ALGORITHM = 'ES256'
const AUDIENCE = 'authenticated'

/**
 * Membuat signer dari environment.
 *
 * Public key diturunkan dari private key yang sama (koordinat `x`/`y` ada di
 * JWK hasil export), sehingga verifikasi token sendiri tidak memerlukan secret
 * tambahan. Konsekuensinya private key diimpor sebagai `extractable` — nilainya
 * toh sudah berada di environment Worker.
 */
export async function createJwtSigner(env: Env): Promise<JwtSigner> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(env.APP_JWT_PRIVATE_KEY),
    ALGORITHM,
    true,
    ['sign'],
  )

  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
    ALGORITHM,
    false,
    ['verify'],
  )

  const issuer = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`

  return {
    async mint({ userId, appRole, now }) {
      const issuedAt = Math.floor(now.getTime() / 1000)
      const header = { alg: JWT_ALGORITHM, typ: 'JWT', kid: env.APP_JWT_KEY_ID }
      const payload: AccessTokenClaims = {
        sub: userId,
        role: 'authenticated',
        app_user_id: userId,
        app_role: appRole,
        iss: issuer,
        aud: AUDIENCE,
        iat: issuedAt,
        exp: issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS,
      }

      const signingInput = `${base64UrlEncodeUtf8(JSON.stringify(header))}.${base64UrlEncodeUtf8(JSON.stringify(payload))}`
      const signature = await crypto.subtle.sign(SIGN_PARAMS, privateKey, utf8Bytes(signingInput))

      return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
    },

    async verify(token, now) {
      const parts = token.split('.')
      if (parts.length !== 3) throw invalidToken('bentuk token salah')
      const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]

      let header: Record<string, unknown>
      let claims: Record<string, unknown>
      try {
        header = JSON.parse(base64UrlDecodeUtf8(headerPart)) as Record<string, unknown>
        claims = JSON.parse(base64UrlDecodeUtf8(payloadPart)) as Record<string, unknown>
      } catch {
        throw invalidToken('header/payload bukan JSON')
      }

      // Algoritma dibatasi: tanpa ini, `alg: none` atau algoritma lemah apa pun
      // akan dipercaya.
      if (header['alg'] !== JWT_ALGORITHM) throw invalidToken('alg tidak didukung')
      if (header['kid'] !== env.APP_JWT_KEY_ID) throw invalidToken('kid tidak dikenal')

      const signatureValid = await crypto.subtle.verify(
        SIGN_PARAMS,
        publicKey,
        base64UrlDecode(signaturePart),
        utf8Bytes(`${headerPart}.${payloadPart}`),
      )
      if (!signatureValid) throw invalidToken('tanda tangan tidak sah')

      if (claims['iss'] !== issuer) throw invalidToken('iss tidak cocok')
      if (claims['aud'] !== AUDIENCE) throw invalidToken('aud tidak cocok')
      if (claims['role'] !== 'authenticated') throw invalidToken('role tidak cocok')

      const expiresAt = claims['exp']
      if (typeof expiresAt !== 'number' || expiresAt * 1000 <= now.getTime()) {
        throw invalidToken('token kedaluwarsa')
      }

      const subject = claims['sub']
      const appUserId = claims['app_user_id']
      if (typeof subject !== 'string' || subject === '') throw invalidToken('sub kosong')
      // Dokumen memaku `sub = app_user_id = users.id`; token yang tidak konsisten
      // tidak boleh dipercaya.
      if (appUserId !== subject) throw invalidToken('app_user_id tidak sama dengan sub')

      const appRole = claims['app_role']
      if (typeof appRole !== 'string' || !APP_ROLES.includes(appRole as AppRole)) {
        throw invalidToken('app_role tidak dikenal')
      }

      return {
        sub: subject,
        role: 'authenticated',
        app_user_id: subject,
        app_role: appRole as AppRole,
        iss: issuer,
        aud: AUDIENCE,
        iat: typeof claims['iat'] === 'number' ? claims['iat'] : 0,
        exp: expiresAt,
      }
    },
  }
}

function invalidToken(reason: string): ApiFailure {
  return new ApiFailure('SESSION_INVALID', `access token: ${reason}`)
}

/** Ubah PEM PKCS#8 menjadi byte DER. */
export function pemToBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')

  if (body === '') throw new Error('APP_JWT_PRIVATE_KEY kosong atau bukan PEM')

  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
