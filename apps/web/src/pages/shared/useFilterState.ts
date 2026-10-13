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

export function useFilterState<T extends CommonFilters>(initial: T): FilterState<T> {
  const [filters, setFilters] = useState<T>(initial)
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
    clearAll: () => setFilters((current) => clearAllFilters(current)),
  }
}
