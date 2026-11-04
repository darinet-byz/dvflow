// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { presetRange } from '../src/lib/date-range'
import { EMPTY_ORDER_FILTERS } from '../src/lib/filters'
import { clearPersistedFilters, persistFilters, readPersistedFilters } from '../src/lib/filter-storage'
import { useFilterState } from '../src/pages/shared/useFilterState'

/** Filter adalah keadaan kerja tab: harus bertahan saat pindah halaman, lalu bersih saat logout. */
describe('penyimpanan filter', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(cleanup)

  it('membaca kembali filter yang disimpan dan mengabaikan bentuk rusak', () => {
    persistFilters('contoh', { ...EMPTY_ORDER_FILTERS, batch: '392' })
    expect(readPersistedFilters('contoh', EMPTY_ORDER_FILTERS).batch).toBe('392')

    window.sessionStorage.setItem('dvflow.filters.contoh', '{bukan json')
    expect(readPersistedFilters('contoh', EMPTY_ORDER_FILTERS).batch).toBe('')

    window.sessionStorage.setItem('dvflow.filters.contoh', JSON.stringify({ batch: 123, appStatus: 'Paid' }))
    const parsed = readPersistedFilters('contoh', EMPTY_ORDER_FILTERS)
    expect(parsed.batch).toBe('')
    expect(parsed.appStatus).toBe('Paid')
  })

  it('clearPersistedFilters hanya menghapus kunci filter', () => {
    persistFilters('order', { ...EMPTY_ORDER_FILTERS, batch: '392' })
    window.sessionStorage.setItem('lain', 'tetap')
    clearPersistedFilters()
    expect(window.sessionStorage.getItem('dvflow.filters.order')).toBeNull()
    expect(window.sessionStorage.getItem('lain')).toBe('tetap')
  })

  it('useFilterState mempertahankan filter saat komponen dipasang ulang', () => {
    const first = renderHook(() => useFilterState(EMPTY_ORDER_FILTERS, { storageKey: 'test-persist' }))
    act(() => first.result.current.update('batch', '392'))
    act(() => first.result.current.update('productCode', 'KM'))
    first.unmount()

    const second = renderHook(() => useFilterState(EMPTY_ORDER_FILTERS, { storageKey: 'test-persist' }))
    expect(second.result.current.filters.batch).toBe('392')
    expect(second.result.current.filters.productCode).toBe('KM')

    act(() => second.result.current.clearAll())
    const today = presetRange('today')
    expect(second.result.current.filters.batch).toBe('')
    expect(second.result.current.filters.dateFrom).toBe(today.from)
    expect(second.result.current.filters.dateTo).toBe(today.to)
  })
})
