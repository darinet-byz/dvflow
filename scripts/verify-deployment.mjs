#!/usr/bin/env node
/**
 * Memverifikasi project Supabase yang sudah di-deploy — bukan mengasumsikan.
 *
 * Yang diperiksa, semuanya terhadap project SUNGGUHAN:
 *   1. migrasi benar-benar menghasilkan skema (tabel, fungsi, seed canonical);
 *   2. RLS menyala di SELURUH tabel dan TIDAK ada policy yang memberi hak tulis
 *      dari browser (STATE.md K11);
 *   3. job retensi terjadwal (06 §8);
 *   4. **ujian paling penting**: `orders`, `users`, dan `app_settings` TIDAK
 *      dapat dibaca dengan kunci publik — inilah yang membedakan RLS yang benar
 *      dari RLS yang hanya dipasang di atas kertas.
 *
 * Pemakaian: node scripts/verify-deployment.mjs
 * Tidak pernah menampilkan nilai rahasia.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let failures = 0

function ok(label, detail = '') {
  console.log(`  OK     ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

function bad(label, detail) {
  failures += 1
  console.log(`  GAGAL  ${label} — ${detail}`)
}

function info(label, detail) {
  console.log(`  catatan ${label} — ${detail}`)
}

const vars = {}
for (const line of readFileSync(resolve('.env.setup.local'), 'utf8').split('\n')) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
  if (match === null) continue
  const raw = (match[2] ?? '').trim()
  vars[match[1]] = raw.startsWith('"') && raw.endsWith('"') ? JSON.parse(raw) : raw
}

console.log('\nVerifikasi project Supabase\n')

// ---------------------------------------------------------------------------
console.log('1. Skema hasil migrasi')
const { Client } = await import('pg')
const client = new Client({ connectionString: vars.SUPABASE_DB_URL })
await client.connect()
const query = async (sql, values) => (await client.query(sql, values)).rows

const tables = await query(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
)
const expectedTables = [
  'app_sessions', 'app_settings', 'attendance_events', 'advertisers', 'event_types',
  'orders', 'payment_fee_rules', 'products', 'sessions_config', 'users', 'webhook_logs',
]
const missing = expectedTables.filter((name) => !tables.some((row) => row.table_name === name))
if (missing.length === 0) ok(`11 tabel inti ada`, `total ${tables.length} tabel di public`)
else bad('tabel inti', `hilang: ${missing.join(', ')}`)

const functions = await query(
  `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname in
      ('upsert_order_webhook','checkin_seminar','verify_login','admin_create_user',
       'change_password','presensi_page','dashboard_summary','tax_report','orders_page',
       'calc_tax_amount','is_app_user','app_role','normalize_code','normalize_payment_identifier')`,
)
const functionNames = functions.map((row) => row.proname)
if (functionNames.length === 14) ok('fungsi domain & RPC terpasang', '14/14')
else bad('fungsi', `kurang: ${['upsert_order_webhook','checkin_seminar','verify_login','admin_create_user','change_password','presensi_page','dashboard_summary','tax_report','orders_page','calc_tax_amount','is_app_user','app_role','normalize_code','normalize_payment_identifier'].filter((n) => !functionNames.includes(n)).join(', ')}`)

const seed = await query(
  `select (select count(*)::int from public.event_types) as event_types,
          (select count(*)::int from public.sessions_config) as sessions`,
)
if (seed[0].event_types === 2 && seed[0].sessions === 3) {
  ok('seed canonical ada', 'event_types 2 (SO/WO), sessions 3 (S1/S2/ST)')
} else {
  bad('seed canonical', `event_types=${seed[0].event_types}, sessions=${seed[0].sessions} — periksa 0006/0007`)
}

// ---------------------------------------------------------------------------
console.log('\n2. RLS')
const tanpaRls = await query(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
)
if (tanpaRls.length === 0) ok('RLS menyala di seluruh tabel public')
else bad('RLS', `menyala di semua kecuali: ${tanpaRls.map((row) => row.relname).join(', ')}`)

const policy = await query(
  `select count(*)::int as total,
          count(*) filter (where cmd in ('INSERT','UPDATE','DELETE','ALL'))::int as menulis
     from pg_policies where schemaname = 'public'`,
)
if (policy[0].menulis === 0) ok('tidak ada policy yang memberi hak tulis', `${policy[0].total} policy, semuanya baca`)
else bad('policy tulis', `${policy[0].menulis} policy memberi hak tulis — melanggar K11`)

const grants = await query(
  `select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and privilege_type in ('INSERT','UPDATE','DELETE')
    group by table_name, privilege_type`,
)
if (grants.length === 0) ok('authenticated tidak punya grant tulis di tabel mana pun')
else bad('grant tulis', grants.map((row) => `${row.table_name}:${row.privilege_type}`).join(', '))

const cols = await query(
  `select column_name from information_schema.column_privileges
    where grantee = 'authenticated' and table_schema = 'public' and table_name = 'users'
      and column_name in ('password_hash','password_algo')`,
)
if (cols.length === 0) ok('kolom kredensial tidak dapat dibaca authenticated', 'password_hash/password_algo tertutup')
else bad('kolom kredensial', cols.map((row) => row.column_name).join(', '))

// ---------------------------------------------------------------------------
console.log('\n3. Job retensi')
const cron = await query(`select jobname, schedule, command from cron.job where jobname like 'dvflow_%' order by jobname`)
if (cron.length === 2) {
  ok('dua job retensi terjadwal', cron.map((row) => `${row.jobname} (${row.schedule})`).join(', '))
  if (cron.some((row) => row.command.includes('public.orders'))) bad('job retensi', 'ada job yang menyentuh Master Order')
  else ok('job retensi tidak menyentuh Master Order')
} else {
  bad('job retensi', `terjadwal ${cron.length}, seharusnya 2 — periksa ekstensi pg_cron`)
}

await client.end()

// ---------------------------------------------------------------------------
console.log('\n4. Uji RLS lewat REST (kunci publik harus DITOLAK)')
const base = vars.SUPABASE_URL.replace(/\/+$/, '')

async function rest(label, key, path, expectBlocked) {
  try {
    const response = await fetch(`${base}${path}`, { headers: { apikey: key, authorization: `Bearer ${key}` } })
    const body = (await response.text()).slice(0, 60)

    if (expectBlocked) {
      // Ditolak = status 401/403, ATAU 200 dengan nol baris. Yang BAHAYA: ada isinya.
      const blocked = response.status === 401 || response.status === 403 || body.trim() === '[]'
      if (blocked) ok(`${label} tidak dapat dibaca kunci publik`, `status ${response.status}, body ${body}`)
      else bad(`${label} TERBUKA untuk kunci publik`, `status ${response.status}, body ${body}`)
    } else {
      if (response.ok) ok(`${label} dapat dibaca backend`, `status ${response.status}`)
      else bad(`${label} gagal dibaca backend`, `status ${response.status}, body ${body}`)
    }
  } catch (error) {
    bad(label, `tidak dapat dihubungi (${error.message})`)
  }
}

await rest('orders', vars.SUPABASE_PUBLISHABLE_KEY, '/rest/v1/orders?select=order_id&limit=1', true)
await rest('users', vars.SUPABASE_PUBLISHABLE_KEY, '/rest/v1/users?select=username&limit=1', true)
await rest('app_settings', vars.SUPABASE_PUBLISHABLE_KEY, '/rest/v1/app_settings?select=key&limit=1', true)
await rest('app_sessions', vars.SUPABASE_PUBLISHABLE_KEY, '/rest/v1/app_sessions?select=id&limit=1', true)
await rest('orders', vars.SUPABASE_SECRET_KEY, '/rest/v1/orders?select=order_id&limit=1', false)

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? 'Semua pemeriksaan lulus.' : `${failures} pemeriksaan GAGAL.`}\n`)
process.exit(failures === 0 ? 0 : 1)
