/** Defaults to read-only inventory + backup. --apply requires exact project and actor. */
import { Client } from 'pg'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
const envPath = option('--env')
if (!envPath) throw new Error('Usage: node scripts/reset-product-configuration.mjs --env <file> [--apply --project <ref> --actor <uuid>]')
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')]
}))
const local = ['127.0.0.1','localhost'].includes(new URL(env.SUPABASE_DB_URL).hostname)
const dbTarget = new URL(env.SUPABASE_DB_URL)
const ca = option('--ca') ? readFileSync(option('--ca'), 'utf8') : undefined
const client = new Client({ connectionString: env.SUPABASE_DB_URL, ...(local ? {} : { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } }), connectionTimeoutMillis: 10000 })
let inTransaction = false
try {
  await client.connect()
  const applying = args.includes('--apply')
  if (applying && (!option('--project') || option('--project') !== env.SUPABASE_PROJECT_REF || !/^[a-f0-9-]{36}$/i.test(option('--actor') ?? ''))) {
    throw new Error('Exact --project and --actor are required for cleanup.')
  }
  if (applying && !local && dbTarget.hostname !== `db.${env.SUPABASE_PROJECT_REF}.supabase.co` &&
      !(dbTarget.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(dbTarget.username) === `postgres.${env.SUPABASE_PROJECT_REF}`)) {
    throw new Error('Database target does not match the expected project.')
  }
  await client.query(applying ? 'begin' : 'begin isolation level repeatable read read only')
  inTransaction = true
  if (applying) await client.query(`lock table public.orders, public.attendance_events, public.products, public.advertisers,
    public.event_types, public.sessions_config, public.product_aliases, public.app_settings, public.user_product_access in share row exclusive mode`)
  const counts = (await client.query('select (select count(*)::int from public.orders) orders, (select count(*)::int from public.attendance_events) attendance_events')).rows[0]
  const backup = { project: env.SUPABASE_PROJECT_REF, target: { host: dbTarget.hostname, database: dbTarget.pathname.slice(1) }, created_at: new Date().toISOString(), counts, tables: {} }
  for (const table of ['products','advertisers','event_types','sessions_config','product_aliases','user_product_access']) {
    backup.tables[table] = (await client.query(`select * from public.${table}`)).rows
  }
  backup.tables.app_settings = (await client.query("select * from public.app_settings where key like 'webinar_destination::%' or key like 'seminar_ticket::%'")).rows
  const dir = resolve('.local-backups')
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, `product-configuration-${Date.now()}.json`)
  const serialized = JSON.stringify(backup, null, 2)
  writeFileSync(path, serialized, { flag: 'wx', mode: 0o600 })
  console.log('Backup:', path)
  console.log('SHA256:', createHash('sha256').update(serialized).digest('hex'))
  console.log('Counts:', JSON.stringify({ ...counts, ...Object.fromEntries(Object.entries(backup.tables).map(([k,v]) => [k,v.length])) }))
  if (counts.orders || counts.attendance_events) {
    console.log('BLOCKED: transaksi masih ada; tidak ada konfigurasi atau transaksi yang dihapus.')
    await client.query('rollback'); inTransaction = false
    process.exitCode = 2
  } else if (!applying) {
    console.log('DRY RUN: tidak ada data dihapus.')
    await client.query('rollback'); inTransaction = false
  } else {
    const result = await client.query('select public.reset_product_configuration($1) result', [option('--actor')])
    await client.query('commit'); inTransaction = false
    console.log(JSON.stringify(result.rows[0].result))
  }
} catch (error) {
  if (inTransaction) await client.query('rollback')
  // Never print connection strings, SQL arguments or driver error details.
  console.error('Cleanup failed:', error.code ?? error.name)
  process.exitCode = 1
} finally {
  await client.end()
}
