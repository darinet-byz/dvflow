import type { ReactNode } from 'react'
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
 * Bar filter yang SAMA untuk Dashboard, Order, Presensi, dan Report Tax (A28).
 *
 * Susunan tetap supaya mudah ditemukan di halaman mana pun:
 *   Baris 1  Cari (bila ada) · Tanggal · kontrol tampilan (mis. "Kelompokkan per")
 *   Baris 2  Produk · Pengiklan · Seminar & Webinar · Batch · Sesi · Kota · filter khusus halaman
 *   Baris 3  chip filter aktif · Clear All
 * Tidak ada filter yang disembunyikan (tanpa "More Filters").
 * Clear All tidak menghapus teks pencarian (PRD §37) — itu urusan `useFilterState`.
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
  /** Filter khusus halaman, selalu di ujung baris 2. */
  extra?: ReactNode
  extraChips?: ReactNode
}) {
  const chips = activeCommonFilters(filters)
  const controls = { filters, lists, update }
  return (
    <div className="filter-bar flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-card p-3.5" data-testid="standard-filter-bar">
      <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5" data-filter-row="primary">
        {search}
        <DateRangeFilters {...controls} />
        {viewControls}
      </div>
      <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5" data-filter-row="filters">
        <ProductFilter {...controls} />
        <AdvertiserFilter {...controls} />
        <EventTypeFilter {...controls} />
        <BatchFilter {...controls} />
        <SessionFilter {...controls} />
        <CityFilter {...controls} />
        {extra}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <FilterChip key={chip.key} label={chip.label} onRemove={() => removeFilter(chip.key)} />
        ))}
        {extraChips}
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
