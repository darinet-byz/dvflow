#!/usr/bin/env node
/**
 * Menyiapkan `.dev.vars` untuk `wrangler pages dev` lokal.
 *
 * `wrangler` membaca berkas ini sebagai secret lokal, sehingga backend dapat
 * dijalankan dengan bentuk environment yang SAMA seperti produksi — termasuk
 * kunci JWT. Nilai Supabase diambil dari `supabase status -o env`, dan kunci
 * JWT dibuat baru (sekali pakai, hanya untuk lokal).
 *
 * Berkas `.dev.vars` berisi secret dan sudah masuk `.gitignore`.
 *
 * Pemakaian:
 *   npm run db:start
 *   node scripts/write-dev-vars.mjs
 *   npm run dev:backend        # wrangler pages dev
 */

import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function supabaseEnv() {
  try {
    const output = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
    const values = {}
    for (const line of output.split('\n')) {
      const match = /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim())
      if (match !== null) values[match[1]] = match[2]
    }
    return values
  } catch {
    console.error('Gagal membaca `supabase status`. Pastikan `npm run db:start` sudah dijalankan.')
    process.exit(1)
  }
}

// Kunci ES256 untuk access JWT — sama bentuknya dengan yang dipakai produksi.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const keyId = `local-dev-key-${randomBytes(3).toString('hex')}`

const supabase = supabaseEnv()
const apiUrl = supabase['API_URL']
const secretKey = supabase['SECRET_KEY']

if (apiUrl === undefined || secretKey === undefined) {
  console.error('API_URL / SECRET_KEY tidak ada di keluaran `supabase status -o env`.')
  console.error('Jalankan `npm run db:start` lalu ulangi.')
  process.exit(1)
}

const webhookSecret = `secret-lokal-webhook-${Math.random().toString(36).slice(2, 10)}`

/**
 * Nilai ditulis dengan `JSON.stringify`, yaitu bentuk dotenv yang sah: satu
 * baris, tanda kutip ganda, dan `\n` sebagai escape.
 *
 * Penting: bentuk multi-baris (heredoc) TIDAK dikenal parser `.dev.vars`.
 * Ketika itu dipakai, seluruh berkas tetap "terbaca" tetapi nilainya tidak
 * sampai ke Worker — gejalanya adalah webhook selalu 404 dengan secret yang
 * sebenarnya benar, dan itu sangat membingungkan untuk didiagnosa.
 */
const vars = [
  '# Dibuat oleh `node scripts/write-dev-vars.mjs` — JANGAN di-commit.',
  '# Berisi secret; sudah tercantum di .gitignore.',
  `SUPABASE_URL=${JSON.stringify(apiUrl)}`,
  `SUPABASE_SECRET_KEY=${JSON.stringify(secretKey)}`,
  `APP_JWT_KEY_ID=${JSON.stringify(keyId)}`,
  `APP_JWT_PRIVATE_KEY=${JSON.stringify(privatePem)}`,
  `ORDERONLINE_WEBHOOK_SECRET=${JSON.stringify(webhookSecret)}`,
  // Dev server Vite berjalan di origin berbeda, dan backend memeriksa
  // same-origin (K19). Tanpa origin ini, refresh session dari `npm run dev:web`
  // akan ditolak 403 dan halaman terus meminta login.
  'APP_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"',
  'ALLOW_MASTER_ADMIN_CREATE_MASTER="false"',
  // Dinaikkan HANYA di lokal supaya tujuan webinar boleh `http://localhost`.
  'ALLOW_INSECURE_WEBINAR_DESTINATION="true"',
  '',
].join('\n')

const target = resolve('.dev.vars')
writeFileSync(target, vars, 'utf8')

// Webhook secret perlu diketahui skrip smoke test; dibaca kembali dari berkas.
console.log(`.dev.vars dibuat di ${target}`)
console.log(`SUPABASE_URL = ${apiUrl}`)
console.log('APP_JWT_PRIVATE_KEY = (kunci baru, hanya lokal)')
console.log('')
console.log('Lalu jalankan backend lokal: npm run dev:backend')
