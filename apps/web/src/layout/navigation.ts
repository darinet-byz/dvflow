/** Sidebar: original navigation plus user-requested Zoom and Add Team (AMENDMENTS A10). */
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
      { label: 'Konfigurasi Zoom', path: '/konfigurasi-zoom', icon: 'video' },
      { label: 'Product Name Generator', path: '/generator', icon: 'wand' },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [
      { label: 'Add Team', path: '/add-team', icon: 'users' },
      { label: 'Profil', path: '/profil', icon: 'user' },
      { label: 'Logout', path: '/logout', icon: 'log-out' },
    ],
  },
]

/** Urutan label sebagaimana dipakai test dan dokumen. */
export function flattenNavigation(): NavItem[] {
  return NAV_SECTIONS.flatMap((section) => section.items)
}
