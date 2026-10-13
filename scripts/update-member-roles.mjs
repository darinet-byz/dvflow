import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const envFile = readFileSync(resolve(process.cwd(), '.env.setup.local'), 'utf8')
const dbUrl = envFile.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL=')).slice('SUPABASE_DB_URL='.length).trim()

const client = new pg.Client({ connectionString: dbUrl })
await client.connect()

try {
  await client.query('BEGIN')

  const u1 = await client.query(
    "UPDATE public.users SET role = 'developer' WHERE username = 'hizul' RETURNING id, username, display_name, role",
  )
  const u2 = await client.query(
    "UPDATE public.users SET role = 'manajer' WHERE username = 'himel' RETURNING id, username, display_name, role",
  )
  const u3 = await client.query(
    "UPDATE public.users SET role = 'admin' WHERE username = 'divimultimedia' RETURNING id, username, display_name, role",
  )

  await client.query('COMMIT')

  console.log('Update berhasil:')
  console.log(JSON.stringify([...u1.rows, ...u2.rows, ...u3.rows], null, 2))
} catch (error) {
  await client.query('ROLLBACK')
  console.error('Update gagal:', error)
  process.exit(1)
} finally {
  await client.end()
}
