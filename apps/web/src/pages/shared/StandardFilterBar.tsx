import { useState, type ReactNode } from 'react'
import { Select } from '../../ui/Field'
import { activeCommonFilters, type CommonFilters } from '../../lib/filters'
import type { ConfigLists } from '../../lib/queries'
import { FilterChip } from '../../ui/Filters'
import {
  AdvertiserFilter,
  BatchFilter,
  CityFilter,
  DateRangeFilters,
  EventTypeFilter,
  ProductFilter,
  SessionFilter,
} from './FilterControls'

/**
 * Bar filter bersama untuk Dashboard, Order, Presensi, Refund, dan Report Tax.
 *
 * Susunan baru (permintaan pengguna 6 November 2026):
 *   Baris 1  Cari · Tanggal · Produk · Batch · Pengiklan
 *   Baris 2  Filter Lain (Sumber, Jenis Acara, Sesi, Kota, filter khusus halaman)
 *   Baris 3  chip aktif · toggle Filter Lain · Clear All
 *
 * Filter sekunder tidak hilang: hanya dilipat. Chip tetap terlihat, dan baris
 * otomatis terbuka bila salah satu filter sekunder sedang aktif.
 * Clear All tidak menghapus teks pencarian (PRD §37).
 */
export function StandardFilterBar<T extends CommonFilters>({
  filters,
  lists,
  update,
  removeFilter,
  clearAll,
  search,
  viewControls,
  extra,
  extraChips,
}: {
  filters: T
  lists: ConfigLists | null
  update: (key: keyof T, value: string) => void
  removeFilter: (key: string) => void
  clearAll: () => void
  search?: ReactNode
  viewControls?: ReactNode
  /** Filter khusus halaman, selalu di baris Filter Lain. */
  extra?: ReactNode
  extraChips?: ReactNode
}) {
  const [showMore, setShowMore] = useState(false)
  const chips = activeCommonFilters(filters)
  const controls = { filters, lists, update }
  const activeSecondary = [filters.eventType, filters.session, filters.city].filter((value) => value.trim() !== '').length
  const expanded = showMore
  return (
    <div className="filter-bar flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-card p-3.5" data-testid="standard-filter-bar">
      <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5" data-filter-row="primary">
        {search}
        <DateRangeFilters {...controls} />
        <ProductFilter {...controls} />
        <BatchFilter {...controls} />
        <AdvertiserFilter {...controls} />
        {viewControls}
      </div>
      {expanded ? (
        <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5" data-filter-row="filters">
          <Select
            id="source-filter"
            ariaLabel="Filter sumber pendaftaran"
            className="w-[190px]"
            value={filters.source}
            onChange={(value) => update('source', value)}
            options={[{ value: '', label: 'Semua Sumber' }, { value: 'orderonline', label: 'Online' }, { value: 'ots', label: 'OTS' }]}
          />
          <EventTypeFilter {...controls} />
          <SessionFilter {...controls} />
          <CityFilter {...controls} />
          {extra}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <FilterChip key={chip.key} label={chip.label} onRemove={() => removeFilter(chip.key)} />
        ))}
        {extraChips}
        <button
          type="button"
          onClick={() => setShowMore((value) => !value)}
          aria-expanded={expanded}
          className="rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-ink-soft hover:border-primary/40 hover:text-ink"
        >
          {expanded ? 'Sembunyikan Filter' : `Filter Lain${activeSecondary > 0 ? ` (${activeSecondary})` : ''}`}
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="ml-auto text-[12px] font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline"
        >
          Clear All
        </button>
      </div>
    </div>
  )
}
