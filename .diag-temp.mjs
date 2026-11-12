import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'
import pg from 'pg'

const text = readFileSync('.env.setup.local', 'utf8')
const env = {}
for (const line of text.split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}

const b64url = (value) => Buffer.from(value).toString('base64url')

function mint(userId, appRole) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT', kid: env.APP_JWT_KEY_ID }
  const payload = {
    sub: userId,
    role: 'authenticated',
    app_user_id: userId,
    app_role: appRole,
    iss: `${String(env.SUPABASE_URL).replace(/\/+$/, '')}/auth/v1`,
    aud: 'authenticated',
    iat: now,
    exp: now + 1800,
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signer = createSign('SHA256')
  signer.update(signingInput)
  const signature = signer.sign({ key: env.APP_JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${signature.toString('base64url')}`
}

const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const roles = await client.query('select role, count(*)::int as n from public.users group by role order by role')
console.log('roles:', JSON.stringify(roles.rows))
const users = await client.query(
  `select u.id, u.username, u.role from public.users u
   join public.app_role_permissions p on p.role_id = u.role and p.permission_key = 'config.wa_bot'
   limit 1`,
)
if (users.rows.length === 0) {
  console.log('NO USER WITH config.wa_bot FOUND')
  process.exit(0)
}
const user = users.rows[0]
console.log('acting as:', user.username, '| role:', user.role)
await client.end()

const token = mint(user.id, user.role)
const base = 'https://dvflow.pages.dev'

for (const [method, path] of [['GET', '/api/wa-bot'], ['POST', '/api/wa-bot/settings/verify']]) {
  const started = Date.now()
  try {
    const response = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    })
    const bodyText = await response.text()
    console.log(`\n${method} ${path} -> ${response.status} (${Date.now() - started} ms)`)
    console.log(bodyText.slice(0, 1200))
  } catch (error) {
    console.log(`\n${method} ${path} -> FETCH ERROR after ${Date.now() - started} ms: ${error.message}`)
  }
}
