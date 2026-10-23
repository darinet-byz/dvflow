/** Sidebar: menu dikelompokkan per alur kerja atas permintaan pengguna (AMENDMENTS A10, A38). */
export type NavItem = {
  label: string
  path: string
  /** Ikon Lucide; belum dipasang (P8) — teks dulu agar tidak ada aset menganggur. */
  icon: string
}

export type NavSection = {
  /** Kosong = seksi tanpa judul (Dashboard di paling atas). */
  title?: string
  items: NavItem[]
}

export const OPERASIONAL_PATH = '/scan-qr'
export const DASHBOARD_PATH = '/'
export const LOGIN_PATH = '/login'

export const NAV_SECTIONS: NavSection[] = [
  // A38: Dashboard berdiri sendiri di paling atas, tanpa judul seksi.
  {
    items: [{ label: 'Dashboard Resume', path: DASHBOARD_PATH, icon: 'layout-dashboard' }],
  },
  {
    title: 'ACARA',
    items: [
      { label: 'Scan QR', path: OPERASIONAL_PATH, icon: 'scan-line' },
      { label: 'Presensi Acara', path: '/presensi', icon: 'user-check' },
    ],
  },
  {
    title: 'ORDER',
    items: [
      { label: 'Order', path: '/order', icon: 'receipt' },
      { label: 'Order Unmapped', path: '/order-unmapped', icon: 'alert-circle' },
    ],
  },
  {
    title: 'LAPORAN & PAJAK',
    items: [
      { label: 'Report Spend Iklan', path: '/report-spend', icon: 'megaphone' },
      { label: 'Report Tax', path: '/report-tax', icon: 'file-text' },
      { label: 'Konfigurasi Tax', path: '/konfigurasi-tax', icon: 'percent' },
    ],
  },
  {
    title: 'PRODUK & ACARA',
    items: [
      { label: 'Konfigurasi Produk', path: '/konfigurasi-produk', icon: 'package' },
      { label: 'Product Name Generator', path: '/generator', icon: 'wand' },
      { label: 'Konfigurasi Zoom', path: '/konfigurasi-zoom', icon: 'video' },
      { label: 'Konfigurasi Barcode / Tiket', path: '/konfigurasi-tiket', icon: 'qr-code' },
    ],
  },
  {
    title: 'SISTEM',
    items: [
      { label: 'Add Team', path: '/add-team', icon: 'users' },
      { label: 'Konfigurasi Role', path: '/konfigurasi-role', icon: 'shield' },
      { label: 'API & Webhook', path: '/integrasi', icon: 'plug' },
      { label: 'Reset Data', path: '/reset-data', icon: 'trash-2' },
    ],
  },
  {
    title: 'AKUN',
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
