// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_ORDER_FILTERS } from '../src/lib/filters'
import { useFilterState } from '../src/pages/shared/useFilterState'
import { Pagination } from '../src/ui/Pagination'

/** A18: list maksimal 500 baris (10 x 50); halaman bertanggal default 30 Hari Terakhir. */

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 16, 9, 0, 0)) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Pagination: batas 10 halaman', () => {
  it('total 1.200 baris -> hanya 10 halaman x 50 + catatan', () => {
    render(<Pagination page={10} pageSize={50} total={1200} onPageChange={() => {}} onPageSizeChange={() => {}} />)
    expect(screen.getByText('10 / 10')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Berikutnya' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('note').textContent).toContain('500 data pertama')
  })

  it('100 per halaman -> 5 halaman', () => {
    render(<Pagination page={1} pageSize={100} total={1200} onPageChange={() => {}} onPageSizeChange={() => {}} />)
    expect(screen.getByText('1 / 5')).toBeDefined()
  })

  it('total di bawah batas: tanpa catatan', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} pageSize={50} total={120} onPageChange={onPageChange} onPageSizeChange={() => {}} />)
    expect(screen.getByText('1 / 3')).toBeDefined()
    expect(screen.queryByRole('note')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})

describe('filter tanggal default 30 hari', () => {
  it('halaman dibuka dengan 30 Hari Terakhir', () => {
    const { result } = renderHook(() => useFilterState(EMPTY_ORDER_FILTERS))
    expect(result.current.filters).toMatchObject({ dateFrom: '2026-09-17', dateTo: '2026-10-16' })
  })

  it('Clear All kembali ke 30 hari (teks pencarian tetap)', () => {
    const { result } = renderHook(() => useFilterState(EMPTY_ORDER_FILTERS))
    act(() => { result.current.update('search', 'Ahmad'); result.current.update('dateFrom', '2026-01-01'); result.current.update('city', 'Solo') })
    act(() => { result.current.clearAll() })
    expect(result.current.filters).toMatchObject({ dateFrom: '2026-09-17', dateTo: '2026-10-16', city: '', search: 'Ahmad' })
  })

  it('"Semua tanggal" tetap bisa dipilih (chip tanggal dihapus)', () => {
    const { result } = renderHook(() => useFilterState(EMPTY_ORDER_FILTERS))
    act(() => { result.current.removeFilter('dateRange') })
    expect(result.current.filters).toMatchObject({ dateFrom: '', dateTo: '' })
  })
})
