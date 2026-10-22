import { describe, expect, it } from 'vitest'
import { flattenNavigation, NAV_SECTIONS } from '../src/layout/navigation'

/**
 * Sidebar dipaku oleh dokumen (CLAUDE.md §5, 05 §K02, AMENDMENTS).
 *
 * Test ini menyalin daftarnya dari dokumen, bukan dari kode. Gunanya: setiap
 * penambahan menu "yang kelihatannya membantu" akan gagal di sini, bukan lolos
 * diam-diam ke produksi.
 */
describe('sidebar MVP (CLAUDE.md §5)', () => {
  it('K02: nama, urutan, dan pengelompokan menu persis seperti dokumen', () => {
    expect(NAV_SECTIONS.map((section) => section.title)).toEqual(['OPERASIONAL', 'KONFIGURASI', 'ACCOUNT'])

    expect(flattenNavigation().map((item) => item.label)).toEqual([
      'Scan QR',
      'Dashboard Resume',
      'Order',
      'Order Unmapped',
      'Presensi Acara',
      'Product Name Generator',
      // A37: Report Spend Iklan.
      'Report Spend Iklan',
      'Konfigurasi Produk',
      'Konfigurasi Tax',
      'Report Tax',
      'Konfigurasi Zoom',
      'Konfigurasi Barcode / Tiket',
      'API & Webhook',
      'Konfigurasi Role',
      'Add Team',
      'Reset Data',
      'Profil',
      'Logout',
    ])
  })

  it('setiap item punya path unik dan absolut', () => {
    const paths = flattenNavigation().map((item) => item.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) expect(path.startsWith('/')).toBe(true)
  })

  it('menu yang dilarang MVP tidak ada (CLAUDE.md §5)', () => {
    const labels = flattenNavigation().map((item) => item.label.toLowerCase())
    const forbidden = [
      'user management',
      'notification',
      'notifikasi',
      'export',
      'audit',
      'chart',
      'grafik',
      'laporan kustom',
    ]

    for (const word of forbidden) {
      expect(labels.some((label) => label.includes(word))).toBe(false)
    }
  })
})
