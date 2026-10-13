#!/usr/bin/env node
/**
 * Memeriksa berkas isian `.env.setup.local` — isinya DAN apakah nilainya
 * benar-benar bekerja.
 *
 * Prinsip berkas ini: **tidak pernah menampilkan nilai rahasia.** Yang
 * dilaporkan hanya status, bentuk, dan panjang. Tujuannya supaya pemeriksaan
 * bisa dijalankan sambil layarnya dilihat orang lain atau direkam.
 *
 * Pemakaian:
 *   node scripts/check-setup.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TARGET = resolve('.env.setup.local')

const REQUIRED = [
  ['GITHUB_REPO', 'pemilik/nama-repo'],
  ['SUPABASE_PROJECT_REF', 'project ref'],
  ['SUPABASE_URL', 'https://<ref>.supabase.co'],
  ['SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_...'],
  ['SUPABASE_SECRET_KEY', 'sb_secret_...'],
  ['SUPABASE_DB_URL', 'postgresql://...'],
  ['CLOUDFLARE_ACCOUNT_ID', 'account id'],
  ['CLOUDFLARE_API_TOKEN', 'API token izin Pages'],
]

const OPTIONAL = ['GITHUB_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'APP_DOMAIN']

let failures = 0
let pending = 0

function ok(label, detail = '') {
  console.log(`  OK     ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

function bad(label, detail) {
  failures += 1
  console.log(`  GAGAL  ${label} — ${detail}`)
}

function todo(label) {
  pending += 1
  console.log(`  KOSONG ${label}`)
}

/** Nilai hanya dipakai, tidak pernah dicetak. */
function preview(value) {
  return `${value.length} karakter`
}

if (!existsSync(TARGET)) {
  console.error(`${TARGET} tidak ada. Jalankan: node scripts/make-setup-file.mjs`)
  process.exit(1)
}

const vars = {}
for (const line of readFileSync(TARGET, 'utf8').split('\n')) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
  if (match === null) continue
  const raw = (match[2] ?? '').trim()
  // Nilai boleh dikutip (kunci PEM memakai \n sebagai escape).
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? JSON.parse(raw) : raw
  vars[match[1]] = unquoted
}

console.log(`\nMemeriksa ${TARGET}\n`)

// ---------------------------------------------------------------------------
console.log('1. Kelengkapan')
for (const [key, hint] of REQUIRED) {
  const value = vars[key] ?? ''
  if (value === '' || value.startsWith('PLACEHOLDER')) todo(`${key} (butuh: ${hint})`)
  else ok(`${key} terisi`, preview(value))
}
for (const key of OPTIONAL) {
  const value = vars[key] ?? ''
  console.log(`  ${value === '' ? 'kosong (opsional)' : 'terisi (opsional)'}  ${key}`)
}

// ---------------------------------------------------------------------------
console.log('\n2. Bentuk nilai')
const url = vars['SUPABASE_URL'] ?? ''
if (url !== '' && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url)) {
  bad('SUPABASE_URL', 'bukan bentuk https://<ref>.supabase.co')
} else if (url !== '') {
  ok('SUPABASE_URL berbentuk benar')
}

const ref = vars['SUPABASE_PROJECT_REF'] ?? ''
if (ref !== '' && url.includes(ref)) ok('project ref cocok dengan isi URL')
else if (ref !== '' && url !== '') bad('SUPABASE_PROJECT_REF', 'tidak cocok dengan URL project')
else if (ref !== '') console.log('  (tidak diperiksa)  kecocokan ref vs URL')

const publishable = vars['SUPABASE_PUBLISHABLE_KEY'] ?? ''
if (publishable !== '' && !publishable.startsWith('sb_publishable_') && !publishable.startsWith('eyJ')) {
  bad('SUPABASE_PUBLISHABLE_KEY', 'bukan kunci format baru (sb_publishable_) maupun JWT lama')
} else if (publishable !== '') {
  ok('SUPABASE_PUBLISHABLE_KEY bentuknya dikenal')
}

const secret = vars['SUPABASE_SECRET_KEY'] ?? ''
if (secret !== '' && secret.startsWith('sb_publishable_')) {
  bad('SUPABASE_SECRET_KEY', 'INI KUNCI PUBLIK, bukan rahasia')
} else if (secret !== '' && !secret.startsWith('sb_secret_') && !secret.startsWith('eyJ')) {
  bad('SUPABASE_SECRET_KEY', 'bukan kunci format baru (sb_secret_) maupun JWT lama')
} else if (secret !== '') {
  ok('SUPABASE_SECRET_KEY bentuknya dikenal')
}

const dbUrl = vars['SUPABASE_DB_URL'] ?? ''
if (dbUrl !== '' && !/^postgres(ql)?:\/\/.+@.+:\d+\/.+$/.test(dbUrl)) {
  bad('SUPABASE_DB_URL', 'bukan connection string Postgres yang lengkap')
} else if (dbUrl !== '') {
  ok('SUPABASE_DB_URL berbentuk benar')
}

