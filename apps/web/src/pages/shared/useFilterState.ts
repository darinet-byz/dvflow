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
import { persistFilters, readPersistedFilters } from '../../lib/filter-storage'

/**
 * Keadaan filter + halaman untuk halaman baca.
 *
 * Dua perilaku yang dijaga di sini, keduanya dari 01 §7:
 *   * teks pencarian di-debounce 300 ms dan baru dipakai setelah memenuhi
 *     syarat panjang minimum (`effectiveSearch`), sedangkan filter terstruktur
 *     langsung berlaku;
 *   * setiap perubahan filter mengembalikan halaman ke 1 — kalau tidak,
 *     pengguna bisa terjebak di halaman 7 dari hasil yang tinggal 1 halaman;
 *   * bila `storageKey` diberikan, filter disimpan di sessionStorage selama tab
 *     terbuka, sehingga berpindah halaman (mis. Presensi → Scan → Presensi)
 *     tidak mengulang setting filter.
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

/** Rentang default halaman bertanggal: Hari Ini (A28; sebelumnya 30 Hari Terakhir, A18), dihitung saat dipakai. */
function withDefaultDates<T extends CommonFilters>(filters: T): T {
  const today = presetRange('today')
  return { ...filters, dateFrom: today.from, dateTo: today.to }
}

export function useFilterState<T extends CommonFilters>(
  initial: T,
  options: { storageKey?: string } = {},
): FilterState<T> {
  // Filter awal tanpa tanggal berarti "pakai default Hari Ini"; "Semua tanggal" tetap bisa dipilih manual.
  const [filters, setFilters] = useState<T>(() => {
    const base = initial.dateFrom === '' && initial.dateTo === '' ? withDefaultDates(initial) : initial
    const saved = options.storageKey === undefined ? base : readPersistedFilters(options.storageKey, base)
    const params = new URLSearchParams(window.location.search)
    for (const key of Object.keys(base) as Array<keyof T>) {
      const value = params.get(String(key))
      if (value !== null && (key !== 'source' || ['', 'ots', 'orderonline'].includes(value))) saved[key] = value as T[keyof T]
    }
    return saved
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState<PageSize>(DEFAULT_PAGE_SIZE)

  // Tautan dari panel Notes membawa filter lewat query string. Saat pengguna sudah
  // berada di halaman yang sama, komponen tidak remount; sinkronkan query baru.
  // Event khusus dipakai karena history.pushState tidak memicu `popstate`.
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search)
      setFilters((current) => {
        const next = { ...current }
        let changed = false
        for (const key of Object.keys(initial) as Array<keyof T>) {
          const value = params.get(String(key))
          if (value === null || (key === 'source' && !['', 'ots', 'orderonline'].includes(value))) continue
          if (next[key] !== value) {
            next[key] = value as T[keyof T]
            changed = true
          }
        }
        return changed ? next : current
      })
    }
    window.addEventListener('popstate', sync)
    window.addEventListener('dvflow:filter-from-url', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('dvflow:filter-from-url', sync)
    }
    // `initial` sengaja tidak menjadi dependency: kunci filter stabil per halaman.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const debouncedSearch = useDebouncedValue(filters.search)

  const applied = useMemo(
    () => ({ ...filters, search: effectiveSearch(debouncedSearch) }) as T,
    [filters, debouncedSearch],
  )

  const appliedKey = JSON.stringify(applied)
  useEffect(() => {
    setPage(1)
  }, [appliedKey])

  // Simpan nilai mentah (bukan `applied`) supaya teks pencarian yang sedang
  // diketik tetap utuh ketika pengguna berpindah halaman lalu kembali.
  useEffect(() => {
    if (options.storageKey !== undefined) persistFilters(options.storageKey, filters)
  }, [options.storageKey, filters])

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
    // Clear All kembali ke Hari Ini, bukan ke semua data.
    clearAll: () => setFilters((current) => withDefaultDates({ ...clearAllFilters(current), source: initial.source })),
  }
}
