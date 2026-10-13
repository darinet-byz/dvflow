/**
 * Sidebar MVP (CLAUDE.md §5, 05 §K02).
 *
 * Daftar ini SENGAJA dipaku: jumlah, nama, urutan, dan pengelompokannya tidak
 * boleh berubah tanpa perubahan requirement. Yang dilarang ditambahkan ke sini
 * antara lain: User Management, Notification Center, Export, Audit Log, menu
 * report tambahan, dan chart dashboard.
 *
 * Test `navigation.test.ts` membandingkan berkas ini dengan daftar di dokumen,
 * supaya "perbaikan" yang menambah menu tertangkap lebih awal.
 */
export type NavItem = {
  label: string
  path: string
  /** Ikon Lucide; belum dipasang (P8) — teks dulu agar tidak ada aset menganggur. */
  icon: string
}

export type NavSection = {
  title: string
  items: NavItem[]
}

export const OPERASIONAL_PATH = '/scan-qr'
export const DASHBOARD_PATH = '/'
export const LOGIN_PATH = '/login'

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'OPERASIONAL',
    items: [
      { label: 'Scan QR', path: OPERASIONAL_PATH, icon: 'scan-line' },
      { label: 'Dashboard Resume', path: DASHBOARD_PATH, icon: 'layout-dashboard' },
      { label: 'Order', path: '/order', icon: 'receipt' },
      { label: 'Presensi Acara', path: '/presensi', icon: 'user-check' },
    ],
  },
  {
    title: 'KONFIGURASI',
    items: [
      { label: 'Konfigurasi Produk', path: '/konfigurasi-produk', icon: 'package' },
      { label: 'Konfigurasi Tax', path: '/konfigurasi-tax', icon: 'percent' },
      { label: 'Report Tax', path: '/report-tax', icon: 'file-text' },
      { label: 'Product Name Generator', path: '/generator', icon: 'wand' },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [
      { label: 'Profil', path: '/profil', icon: 'user' },
      { label: 'Logout', path: '/logout', icon: 'log-out' },
    ],
  },
]

/** Urutan label sebagaimana dipakai test dan dokumen. */
export function flattenNavigation(): NavItem[] {
  return NAV_SECTIONS.flatMap((section) => section.items)
}
