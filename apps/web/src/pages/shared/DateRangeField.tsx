import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DATE_PRESETS,
  MONTH_NAMES,
  WEEKDAYS,
  describeRange,
  matchPreset,
  monthGrid,
  parseIsoDate,
  presetRange,
  rangeFromPicks,
  toIsoDate,
  type DatePresetKey,
} from '../../lib/date-range'
import { Button } from '../../ui/Button'
import { cn } from '../../ui/cn'

/**
 * Filter tanggal satu field: preset + kalender kecil (tanpa mengetik tanggal).
 *
 * Klik tanggal pertama = tanggal tunggal; klik kedua = rentang terurut; klik ketiga memulai
 * pilihan baru. Preset langsung diterapkan. Nilai yang dihasilkan tetap dateFrom/dateTo.
 */
export function DateRangeField({
  from,
  to,
  onChange,
  disabled = false,
  className,
}: {
  from: string
  to: string
  onChange: (range: { from: string; to: string }) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [picks, setPicks] = useState<string[]>([])
  const [view, setView] = useState(() => monthOf(from || toIsoDate(new Date())))
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  const today = toIsoDate(new Date())
  const activePreset = from && to ? matchPreset(from, to) : null

  // Saat dibuka, kalender menampilkan pilihan yang sedang berlaku.
  useEffect(() => {
    if (!open) return
    setPicks(from && to ? (from === to ? [from] : [from, to]) : [])
    setView(monthOf(from || today))
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat panel dibuka
  }, [open])

  // Panel tidak boleh keluar layar: geser ke kiri sejauh yang perlu (field sering berada di kanan toolbar).
  useLayoutEffect(() => {
    if (!open || !rootRef.current || !panelRef.current) return
    const field = rootRef.current.getBoundingClientRect()
    const width = panelRef.current.offsetWidth
    const margin = 8
    // Muat di kanan field: rata kiri. Tidak muat: rata kanan dengan field (kartu induk memotong
    // isi yang melewati tepinya), tetapi tidak pernah melewati tepi kiri layar.
    const fits = field.left + width <= window.innerWidth - margin
    setShift(fits ? 0 : Math.max(field.width - width, margin - field.left))
  }, [open])

  const apply = (range: { from: string; to: string }) => { onChange(range); setOpen(false) }
  const choosePreset = (key: DatePresetKey) => apply(presetRange(key))
  const clickDay = (day: string) => setPicks((current) => (current.length === 1 ? [current[0]!, day] : [day]))
  const draft = picks.length === 0 ? null : rangeFromPicks(picks[0]!, picks[1])
  const inDraft = (day: string) => draft !== null && day >= draft.from && day <= draft.to
  const shiftMonth = (delta: number) => setView((v) => {
    const next = new Date(v.year, v.month + delta, 1)
    return { year: next.getFullYear(), month: next.getMonth() }
  })

  return (
    <div ref={rootRef} className={cn('relative min-w-0 max-w-full', className)}>
      <button
        type="button"
        id="filter-tanggal"
        aria-label="Filter tanggal"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-sm border border-line bg-card px-2 text-left text-[13px]',
          'focus:border-primary focus:outline-none disabled:bg-soft disabled:text-ink-muted',
          from || to ? 'text-ink' : 'text-ink-muted',
        )}
      >
        <span className="truncate">{describeRange(from, to)}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
          <path d="M3 8.5h14M7 3v3M13 3v3" />
        </svg>
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Pilih tanggal"
          style={{ left: shift }}
          className="absolute z-30 mt-1 flex w-[min(calc(100vw-16px),460px)] flex-col gap-3 rounded-[14px] border border-line bg-card p-3 shadow-lg sm:flex-row"
        >
          <div className="flex flex-wrap gap-1 sm:w-[140px] sm:flex-col">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => choosePreset(preset.key)}
                className={cn(
                  'rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-soft',
                  activePreset === preset.key ? 'bg-primary-soft font-semibold text-primary' : 'text-ink',
                )}
              >
                {preset.label}
              </button>
            ))}
            {/* Pilihan sadar: default halaman adalah 30 hari, semua data hanya bila diminta. */}
            <button
              type="button"
              onClick={() => apply({ from: '', to: '' })}
              className={cn(
                'rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-soft',
                !from && !to ? 'bg-primary-soft font-semibold text-primary' : 'text-ink',
              )}
            >
              Semua tanggal
            </button>
            <span
              className={cn(
                'rounded-sm px-2.5 py-1.5 text-[13px]',
                (from || to) && activePreset === null ? 'bg-primary-soft font-semibold text-primary' : 'text-ink-soft',
              )}
            >
              Custom
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label="Bulan sebelumnya" onClick={() => shiftMonth(-1)} className="grid h-7 w-7 place-items-center rounded-sm text-ink-soft hover:bg-soft">‹</button>
              <span className="text-[13px] font-semibold text-ink">{MONTH_NAMES[view.month]} {view.year}</span>
              <button type="button" aria-label="Bulan berikutnya" onClick={() => shiftMonth(1)} className="grid h-7 w-7 place-items-center rounded-sm text-ink-soft hover:bg-soft">›</button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-ink-muted">
              {WEEKDAYS.map((d) => <span key={d} className="py-1">{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5" role="grid">
              {monthGrid(view.year, view.month).map((day, index) =>
                day === null ? <span key={`e${index}`} /> : (
                  <button
                    key={day}
                    type="button"
                    aria-label={day}
                    aria-pressed={inDraft(day)}
                    onClick={() => clickDay(day)}
                    className={cn(
                      'h-8 rounded-sm text-[12px] tabular-nums',
                      draft && (day === draft.from || day === draft.to)
                        ? 'bg-primary font-semibold text-white'
                        : inDraft(day) ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-soft',
                      day === today && !inDraft(day) ? 'ring-1 ring-primary/40' : '',
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                ),
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button type="button" onClick={() => apply({ from: '', to: '' })} className="text-[12px] font-medium text-ink-soft hover:text-ink">
                Hapus tanggal
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-ink-soft">{draft ? describeRange(draft.from, draft.to) : 'Pilih tanggal'}</span>
                <Button size="sm" variant="primary" disabled={draft === null} onClick={() => draft && apply(draft)}>
                  Terapkan
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function monthOf(iso: string): { year: number; month: number } {
  const date = parseIsoDate(iso) ?? new Date()
  return { year: date.getFullYear(), month: date.getMonth() }
}
