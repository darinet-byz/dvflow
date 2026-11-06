/** Sidebar: menu dikelompokkan per alur kerja atas permintaan pengguna (AMENDMENTS A10, A38). */
export type NavItem = {
  label: string
  path: string
  /** Ikon Lucide; belum dipasang (P8) — teks dulu agar tidak ada aset menganggur. */
  icon: string
  /** Kata kunci tambahan untuk pencarian menu global (mis. “tiket”, “laporan”). */
  keywords?: string[]
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
    items: [
      { label: 'Dashboard', path: DASHBOARD_PATH, icon: 'layout-dashboard' },
      // OTS kini menu utama tersendiri (permintaan pengguna 6 November 2026).
      { label: 'OTS', path: '/ots', icon: 'clipboard-list', keywords: ['ots', 'bayar di lokasi', 'pendaftaran', 'registrasi', 'tiket'] },
    ],
  },
  {
    title: 'Acara',
    collapsible: true,
    items: [
      { label: 'Scan QR', path: OPERASIONAL_PATH, icon: 'scan-line', keywords: ['scan', 'kamera', 'checkin', 'tiket'] },
      { label: 'Presensi Acara', path: '/presensi', icon: 'user-check', keywords: ['kehadiran', 'hadir', 'peserta', 'seminar', 'webinar'] },
    ],
  },
  {
    title: 'Order',
    collapsible: true,
    items: [
      { label: 'Order', path: '/order', icon: 'receipt', keywords: ['pesanan', 'transaksi', 'order id'] },
      // A58: monitoring refund + pembatalan refund.
      { label: 'Order Refund', path: '/order-refund', icon: 'rotate-ccw', keywords: ['refund', 'pembatalan', 'uang kembali'] },
      { label: 'Order Unmapped', path: '/order-unmapped', icon: 'alert-circle', keywords: ['unmapped', 'tidak terpetakan', 'produk'] },
    ],
  },
  {
    title: 'Status',
    collapsible: true,
    items: [
      { label: 'Status Produk', path: '/status-produk', icon: 'package-check' },
      { label: 'Status Pengiklan', path: '/status-advertiser', icon: 'badge-check' },
    ],
  },
  {
    title: 'Laporan & Pajak',
    collapsible: true,
    items: [
      { label: 'Report Spend Iklan', path: '/report-spend', icon: 'megaphone', keywords: ['laporan', 'iklan', 'spend', 'biaya', 'budget'] },
      // A46: performa per pengiklan (track record + perbandingan).
      { label: 'Performa / Analitik', path: '/performa', icon: 'trending-up', keywords: ['laporan', 'analitik', 'pengiklan', 'roi'] },
      { label: 'Report Tax', path: '/report-tax', icon: 'file-text', keywords: ['laporan', 'pajak', 'tax', 'fee'] },
      { label: 'Konfigurasi Tax', path: '/konfigurasi-tax', icon: 'percent', keywords: ['pajak', 'fee', 'aturan'] },
    ],
  },
  {
    title: 'Produk & Acara',
    collapsible: true,
    items: [
      { label: 'Konfigurasi Produk', path: '/konfigurasi-produk', icon: 'package', keywords: ['produk', 'alias', 'kode'] },
      { label: 'Product Name Generator', path: '/generator', icon: 'wand', keywords: ['generator', 'nama produk', 'kode produk'] },
      { label: 'Konfigurasi Zoom', path: '/konfigurasi-zoom', icon: 'video', keywords: ['zoom', 'webinar', 'link'] },
      { label: 'Konfigurasi Barcode / Tiket', path: '/konfigurasi-tiket', icon: 'qr-code', keywords: ['tiket', 'barcode', 'qr', 'seminar'] },
    ],
  },
  {
    title: 'Sistem',
    collapsible: true,
    items: [
      { label: 'Add Team', path: '/add-team', icon: 'users', keywords: ['tim', 'anggota', 'user', 'akun'] },
      { label: 'Konfigurasi Role', path: '/konfigurasi-role', icon: 'shield', keywords: ['role', 'hak akses', 'permission'] },
      { label: 'API & Webhook', path: '/integrasi', icon: 'plug', keywords: ['api', 'webhook', 'integrasi', 'orderonline'] },
      { label: 'Reset Data', path: '/reset-data', icon: 'trash-2', keywords: ['hapus', 'reset', 'bersihkan'] },
    ],
  },
  {
    title: 'Akun',
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
