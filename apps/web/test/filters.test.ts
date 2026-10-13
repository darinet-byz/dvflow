import { describe, expect, it } from 'vitest'
import {
  EMPTY_COMMON_FILTERS,
  EMPTY_ORDER_FILTERS,
  EMPTY_PRESENSI_FILTERS,
  activeCommonFilters,
  clearAllFilters,
  clearFilter,
  effectiveSearch,
  hasStructuredFilters,
  pageRange,
  toCommonFilters,
  toFilterArgs,
  toOrderArgs,
  toPresensiArgs,
  totalPages,
} from '../src/lib/filters'

/**
 * Aturan filter & pencarian (PRD §34–§37, 01 §6–§7, CLAUDE.md §14–§15).
 *
 * Berkas ini memegang perilaku yang mudah rusak tanpa terlihat: aturan panjang
 * minimum pencarian, arti "kosong" versus "null", dan `Clear All` yang TIDAK
 * boleh menghapus teks pencarian.
 */
describe('aturan teks pencarian (01 §7)', () => {
  it('minimal 2 karakter, kecuali Order ID numerik boleh 1 karakter', () => {
    expect(effectiveSearch('')).toBe('')
    expect(effectiveSearch('A')).toBe('')
    expect(effectiveSearch('Ab')).toBe('Ab')
    expect(effectiveSearch('7')).toBe('7')
    expect(effectiveSearch('283033796')).toBe('283033796')
    // Satu huruf yang diikuti angka tetap bukan Order ID numerik.
    expect(effectiveSearch('a1')).toBe('a1')
    expect(effectiveSearch('1a')).toBe('1a')
  })

  it('spasi tepi diabaikan saat mengukur panjang', () => {
    expect(effectiveSearch('  A  ')).toBe('')
    expect(effectiveSearch('  Ab  ')).toBe('Ab')
  })
})

describe('pemetaan filter ke argumen RPC', () => {
  it('nama argumennya sama dengan tanda tangan fungsi di database', () => {
    expect(Object.keys(toFilterArgs(EMPTY_COMMON_FILTERS)).sort()).toEqual([
      'p_advertiser_code',
      'p_batch',
      'p_city',
      'p_date_from',
      'p_date_to',
      'p_event_type',
      'p_product_code',
      'p_search',
      'p_session',
    ])
  })

  it('filter kosong dikirim sebagai null, bukan string kosong', () => {
    const args = toFilterArgs({ ...EMPTY_COMMON_FILTERS, productCode: '   ' })
    expect(args['p_product_code']).toBeNull()
    expect(args['p_search']).toBeNull()
  })

  it('nilai yang diisi diteruskan apa adanya', () => {
    const args = toFilterArgs({
      ...EMPTY_COMMON_FILTERS,
      search: 'Ahmad',
      productCode: 'KM',
      batch: '392',
      city: 'Solo',
      dateFrom: '2026-10-01',
    })
    expect(args).toMatchObject({
      p_search: 'Ahmad',
      p_product_code: 'KM',
      p_batch: '392',
      p_city: 'Solo',
      p_date_from: '2026-10-01',
    })
  })

  it('halaman Order menambah status dan payment method', () => {
    const args = toOrderArgs({ ...EMPTY_ORDER_FILTERS, appStatus: 'Paid', paymentMethod: 'bank_transfer' })
    expect(args['p_app_status']).toBe('Paid')
    expect(args['p_payment_method']).toBe('bank_transfer')
  })

  it('halaman Presensi menambah status presensi', () => {
    const args = toPresensiArgs({ ...EMPTY_PRESENSI_FILTERS, attendanceStatus: 'Hadir' })
    expect(args['p_attendance_status']).toBe('Hadir')
    expect(args).not.toHaveProperty('p_app_status')
  })
})

describe('chip filter aktif (PRD §35–§36)', () => {
  it('hanya filter yang terisi yang muncul sebagai chip', () => {
    expect(activeCommonFilters(EMPTY_COMMON_FILTERS)).toEqual([])

    const chips = activeCommonFilters({ ...EMPTY_COMMON_FILTERS, productCode: 'KM', batch: '392' }, { product: 'Kuliner Masteri' })
    expect(chips.map((chip) => chip.label)).toEqual(['Produk: Kuliner Masteri', 'Batch 392'])
  })

  it('membuang satu chip tidak mengubah filter lain', () => {
    const filters = { ...EMPTY_COMMON_FILTERS, productCode: 'KM', batch: '392', city: 'Solo' }
    const after = clearFilter(filters, 'batch')

    expect(after.batch).toBe('')
    expect(after.productCode).toBe('KM')
    expect(after.city).toBe('Solo')
  })

  it('kunci yang tidak dikenal tidak mengubah apa pun', () => {
    const filters = { ...EMPTY_COMMON_FILTERS, city: 'Solo' }
    expect(clearFilter(filters, 'tidak-ada')).toEqual(filters)
  })
})

describe('Clear All (PRD §37 — teks pencarian TIDAK ikut terhapus)', () => {
  it('menghapus seluruh filter terstruktur', () => {
    const filters = {
      ...EMPTY_ORDER_FILTERS,
      search: 'Ahmad',
      productCode: 'KM',
      batch: '392',
      appStatus: 'Paid',
      paymentMethod: 'bank_transfer',
    }

    const after = clearAllFilters(filters)

    expect(after.productCode).toBe('')
    expect(after.batch).toBe('')
    expect(after.appStatus).toBe('')
    expect(after.paymentMethod).toBe('')
  })

  it('mempertahankan teks pencarian', () => {
    const after = clearAllFilters({ ...EMPTY_ORDER_FILTERS, search: 'Ahmad', city: 'Solo' })
    expect(after.search).toBe('Ahmad')
  })

  it('hasStructuredFilters mengabaikan teks pencarian', () => {
    expect(hasStructuredFilters({ ...EMPTY_COMMON_FILTERS, search: 'Ahmad' })).toBe(false)
    expect(hasStructuredFilters({ ...EMPTY_COMMON_FILTERS, city: 'Solo' })).toBe(true)
  })
})

describe('filter KPI Presensi (PRD §111)', () => {
  it('toCommonFilters membuang filter status presensi', () => {
    const presensi = { ...EMPTY_PRESENSI_FILTERS, attendanceStatus: 'Hadir', city: 'Solo' }
    const common = toCommonFilters(presensi)

    expect(common).not.toHaveProperty('attendanceStatus')
    expect(common.city).toBe('Solo')
  })
})

describe('pagination (PRD §33)', () => {
  it('menghitung jumlah halaman', () => {
    expect(totalPages(0, 50)).toBe(1)
    expect(totalPages(50, 50)).toBe(1)
    expect(totalPages(51, 50)).toBe(2)
    expect(totalPages(120, 100)).toBe(2)
  })

  it('rentang baris yang ditampilkan', () => {
    expect(pageRange(1, 50, 0)).toEqual({ from: 0, to: 0 })
    expect(pageRange(1, 50, 120)).toEqual({ from: 1, to: 50 })
    expect(pageRange(3, 50, 120)).toEqual({ from: 101, to: 120 })
    expect(pageRange(2, 100, 120)).toEqual({ from: 101, to: 120 })
  })
})
