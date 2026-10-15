import { describe, expect, it } from 'vitest'
import { calcTaxAmount, calculateFees, calculateTax, roundMoney, shouldRecalculateTax } from '../src/domain/tax'
import type { MatchedFeeRule } from '../src/types'

const FLAT_4000: MatchedFeeRule = {
  id: 'rule-va-bca',
  name: 'VA BCA',
  fee_type: 'flat',
  fee_value: 4000,
}

const PERCENT_QRIS: MatchedFeeRule = {
  id: 'rule-qris',
  name: 'QRIS',
  fee_type: 'percentage',
  fee_value: 0.7,
}

describe('perhitungan tax (PRD §81, §82)', () => {
  it('E01 flat 4000 pada gross 300000 -> tax 4000, net 296000', () => {
    const result = calculateTax(300000, FLAT_4000)

    expect(result.tax_amount).toBe(4000)
    expect(result.net_amount).toBe(296000)
    expect(result.tax_mapping_status).toBe('mapped')
    expect(result.fee_rule?.name).toBe('VA BCA')
  })

  it('E02 percentage 0.7 pada gross 300000 -> tax 2100, net 297900', () => {
    const result = calculateTax(300000, PERCENT_QRIS)

    expect(result.tax_amount).toBe(2100)
    expect(result.net_amount).toBe(297900)
    expect(result.tax_mapping_status).toBe('mapped')
  })

  it('E05 tanpa rule yang cocok -> tax 0, net = gross, status unmapped', () => {
    const result = calculateTax(300000, null)

    expect(result.tax_amount).toBe(0)
    expect(result.net_amount).toBe(300000)
    expect(result.tax_mapping_status).toBe('unmapped')
    expect(result.fee_rule).toBeNull()
  })

  it('percentage 0.7 berarti 0,7% bukan 0,007', () => {
    expect(calcTaxAmount(100000, { fee_type: 'percentage', fee_value: 0.7 })).toBe(700)
    expect(calcTaxAmount(1000, { fee_type: 'percentage', fee_value: 100 })).toBe(1000)
  })

  it('pembulatan uang selalu 2 desimal', () => {
    expect(calcTaxAmount(12345, { fee_type: 'percentage', fee_value: 0.7 })).toBe(86.42)
    expect(roundMoney(2100.0000000000005)).toBe(2100)
    expect(roundMoney(0.005)).toBe(0.01)
    expect(roundMoney(296000)).toBe(296000)
  })

  it('gross nol menghasilkan tax nol dan net nol', () => {
    expect(calculateTax(0, PERCENT_QRIS).tax_amount).toBe(0)
    expect(calculateTax(0, FLAT_4000).tax_amount).toBe(4000)
    expect(calculateTax(0, FLAT_4000).net_amount).toBe(-4000)
  })

  it('nilai uang tidak valid ditolak, bukan menghasilkan angka sampah', () => {
    expect(() => roundMoney(Number.NaN)).toThrow()
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('perhitungan dapat diulang dengan hasil identik (deterministik)', () => {
    const first = calculateTax(300000, PERCENT_QRIS)
    const second = calculateTax(300000, PERCENT_QRIS)

    expect(second).toEqual(first)
  })
})

describe('kapan snapshot tax boleh dihitung ulang (01 §12)', () => {
  const base = {
    incomingPaymentIdentifier: 'qris',
    storedPaymentIdentifier: 'qris',
    incomingGrossAmount: 300000,
    storedGrossAmount: 300000,
    storedTaxMappingStatus: 'mapped' as const,
    hasMatchingRuleNow: true,
  }

  it('E09 webhook ulang tanpa perubahan tidak menghitung ulang', () => {
    expect(shouldRecalculateTax(base)).toBe(false)
  })

  it('E09 webhook parsial tanpa identifier TIDAK dianggap berubah', () => {
    expect(shouldRecalculateTax({ ...base, incomingPaymentIdentifier: null })).toBe(false)
  })

  it('identifier yang benar-benar berubah memicu perhitungan ulang', () => {
    expect(shouldRecalculateTax({ ...base, incomingPaymentIdentifier: 'va bca' })).toBe(true)
  })

  it('gross yang berubah memicu perhitungan ulang', () => {
    expect(shouldRecalculateTax({ ...base, incomingGrossAmount: 400000 })).toBe(true)
  })

  it('order unmapped yang kini punya rule cocok dihitung ulang', () => {
    expect(
      shouldRecalculateTax({
        ...base,
        storedTaxMappingStatus: 'unmapped',
        storedPaymentIdentifier: null,
        hasMatchingRuleNow: true,
      }),
    ).toBe(true)
  })

  it('order unmapped tanpa rule dan tanpa identifier baru tidak dihitung ulang', () => {
    expect(
      shouldRecalculateTax({
        ...base,
        incomingPaymentIdentifier: null,
        storedTaxMappingStatus: 'unmapped',
        storedPaymentIdentifier: null,
        hasMatchingRuleNow: false,
      }),
    ).toBe(false)
  })

  it('identifier yang muncul pertama kali memicu perhitungan ulang saat rule tersedia', () => {
    expect(
      shouldRecalculateTax({
        ...base,
        incomingPaymentIdentifier: 'qris',
        storedPaymentIdentifier: null,
        storedTaxMappingStatus: 'unmapped',
        hasMatchingRuleNow: true,
      }),
    ).toBe(true)
  })

  it('identifier berubah ke yang tanpa rule -> dihitung ulang dan hasilnya unmapped', () => {
    // 01 §12: input perhitungan berubah, jadi dihitung ulang. Hasil barunya memang
    // unmapped — snapshot lama tidak dipertahankan karena pembayarannya berbeda.
    expect(
      shouldRecalculateTax({
        ...base,
        incomingPaymentIdentifier: 'va mandiri',
        storedPaymentIdentifier: 'qris',
        hasMatchingRuleNow: false,
      }),
    ).toBe(true)
  })
})

describe('calculateFees (A15): e-payment fee, e-payment fee tax, platform fee', () => {
  const va = { fee_type: 'flat' as const, fee_value: 4000, platform_fee_applies: true, epayment_tax_type: 'percentage' as const, epayment_tax_value: 1 }
  const qris = { fee_type: 'percentage' as const, fee_value: 0.7, platform_fee_applies: true, epayment_tax_type: null, epayment_tax_value: null }
  const transfer = { fee_type: 'flat' as const, fee_value: 0, platform_fee_applies: false, epayment_tax_type: null, epayment_tax_value: null }
  const paid = { platformFeePercent: 2, isPaid: true }

  it('VA: flat fee + PPN 1% dari fee + platform fee 2%', () => {
    expect(calculateFees(1_000_000, va, paid)).toEqual({ epayment_fee: 4000, epayment_fee_tax: 40, platform_fee: 20000, net_amount: 975960 })
  })
  it('QRIS: % fee + platform fee, tanpa e-payment fee tax', () => {
    expect(calculateFees(1_000_000, qris, paid)).toEqual({ epayment_fee: 7000, epayment_fee_tax: 0, platform_fee: 20000, net_amount: 973000 })
  })
  it('bank transfer tidak kena platform fee', () => {
    expect(calculateFees(1_000_000, transfer, paid).platform_fee).toBe(0)
  })
  it('order belum Paid tidak kena platform fee', () => {
    expect(calculateFees(100_000, qris, { platformFeePercent: 2, isPaid: false }).platform_fee).toBe(0)
  })
  it('e-payment fee tax flat', () => {
    expect(calculateFees(100_000, { ...va, epayment_tax_type: 'flat', epayment_tax_value: 500 }, paid).epayment_fee_tax).toBe(500)
  })
  it('tanpa rule: semua 0, net = gross', () => {
    expect(calculateFees(100_000, null, paid)).toEqual({ epayment_fee: 0, epayment_fee_tax: 0, platform_fee: 0, net_amount: 100000 })
  })
})
