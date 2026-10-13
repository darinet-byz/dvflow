/**
 * Fixture konfigurasi untuk pengujian.
 *
 * Mengikuti contoh yang diberikan PRD §12 dan §54. Ini data DEVELOPMENT saja:
 * 06-DEPLOYMENT-ENV-AND-BUILD-RUNBOOK §5 melarang menanam produk/pengiklan contoh
 * ke migrasi produksi, jadi fixture ini tidak pernah masuk `supabase/seed.sql`.
 */

import type { ProductConfigSet } from '../src/types'

export const TEST_CONFIG: ProductConfigSet = {
  products: [
    { name: 'Kuliner Masteri', code: 'KM', active: true },
    { name: 'Master TikTok Indonesia', code: 'MT', active: true },
    { name: 'Webstore Academy', code: 'WA', active: true },
  ],
  advertisers: [
    { name: 'Zul', code: '01', active: true },
    { name: 'Rahman', code: '02', active: true },
    { name: 'Andi', code: '03', active: true },
  ],
  eventTypes: [
    { name: 'Seminar Offline', code: 'SO', kind: 'seminar', active: true },
    { name: 'Webinar Online', code: 'WO', kind: 'webinar', active: true },
  ],
  sessions: [
    { name: 'Sesi 1', code: 'S1', active: true },
    { name: 'Sesi 2', code: 'S2', active: true },
    { name: 'Sesi Tunggal', code: 'ST', active: true },
  ],
}

/**
 * Konfigurasi yang sengaja ambigu: dua kombinasi menghasilkan prefix identik
 * ("KM01SO"), sehingga parser WAJIB menolak alih-alih memilih salah satu.
 */
export const AMBIGUOUS_CONFIG: ProductConfigSet = {
  products: [
    { name: 'Produk KM', code: 'KM', active: true },
    { name: 'Produk KM0', code: 'KM0', active: true },
  ],
  advertisers: [
    { name: 'Pengiklan 01', code: '01', active: true },
    { name: 'Pengiklan 1', code: '1', active: true },
  ],
  eventTypes: [{ name: 'Seminar Offline', code: 'SO', kind: 'seminar', active: true }],
  sessions: TEST_CONFIG.sessions,
}
