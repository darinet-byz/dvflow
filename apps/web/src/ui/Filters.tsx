import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Filter bar & chip (PRD §34–§37, 01 §7).
 *
 * Aturan UX yang dijaga komponen ini:
 *   * filter aktif **selalu terlihat** sebagai chip;
 *   * setiap chip dapat dilepas satu per satu;
 *   * `Clear All` hanya membersihkan filter terstruktur — teks pencarian global
 *     TIDAK ikut terhapus (PRD §37, 01 §7). Pemisahan itu dilakukan pemanggil;
 *     komponen ini hanya menyediakan dua tombol yang berbeda.
 */
export function FilterBar({
  search,
  filters,
  activeFilters,
  onClearAll,
  actions,
}: {
  search?: ReactNode
  /** Kontrol filter terstruktur (select, dsb.). */
  filters?: ReactNode
  /** Chip filter yang sedang aktif. */
  activeFilters?: ReactNode
  onClearAll?: () => void
  actions?: ReactNode
}) {
  return (
    <div className="filter-bar flex min-w-0 flex-wrap items-center gap-2.5 rounded-lg border border-line bg-card p-3.5">
      {search}
      {filters}
      {actions}

      {activeFilters === undefined ? null : (
        <div className="flex flex-wrap items-center gap-1.5">{activeFilters}</div>
      )}

      {onClearAll === undefined ? null : (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-auto text-[12px] font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline"
        >
          Clear All
        </button>
      )}
    </div>
  )
}

export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-[30px] max-w-full [overflow-wrap:anywhere] items-center gap-1.5 rounded-full bg-primary-soft px-2.5 text-[11px] font-semibold text-primary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Hapus filter ${label}`}
        className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full text-primary/70 hover:bg-primary/10 hover:text-primary')}
      >
        ×
      </button>
    </span>
  )
}
