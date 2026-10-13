import { describe, expect, it } from 'vitest'
import {
  isKnownRawStatus,
  isPaidStatus,
  normalizeAppStatus,
  UnsupportedOrderStatusError,
} from '../src/domain/status'

describe('mapping status kanonik (PRD §52)', () => {
  it('C03 pending -> Pending', () => {
    expect(normalizeAppStatus('pending')).toBe('Pending')
  })

  it('C04 processing -> Paid', () => {
    expect(normalizeAppStatus('processing')).toBe('Paid')
  })

  it('C05 complete -> Paid', () => {
    expect(normalizeAppStatus('complete')).toBe('Paid')
  })

  it('C06 cancelled -> Cancelled', () => {
    expect(normalizeAppStatus('cancelled')).toBe('Cancelled')
  })

  it('C07 status tak dikenal ditolak, tidak dipetakan diam-diam', () => {
    expect(() => normalizeAppStatus('refunded')).toThrow(UnsupportedOrderStatusError)

    try {
      normalizeAppStatus('refunded')
      throw new Error('seharusnya melempar')
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedOrderStatusError)
      expect((error as UnsupportedOrderStatusError).code).toBe('UNSUPPORTED_ORDER_STATUS')
    }
  })

  it('C07 variasi status yang mirip tetap ditolak (tanpa fuzzy matching)', () => {
    for (const value of ['proces', 'PROCESSINGG', 'paid', 'canceled', '', '  ', 'processing-']) {
      expect(() => normalizeAppStatus(value)).toThrow(UnsupportedOrderStatusError)
    }
  })

  it('menerima huruf besar/kecil dan spasi di tepi, karena itu nilai yang sama', () => {
    expect(normalizeAppStatus(' PROCESSING ')).toBe('Paid')
    expect(normalizeAppStatus('Cancelled')).toBe('Cancelled')
  })

  it('isKnownRawStatus sejalan dengan normalizeAppStatus', () => {
    expect(isKnownRawStatus('complete')).toBe(true)
    expect(isKnownRawStatus('paid')).toBe(false)
  })

  it('Paid = processing OR complete', () => {
    expect(isPaidStatus(normalizeAppStatus('processing'))).toBe(true)
    expect(isPaidStatus(normalizeAppStatus('complete'))).toBe(true)
    expect(isPaidStatus(normalizeAppStatus('pending'))).toBe(false)
    expect(isPaidStatus(normalizeAppStatus('cancelled'))).toBe(false)
  })
})