const accountId = vars['CLOUDFLARE_ACCOUNT_ID'] ?? ''
if (accountId !== '' && !/^[0-9a-f]{32}$/.test(accountId)) {
  console.log('  catatan  CLOUDFLARE_ACCOUNT_ID bukan 32 karakter hex — pastikan yang disalin Account ID, bukan nama akun')
} else if (accountId !== '') {
  ok('CLOUDFLARE_ACCOUNT_ID berbentuk benar')
}

const repo = vars['GITHUB_REPO'] ?? ''
if (repo !== '' && !/^[\w.-]+\/[\w.-]+$/.test(repo)) bad('GITHUB_REPO', 'bukan format pemilik/nama-repo')
else if (repo !== '') ok('GITHUB_REPO berbentuk benar')

const privateKey = vars['APP_JWT_PRIVATE_KEY'] ?? ''
if (privateKey.includes('BEGIN PRIVATE KEY')) ok('APP_JWT_PRIVATE_KEY ada (dibuat otomatis)')
else bad('APP_JWT_PRIVATE_KEY', 'tidak memuat PEM PKCS#8')

// ---------------------------------------------------------------------------
console.log('\n3. Uji sambungan (yang bisa diuji tanpa mengubah apa pun)')

if (url !== '' && secret !== '') {
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/products?select=code&limit=1`, {
      headers: { apikey: secret, authorization: `Bearer ${secret}` },
    })
    if (response.ok) ok('Supabase + secret key', 'REST menjawab dan dapat membaca tabel')
    else bad('Supabase + secret key', `REST menjawab ${response.status}`)
  } catch (error) {
    bad('Supabase + secret key', `tidak dapat dihubungi (${error.message})`)
  }
} else {
  console.log('  dilewati  Supabase (nilai belum lengkap)')
}

if (url !== '' && publishable !== '') {
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/orders?select=order_id&limit=1`, {
      headers: { apikey: publishable, authorization: `Bearer ${publishable}` },
    })
    // 401 = benar: anon tidak punya akses ke orders (RLS + grant dicabut).
    // 200 dengan isi = BAHAYA: tabel terbuka untuk umum.
    if (response.status === 401 || response.status === 403) {
      ok('RLS: orders TERTUTUP untuk kunci publik', `status ${response.status}`)
    } else if (response.ok) {
      const body = await response.text()
      if (body === '[]') ok('RLS: orders tidak mengembalikan baris untuk kunci publik', 'status 200, 0 baris')
      else bad('RLS', 'orders dapat dibaca dengan kunci publik — periksa policy dan grant!')
    } else {
      console.log(`  catatan  orders menjawab ${response.status} untuk kunci publik`)
    }
  } catch (error) {
    bad('RLS check', `tidak dapat dihubungi (${error.message})`)
  }
} else {
  console.log('  dilewati  RLS check (nilai belum lengkap)')
}

if (dbUrl !== '') {
  try {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: dbUrl })
    await client.connect()
    const { rows } = await client.query('select count(*)::int as tables from information_schema.tables where table_schema = $1', ['public'])
    await client.end()
    const tableCount = rows[0]?.tables ?? 0
    if (tableCount === 0) {
      console.log('  catatan  Database tersambung, tetapi skema `public` masih kosong — migrasi belum dijalankan')
    } else {
      ok('Database Postgres', `tersambung, ${tableCount} tabel di skema public`)
    }
  } catch (error) {
    bad('Database Postgres', `tidak dapat tersambung (${error.code ?? error.message})`)
  }
} else {
  console.log('  dilewati  Database (nilai belum lengkap)')
}

const cloudflareToken = vars['CLOUDFLARE_API_TOKEN'] ?? ''
if (cloudflareToken !== '') {
  try {
    const output = execFileSync(
      process.execPath,
      ['node_modules/wrangler/bin/wrangler.js', 'whoami'],
      { encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_TOKEN: cloudflareToken, CLOUDFLARE_ACCOUNT_ID: accountId }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const lines = output.split('\n').filter((line) => /@|Account|Token|pages/i.test(line)).slice(0, 6)
    ok('Cloudflare token diterima wrangler')
    for (const line of lines) console.log(`         ${line.trim()}`)
  } catch (error) {
    bad('Cloudflare token', `wrangler menolak atau gagal (${(error.stderr ?? error.message).toString().trim().split('\n')[0]})`)
  }
} else {
  console.log('  dilewati  Cloudflare (token belum diisi)')
}

if (repo !== '') {
  try {
    const output = execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const line = output.split('\n').find((l) => l.includes('Logged in')) ?? 'terautentikasi'
    ok('GitHub CLI', line.trim())
  } catch {
    console.log('  catatan  `gh` tidak tersedia atau belum login — push bisa memakai kredensial VS Code/Git Anda')
  }
} else {
  console.log('  dilewati  GitHub (repo belum diisi)')
}

console.log(`\n${failures === 0 && pending === 0 ? 'Semua siap.' : `${pending} nilai belum diisi, ${failures} masalah.`}\n`)
process.exit(failures === 0 ? 0 : 1)
