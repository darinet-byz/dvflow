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
  /**
   * A47: grup yang bisa dilipat di sidebar. Dashboard tetap langsung terlihat;
   * seksi lain hanya menampilkan judul sampai diklik.
   */
  collapsible?: boolean
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
    collapsible: true,
    items: [
      { label: 'Scan QR', path: OPERASIONAL_PATH, icon: 'scan-line' },
      { label: 'Presensi Acara', path: '/presensi', icon: 'user-check' },
      // A39: jumlah tiket Paid per sesi dalam satu batch, gabungan semua pengiklan.
      { label: 'Resume Batch', path: '/resume-batch', icon: 'layers' },
    ],
  },
  {
    title: 'ORDER',
    collapsible: true,
    items: [
      { label: 'Order', path: '/order', icon: 'receipt' },
      { label: 'Order Unmapped', path: '/order-unmapped', icon: 'alert-circle' },
    ],
  },
  {
    title: 'STATUS',
    collapsible: true,
    items: [
      { label: 'Status Produk', path: '/status-produk', icon: 'package-check' },
      { label: 'Status Pengiklan', path: '/status-advertiser', icon: 'badge-check' },
    ],
  },
  {
    title: 'LAPORAN & PAJAK',
    collapsible: true,
    items: [
      { label: 'Report Spend Iklan', path: '/report-spend', icon: 'megaphone' },
      // A46: performa per pengiklan (track record + perbandingan).
      { label: 'Performa / Analitik', path: '/performa', icon: 'trending-up' },
      { label: 'Report Tax', path: '/report-tax', icon: 'file-text' },
      { label: 'Konfigurasi Tax', path: '/konfigurasi-tax', icon: 'percent' },
    ],
  },
  {
    title: 'PRODUK & ACARA',
    collapsible: true,
    items: [
      { label: 'Konfigurasi Produk', path: '/konfigurasi-produk', icon: 'package' },
      { label: 'Product Name Generator', path: '/generator', icon: 'wand' },
      { label: 'Konfigurasi Zoom', path: '/konfigurasi-zoom', icon: 'video' },
      { label: 'Konfigurasi Barcode / Tiket', path: '/konfigurasi-tiket', icon: 'qr-code' },
    ],
  },
  {
    title: 'SISTEM',
    collapsible: true,
    items: [
      { label: 'Add Team', path: '/add-team', icon: 'users' },
      { label: 'Konfigurasi Role', path: '/konfigurasi-role', icon: 'shield' },
      { label: 'API & Webhook', path: '/integrasi', icon: 'plug' },
      { label: 'Reset Data', path: '/reset-data', icon: 'trash-2' },
    ],
  },
  {
    title: 'AKUN',
    collapsible: true,
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
