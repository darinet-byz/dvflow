import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../ui/cn'
import { useSession } from '../lib/useSession'
import { ROLE_LABELS, canAccessPath } from '../lib/roles'
import { NAV_SECTIONS, type NavSection } from './navigation'

const OPEN_SECTION_KEY = 'dvflow.sidebar.open'

function sectionId(title: string): string {
  return `nav-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

function readOpenSection(): string | null {
  try {
    return window.localStorage.getItem(OPEN_SECTION_KEY)
  } catch {
    return null
  }
}

function activeSectionTitle(pathname: string): string | null {
  const active = NAV_SECTIONS.find(
    (section) => section.title !== undefined && section.items.some((item) => item.path === pathname),
  )
  return active?.title ?? null
}

/**
 * Sidebar (guideline §7, CLAUDE.md §5).
 *
 * A47: menu dikelompokkan dan bisa dilipat. Grup dari halaman aktif otomatis terbuka;
 * status grup yang sedang dibuka disimpan di localStorage. Route, izin, dan urutan item
 * tidak berubah — hanya presentasinya.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession()
  const location = useLocation()
  const [openTitle, setOpenTitle] = useState<string | null>(() => readOpenSection())
  const activeTitle = activeSectionTitle(location.pathname)

  // Halaman aktif selalu terlihat, termasuk saat pengguna membuka menu dari HP.
  useEffect(() => {
    if (activeTitle !== null) setOpenTitle(activeTitle)
  }, [activeTitle])

  useEffect(() => {
    try {
      if (openTitle === null) window.localStorage.removeItem(OPEN_SECTION_KEY)
      else window.localStorage.setItem(OPEN_SECTION_KEY, openTitle)
    } catch {
      // localStorage bisa diblokir (mode privat); sidebar tetap bekerja tanpa simpanan.
    }
  }, [openTitle])

  function visibleItems(section: NavSection) {
    if (!session.profile) return []
    return section.items.filter((item) => canAccessPath(session.profile, item.path))
  }

  function toggle(title: string): void {
    setOpenTitle((current) => (current === title ? null : title))
  }

  return (
    <nav aria-label="Menu utama" className="flex h-full w-[230px] min-w-[230px] flex-col gap-4 bg-sidebar p-4">
      <div className="px-1">
        <p className="text-[15px] font-bold tracking-tight text-ink">DVFLOW</p>
        <p className="text-[11px] text-ink-muted">Operasional event</p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {NAV_SECTIONS.map((section, index) => {
          const items = visibleItems(section)
          if (items.length === 0) return null

          const title = section.title
          // Dashboard (tanpa judul) tetap langsung terlihat.
          if (title === undefined) {
            return (
              <ul key={index} className="flex flex-col gap-1">
                {items.map((item) => (
                  <li key={item.path}>
                    <NavItemLink item={item} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            )
          }

          if (section.collapsible !== true) {
            return (
              <div key={title}>
                <p className="px-3 pb-1.5 text-[14px] font-semibold tracking-[0.06em] text-ink">{title}</p>
                <ul className="flex flex-col gap-1">
                  {items.map((item) => (
                    <li key={item.path}>
                      <NavItemLink item={item} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              </div>
            )
          }

          const id = sectionId(title)
          const isOpen = openTitle === title
          return (
            <div key={title}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => toggle(title)}
                className={cn(
                  'flex min-h-8 w-full items-center justify-between gap-2 rounded-[11px] px-3 py-1.5 text-[14px] font-semibold tracking-[0.06em] text-ink transition-colors',
                  'hover:bg-primary/15 hover:text-ink',
                )}
              >
                <span>{title}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className={cn(
                    'h-4 w-4 shrink-0 text-ink transition-transform duration-150',
                    isOpen && 'rotate-90',
                  )}
                >
                  <path
                    d="M7.5 5l5 5-5 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {isOpen ? (
                <ul id={id} className="mt-1 flex flex-col gap-1">
                  {items.map((item) => (
                    <li key={item.path}>
                      <NavItemLink item={item} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>

      {session.profile === null ? null : (
        <div className="flex items-center gap-2 rounded-md border border-line bg-card p-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-[15px]">
            {session.profile.avatar_emoji ?? session.profile.display_name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-ink">{session.profile.display_name}</p>
            <p className="truncate text-[11px] text-ink-muted">{session.profile.role_name ?? ROLE_LABELS[session.profile.role] ?? session.profile.role}</p>
          </div>
        </div>
      )}
    </nav>
  )
}

function NavItemLink({
  item,
  onNavigate,
}: {
  item: NavSection['items'][number]
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      end={item.path === '/'}
      className={({ isActive }) =>
        cn(
          'flex h-11 items-center rounded-[11px] px-2.5 text-[14px] font-medium tracking-[-0.01em] transition-colors',
          isActive
            ? // Guideline §7 memakai gradien primary untuk item aktif.
              'bg-[linear-gradient(135deg,#564cff,#424bf4)] text-white shadow-card'
            : 'text-ink hover:bg-primary/30',
        )
      }
    >
      {item.label}
    </NavLink>
  )
}
