import { describe, expect, it } from 'vitest'
import { normalizePaymentIdentifier, paymentIdentifiersEqual } from '../src/domain/payment-identifier'

describe('normalisasi payment identifier (01-IMPLEMENTATION-DECISIONS §11)', () => {
  it('E04 cocok walau beda huruf besar/kecil dan spasi berlebih', () => {
    const canonical = normalizePaymentIdentifier('QRIS')
    expect(canonical).toBe('qris')
    expect(normalizePaymentIdentifier('qris')).toBe(canonical)
    expect(normalizePaymentIdentifier('  qris  ')).toBe(canonical)
    expect(normalizePaymentIdentifier('Q R I S')).toBe('q r i s')
  })

  it('E04 merapatkan spasi ganda menjadi satu', () => {
    expect(normalizePaymentIdentifier('VA    BCA')).toBe('va bca')
    expect(normalizePaymentIdentifier('VA BCA')).toBe(normalizePaymentIdentifier('  va   bca '))
  })

  it('E05/E06 tidak ada fuzzy matching: string berbeda tetap berbeda', () => {
    expect(normalizePaymentIdentifier('va bca')).not.toBe(normalizePaymentIdentifier('va bca 2'))
    expect(normalizePaymentIdentifier('qris')).not.toBe(normalizePaymentIdentifier('qriss'))
    expect(normalizePaymentIdentifier('va bca')).not.toBe(normalizePaymentIdentifier('bca'))
  })

  it('nilai kosong menjadi null, bukan string kosong', () => {
    expect(normalizePaymentIdentifier('')).toBeNull()
    expect(normalizePaymentIdentifier('   ')).toBeNull()
    expect(normalizePaymentIdentifier(null)).toBeNull()
    expect(normalizePaymentIdentifier(undefined)).toBeNull()
  })

  it('perbandingan identifier memperlakukan null sebagai "tidak disebutkan"', () => {
    expect(paymentIdentifiersEqual(null, null)).toBe(true)
    expect(paymentIdentifiersEqual('qris', 'qris')).toBe(true)
    expect(paymentIdentifiersEqual('qris', null)).toBe(false)
    expect(paymentIdentifiersEqual(null, 'qris')).toBe(false)
  })
})
