#!/usr/bin/env node
/**
 * Membuat ulang access-JWT signing key (04 §4, 06 §4, AMENDMENTS A3).
 *
 * Access JWT ditandatangani di Worker dengan ES256 dan diverifikasi Supabase.
 * Agar PostgREST menerima tokennya, public key harus di-import ke project
 * Supabase sebagai signing key dengan `kid` yang sama dengan header token (A3).
 *
 * Private key TIDAK pernah ditulis ke repository — script ini hanya
 * menampilkannya ke stdout untuk langsung disalin menjadi Worker secret.
 *
 * Pemakaian:
 *   node scripts/rotate-jwt-key.mjs
 *   node scripts/rotate-jwt-key.mjs --kid <kid-lama>   # rotasi memakai kid baru
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { argv, env, exit } from 'node:process'

const kidFlagIndex = argv.indexOf('--kid')
const keyId = kidFlagIndex !== -1 ? argv[kidFlagIndex + 1] : randomUUID()

if (!keyId) {
  console.error('Gagal: nilai --kid kosong.')
  exit(1)
}

// P-256 (prime256v1) = kurva yang dipakai ES256.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicJwk = publicKey.export({ format: 'jwk' })

console.log('=== APP_JWT_KEY_ID (Worker secret) ===')
console.log(keyId)

console.log('\n=== APP_JWT_PRIVATE_KEY (Worker secret, PKCS#8 PEM) ===')
console.log('Simpan sebagai Worker secret. JANGAN commit ke repository.')
console.log('---8<---')
console.log(privatePem.trimEnd())
console.log('--->8---')

console.log('\n=== Public key untuk Supabase (JWT signing key, ES256) ===')
console.log('Tambahkan di Supabase Dashboard -> Project Settings -> API -> JWT Signing Keys')
console.log('(atau lewat Management API) dengan `kid` di atas dan JWK berikut:')
console.log(JSON.stringify({ ...publicJwk, kid: keyId, alg: 'ES256', use: 'sig' }, null, 2))

console.log('\nLangkah rotasi:')
console.log('  1. import public key di atas sebagai signing key BARU (kid baru);')
console.log('  2. set APP_JWT_PRIVATE_KEY + APP_JWT_KEY_ID di Worker;')
console.log('  3. deploy Worker, lalu verifikasi login menghasilkan token yang diterima PostgREST;')
console.log('  4. baru setelah itu hapus signing key lama.')
console.log('Catatan: rotasi mencabut seluruh access JWT yang masih beredar (umur 30 menit),')
console.log('        tetapi TIDAK memutus refresh session (7 hari) — user tidak perlu login ulang.')

if (env.APP_JWT_KEY_ID && env.APP_JWT_KEY_ID === keyId) {
  console.warn('\nPeringatan: kid ini sama dengan APP_JWT_KEY_ID di environment saat ini.')
}
