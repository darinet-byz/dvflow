import { describe, expect, it } from 'vitest'
import type { AppRole } from '@dvflow/shared'
import { createJwtSigner } from '../src/auth/jwt'
import { ApiFailure } from '../src/http/errors'
import { createTestEnv } from './helpers'

const NOW = new Date('2026-10-13T08:00:00.000Z')

function decodePart(part: string): Record<string, unknown> {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

function replacePart(token: string, index: number, value: string): string {
  const parts = token.split('.')
  parts[index] = value
  return parts.join('.')
}

async function expectRejected(signer: Awaited<ReturnType<typeof createJwtSigner>>, token: string, now = NOW) {
  await expect(signer.verify(token, now)).rejects.toBeInstanceOf(ApiFailure)
}

describe('access JWT (01 §2, 04 §4, A3)', () => {
  it('header memuat alg/kid yang benar dan payload memuat seluruh claim wajib', async () => {
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)
    const token = await signer.mint({ userId: 'user-1', appRole: 'member', now: NOW })

    const [headerPart, payloadPart] = token.split('.') as [string, string]
    expect(decodePart(headerPart)).toEqual({ alg: 'ES256', typ: 'JWT', kid: env.APP_JWT_KEY_ID })

    const claims = decodePart(payloadPart)
    expect(claims).toEqual({
      sub: 'user-1',
      role: 'authenticated',
      app_user_id: 'user-1',
      app_role: 'member',
      iss: 'https://project.supabase.co/auth/v1',
      aud: 'authenticated',
      iat: Math.floor(NOW.getTime() / 1000),
      exp: Math.floor(NOW.getTime() / 1000) + 1800,
    })
  })

  it('token buatan sendiri lolos verifikasi dan mengembalikan claim yang sama', async () => {
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)
    const token = await signer.mint({ userId: 'user-1', appRole: 'admin', now: NOW })

    const claims = await signer.verify(token, NOW)
    expect(claims.sub).toBe('user-1')
    expect(claims.app_role).toBe('admin')
    expect(claims.iss).toBe('https://project.supabase.co/auth/v1')
    expect(claims.aud).toBe('authenticated')
  })

  it('payload yang diubah membuat tanda tangan tidak sah', async () => {
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)
    const token = await signer.mint({ userId: 'user-1', appRole: 'member', now: NOW })

    const tampered = replacePart(
      token,
      1,
      btoa(JSON.stringify({ sub: 'user-1', app_role: 'owner', iss: 'https://project.supabase.co/auth/v1', aud: 'authenticated', role: 'authenticated', exp: Math.floor(NOW.getTime() / 1000) + 1800 }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, ''),
    )

    await expectRejected(signer, tampered)
  })

  it('`alg: none` ditolak', async () => {
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)
    const token = await signer.mint({ userId: 'user-1', appRole: 'member', now: NOW })

    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    await expectRejected(signer, replacePart(token, 0, header))
  })

  it('kid asing ditolak (rotasi kunci tidak membuat token lama diterima)', async () => {
    const envA = await createTestEnv()
    const envB = await createTestEnv({ APP_JWT_KEY_ID: 'kunci-lain' })
    const signerA = await createJwtSigner(envA)
    const signerB = await createJwtSigner(envB)

    const tokenFromB = await signerB.mint({ userId: 'user-1', appRole: 'member', now: NOW })
    await expectRejected(signerA, tokenFromB)
  })

  it('token yang ditandatangani kunci lain ditolak', async () => {
    const envA = await createTestEnv()
    const envB = await createTestEnv()
    // kid dibuat sama supaya yang diuji benar-benar tanda tangannya.
    const signerA = await createJwtSigner(envA)
    const signerB = await createJwtSigner(envB)

    const tokenFromB = await signerB.mint({ userId: 'user-1', appRole: 'member', now: NOW })
    await expectRejected(signerA, tokenFromB)
  })

  it('token kedaluwarsa ditolak', async () => {
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)
    const token = await signer.mint({ userId: 'user-1', appRole: 'member', now: NOW })

    await expect(signer.verify(token, new Date(NOW.getTime() + 29 * 60 * 1000))).resolves.toBeTruthy()
    await expectRejected(signer, token, new Date(NOW.getTime() + 31 * 60 * 1000))
  })

  it('iss yang berbeda ditolak (token project lain)', async () => {
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)

    // Kunci dan `kid` SENGAJA sama, hanya `iss` yang berbeda — supaya yang
    // diuji benar-benar pemeriksaan issuer, bukan pemeriksaan tanda tangan.
    const otherProjectSigner = await createJwtSigner({ ...env, SUPABASE_URL: 'https://project-lain.supabase.co' })
    const token = await otherProjectSigner.mint({ userId: 'user-1', appRole: 'member', now: NOW })

    await expectRejected(signer, token)
  })

  it('slug role tidak valid ditolak walau tanda tangannya sah', async () => {
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)

    const token = await signer.mint({ userId: 'user-1', appRole: 'invalid role!' as AppRole, now: NOW })
    await expectRejected(signer, token)
  })

  it('token cacat bentuk ditolak', async () => {
    const env = await createTestEnv()
    const signer = await createJwtSigner(env)

    for (const token of ['', 'a', 'a.b', 'a.b.c.d', '..', 'x.y.z']) {
      await expectRejected(signer, token)
    }
  })
})
