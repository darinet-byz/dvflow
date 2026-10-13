#!/usr/bin/env node
/**
 * Provisioning Master Admin pertama (06 §6).
 *
 * Kenapa lewat database langsung, bukan endpoint: 06 §6 melarang bootstrap
 * endpoint publik, dan pada saat menjalankan ini belum ada user mana pun yang
 * bisa menjadi actor `admin_create_user`.
 *
 * Hashing password dilakukan pgcrypto di database (AMENDMENTS A1), dengan
 * parameter yang sama seperti `verify_login` — jadi hash hasil script ini pasti
 * dapat diverifikasi Worker.
 *
 * Yang TIDAK dilakukan script ini:
 *   - tidak punya password default (06 §6.5);
 *   - tidak menuliskan password ke file, log, atau stdout (06 §6.4).
 *
 * Pemakaian:
 *   node scripts/create-master-admin.mjs
 *   SUPABASE_DB_URL=postgresql://... node scripts/create-master-admin.mjs
 *
 * Script juga bekerja dengan stdin non-interaktif (mis. pipe/CI): baris dibaca
 * berurutan username, display name, password, konfirmasi.
 */

import { createInterface } from 'node:readline/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stdin, stdout, env, exit } from 'node:process'
import pg from 'pg'

const LOCAL_DEFAULT = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const PASSWORD_MIN_LENGTH = 8 // 01 §4
const USERNAME_MAX_LENGTH = 64

function fail(message) {
  console.error(`\nGagal: ${message}`)
  exit(1)
}

const isTty = Boolean(stdin.isTTY)
let pipedLines = null
let pipedIndex = 0

if (!isTty) {
  const chunks = []
  for await (const chunk of stdin) chunks.push(chunk)
  pipedLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
  while (pipedLines.length > 0 && pipedLines[pipedLines.length - 1] === '') pipedLines.pop()
  console.warn('(peringatan: stdin bukan TTY — password tidak tersembunyi)')
}

const rl = isTty ? createInterface({ input: stdin, output: stdout }) : null

/** Baca satu baris, tanpa echo saat `hidden` (hanya mungkin di TTY). */
async function ask(question, hidden = false) {
  if (!isTty) {
    const value = pipedLines[pipedIndex++] ?? ''
    stdout.write(`${question}${hidden ? '<disembunyikan>' : value}\n`)
    return value
  }

  if (!hidden) return rl.question(question)

  stdout.write(question)
  stdin.setRawMode(true)
  stdin.resume()

  return new Promise((resolve, reject) => {
    let value = ''
    const onData = (chunk) => {
      const char = chunk.toString('utf8')
      if (char === '\r' || char === '\n' || char === '\u0004') {
        cleanup()
        stdout.write('\n')
        resolve(value)
      } else if (char === '\u0003') {
        cleanup()
        stdout.write('\n')
        reject(new Error('dibatalkan'))
      } else if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1)
      } else if (char >= ' ') {
        value += char
      }
    }
    const cleanup = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
    }
    stdin.on('data', onData)
  })
}

/**
 * Tentukan database tujuan, dan TAMPILKAN host-nya sebelum bertanya apa pun.
 *
 * Urutannya: environment -> `.env.setup.local` -> database lokal. Menampilkan
 * host penting karena kesalahan yang paling mahal di skrip ini adalah membuat
 * akun di database yang salah, dan itu tidak terlihat dari prompt username.
 *
 * Nilai rahasianya sendiri tidak pernah ditampilkan — hanya host-nya.
 */
function resolveConnectionString() {
  if (env.SUPABASE_DB_URL !== undefined && env.SUPABASE_DB_URL !== '') {
    return { connectionString: env.SUPABASE_DB_URL, source: 'environment SUPABASE_DB_URL' }
  }

  try {
    const text = readFileSync(resolve(process.cwd(), '.env.setup.local'), 'utf8')
    const line = text.split('\n').find((row) => row.startsWith('SUPABASE_DB_URL='))
    const value = line?.slice('SUPABASE_DB_URL='.length).trim()
    if (value !== undefined && value !== '') {
      return { connectionString: value, source: '.env.setup.local' }
    }
  } catch {
    // Berkas isian belum ada; jatuh ke database lokal.
  }

  return { connectionString: LOCAL_DEFAULT, source: 'database LOKAL (default)' }
}

const { connectionString, source } = resolveConnectionString()

let targetHost = '(tidak terbaca)'
try {
  targetHost = new URL(connectionString).host
} catch {
  // Biarkan apa adanya; kegagalan koneksi akan menjelaskannya.
}

console.log(`Target database : ${targetHost}`)
console.log(`Sumber          : ${source}`)
if (targetHost.startsWith('127.0.0.1') || targetHost.startsWith('localhost')) {
  console.log('(ini database LOKAL — bukan project Supabase sungguhan)')
}
console.log('')

try {
  const username = (await ask('Username Master Admin: ')).trim()
  const displayName = (await ask('Nama tampilan: ')).trim()
  const password = await ask('Password (min 8 karakter): ', true)
  const confirmation = await ask('Ulangi password: ', true)

  if (username === '') fail('username tidak boleh kosong')
  if (username.length > USERNAME_MAX_LENGTH) fail(`username maksimal ${USERNAME_MAX_LENGTH} karakter`)
  if (/\s/.test(username)) fail('username tidak boleh mengandung spasi')
  if (displayName === '') fail('nama tampilan tidak boleh kosong')
  if (password.length < PASSWORD_MIN_LENGTH) fail(`password minimal ${PASSWORD_MIN_LENGTH} karakter`)
  if (password !== confirmation) fail('password dan konfirmasi tidak sama')

  const client = new pg.Client({
    connectionString,
    ssl: env.SUPABASE_DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()

  try {
    // crypt() + gen_salt('bf', 12) — parameter sama dengan verify_login (A1).
    const { rows } = await client.query(
      `insert into public.users (username, display_name, password_hash, password_algo, role)
       values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf', 12)), 'bcrypt', 'master_admin')
       returning id, username, display_name, role, active, created_at`,
      [username, displayName, password],
    )
    const user = rows[0]
    console.log('\nMaster Admin dibuat:')
    console.log(`  id           : ${user.id}`)
    console.log(`  username     : ${user.username}`)
    console.log(`  display_name : ${user.display_name}`)
    console.log(`  role         : ${user.role}`)
    console.log(`  active       : ${user.active}`)
    console.log(`  created_at   : ${user.created_at.toISOString()}`)
  } catch (error) {
    if (error.code === '23505') fail('username sudah dipakai (case-insensitive)')
    fail(error.message)
  } finally {
    await client.end()
  }
} finally {
  rl?.close()
}
