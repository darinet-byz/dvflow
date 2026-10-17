import type { ReactNode } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { hasPermission } from '../lib/roles'
import { useSession } from '../lib/useSession'
import { FieldAppContext } from '../lib/field-app'
import { cn } from '../ui/cn'

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
  { to: '/cari-peserta', label: 'Cari', permission: 'action.manual_checkin', icon: icon('M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3') },
  { to: '/profil', label: 'Akun', permission: null, icon: icon('M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0') },
]

const TITLES: Record<string, string> = {
  '/presensi': 'Presensi',
  '/ots': 'Peserta OTS',
  '/scan-qr': 'Scan Tiket',
  '/cari-peserta': 'Cari Peserta',
  '/profil': 'Akun',
}

export function fieldTabs(profile: Parameters<typeof hasPermission>[0]): Tab[] {
  return TABS.filter((tab) => tab.permission === null || hasPermission(profile, tab.permission))
}

export function FieldAppShell() {
  const { profile } = useSession()
  const location = useLocation()
  const tabs = fieldTabs(profile)

  // Halaman di luar tab lapangan (mis. "/" Dashboard) -> layar utama lapangan.
  const known = tabs.some((tab) => location.pathname === tab.to) || location.pathname === '/logout'
  if (!known) {
    const home = tabs.find((tab) => tab.primary) ?? tabs[0]
    return <Navigate to={home?.to ?? '/profil'} replace />
  }

  return (
    <FieldAppContext.Provider value={true}>
      <div className="field-app flex min-h-[100dvh] flex-col bg-app" data-testid="field-app-shell">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-card/95 px-4 py-3 backdrop-blur" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
          <p className="text-[16px] font-bold text-ink">{TITLES[location.pathname] ?? 'DVFLOW'}</p>
          {profile ? (
            <span className="ml-auto grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-[14px] font-semibold text-primary" aria-label={profile.display_name}>
              {profile.avatar_emoji ?? profile.display_name.slice(0, 1).toUpperCase()}
            </span>
          ) : null}
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
