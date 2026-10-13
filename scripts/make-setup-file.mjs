#!/usr/bin/env node
/**
 * Membuat berkas isian setup `.env.setup.local`.
 *
 * Kenapa berkas ini ada:
 *   * nilai yang HANYA Anda yang tahu (kunci project, akun Cloudflare, repo) tidak
 *     bisa saya tebak, jadi harus ada satu tempat untuk mengisinya;
 *   * nilai rahasia yang bisa dibuat mesin (kunci JWT, webhook secret) diisi
 *     otomatis di sini, sehingga tidak perlu Anda salin-tempel dan tidak pernah
 *     muncul di percakapan;
 *   * berkasnya bernama `.env.setup.local` — sudah tercakup pola `.env.*` di
 *     `.gitignore`, jadi TIDAK AKAN PERNAH ikut ter-commit.
 *
 * Pemakaian:
 *   node scripts/make-setup-file.mjs          # buat bila belum ada
 *   node scripts/make-setup-file.mjs --force  # timpa (kunci JWT baru dibuat)
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { argv, exit } from 'node:process'

const target = resolve('.env.setup.local')
const force = argv.includes('--force')

if (existsSync(target) && !force) {
  console.log(`${target} sudah ada — tidak ditimpa. Pakai --force bila memang ingin membuat ulang.`)
  exit(0)
}

/** Kunci ES256 untuk access JWT (A3). Satu baris dengan escape \n. */
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwtPrivatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const jwtKeyId = `dvflow-${randomBytes(4).toString('hex')}`

/** Secret webhook: 32 byte acak, base64url — tidak dapat ditebak (01 §20). */
const webhookSecret = randomBytes(32).toString('base64url')

const content = `# ============================================================================
# BERKAS ISIAN SETUP — dvflow
# ============================================================================
#
# Cara pakai: isi setiap baris setelah tanda "=", lalu simpan.
# Baris yang sudah terisi otomatis (ditandai [SUDAH DIISI]) TIDAK perlu diubah.
#
# AMAN: berkas ini sudah tercakup pola \`.env.*\` di .gitignore, jadi tidak akan
# pernah ikut ter-commit. Jangan menyalin isinya ke berkas lain di dalam repo.
#
# Cara menemukan tiap nilai ada di komentar di atasnya.
# ============================================================================


# ----------------------------------------------------------------------------
# 1. GITHUB — untuk menyimpan kode ke remote (backup + kolaborasi)
# ----------------------------------------------------------------------------

# [ISI] Pemilik/nama repo, format: pemilik/nama-repo
#   Contoh: zulfakar25/dvflow
GITHUB_REPO=

# [ISI] private atau public. Rekomendasi kuat: private
GITHUB_REPO_VISIBILITY=private

# [OPSIONAL] Token GitHub, hanya bila Anda ingin saya yang membuat repo + push.
#   Buat di: GitHub -> Settings -> Developer settings -> Personal access tokens
#   -> Fine-grained tokens, scope "Contents: Read and write" + "Administration: Read and write"
#   Kalau Anda membuat repo dan push sendiri, biarkan kosong.
GITHUB_TOKEN=


# ----------------------------------------------------------------------------
# 2. SUPABASE — database, auth, dan RLS (WAJIB)
# ----------------------------------------------------------------------------

# [ISI] Project ref (bagian acak pada URL project).
#   Dashboard -> Project Settings -> General -> Reference ID
#   Contoh: abcdefghijklmnop
SUPABASE_PROJECT_REF=

# [ISI] Project URL.
#   Dashboard -> Project Settings -> API -> Project URL
#   Contoh: https://abcdefghijklmnop.supabase.co
SUPABASE_URL=

# [ISI] Kunci publik (boleh ada di frontend).
#   Dashboard -> Project Settings -> API -> Publishable key
#   Bentuknya: sb_publishable_...
#   CATATAN: kunci JWT "anon" lama juga bisa dipakai, tapi kunci format baru ini
#   yang sudah terbukti bekerja dengan Supabase versi ini.
SUPABASE_PUBLISHABLE_KEY=

# [ISI] Kunci RAHASIA (hanya backend). JANGAN pernah ditaruh di frontend.
#   Dashboard -> Project Settings -> API -> Secret key
#   Bentuknya: sb_secret_...
SUPABASE_SECRET_KEY=

# [ISI] Connection string Postgres, termasuk password database.
#   Dashboard -> Connect -> Session pooler (atau Direct connection)
#   Bentuknya: postgresql://postgres.<ref>:<PASSWORD>@<host>:5432/postgres
#   Dipakai oleh: supabase db push, scripts/create-master-admin.mjs
SUPABASE_DB_URL=

# [OPSIONAL] Access token Supabase (hanya bila Anda ingin saya yang mengurus
#   project lewat Management API, mis. memasang signing key JWT).
#   Dashboard -> Account -> Access Tokens -> Generate new token
SUPABASE_ACCESS_TOKEN=


# ----------------------------------------------------------------------------
# 3. CLOUDFLARE — hosting aplikasi + backend (WAJIB)
# ----------------------------------------------------------------------------

# [ISI] Account ID.
#   Dashboard Cloudflare -> Workers & Pages -> Account ID (sidebar kanan)
CLOUDFLARE_ACCOUNT_ID=

# [ISI] Nama project Pages. Boleh nama baru (akan dibuat) atau yang sudah ada.
#   Contoh: dvflow
PAGES_PROJECT_NAME=dvflow

# [ISI] API token dengan izin "Cloudflare Pages: Edit" (+ "Account: Read").
#   Dibuat di: My Profile -> API Tokens -> Create Token -> Custom token
#   Dipakai oleh: wrangler pages deploy, wrangler pages secret put
CLOUDFLARE_API_TOKEN=

# [OPSIONAL] Domain sendiri, bila sudah ada. Kosongkan bila masih memakai
#   <project>.pages.dev
APP_DOMAIN=


# ----------------------------------------------------------------------------
# 4. RAHASIA APLIKASI — sudah dibuat otomatis, tidak perlu diubah
# ----------------------------------------------------------------------------

# [SUDAH DIISI] Kunci penanda JWT (header "kid").
APP_JWT_KEY_ID=${jwtKeyId}

# [SUDAH DIISI] Private key ES256 (PKCS#8 PEM, satu baris).
#   Public key-nya ada di bagian 5 untuk di-import ke Supabase.
APP_JWT_PRIVATE_KEY=${JSON.stringify(jwtPrivatePem)}

# [SUDAH DIISI] Secret path webhook: /api/webhooks/orderonline/<secret ini>
ORDERONLINE_WEBHOOK_SECRET=${webhookSecret}

# [JANGAN DIUBAH] Dua saklar ini harus tetap false di produksi.
ALLOW_MASTER_ADMIN_CREATE_MASTER=false
ALLOW_INSECURE_WEBINAR_DESTINATION=false


# ----------------------------------------------------------------------------
# 5. PUBLIC KEY JWT — untuk di-import ke Supabase (langkah manual, sekali)
# ----------------------------------------------------------------------------
#
# Supabase harus mempercayai kunci ini, kalau tidak setiap query browser akan
# ditolak 401 oleh PostgREST (docs/AMENDMENTS.md A3).
#
# Caranya:
#   1. Dashboard Supabase -> Project Settings -> API -> JWT Signing Keys
#      (bila tidak ada menu itu, gunakan "Legacy JWT secret" -> bagian
#      "Add signing key" / "Import key")
#   2. Pilih ES256, tempelkan isi di bawah (JWK), kid harus sama:
#      ${jwtKeyId}
#   3. Simpan, lalu aktifkan kunci itu.
#
# Public key (boleh publik — aman untuk disimpan):
APP_JWT_PUBLIC_JWK=PLACEHOLDER_PUBLIC_JWK
`

