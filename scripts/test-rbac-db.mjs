/** Isolated PostgreSQL/pgTAP run; never resets the existing local or remote database. */
import { Client } from 'pg'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const database = `dvflow_rbac_test_${Date.now()}`
const base = 'postgresql://postgres:postgres@127.0.0.1:54322/'
const admin = new Client({ connectionString: base + 'postgres' })
let client
let created = false
let restContainer
let proxy
try {
  admin.on('error', (error) => console.error('Admin connection:', error.message))
  await admin.connect()
  await admin.query(`create database ${database}`)
  created = true
  client = new Client({ connectionString: base + database })
  await client.connect()
  await client.query(`create schema auth; create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid
    $$;
    grant usage on schema auth, public, extensions to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`)
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
    let sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
    // pg_cron can only live in the cluster's primary database. Retention jobs are
    // intentionally not installed in this disposable database; all domain SQL is real.
    sql = sql.replace('create extension if not exists pg_cron with schema pg_catalog;', '')
    await client.query('begin')
    try { await client.query(sql); await client.query('commit') }
    catch (error) { await client.query('rollback'); throw new Error(`${file}: ${error.message}`) }
    console.log(`Migration PASS ${file}`)
  }
  await client.query('create extension if not exists pgtap with schema extensions')
  for (const file of readdirSync('supabase/tests').filter(f => f.endsWith('.sql')).sort()) {
    let results
    let testSql = readFileSync(`supabase/tests/${file}`, 'utf8')
    if (file === '03_seminar_checkin.sql') {
      // Keep the cron assertions in the normal Supabase suite; explicitly skip
      // only those four checks in a non-primary temporary database.
      testSql = testSql.replace(/select ok\([^;]*from cron\.job[^;]*\);/g,
        "select skip('pg_cron unavailable in isolated database', 1);")
    }
    try {
      if (file === '07_permission_enforcement.sql') {
        results = []
        for (const [index, part] of testSql.split(/;\r?\n/).entries()) {
          if (!part.trim()) continue
          if (process.env.RBAC_DEBUG) console.log('SQL statement', index, part.slice(-110))
          const result = await client.query(part)
          results.push(...(Array.isArray(result) ? result : [result]))
        }
      } else results = await client.query(testSql)
    }
    catch (error) { throw new Error(`${file}: ${error.message}`) }
    const lines = (Array.isArray(results) ? results : [results]).flatMap(r => r.rows.flatMap(Object.values)).filter(v => typeof v === 'string')
    const failed = lines.filter(line => line.startsWith('not ok'))
    console.log(`${file}: ${lines.filter(line => /^(not )?ok /.test(line)).length} assertions, ${failed.length} failures`)
    if (failed.length) throw new Error(failed.join('\n'))
  }
  if (process.argv.includes('--integration') || process.argv.includes('--browser')) {
    await client.query(readFileSync('supabase/seed.sql', 'utf8'))
    const secret = 'disposable-rbac-integration-secret-2026'
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const keyId = 'disposable-browser-key'
    const jwks = { keys: [
      { kty: 'oct', k: Buffer.from(secret).toString('base64url'), alg: 'HS256', kid: 'service' },
      { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', kid: keyId },
    ] }
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const tokenBody = `${encode({ alg: 'HS256', typ: 'JWT', kid: 'service' })}.${encode({ role: 'service_role', exp: Math.floor(Date.now()/1000)+3600 })}`
    const token = `${tokenBody}.${createHmac('sha256',secret).update(tokenBody).digest('base64url')}`
    restContainer = `${database}_rest`
    execFileSync('docker', ['run','--rm','-d','--name',restContainer,'-p','127.0.0.1:55431:3000',
      '-e',`PGRST_DB_URI=postgresql://postgres:postgres@host.docker.internal:54322/${database}`,
      '-e',`PGRST_JWT_SECRET=${JSON.stringify(jwks)}`,'-e','PGRST_DB_ANON_ROLE=anon',
      'public.ecr.aws/supabase/postgrest:v14.8'], { stdio: 'pipe' })
    proxy = createServer(async (req,res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const response = await fetch(`http://127.0.0.1:55431${req.url.replace(/^\/rest\/v1/,'')}`, {
          method:req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k])=>!['host','connection','content-length'].includes(k))),
          ...(['GET','HEAD'].includes(req.method) ? {} : { body:Buffer.concat(chunks) }),
        })
        if (process.env.RBAC_DEBUG && !response.ok && req.url.includes('/products')) console.log('Test REST error:', await response.clone().text())
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
      } catch { res.writeHead(502);res.end('Local test proxy unavailable') }
    })
    await new Promise(r=>proxy.listen(55432,'127.0.0.1',r))
    for(let attempt=0;attempt<30;attempt++) {
      try { if((await fetch('http://127.0.0.1:55431/')).ok) break } catch {}
      if(attempt===29) throw new Error('Test PostgREST did not start')
      await new Promise(r=>setTimeout(r,500))
    }
    if (process.argv.includes('--integration')) {
      const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'),'run','--config','vitest.integration.config.ts'], {
      cwd:resolve('packages/api'), stdio:'inherit', env:{...process.env,
        SUPABASE_URL:'http://127.0.0.1:55432',SUPABASE_SECRET_KEY:token,SUPABASE_DB_URL:base+database,
      }, windowsHide:true,
    })
    const code = await new Promise(r=>child.on('exit',r))
      if(code!==0) throw new Error(`Integration tests failed (${code})`)
    }
    if (process.argv.includes('--browser')) {
      const { runBrowser } = await import('./test-rbac-browser.mjs')
      await runBrowser(client, {
        SUPABASE_URL: 'http://127.0.0.1:55432', SUPABASE_SECRET_KEY: token,
        APP_JWT_KEY_ID: keyId, APP_JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        APP_ALLOWED_ORIGINS: 'http://127.0.0.1:55434',
      })
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (proxy) { proxy.closeAllConnections();await new Promise(r=>proxy.close(r)) }
  if (restContainer) execFileSync('docker',['stop',restContainer],{stdio:'pipe'})
  if (client) await client.end()
  if (created) await admin.query(`drop database ${database} with (force)`)
  await admin.end()
}
