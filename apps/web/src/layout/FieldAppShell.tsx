import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { hasPermission } from '../lib/roles'
import { setPreferWebLayout } from '../lib/field-app'
import { useSession } from '../lib/useSession'
import { FieldAppContext } from '../lib/field-app'
import { cn } from '../ui/cn'
import { GlobalSearchButton, GlobalSearchDialog } from './GlobalSearch'

/**
 * Tampilan Apps Lapangan (A30) — hanya untuk Pimpro/Staff/Member berizin `ui.field_app` di HP.
 *
 * Header ringkas, konten selebar layar, dan tab bawah yang mudah dijangkau jempol:
 *   Presensi · OTS · [ SCAN ] · Cari Peserta · Akun
 * Tab yang tidak diizinkan role tidak tampil. Sidebar web tidak berubah (CLAUDE.md §5);
 * /ots dan /cari-peserta adalah layar lapangan, bukan menu sidebar baru.
 */
type Tab = { to: string; label: string; permission: string | null; icon: ReactNode; primary?: boolean }

const icon = (d: string) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const TABS: Tab[] = [
  { to: '/presensi', label: 'Presensi', permission: 'operasional.presensi', icon: icon('M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9') },
  { to: '/ots', label: 'OTS', permission: 'action.ots', icon: icon('M3 7h18v10H3zM7 12h.01M17 12h.01M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z') },
  { to: '/scan-qr', label: 'Scan', permission: 'operasional.scan_qr', primary: true, icon: icon('M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10') },
  // A77: tab Order (dengan Follow Up) masuk tampilan lapangan.
  { to: '/order', label: 'Order', permission: 'operasional.order', icon: icon('M7 4h10a2 2 0 012 2v14l-3-2-2 2-2-2-3 2V6a2 2 0 012-2zM9 8h6M9 12h6M9 16h4') },
  { to: '/cari-peserta', label: 'Cari', permission: 'action.manual_checkin', icon: icon('M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3') },
]

const TITLES: Record<string, string> = {
  '/presensi': 'Presensi',
  '/ots': 'OTS',
  '/scan-qr': 'Scan Tiket',
  '/order': 'Order',
  '/cari-peserta': 'Cari Peserta',
  '/profil': 'Akun',
  '/template-follow-up': 'Template Follow Up',
}

/** Halaman yang boleh dibuka dari tautan, tetapi bukan tab bawah. */
const EXTRA_PATHS = ['/profil', '/template-follow-up']

export function fieldTabs(profile: Parameters<typeof hasPermission>[0]): Tab[] {
  return TABS.filter((tab) => tab.permission === null || hasPermission(profile, tab.permission))
}

export function FieldAppShell() {
  const { profile } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [accountOpen, setAccountOpen] = useState(false)
  const tabs = fieldTabs(profile)

  // Menu akun menutup sendiri saat pindah halaman.
  useEffect(() => { setAccountOpen(false) }, [location.pathname, location.hash])

  // Halaman di luar tab lapangan (mis. "/" Dashboard) -> layar utama lapangan.
  const known =
    tabs.some((tab) => location.pathname === tab.to) ||
    location.pathname === '/logout' ||
    EXTRA_PATHS.includes(location.pathname)
  if (!known) {
    const home = tabs.find((tab) => tab.primary) ?? tabs[0]
    return <Navigate to={home?.to ?? '/profil'} replace />
  }

  function go(path: string): void {
    setAccountOpen(false)
    navigate(path)
  }

  return (
    <FieldAppContext.Provider value={true}>
      <div className="field-app flex min-h-[100dvh] flex-col bg-app" data-testid="field-app-shell">
        <GlobalSearchDialog />
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-card/95 px-4 py-3 backdrop-blur" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
          <p className="text-[16px] font-bold text-ink">{TITLES[location.pathname] ?? 'DVFLOW'}</p>
          <div className="ml-auto flex items-center gap-2">
            <GlobalSearchButton compact />
            {profile ? (
              <div className="relative">
                <button
                  type="button"
                  aria-label="Menu akun"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  onClick={() => setAccountOpen((open) => !open)}
                  className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-[14px] font-semibold text-primary"
                >
                  {profile.avatar_emoji ?? profile.display_name.slice(0, 1).toUpperCase()}
                </button>
                {accountOpen ? (
                  <>
                    <div className="fixed inset-0 z-40" role="presentation" onClick={() => setAccountOpen(false)} />
                    <div
                      role="menu"
                      aria-label="Menu akun"
                      className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-md border border-line bg-card shadow-app"
                    >
                      <div className="border-b border-line px-3 py-2">
                        <p className="truncate text-[12px] font-semibold text-ink">{profile.display_name}</p>
                        <p className="truncate text-[11px] text-ink-soft">@{profile.username}</p>
                      </div>
                      <button type="button" role="menuitem" onClick={() => go('/profil')} className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-soft">
                        Profil
                      </button>
                      <button type="button" role="menuitem" onClick={() => go('/profil#ganti-password')} className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-soft">
                        Ganti Password
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountOpen(false)
                          setPreferWebLayout(true)
                        }}
                        className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-soft"
                      >
                        Tampilan Web
                      </button>
                      <button type="button" role="menuitem" onClick={() => go('/logout')} className="block w-full border-t border-line px-3 py-2 text-left text-[13px] text-danger hover:bg-soft">
                        Logout
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 pb-28 pt-3">
          <Outlet />
        </main>

        <nav
          aria-label="Navigasi lapangan"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <ul className="mx-auto flex max-w-md items-end justify-around px-1">
            {tabs.map((tab) => (
              <li key={tab.to} className="flex-1">
                <NavLink
                  to={tab.to}
                  className={({ isActive }) => cn(
                    'flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold active:opacity-70',
                    tab.primary ? 'text-white' : isActive ? 'text-primary' : 'text-ink-muted',
                  )}
                >
                  {({ isActive }) => tab.primary ? (
                    <>
                      <span className={cn('-mt-6 grid h-16 w-16 place-items-center rounded-full bg-primary shadow-app ring-4 ring-card', isActive && 'bg-primary-hover')}>
                        {tab.icon}
                      </span>
                      <span className={cn('mb-1', isActive ? 'text-primary' : 'text-ink-muted')}>{tab.label}</span>
                    </>
                  ) : (
                    <>
                      {tab.icon}
                      <span>{tab.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </FieldAppContext.Provider>
  )
}
