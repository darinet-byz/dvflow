#!/usr/bin/env node
/**
 * Smoke test jalur deploy (06 §10) terhadap `wrangler pages dev` lokal.
 *
 * Yang dibuktikan di sini TIDAK dapat dibuktikan test lain: bahwa berkas
 * konfigurasi deploy benar-benar menyambung seluruh bagian — prioritas routing
 * Functions vs fallback SPA, `_headers`, aset statis, dan backend yang berjalan
 * di lingkungan Worker dengan secret berbentuk seperti produksi.
 *
 * Inilah yang menemukan bug nyata: rute `/access/*` dan `/checkin/*` tidak
 * punya berkas Pages Function, sehingga mengembalikan `index.html` alih-alih
 * halaman peserta. Tanpa langkah ini, bug itu baru ketahuan setelah deploy.
 *
 * Pemakaian:
 *   npm run build
 *   node scripts/write-dev-vars.mjs
 *   npm run dev:backend            # terminal lain
 *   node scripts/smoke-pages-local.mjs
 */

import { readFileSync } from 'node:fs'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8788'

let failures = 0

function check(label, condition, detail = '') {
  const status = condition ? 'OK  ' : 'GAGAL'
  if (!condition) failures += 1
  console.log(`  ${status} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

async function request(path, init) {
  const response = await fetch(`${BASE}${path}`, init)
  const body = await response.text()
  return { status: response.status, type: response.headers.get('content-type') ?? '', headers: response.headers, body }
}

/**
 * Secret webhook untuk target yang diuji.
 *
 * Dua sumber, dan urutannya penting:
 *   1. `.env.setup.local` — dipakai saat menguji project SUNGGUHAN
 *      (`SMOKE_BASE_URL=https://<domain>`), karena secret di sana berbeda dari
 *      yang dipakai dev server lokal;
 *   2. `.dev.vars` — dipakai saat menguji `wrangler pages dev` lokal.
 *
 * Kalau salah sumber, gejalanya menyesatkan: webhook selalu 404 walaupun
 * endpoint dan secret-nya benar-benar cocok dengan server yang lain.
 */
function webhookSecret() {
  // Server lokal selalu memakai .dev.vars; .env.setup.local hanya untuk target sungguhan.
  const isLocalTarget = ['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname)
  try {
    if (isLocalTarget) throw new Error('lokal')
    const setup = readFileSync('.env.setup.local', 'utf8')
    const line = setup.split('\n').find((row) => row.startsWith('ORDERONLINE_WEBHOOK_SECRET='))
    const value = line?.slice('ORDERONLINE_WEBHOOK_SECRET='.length).trim()
    if (value !== undefined && value !== '') {
      return value.startsWith('"') && value.endsWith('"') ? JSON.parse(value) : value
    }
  } catch {
    // .env.setup.local belum ada; coba sumber lokal.
  }

  const devVars = readFileSync('.dev.vars', 'utf8')
  const match = /ORDERONLINE_WEBHOOK_SECRET="([^"]+)"/.exec(devVars)
  if (match === null) {
    throw new Error('ORDERONLINE_WEBHOOK_SECRET tidak ada di .env.setup.local maupun .dev.vars')
  }
  return match[1]
}

console.log(`\nSmoke test jalur deploy di ${BASE}\n`)

// 1. Aset statis + header keamanan -------------------------------------------
console.log('1. Aset statis & header keamanan')
const root = await request('/')
check('GET / dilayani index.html', root.status === 200 && root.body.includes('id="root"'))
check('CSP aplikasi terpasang', (root.headers.get('content-security-policy') ?? '').includes("script-src 'self'"))
check('Permissions-Policy mengizinkan kamera sendiri', (root.headers.get('permissions-policy') ?? '').includes('camera=(self)'))
check('nosniff + anti-framing', root.headers.get('x-content-type-options') === 'nosniff' && root.headers.get('x-frame-options') === 'DENY')

const qr = await request('/assets/ticket-qr.js')
check('skrip QR halaman peserta tersedia', qr.status === 200 && qr.type.includes('javascript'))
check('aset ber-hash di-cache lama', (qr.headers.get('cache-control') ?? '').includes('immutable'))

// 2. Prioritas routing --------------------------------------------------------
console.log('\n2. Prioritas Functions vs fallback SPA (dulu ditunda, kini diuji)')
const spa = await request('/order')
check('rute SPA dilayani index.html', spa.status === 200 && spa.body.includes('id="root"'))
check('rute SPA TIDAK dilayani Functions', !spa.type.includes('json'))

const api = await request('/api/profile')
check('/api/* ditangani Functions (JSON, bukan HTML)', api.type.includes('json') && !api.body.includes('<html'))
check('/api/profile tanpa token ditolak', api.status === 401 || api.status === 500, `status ${api.status}`)

const access = await request('/access/999999')
check('/access/* ditangani Functions (halaman error, bukan index.html)', access.type.includes('html') && !access.body.includes('id="root"'))
check('order tidak dikenal -> 404', access.status === 404, `status ${access.status}`)
check('halaman error peserta tampil', access.body.includes('Tiket tidak ditemukan'))
const storeAccess = await request('/access/TK01/999999')
check('/access/:kodeToko/:orderId ditangani Functions', storeAccess.type.includes('html') && !storeAccess.body.includes('id="root"'))

const checkinPage = await request('/checkin/123456')
check('/checkin/* ditangani Functions', checkinPage.type.includes('html') && checkinPage.body.includes('Bukan halaman check-in'))
check('GET /checkin TIDAK mengubah apa pun (hanya halaman)', checkinPage.status === 200)

// 3. Webhook lewat jalur deploy ---------------------------------------------
console.log('\n3. Webhook lewat jalur deploy')
const secret = webhookSecret()
// Awalan yang tetap (`smoke-`) supaya data uji mudah dibersihkan; `slice` hanya
// memotong bagian waktunya, bukan awalannya.
const orderId = `smoke-${String(Date.now()).slice(-8)}`

const orderPayload = {
  type: 'order',
  action: 'create',
  payload: {
    order_id: orderId,
    product_data: { name: 'TEST99SO392 - S1 - Solo' },
    customer_data: { name: 'Peserta Smoke', phone: '+628000', email: 'smoke@example.com' },
    payment: { method: 'bank_transfer', data: [], channels: [], status: 'unpaid' },
    status: 'processing',
    total_price: 22000,
    created_at: '2026-10-13 02:00:00',
    updated_at: '2026-10-13 02:00:00',
  },
}

const wrongSecret = await request('/api/webhooks/orderonline/secret-yang-salah', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(orderPayload),
})
check('secret salah -> 404', wrongSecret.status === 404, `status ${wrongSecret.status}`)

