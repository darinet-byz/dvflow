#!/usr/bin/env node
/**
 * Mengisi data contoh ke backend yang SEDANG berjalan, supaya tampilan aplikasi
 * bisa dilihat dengan data yang masuk akal (tanpa itu semua halaman kosong).
 *
 * Semua data dibuat lewat JALUR SUNGGUHAN, bukan INSERT langsung ke database:
 *   * order dibuat dengan mengirim webhook ke `/api/webhooks/orderonline/:secret`
 *     (jadi parser produk, snapshot tax, dan idempotensi ikut teruji);
 *   * presensi webinar dibuat dengan membuka `/access/:orderId` (yang memang
 *     mencatat setiap klik);
 *   * check-in seminar lewat `/checkin/:orderId` memakai akun operator, bila
 *     kredensialnya diberikan.
 *
 * ⚠️  HANYA UNTUK LOKAL. Skrip ini menolak berjalan bila base URL bukan
 *     localhost, kecuali `--force` diberikan secara sadar.
 *
 * Pemakaian:
 *   node scripts/seed-demo-data.mjs
 *   node scripts/seed-demo-data.mjs --user admin1 --password 'rahasia123'
 */

import { readFileSync } from 'node:fs'
import { argv } from 'node:process'

const BASE = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:8788'
const force = argv.includes('--force')

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) && !force) {
  console.error(`Menolak mengisi data contoh ke ${BASE} (bukan localhost). Pakai --force bila benar-benar disengaja.`)
  process.exit(1)
}

function readDevVars() {
  const text = readFileSync('.dev.vars', 'utf8')
  const secret = /ORDERONLINE_WEBHOOK_SECRET="([^"]+)"/.exec(text)?.[1]
  if (secret === undefined) {
    console.error('ORDERONLINE_WEBHOOK_SECRET tidak ada di .dev.vars. Jalankan `npm run dev:vars`.')
    process.exit(1)
  }
  return secret
}

function argValue(name) {
  const index = argv.indexOf(name)
  return index === -1 ? null : (argv[index + 1] ?? null)
}

const webhookSecret = readDevVars()
const username = argValue('--user')
const password = argValue('--password')

/** Konfigurasi yang ada di seed.sql: TEST/Product Test, TESB/Product Test 2, 99/Agent Test, 98/Agent Test 2, S1/S2/ST. */
const DEMO_ORDERS = [
  { product: 'TEST99SO392 - S1 - Solo', status: 'processing', pay: 'bank_transfer', price: 385000, name: 'Ahmad Fauzi', phone: '+6281200111222', city: 'Solo' },
  { product: 'TEST99SO392 - S1 - Solo', status: 'processing', pay: 'qris', price: 385000, name: 'Bella Safira', phone: '+6281200222333', city: 'Solo' },
  { product: 'TEST99SO392 - S1 - Bandung', status: 'complete', pay: 'bank_transfer', price: 385000, name: 'Candra Wijaya', phone: '+6281200333444', city: 'Bandung' },
  { product: 'TEST98WO205 - S2 - Jakarta', status: 'processing', pay: 'qris', price: 250000, name: 'Dewi Lestari', phone: '+6281200444555', city: 'Jakarta' },
  { product: 'TEST98WO205 - S2 - Jakarta', status: 'pending', pay: 'bank_transfer', price: 250000, name: 'Eko Prasetyo', phone: '+6281200555666', city: 'Jakarta' },
  { product: 'TESB99SO001 - ST - Surabaya', status: 'processing', pay: 'bank_transfer', price: 150000, name: 'Fitri Handayani', phone: '+6281200666777', city: 'Surabaya' },
  { product: 'TESB99SO001 - ST - Surabaya', status: 'cancelled', pay: 'bank_transfer', price: 150000, name: 'Gilang Ramadhan', phone: '+6281200777888', city: 'Surabaya' },
  { product: 'TESB98WO392 - S1 - Medan', status: 'processing', pay: 'qris', price: 420000, name: 'Hana Permata', phone: '+6281200888999', city: 'Medan' },
  { product: 'TEST99SO392 - S1 - Solo', status: 'processing', pay: 'metode_tidak_dikenal', price: 385000, name: 'Irfan Maulana', phone: '+6281200999000', city: 'Solo' },
  { product: 'Nama Produk Tidak Sesuai Format', status: 'pending', pay: 'bank_transfer', price: 100000, name: 'Joko Susilo', phone: '+6281201111222', city: 'Yogyakarta' },
  { product: 'TEST99SO392 - S1 - Solo', status: 'processing', pay: 'bank_transfer', price: 770000, name: 'Kartika Sari', phone: '+6281201222333', city: 'Solo' },
  { product: 'TESB99WO205 - S2 - Semarang', status: 'processing', pay: 'qris', price: 300000, name: 'Lukman Hakim', phone: '+6281201333444', city: 'Semarang' },
]

