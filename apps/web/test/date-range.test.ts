import { describe, expect, it } from 'vitest'
import { describeRange, monthGrid, presetRange, rangeFromPicks } from '../src/lib/date-range'
import { activeCommonFilters, clearFilter, EMPTY_COMMON_FILTERS } from '../src/lib/filters'

const TODAY = new Date(2026, 9, 16) // 16 Okt 2026 (lokal)

describe('preset tanggal', () => {
  it('Hari Ini / Kemarin / 7 / 30 hari dari tanggal lokal', () => {
    expect(presetRange('today', TODAY)).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    expect(presetRange('yesterday', TODAY)).toEqual({ from: '2026-10-15', to: '2026-10-15' })
    expect(presetRange('last7', TODAY)).toEqual({ from: '2026-10-10', to: '2026-10-16' })
    expect(presetRange('last30', TODAY)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
  })
  it('melewati batas bulan/tahun dengan benar', () => {
    expect(presetRange('yesterday', new Date(2026, 0, 1))).toEqual({ from: '2025-12-31', to: '2025-12-31' })
  })
})

describe('pilihan kalender', () => {
  it('satu tanggal = tanggal tunggal', () => {
    expect(rangeFromPicks('2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-05' })
  })
  it('dua tanggal = rentang terurut, berapa pun urutan klik', () => {
    expect(rangeFromPicks('2026-10-15', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-15' })
    expect(rangeFromPicks('2026-10-01', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-15' })
  })
  it('kalender mulai Senin: 1 Okt 2026 (Kamis) didahului 3 sel kosong', () => {
    const grid = monthGrid(2026, 9)
    expect(grid.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(grid.filter(Boolean)).toHaveLength(31)
  })
})

describe('label rentang', () => {
  it.each([
    ['', '', 'Semua tanggal'],
    ['2026-10-16', '2026-10-16', 'Hari Ini'],
    ['2026-10-10', '2026-10-16', '7 Hari Terakhir'],
    ['2026-10-05', '2026-10-05', '5 Okt 2026'],
    ['2026-10-01', '2026-10-15', '1–15 Okt 2026'],
    ['2026-09-20', '2026-10-05', '20 Sep – 5 Okt 2026'],
    ['2025-12-20', '2026-01-05', '20 Des 2025 – 5 Jan 2026'],
  ])('%s s/d %s -> %s', (from, to, label) => {
    expect(describeRange(from, to, TODAY)).toBe(label)
  })
})

describe('chip filter tanggal', () => {
  it('satu chip untuk rentang; menghapusnya mengosongkan kedua tanggal', () => {
    const filters = { ...EMPTY_COMMON_FILTERS, search: 'Ahmad', dateFrom: '2026-10-01', dateTo: '2026-10-15' }
    const chips = activeCommonFilters(filters)
    expect(chips.filter((c) => c.key === 'dateRange')).toHaveLength(1)
    expect(chips.find((c) => c.key === 'dateRange')?.label).toBe('Tanggal: 1–15 Okt 2026')
    expect(chips.some((c) => c.key === 'dateFrom' || c.key === 'dateTo')).toBe(false)
    const cleared = clearFilter(filters, 'dateRange')
    expect(cleared).toMatchObject({ dateFrom: '', dateTo: '', search: 'Ahmad' })
  })
})
