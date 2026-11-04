import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { canAccessPath } from '../lib/roles'
import { useSession } from '../lib/useSession'
import { cn } from '../ui/cn'
import { NAV_SECTIONS, type NavItem } from './navigation'

/**
 * Pencarian menu global.
 *
 * Yang dicari adalah FITUR/MENU, bukan data order/peserta: hasilnya selalu
 * berupa navigasi. Daftar dibatasi izin role yang sedang login, jadi menu yang
 * tidak boleh dibuka tidak pernah muncul sebagai hasil.
 *
 * Satu dialog dipasang di shell; tombol di sidebar/header hanya memicu event,
 * supaya Ctrl/Cmd+K tidak membuka dua dialog saat sidebar desktop dan drawer HP
 * sama-sama ter-mount.
 */
const OPEN_EVENT = 'dvflow:open-global-search'

type SearchResult = {
  item: NavItem
  section: string
  score: number
}

/** Halaman lapangan yang tidak muncul di sidebar tetap bisa dicari dari sini. */
const EXTRA_ITEMS: NavItem[] = [
  { label: 'Cari Peserta', path: '/cari-peserta', icon: 'search', keywords: ['cari peserta', 'manual', 'checkin', 'nama', 'no hp'] },
]

function allItems(): SearchResult[] {
  const results: SearchResult[] = []
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      results.push({ item, section: section.title ?? 'Dashboard', score: 0 })
    }
  }
  for (const item of EXTRA_ITEMS) results.push({ item, section: 'ACARA', score: 0 })
  return results
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('id').trim()
}

function matchScore(result: SearchResult, query: string): number {
  const label = normalize(result.item.label)
  const section = normalize(result.section)
  const keywords = (result.item.keywords ?? []).map(normalize)
  if (label === query) return 100
  if (label.startsWith(query)) return 80
  if (label.includes(query)) return 60
  if (keywords.some((keyword) => keyword === query)) return 55
  if (keywords.some((keyword) => keyword.includes(query))) return 40
  if (section.includes(query)) return 20
  return 0
}

export function GlobalSearchButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  function open(): void {
    window.dispatchEvent(new Event(OPEN_EVENT))
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Cari menu"
      className={cn(
        'flex items-center gap-2 rounded-[11px] border border-line bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-primary/40 hover:text-ink',
        compact ? 'h-9 w-9 justify-center' : 'h-9 w-full justify-start',
        className,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      {compact ? null : (
        <>
          <span className="truncate">Cari menu…</span>
          <kbd className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted">Ctrl K</kbd>
        </>
      )}
    </button>
  )
}

export function GlobalSearchDialog() {
  const { profile } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const accessible = useMemo(
    () => allItems().filter((result) => canAccessPath(profile, result.item.path)),
    [profile],
  )

  const results = useMemo(() => {
    const term = normalize(query)
    if (term === '') return accessible
    return accessible
      .map((result) => ({ ...result, score: matchScore(result, term) }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || left.item.label.localeCompare(right.item.label, 'id'))
  }, [accessible, query])

  function close(): void {
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  function choose(result: SearchResult | undefined): void {
    if (result === undefined) return
    navigate(result.item.path)
    close()
  }

  useEffect(() => {
    function onOpen(): void {
      setOpen(true)
      setQuery('')
      setActive(0)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpen()
      }
      if (event.key === 'Escape') close()
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    // Fokus setelah overlay terpasang, termasuk saat dibuka lewat shortcut.
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" role="presentation" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cari menu"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-card shadow-app"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((current) => Math.min(current + 1, Math.max(results.length - 1, 0)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((current) => Math.max(current - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(results[active])
              }
            }}
            placeholder="Cari menu atau fitur…"
            aria-label="Cari menu atau fitur"
            className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button type="button" onClick={close} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:text-ink">
            Esc
          </button>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox" aria-label="Hasil pencarian menu">
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13px] text-ink-soft">Tidak ada menu yang cocok.</li>
          ) : (
            results.map((result, index) => (
              <li key={result.item.path}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(result)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-[13px]',
                    index === active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-soft',
                  )}
                >
                  <span className="font-semibold">{result.item.label}</span>
                  <span className="shrink-0 text-[11px] text-ink-muted">{result.section}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