async function post(path, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`

  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, body: text }
}

function payloadFor(order, orderId) {
  return {
    type: 'order',
    action: 'create',
    payload: {
      order_id: orderId,
      product_data: { name: order.product },
      customer_data: {
        name: order.name,
        phone: order.phone,
        email: `${order.name.toLowerCase().replace(/[^a-z]/g, '.')}@example.com`,
        city: order.city,
      },
      payment: { method: order.pay, data: [], channels: [], status: order.status === 'pending' ? 'unpaid' : 'paid' },
      status: order.status,
      total_price: order.price,
      created_at: '2026-10-13 02:00:00',
      updated_at: '2026-10-13 02:00:00',
    },
  }
}

console.log(`Mengisi data contoh ke ${BASE}\n`)

const orderIds = []
let ok = 0
let failed = 0

for (const [index, order] of DEMO_ORDERS.entries()) {
  const orderId = `demo${String(281343600 + index)}`
  const result = await post(`/api/webhooks/orderonline/${webhookSecret}`, payloadFor(order, orderId))

  if (result.status === 200) {
    ok += 1
    orderIds.push({ orderId, kind: order.product.includes('WO') ? 'webinar' : 'seminar', status: order.status })
  } else {
    failed += 1
    console.log(`  GAGAL  ${orderId} (${order.product}) — status ${result.status}: ${result.body.slice(0, 120)}`)
  }
}

console.log(`1. Webhook: ${ok} order dibuat, ${failed} gagal`)

// Presensi webinar: setiap klik membuat satu baris (PRD §91). Beberapa peserta
// sengaja diklik lebih dari sekali supaya kolom T1..T10 terlihat terisi.
const webinarOrders = orderIds.filter((entry) => entry.kind === 'webinar' && entry.status !== 'pending')

let klik = 0
for (const [index, entry] of webinarOrders.entries()) {
  const times = 1 + (index % 3) // 1–3 kali masuk
  for (let i = 0; i < times; i += 1) {
    const response = await fetch(`${BASE}/access/${entry.orderId}`, { redirect: 'manual' })
    if (response.status === 302) klik += 1
  }
}
console.log(`2. Presensi webinar: ${klik} klik tercatat (${webinarOrders.length} order webinar)`)

// Check-in seminar lewat akun operator, bila kredensialnya diberikan.
if (username !== null && password !== null) {
  const login = await post('/api/auth/login', { username, password })
  if (login.status !== 200) {
    console.log(`3. Check-in seminar: DILEWATI — login gagal (status ${login.status})`)
  } else {
    const token = JSON.parse(login.body).data.access_token
    const seminarPaid = orderIds.filter((entry) => entry.kind === 'seminar' && entry.status !== 'pending')

    let checkin = 0
    let already = 0
    for (const [index, entry] of seminarPaid.entries()) {
      // Sebagian sengaja discan dua kali, supaya perilaku ALREADY_CHECKED_IN terlihat.
      const repeats = index % 4 === 0 ? 2 : 1
      for (let i = 0; i < repeats; i += 1) {
        const response = await post(`/checkin/${entry.orderId}`, undefined, token)
        if (response.status !== 200) continue
        if (response.body.includes('ALREADY_CHECKED_IN')) already += 1
        else checkin += 1
      }
    }
    console.log(`3. Check-in seminar: ${checkin} berhasil, ${already} scan ulang terdeteksi`)
  }
} else {
  console.log('3. Check-in seminar: DILEWATI (tanpa --user/--password) — kolom Hadir akan kosong')
}

console.log('\nSelesai. Buka aplikasi dan login untuk melihat datanya.')
