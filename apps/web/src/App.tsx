import { TeamPage } from './pages/team/TeamPage'
import { ZoomPage } from './pages/config/ZoomPage'
import { canAccessPath } from './lib/roles'
import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { DASHBOARD_PATH, LOGIN_PATH } from './layout/navigation'
import { bootstrapSession } from './lib/session'
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
import { PresensiPage } from './pages/presensi/PresensiPage'
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
        <Route element={<AppShell />}>
          <Route path="/logout" element={<LogoutPage />} />
          <Route path={DASHBOARD_PATH} element={<DashboardPage />} />
          <Route path="/scan-qr" element={<ScanQrPage />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/presensi" element={<PresensiPage />} />
          <Route path="/konfigurasi-produk" element={<RoleGuard path="/konfigurasi-produk"><KonfigurasiProdukPage /></RoleGuard>} />
          <Route path="/konfigurasi-tax" element={<RoleGuard path="/konfigurasi-tax"><KonfigurasiTaxPage /></RoleGuard>} />
          <Route path="/report-tax" element={<RoleGuard path="/report-tax"><ReportTaxPage /></RoleGuard>} />
          <Route path="/generator" element={<GeneratorPage />} />
          <Route path="/add-team" element={<RoleGuard path="/add-team"><TeamPage /></RoleGuard>} />
          <Route path="/konfigurasi-zoom" element={<ZoomPage />} />
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
function RequireAuth() {
  const session = useSession()
  const location = useLocation()

  if (session.status === 'anonymous') return <Navigate to={LOGIN_PATH} replace state={{ from: location.pathname }} />
  if (session.status !== 'authenticated') return <Navigate to={LOGIN_PATH} replace />

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
  if (!session.profile || !canAccessPath(session.profile.role, path)) return <ErrorState title="Tidak punya akses" message="Menu ini tidak tersedia untuk role Anda." />
  return children
}
