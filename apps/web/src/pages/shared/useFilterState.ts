import { useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '../../lib/useAsyncData'
import {
  clearAllFilters,
  clearFilter,
  effectiveSearch,
  type CommonFilters,
  type PageSize,
  DEFAULT_PAGE_SIZE,
} from '../../lib/filters'
import { presetRange } from '../../lib/date-range'

/**
 * Keadaan filter + halaman untuk halaman baca.
 *
 * Dua perilaku yang dijaga di sini, keduanya dari 01 §7:
 *   * teks pencarian di-debounce 300 ms dan baru dipakai setelah memenuhi
 *     syarat panjang minimum (`effectiveSearch`), sedangkan filter terstruktur
 *     langsung berlaku;
 *   * setiap perubahan filter mengembalikan halaman ke 1 — kalau tidak,
 *     pengguna bisa terjebak di halaman 7 dari hasil yang tinggal 1 halaman.
 */
export type FilterState<T extends CommonFilters> = {
  /** Nilai mentah (dipakai input, termasuk teks pencarian yang sedang diketik). */
  filters: T
  /** Nilai yang dikirim ke server (pencarian sudah di-debounce dan disaring). */
  applied: T
  page: number
  pageSize: PageSize
  setPage: (page: number) => void
  setPageSize: (size: PageSize) => void
  update: (key: keyof T, value: string) => void
  removeFilter: (key: string) => void
  clearAll: () => void
}

/** Rentang default halaman bertanggal: 30 Hari Terakhir (dihitung saat dipakai), agar tidak memuat semua data. */
function withDefaultDates<T extends CommonFilters>(filters: T): T {
  const last30 = presetRange('last30')
  return { ...filters, dateFrom: last30.from, dateTo: last30.to }
}

export function useFilterState<T extends CommonFilters>(initial: T): FilterState<T> {
  // Filter awal tanpa tanggal berarti "pakai default 30 hari"; "Semua tanggal" tetap bisa dipilih manual.
  const [filters, setFilters] = useState<T>(() => (initial.dateFrom === '' && initial.dateTo === '' ? withDefaultDates(initial) : initial))
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState<PageSize>(DEFAULT_PAGE_SIZE)

  const debouncedSearch = useDebouncedValue(filters.search)

  const applied = useMemo(
    () => ({ ...filters, search: effectiveSearch(debouncedSearch) }) as T,
    [filters, debouncedSearch],
  )

  const appliedKey = JSON.stringify(applied)
  useEffect(() => {
    setPage(1)
  }, [appliedKey])

  return {
    filters,
    applied,
    page,
    pageSize,
    setPage,
    setPageSize: (size) => {
      setPageSizeState(size)
      setPage(1)
    },
    update: (key, value) => setFilters((current) => ({ ...current, [key]: value })),
    removeFilter: (key) => setFilters((current) => clearFilter(current, key)),
    // Clear All kembali ke 30 Hari Terakhir, bukan ke semua data.
    clearAll: () => setFilters((current) => withDefaultDates(clearAllFilters(current))),
  }
}