// Public key diturunkan dari private key yang sama (koordinat x/y ada di JWK).
const publicJwk = privateKey.export({ format: 'jwk' })
const jwkJson = JSON.stringify({ ...publicJwk, kid: jwtKeyId, alg: 'ES256', use: 'sig' })
const finalContent = content.replace('PLACEHOLDER_PUBLIC_JWK', jwkJson)

writeFileSync(target, finalContent, 'utf8')

console.log(`Dibuat: ${target}`)
console.log('')
console.log('Yang perlu Anda isi (8 nilai; 3 lainnya opsional):')
console.log('  1. GITHUB_REPO                 (pemilik/nama-repo)')
console.log('  2. SUPABASE_PROJECT_REF        (Dashboard -> Settings -> General)')
console.log('  3. SUPABASE_URL                (Dashboard -> Settings -> API)')
console.log('  4. SUPABASE_PUBLISHABLE_KEY    (sb_publishable_...)')
console.log('  5. SUPABASE_SECRET_KEY         (sb_secret_...)')
console.log('  6. SUPABASE_DB_URL             (Dashboard -> Connect)')
console.log('  7. CLOUDFLARE_ACCOUNT_ID       (Workers & Pages)')
console.log('  8. CLOUDFLARE_API_TOKEN        (My Profile -> API Tokens)')
console.log('')
console.log('Sudah diisi otomatis: APP_JWT_KEY_ID, APP_JWT_PRIVATE_KEY,')
console.log('ORDERONLINE_WEBHOOK_SECRET, APP_JWT_PUBLIC_JWK, PAGES_PROJECT_NAME.')
console.log('')
console.log('Berkas ini DIABAIKAN git (.env.*) — tidak akan pernah ikut ter-commit.')
