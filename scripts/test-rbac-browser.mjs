/** Real Chromium -> React -> API -> PostgREST -> disposable PostgreSQL smoke test. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer as createViteServer } from 'vite'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

export async function runBrowser(db, env) {
  const base = 'http://127.0.0.1:55434'
  let apiServer, vite, browser
  try {
    const bundled = await build({ entryPoints: ['packages/api/src/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' })
    const { createHandler } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
    const handler = createHandler(env)
    apiServer = createServer(async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const response = await handler(new Request(new URL(req.url, base), {
          method: req.method, headers: req.headers,
          ...(['GET','HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
        }))
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(Buffer.from(await response.arrayBuffer()))
      } catch (error) { console.error(error.message); res.writeHead(500); res.end() }
    })
    await new Promise(r => apiServer.listen(55433, '127.0.0.1', r))
    vite = await createViteServer({ root: resolve('apps/web'), configFile: resolve('apps/web/vite.config.ts'), envDir: false,
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(base),
        'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('disposable-public-key'),
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
      },
      server: { host: '127.0.0.1', port: 55434, strictPort: true, proxy: {
        '/api': 'http://127.0.0.1:55433', '/checkin': 'http://127.0.0.1:55433',
        '/rest/v1': 'http://127.0.0.1:55432',
      } },
    })
    await vite.listen()
    await db.query(`insert into public.app_roles(id,name) values ('browser_custom','Browser custom');
      insert into public.users(username,display_name,password_hash,role,has_all_product_access) values
      ('browserdev','Browser Developer',extensions.crypt('DisposablePassword123!',extensions.gen_salt('bf',4)),'developer',false),
      ('browserlimited','Browser Limited',extensions.crypt('DisposablePassword123!',extensions.gen_salt('bf',4)),'browser_custom',false);
      insert into public.app_role_permissions(role_id,permission_key) values
        ('browser_custom','operasional.order'),('browser_custom','account.profile');
      insert into public.user_product_access(user_id,product_code) select id,'TEST' from public.users where username='browserlimited';
      insert into public.orders(order_id,name,product_code,product_raw,event_type,app_status,gross_amount) values
        ('browser-order-a','Browser Participant A','TEST','TEST99SO1 - S1 - Solo','Seminar Offline','Paid',100),
        ('browser-order-b','Browser Participant B','TESB','TESB99SO1 - S1 - Solo','Seminar Offline','Paid',200);`)
    browser = await chromium.launch({ headless: true, ...(process.env.RBAC_BROWSER_CHANNEL ? { channel: process.env.RBAC_BROWSER_CHANNEL } : {}) })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      return ['127.0.0.1','localhost'].includes(url.hostname) ? route.continue() : route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const browserErrors = []
    page.on('pageerror', error => browserErrors.push(error.message))
    let accessToken
    page.on('response', async response => {
      if (response.url().endsWith('/api/auth/login') && response.ok()) accessToken = (await response.json()).data.access_token
    })
    async function login(username) {
      await page.goto(`${base}/login`)
      await page.getByLabel('Username', { exact: true }).fill(username)
      await page.getByLabel('Password', { exact: true }).fill('DisposablePassword123!')
      await page.getByRole('button', { name: 'Masuk', exact: true }).click()
      await page.waitForURL(url => url.pathname !== '/login')
    }
    await login('browserdev')
    await page.getByRole('link', { name: 'Konfigurasi Produk', exact: true }).click()
    const products = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Produk', exact: true }) })
    await products.getByRole('button', { name: '+ Tambah', exact: true }).click()
    let modal = page.getByRole('dialog', { name: 'Tambah Produk', exact: true })
    await modal.getByLabel('Nama', { exact: true }).fill('Browser Product')
    await modal.getByLabel('Kode', { exact: true }).fill('brow')
    const created = page.waitForResponse(r => r.url().endsWith('/api/config/products') && r.request().method() === 'POST')
    await modal.getByRole('button', { name: 'Simpan', exact: true }).click()
    assert.equal((await created).status(), 201)
    let row = products.getByRole('row').filter({ hasText: 'BROW' })
    await row.getByRole('button', { name: 'Edit', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Edit Produk', exact: true })
    await modal.getByLabel('Nama', { exact: true }).fill('Browser Product Updated')
    await modal.getByRole('button', { name: 'Simpan', exact: true }).click()
    await products.getByText('Browser Product Updated', { exact: true }).waitFor()
    await row.getByRole('button', { name: 'Nonaktifkan', exact: true }).click()
    await page.getByRole('dialog', { name: 'Nonaktifkan Produk', exact: true }).getByRole('button', { name: 'Nonaktifkan', exact: true }).click()
    await row.getByRole('button', { name: 'Aktifkan', exact: true }).waitFor()
    assert.equal((await db.query("select active from public.products where code='BROW'")).rows[0].active, false)
    mkdirSync('.local-backups/browser-audit', { recursive: true })
    await page.screenshot({ path: '.local-backups/browser-audit/developer-config.png', fullPage: true })
    console.log('Browser PASS Developer login/create/normalize/edit/deactivate product')

    await page.getByRole('link', { name: 'Logout', exact: true }).click()
    await page.waitForURL('**/login')
    await login('browserlimited')
    await page.waitForURL('**/order')
    await page.getByText('Browser Participant A', { exact: true }).waitFor()
    assert.equal(await page.getByText('Browser Participant B', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: 'Konfigurasi Produk', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /export/i }).count(), 0)
    await page.goto(`${base}/konfigurasi-produk`)
    await page.waitForURL('**/order')
    const directDenied = await fetch('http://127.0.0.1:55433/api/config/products', {
      method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Forbidden', code: 'NOPE' }),
    })
    assert.equal(directDenied.status, 403)
    await page.screenshot({ path: '.local-backups/browser-audit/scoped-order.png', fullPage: true })
    console.log('Browser PASS custom role product scope, hidden actions, direct URL and API denial')

    await db.query("delete from public.app_role_permissions where role_id='browser_custom'")
    const refreshed = page.waitForResponse(r => r.url().endsWith('/api/profile') && r.ok())
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refreshed
    await page.getByText('Belum ada fitur yang diizinkan untuk akun Anda.', { exact: true }).waitFor()
    assert.equal(await page.getByText('Browser Participant A', { exact: true }).count(), 0)
    assert.deepEqual(browserErrors, [])
    console.log('Browser PASS live permission revocation without login and empty-permission denial')
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    if (apiServer) { apiServer.closeAllConnections(); await new Promise(r => apiServer.close(r)) }
  }
}
