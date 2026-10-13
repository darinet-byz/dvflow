#!/usr/bin/env node
/**
 * Verifikasi artefak QR halaman tiket peserta.
 *
 * Yang diperiksa BUKAN kode sumbernya, melainkan berkas hasil build
 * `apps/web/dist/assets/ticket-qr.js` — berkas yang benar-benar dikirim ke
 * browser peserta:
 *
 *   1. bentuknya skrip klasik: tidak ada `import`/`export`, sehingga dapat
 *      dijalankan `<script src>` di browser mana pun tanpa dukungan ES module;
 *   2. dijalankan dengan DOM tiruan, skrip itu benar-benar mengisi wadah QR
 *      dengan sebuah `<svg>`;
 *   3. SVG hasilnya DIDEKODE ulang oleh decoder QR independen (`jsqr`) dan
 *      hasilnya sama persis dengan payload — jadi QR-nya memang dapat dipindai.
 *
 * Jalankan setelah `npm run build`:
 *   npm run verify:ticket-qr
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import jsQR from 'jsqr'

const BUNDLE_PATH = resolve('apps/web/dist/assets/ticket-qr.js')
const PAYLOAD = '/checkin/283033796'

function fail(message) {
  console.error(`\nGAGAL: ${message}`)
  process.exit(1)
}

let bundle
try {
  bundle = readFileSync(BUNDLE_PATH, 'utf8')
} catch {
  fail(`${BUNDLE_PATH} tidak ada. Jalankan \`npm run build\` lebih dulu.`)
}

// 1. Bentuk skrip klasik ----------------------------------------------------
if (/(^|\n)\s*(import|export)[\s{]/.test(bundle)) {
  fail('bundel memuat import/export — tidak dapat dijalankan <script src> biasa.')
}
if (!bundle.trimStart().startsWith('(function')) {
  fail('bundel bukan IIFE.')
}
console.log(`1. bentuk skrip   : IIFE klasik, tanpa impor (${(bundle.length / 1024).toFixed(1)} KB)`)

// 2. Jalankan dengan DOM tiruan --------------------------------------------
const container = {
  innerHTML: '',
  attributes: { 'data-checkin-payload': PAYLOAD },
  getAttribute(name) {
    return this.attributes[name] ?? null
  },
  setAttribute(name, value) {
    this.attributes[name] = value
  },
}

globalThis.document = {
  readyState: 'complete',
  addEventListener() {},
  getElementById(id) {
    return id === 'checkin-qr' ? container : null
  },
}

try {
  new Function(bundle)()
} catch (error) {
  fail(`skrip gagal dijalankan: ${error.message}`)
}

if (!container.innerHTML.includes('<svg')) {
  fail('skrip tidak memasang <svg> ke wadah QR.')
}
console.log(`2. dijalankan     : <svg> terpasang (${container.innerHTML.length} byte markup)`)
if (container.attributes['data-qr-ready'] !== 'true') fail('penanda data-qr-ready tidak diset.')

// 3. Decode ulang dengan decoder independen --------------------------------
const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(container.innerHTML)
if (viewBox === null) fail('SVG tanpa viewBox.')

const modules = Number(viewBox[1])
const dark = new Set()
for (const match of container.innerHTML.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"\/>/g)) {
  dark.add(`${match[1]},${match[2]}`)
}

const scale = 8
const pixels = modules * scale
const data = new Uint8ClampedArray(pixels * pixels * 4)
for (let y = 0; y < pixels; y += 1) {
  for (let x = 0; x < pixels; x += 1) {
    const value = dark.has(`${Math.floor(x / scale)},${Math.floor(y / scale)}`) ? 0 : 255
    const offset = (y * pixels + x) * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }
}

const decoded = jsQR(data, pixels, pixels)
if (decoded === null) fail('QR tidak dapat didekode oleh jsqr.')
if (decoded.data !== PAYLOAD) fail(`isi QR tidak sama: ${JSON.stringify(decoded.data)}`)

console.log(`3. didekode ulang : ${JSON.stringify(decoded.data)} (${modules}x${modules} modul, ${dark.size} modul gelap)`)
console.log('\nOK — artefak QR halaman tiket dapat dijalankan browser dan dapat dipindai.')
