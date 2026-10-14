/**
 * Hapus TOTAL data trial (keputusan pengguna 14 Okt 2026), lalu konfigurasi bersih.
 *
 * Default: hanya inventaris + backup JSON lokal (read-only). Penghapusan butuh
 * --apply, --project <ref> yang persis, --actor <uuid Developer aktif>, dan
 * --yes-delete-transactions.
 *
 * Dihapus  : attendance_events, orderonline_order_sources, orders, webhook_logs,
 *            lalu reset_product_configuration (0028): alias, mapping Zoom/tiket,
 *            penugasan produk, 4 kamus master → seed SO/WO + ST/S1–S8, VALIDATE constraint.
 * Disimpan : users, roles/permissions, koneksi OrderOnline (URL webhook tetap), fee rule tax.
 *
 * Usage: node scripts/wipe-trial-data.mjs --env <file> [--apply --project <ref> --actor <uuid> --yes-delete-transactions] [--ca <pem>]
 */
import { Client } from 'pg'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
const envPath = option('--env')
if (!envPath) throw new Error('Usage: node scripts/wipe-trial-data.mjs --env <file> [--apply --project <ref> --actor <uuid> --yes-delete-transactions]')
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')]
}))
const dbTarget = new URL(env.SUPABASE_DB_URL)
const local = ['127.0.0.1', 'localhost'].includes(dbTarget.hostname)
const ca = option('--ca') ? readFileSync(option('--ca'), 'utf8') : undefined
const client = new Client({ connectionString: env.SUPABASE_DB_URL, ...(local ? {} : { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } }), connectionTimeoutMillis: 10000 })

const TRANSACTION_TABLES = ['attendance_events', 'orderonline_order_sources', 'orders', 'webhook_logs']
const CONFIG_TABLES = ['products', 'advertisers', 'event_types', 'sessions_config', 'product_aliases', 'user_product_access']

let inTransaction = false
try {
  await client.connect()
  const applying = args.includes('--apply')
  if (applying) {
    if (!option('--project') || option('--project') !== env.SUPABASE_PROJECT_REF) throw new Error('--project harus sama persis dengan SUPABASE_PROJECT_REF.')
    if (!/^[a-f0-9-]{36}$/i.test(option('--actor') ?? '')) throw new Error('--actor wajib UUID Developer aktif.')
    if (!args.includes('--yes-delete-transactions')) throw new Error('Tambahkan --yes-delete-transactions untuk menyetujui penghapusan order & presensi.')
    if (!local && dbTarget.hostname !== `db.${env.SUPABASE_PROJECT_REF}.supabase.co` &&
        !(dbTarget.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(dbTarget.username) === `postgres.${env.SUPABASE_PROJECT_REF}`)) {
      throw new Error('Target database tidak cocok dengan project yang diharapkan.')
    }
  }

  await client.query(applying ? 'begin' : 'begin isolation level repeatable read read only')
  inTransaction = true
  const version = (await client.query("select exists(select 1 from pg_proc where proname = 'schema_version') ok")).rows[0].ok
    ? (await client.query('select public.schema_version() v')).rows[0].v : null
  if (applying && (version ?? 0) < 29) throw new Error('Terapkan migrasi sampai 0029 terlebih dahulu (schema_version < 29).')

  if (applying) {
    await client.query(`lock table ${[...TRANSACTION_TABLES, ...CONFIG_TABLES, 'app_settings'].map(t => `public.${t}`).join(', ')} in share row exclusive mode`)
  }

  const backup = { project: env.SUPABASE_PROJECT_REF, target: { host: dbTarget.hostname, database: dbTarget.pathname.slice(1) }, schema_version: version, created_at: new Date().toISOString(), tables: {} }
  for (const table of [...TRANSACTION_TABLES, ...CONFIG_TABLES]) {
    backup.tables[table] = (await client.query(`select * from public.${table}`)).rows
  }
  backup.tables.app_settings = (await client.query("select * from public.app_settings where key like 'webinar_destination::%' or key like 'seminar_ticket::%'")).rows

  const dir = resolve('.local-backups')
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, `trial-data-${Date.now()}.json`)
  const serialized = JSON.stringify(backup, null, 2)
  writeFileSync(path, serialized, { flag: 'wx', mode: 0o600 })
  console.log('Backup:', path)
  console.log('SHA256:', createHash('sha256').update(serialized).digest('hex'))
  console.log('Counts:', JSON.stringify(Object.fromEntries(Object.entries(backup.tables).map(([k, v]) => [k, v.length]))))

  if (!applying) {
    console.log('DRY RUN: tidak ada data dihapus.')
    await client.query('rollback'); inTransaction = false
  } else {
    for (const table of TRANSACTION_TABLES) await client.query(`delete from public.${table}`)
    const result = await client.query('select public.reset_product_configuration($1) result', [option('--actor')])
    await client.query('commit'); inTransaction = false
    console.log('SELESAI:', JSON.stringify(result.rows[0].result))
  }
} catch (error) {
  if (inTransaction) await client.query('rollback')
  // Jangan pernah mencetak connection string, argumen SQL, atau detail driver.
  console.error('Wipe gagal:', error.code ?? error.message ?? error.name)
  process.exitCode = 1
} finally {
  await client.end()
}
