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
      { label: 'Order Unmapped', path: '/order-unmapped', icon: 'alert-circle' },
      { label: 'Presensi Acara', path: '/presensi', icon: 'user-check' },
      { label: 'Product Name Generator', path: '/generator', icon: 'wand' },
      { label: 'Report Spend Iklan', path: '/report-spend', icon: 'megaphone' },
    ],
  },
  {
    title: 'KONFIGURASI',
    items: [
      { label: 'Konfigurasi Produk', path: '/konfigurasi-produk', icon: 'package' },
      { label: 'Konfigurasi Tax', path: '/konfigurasi-tax', icon: 'percent' },
      { label: 'Report Tax', path: '/report-tax', icon: 'file-text' },
      { label: 'Konfigurasi Zoom', path: '/konfigurasi-zoom', icon: 'video' },
      { label: 'Konfigurasi Barcode / Tiket', path: '/konfigurasi-tiket', icon: 'qr-code' },
      { label: 'API & Webhook', path: '/integrasi', icon: 'plug' },
      { label: 'Konfigurasi Role', path: '/konfigurasi-role', icon: 'shield' },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [
      { label: 'Add Team', path: '/add-team', icon: 'users' },
      { label: 'Reset Data', path: '/reset-data', icon: 'trash-2' },
      { label: 'Profil', path: '/profil', icon: 'user' },
      { label: 'Logout', path: '/logout', icon: 'log-out' },
    ],
  },
]

/** Urutan label sebagaimana dipakai test dan dokumen. */
export function flattenNavigation(): NavItem[] {
  return NAV_SECTIONS.flatMap((section) => section.items)
}
