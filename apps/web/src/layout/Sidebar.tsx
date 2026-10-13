import { NavLink } from 'react-router-dom'
import { cn } from '../ui/cn'
import { useSession } from '../lib/useSession'
import { ROLE_LABELS, canAccessPath } from '../lib/roles'
import { NAV_SECTIONS } from './navigation'

/**
 * Sidebar (guideline §7, CLAUDE.md §5).
 *
 * Lebar 230px, item 44px, radius 11px, dan state aktif memakai primary. Isinya
 * berasal dari `navigation.ts` — komponen ini tidak boleh punya daftar menu
 * sendiri, supaya urutan yang dipaku dokumen tetap satu sumber.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession()

  return (
    <nav aria-label="Menu utama" className="flex h-full w-[230px] min-w-[230px] flex-col gap-4 bg-sidebar p-4">
      <div className="px-1">
        <p className="text-[15px] font-bold tracking-tight text-ink">dvflow</p>
        <p className="text-[11px] text-ink-muted">Operasional event</p>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-muted">{section.title}</p>
            <ul className="flex flex-col gap-1">
              {section.items.map((item) => (
                <li key={item.path}>
                  {session.profile && !canAccessPath(session.profile.role, item.path) ? <span aria-disabled="true" className="flex min-h-11 items-center rounded-[11px] px-3 text-[13px] text-ink-muted" title="Tidak tersedia untuk role Anda">{item.label}</span> : <NavLink
                    to={item.path}
                    onClick={onNavigate}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex h-11 items-center rounded-[11px] px-3 text-[13px] font-medium transition-colors',
                        isActive
                          ? // Guideline §7 memakai gradien primary untuk item aktif.
                            'bg-[linear-gradient(135deg,#564cff,#424bf4)] text-white shadow-card'
                          : 'text-ink-soft hover:bg-soft hover:text-ink',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {session.profile === null ? null : (
        <div className="flex items-center gap-2 rounded-md border border-line bg-card p-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-[15px]">
            {session.profile.avatar_emoji ?? session.profile.display_name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-ink">{session.profile.display_name}</p>
            <p className="truncate text-[11px] text-ink-muted">{ROLE_LABELS[session.profile.role]}</p>
          </div>
        </div>
      )}
    </nav>
  )
}