const accepted = await request(`/api/webhooks/orderonline/${secret}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(orderPayload),
})
check('webhook diterima', accepted.status === 200, `status ${accepted.status}`)
check('webhook melaporkan order tersimpan', accepted.body.includes(orderId))

const repeated = await request(`/api/webhooks/orderonline/${secret}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(orderPayload),
})
check('webhook berulang tetap 200 (idempoten)', repeated.status === 200)

const unknownStatus = await request(`/api/webhooks/orderonline/${secret}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...orderPayload, payload: { ...orderPayload.payload, status: 'refunded' } }),
})
check('status tak dikenal -> 422 (tidak dipetakan diam-diam)', unknownStatus.status === 422, `status ${unknownStatus.status}`)

// 4. Halaman peserta untuk order nyata --------------------------------------
console.log('\n4. Halaman peserta')
const ticket = await request(`/access/${orderId}`)

// Yang paling penting di sini: respons datang dari FUNCTIONS, bukan fallback SPA.
check('halaman peserta dilayani Functions, bukan index.html', ticket.type.includes('html') && !ticket.body.includes('id="root"'))

/**
 * Pada project yang baru dibuat, konfigurasi Produk/Pengiklan masih kosong,
 * sehingga produk pada order percobaan tidak dapat dipetakan dan akses memang
 * DITOLAK (01 §9 + K8: konfigurasi datang dari layar Konfigurasi Produk, bukan
 * dari kode). Itu perilaku yang benar — bukan kegagalan deploy — jadi
 * dilaporkan sebagai catatan, bukan sebagai langkah gagal.
 */
if (ticket.body.includes('Data acara tidak dikenali')) {
  check('konfigurasi produk belum diisi -> akses peserta ditolak', ticket.status === 403, `status ${ticket.status}`)
  console.log('         ℹ️  setelah Produk & Pengiklan diisi di Konfigurasi Produk, tiket akan terbuka')
} else {
  check('order Paid + Seminar -> halaman tiket', ticket.status === 200 && ticket.body.includes('Peserta Smoke'))
  check('tiket memuat payload QR', ticket.body.includes(`data-checkin-payload="/checkin/${orderId}"`))
  check('tiket merujuk skrip QR same-origin', ticket.body.includes('/assets/ticket-qr.js'))
  check('tiket TIDAK memuat nomor WA (04 §12)', !ticket.body.includes('+628000'))
}

console.log(`\n${failures === 0 ? 'Semua langkah lulus.' : `${failures} langkah GAGAL.`}\n`)
process.exit(failures === 0 ? 0 : 1)
