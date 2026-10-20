import { describe, expect, it } from 'vitest'
import {
  canExportMetaForStatus,
  formatMetaEventTime,
  META_CONVERSION_COLUMNS,
  metaConversionFilters,
  normalizeMetaEmail,
  normalizeMetaPhone,
  toMetaConversionCsv,
  toMetaConversionRow,
  toMetaConversionRows,
} from '../src/lib/meta-conversion'
import { EMPTY_ORDER_FILTERS } from '../src/lib/filters'

const ORDER = {
  order_id: 'MTIX-284129027',
  name: 'Budi Santoso',
  email: 'Budi@Example.COM',
  phone: '0812-3456-7890',
  city: 'Solo',
  app_status: 'Paid',
  gross_amount: '300000.00',
  paid_at: '2026-10-20T13:56:36Z',
  source_created_at: null,
  created_at: '2026-10-20T13:00:00Z',
}

describe('Meta conversion — format', () => {
  it('header persis mengikuti dokumen referensi', () => {
    expect(META_CONVERSION_COLUMNS.map((column) => column.header).join(',')).toBe(
      'order_id,fn,email,phone,ct,country,value,currency,event_name,event_time,data_processing_options',
    )
  })

  it('normalisasi nomor HP Indonesia', () => {
    expect(normalizeMetaPhone('0812-3456-7890')).toBe('+6281234567890')
    expect(normalizeMetaPhone('+62 812 3456 7890')).toBe('+6281234567890')
    expect(normalizeMetaPhone('6281234567890')).toBe('+6281234567890')
    expect(normalizeMetaPhone('81234567890')).toBe('+6281234567890')
    expect(normalizeMetaPhone('021-1234567')).toBe('+62211234567')
    expect(normalizeMetaPhone('+1 555 0100')).toBe('')
    expect(normalizeMetaPhone('')).toBe('')
  })

  it('email lowercase dan validasi sederhana', () => {
    expect(normalizeMetaEmail(' Budi@Example.COM ')).toBe('budi@example.com')
    expect(normalizeMetaEmail('bukan-email')).toBe('')
    expect(normalizeMetaEmail(null)).toBe('')
  })

  it('event_time memakai WIB tanpa offset', () => {
    expect(formatMetaEventTime('2026-10-20T13:56:36Z')).toBe('2026-10-20T20:56:36')
    expect(formatMetaEventTime('bukan tanggal')).toBe('')
  })

  it('mapping baris Paid -> kolom Meta', () => {
    expect(toMetaConversionRow(ORDER)).toEqual({
      order_id: 'MTIX-284129027',
      fn: 'Budi Santoso',
      email: 'budi@example.com',
      phone: '+6281234567890',
      ct: 'Solo',
      country: 'ID',
      value: '300000',
      currency: 'IDR',
      event_name: 'Purchase',
      event_time: '2026-10-20T20:56:36',
      data_processing_options: '[]',
    })
  })

  it('hanya Paid dan hanya baris dengan identifier', () => {
    expect(toMetaConversionRow({ ...ORDER, app_status: 'Pending' })).toBeNull()
    expect(toMetaConversionRow({ ...ORDER, app_status: 'Cancelled' })).toBeNull()
    expect(toMetaConversionRow({ ...ORDER, email: '', phone: '' })).toBeNull()
    const result = toMetaConversionRows([
      ORDER,
      { ...ORDER, order_id: 'MTIX-2', email: '', phone: '' },
      { ...ORDER, order_id: 'MTIX-3', app_status: 'Pending' },
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.skipped).toBe(2)
  })

  it('filter Meta selalu Paid, dan status non-Paid tidak bisa diexport', () => {
    expect(metaConversionFilters({ ...EMPTY_ORDER_FILTERS, appStatus: '' }).appStatus).toBe('Paid')
    expect(metaConversionFilters({ ...EMPTY_ORDER_FILTERS, appStatus: 'Paid' }).appStatus).toBe('Paid')
    expect(canExportMetaForStatus('')).toBe(true)
    expect(canExportMetaForStatus('Paid')).toBe(true)
    expect(canExportMetaForStatus('Pending')).toBe(false)
    expect(canExportMetaForStatus('Cancelled')).toBe(false)
  })

  it('CSV tanpa BOM, tanpa formula guard, quoting standar', () => {
    const csv = toMetaConversionCsv([
      { ...toMetaConversionRow(ORDER)!, fn: 'Santoso, Budi' },
    ])
    expect(csv.charCodeAt(0)).not.toBe(0xFEFF)
    expect(csv.startsWith('order_id,fn,email,phone,ct,country,value,currency,event_name,event_time,data_processing_options\r\n')).toBe(true)
    expect(csv).toContain('"Santoso, Budi"')
    expect(csv).toContain('+6281234567890')
    expect(csv).not.toContain("'+6281234567890")
  })
})
