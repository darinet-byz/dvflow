import { TeamPage } from './pages/team/TeamPage'
import { IntegrationsPage } from './pages/config/IntegrationsPage'
import { ZoomPage } from './pages/config/ZoomPage'
import { TicketConfigPage } from './pages/config/TicketConfigPage'
import { canAccessPath, PATH_PERMISSION_MAP } from './lib/roles'
import { useEffect, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { DASHBOARD_PATH, LOGIN_PATH } from './layout/navigation'
import { bootstrapSession, refreshProfile } from './lib/session'
import { useSession } from './lib/useSession'
import { ErrorState, SkeletonRows } from './ui/Feedback'
import { LoginPage } from './pages/LoginPage'
import { LogoutPage } from './pages/LogoutPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { KonfigurasiProdukPage } from './pages/config/KonfigurasiProdukPage'
import { KonfigurasiTaxPage } from './pages/config/KonfigurasiTaxPage'
import { GeneratorPage } from './pages/generator/GeneratorPage'
import { ProfilePage } from './pages/profile/ProfilePage'
import { ReportTaxPage } from './pages/report-tax/ReportTaxPage'
import { ScanQrPage } from './pages/scanner/ScanQrPage'
import { OrderPage } from './pages/order/OrderPage'
import { OrderUnmappedPage } from './pages/order/OrderUnmappedPage'
import { PresensiPage } from './pages/presensi/PresensiPage'
import { RoleConfigPage } from './pages/config/RoleConfigPage'
import { ResetDataPage } from './pages/developer/ResetDataPage'
import { Card } from './ui/Card'

/**
 * Rute aplikasi.
 *
 * Dua hal yang dijaga di sini:
 *   1. Sesi dipulihkan SEKALI saat aplikasi dimuat, lewat refresh cookie —
 *      access token tidak pernah dibaca dari penyimpanan (CLAUDE.md §8);
 *   2. Halaman hanya dirender setelah status sesi pasti. Menampilkan shell lalu
 *      menariknya kembali saat ternyata belum login membuat aplikasi terasa
 *      berkedip dan pernah membocorkan struktur menu ke pengunjung anonim.
 */
export function App() {
  const session = useSession()
  const location = useLocation()
  useEffect(() => { if (session.status === 'authenticated') void refreshProfile() }, [location.pathname, session.status])
  useEffect(() => {
    // Fokus jendela terjadi sangat sering (pindah aplikasi, screenshot); cukup sekali
    // per 10 detik, dan hanya saat tab memang terlihat.
    let lastFocusRefresh = 0
    const onFocus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastFocusRefresh < 10_000) return
      lastFocusRefresh = Date.now()
      void refreshProfile()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    if (session.status === 'unknown') void bootstrapSession()
  }, [session.status])

  if (session.status === 'unknown') {
    return (
      <div className="grid min-h-screen place-items-center bg-page p-4">
        <Card className="w-full max-w-sm">
          <SkeletonRows rows={3} />
        </Card>
      </div>
    )
  }

  return (
    <Routes>
      <Route path={LOGIN_PATH} element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell key={JSON.stringify([session.profile?.user_id, session.profile?.role, session.profile?.has_all_product_access, [...(session.profile?.permissions ?? [])].sort(), [...(session.profile?.allowed_product_codes ?? [])].sort()])} />}>
          <Route path="/logout" element={<LogoutPage />} />
          <Route path={DASHBOARD_PATH} element={<DashboardPage />} />
          <Route path="/scan-qr" element={<ScanQrPage />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/order-unmapped" element={<RoleGuard path="/order-unmapped"><OrderUnmappedPage /></RoleGuard>} />
          <Route path="/presensi" element={<PresensiPage />} />
          <Route path="/konfigurasi-produk" element={<RoleGuard path="/konfigurasi-produk"><KonfigurasiProdukPage /></RoleGuard>} />
          <Route path="/konfigurasi-tax" element={<RoleGuard path="/konfigurasi-tax"><KonfigurasiTaxPage /></RoleGuard>} />
          <Route path="/report-tax" element={<RoleGuard path="/report-tax"><ReportTaxPage /></RoleGuard>} />
          <Route path="/generator" element={<GeneratorPage />} />
          <Route path="/add-team" element={<RoleGuard path="/add-team"><TeamPage /></RoleGuard>} />
          <Route path="/konfigurasi-zoom" element={<ZoomPage />} />
          <Route path="/konfigurasi-tiket" element={<TicketConfigPage />} />
          <Route path="/integrasi" element={<RoleGuard path="/integrasi"><IntegrationsPage /></RoleGuard>} />
          <Route path="/konfigurasi-role" element={<RoleGuard path="/konfigurasi-role"><RoleConfigPage /></RoleGuard>} />
          <Route path="/reset-data" element={<RoleGuard path="/reset-data"><ResetDataPage /></RoleGuard>} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}

/**
 * Penjaga rute.
 *
 * Ini BUKAN batas keamanan — RLS dan RPC tetap menolak di server (04 §5).
 * Fungsinya hanya mencegah pengunjung anonim melihat kerangka aplikasi.
 */
/** Percobaan memuat profil sebelum menyerah ke layar "Muat ulang". */
const PROFILE_RECOVERY_ATTEMPTS = 4
const PROFILE_RECOVERY_DELAY_MS = 2000

function RequireAuth() {
  const session = useSession()
  const location = useLocation()
  const missingProfile = session.status === 'authenticated' && !session.profile
  const [attempts, setAttempts] = useState(0)

  // Profil kosong karena gangguan sesaat dipulihkan sendiri di latar belakang (masih fail-closed:
  // tidak ada menu yang terbuka tanpa profil). Layar "Muat ulang" hanya setelah semua percobaan gagal.
  useEffect(() => {
    if (!missingProfile) { setAttempts(0); return }
    if (attempts >= PROFILE_RECOVERY_ATTEMPTS) return
    const timer = setTimeout(() => { void refreshProfile().finally(() => setAttempts((n) => n + 1)) }, attempts === 0 ? 0 : PROFILE_RECOVERY_DELAY_MS)
    return () => clearTimeout(timer)
  }, [missingProfile, attempts])

  if (session.status === 'anonymous') return <Navigate to={LOGIN_PATH} replace state={{ from: location.pathname }} />
  if (session.status !== 'authenticated') return <Navigate to={LOGIN_PATH} replace />
  if (!session.profile) {
    if (attempts < PROFILE_RECOVERY_ATTEMPTS) {
      return (
        <div className="p-4" aria-busy="true">
          <SkeletonRows rows={4} />
        </div>
      )
    }
    return <ErrorState title="Akses belum dapat diverifikasi" message="Muat ulang halaman untuk mencoba kembali." action={<a href={location.pathname}>Muat ulang</a>} />
  }

  if (!canAccessPath(session.profile, location.pathname)) {
    const fallback = Object.keys(PATH_PERMISSION_MAP).find((path) => canAccessPath(session.profile, path))
    if (fallback) return <Navigate to={fallback} replace state={{ accessDenied: true }} />
    return <ErrorState title="Tidak punya akses" message="Belum ada fitur yang diizinkan untuk akun Anda." action={<a href="/logout">Keluar</a>} />
  }
  return <Outlet />
}

function NotFound() {
  return (
    <ErrorState
      title="Halaman tidak ditemukan"
      message="Alamat yang Anda buka tidak ada di aplikasi ini."
      action={
        <a href={DASHBOARD_PATH} className="text-[13px] font-semibold text-primary hover:underline">
          Kembali ke Dashboard Resume
        </a>
      }
    />
  )
}

function RoleGuard({ path, children }: { path: string; children: import('react').ReactNode }) {
  const session = useSession()
  if (!session.profile || !canAccessPath(session.profile, path)) return <ErrorState title="Tidak punya akses" message="Menu ini tidak tersedia untuk role Anda." />
  return children
}
