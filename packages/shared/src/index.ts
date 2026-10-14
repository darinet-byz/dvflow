/**
 * @dvflow/shared — aturan bisnis murni, tanpa dependensi runtime.
 *
 * Paket ini adalah tempat seluruh aturan yang dikunci dokumen kontrak:
 * mapping status, parser product_raw, normalisasi payment identifier,
 * perhitungan tax, aturan presensi, dan payload QR check-in.
 *
 * Karena nol dependensi dan tanpa I/O, seluruh isinya dapat diuji tanpa
 * database maupun Cloudflare — dan itu sebabnya paket ini dibangun lebih dulu.
 */

export * from './types'

export * from './domain/constants'
export * from './domain/text'
export * from './domain/status'
export * from './domain/payment-identifier'
export * from './domain/product-name'
export * from './domain/product-parser'
export * from './domain/tax'
export * from './domain/attendance'
export * from './domain/checkin-qr'
export * from './domain/validate'
export * from './domain/config-code'
