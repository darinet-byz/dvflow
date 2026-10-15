/**
 * Perhitungan tax/fee (PRD §81–§82, 01-IMPLEMENTATION-DECISIONS §11 dan §12).
 *
 *   flat       -> tax = fee_value
 *   percentage -> tax = gross * (fee_value / 100)
 *   net        -> gross - tax
 *
 * fee_value persentase disimpan sebagai angka persen: 0.7 berarti 0,7%,
 * bukan 0,007.
 *
 * Tanpa rule yang cocok: tax 0, net = gross, status unmapped. Tidak ada
 * fuzzy matching maupun pemilihan "rule terdekat".
 *
 * Catatan implementasi: aritmetika yang DIPERSIST dihitung di SQL
 * (public.calc_tax_amount) agar hanya ada satu sumber kebenaran. Fungsi di sini
 * adalah cermin untuk tampilan, dan keduanya diuji terhadap angka yang sama dari
 * 05-EDGE-CASES-AND-ACCEPTANCE-TESTS (E01, E02).
 */

import type { FeeType, MatchedFeeRule, TaxMappingStatus } from '../types'

export const PERCENTAGE_DIVISOR = 100

/**
 * Pembulatan uang ke 2 desimal, sepadan dengan NUMERIC(18,2).
 *
 * Epsilon ditambahkan supaya nilai seperti 2100.0000000000005 (hasil
 * 300000 * 0.7 / 100 pada floating point) tidak terpotong ke bawah.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Nilai uang tidak valid')
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calcTaxAmount(
  grossAmount: number,
  rule: Pick<MatchedFeeRule, 'fee_type' | 'fee_value' | 'fee_flat_value'>,
): number {
  const gross = roundMoney(grossAmount)
  const percentPart = gross * (rule.fee_value / PERCENTAGE_DIVISOR)
  const tax =
    rule.fee_type === 'flat'
      ? rule.fee_value
      : rule.fee_type === 'percentage_flat'
        ? percentPart + (rule.fee_flat_value ?? 0)
        : percentPart
  return roundMoney(tax)
}

export type TaxCalculation = {
  tax_mapping_status: TaxMappingStatus
  tax_amount: number
  net_amount: number
  fee_rule: MatchedFeeRule | null
}

export function calculateTax(grossAmount: number, rule: MatchedFeeRule | null): TaxCalculation {
  const gross = roundMoney(grossAmount)

  if (rule === null) {
    return {
      tax_mapping_status: 'unmapped',
      tax_amount: 0,
      net_amount: gross,
      fee_rule: null,
    }
  }

  const taxAmount = calcTaxAmount(gross, rule)
  return {
    tax_mapping_status: 'mapped',
    tax_amount: taxAmount,
    net_amount: roundMoney(gross - taxAmount),
    fee_rule: rule,
  }
}

/**
 * Apakah tax perlu dihitung ulang saat webhook berulang (01-IMPLEMENTATION-DECISIONS §12).
 *
 * Dihitung ulang HANYA bila salah satu input perhitungan berubah, atau bila order
 * sebelumnya unmapped dan sekarang ada rule yang cocok.
 *
 * Kunci keamanannya: identifier yang TIDAK DISEBUTKAN pada webhook (null) bukan
 * berarti "berubah". Tanpa aturan ini, satu webhook parsial akan menghapus
 * snapshot tax yang sudah benar.
 */
export function shouldRecalculateTax(params: {
  incomingPaymentIdentifier: string | null
  storedPaymentIdentifier: string | null
  incomingGrossAmount: number
  storedGrossAmount: number
  storedTaxMappingStatus: TaxMappingStatus
  hasMatchingRuleNow: boolean
}): boolean {
  const identifierChanged =
    params.incomingPaymentIdentifier !== null &&
    params.incomingPaymentIdentifier !== params.storedPaymentIdentifier

  const grossChanged = roundMoney(params.incomingGrossAmount) !== roundMoney(params.storedGrossAmount)

  const becameMappable = params.storedTaxMappingStatus === 'unmapped' && params.hasMatchingRuleNow

  return identifierChanged || grossChanged || becameMappable
}

/**
 * Rincian potongan per order (A15, migrasi 0031) — cermin `upsert_order_webhook`.
 *
 *   e-payment fee     = calcTaxAmount (flat Rp atau % dari gross)
 *   e-payment fee tax = flat Rp atau % dari e-payment fee (mis. PPN 1% untuk VA)
 *   platform fee      = PLATFORM FEE % x gross, hanya order Paid dan rule yang dicentang
 *   net               = gross - ketiganya
 */
export type FeeBreakdownRule = Pick<MatchedFeeRule, 'fee_type' | 'fee_value' | 'fee_flat_value'> & {
  platform_fee_applies: boolean
  epayment_tax_type: FeeType | null
  epayment_tax_value: number | null
}

export type FeeBreakdown = {
  epayment_fee: number
  epayment_fee_tax: number
  platform_fee: number
  net_amount: number
}

export function calculateFees(
  grossAmount: number,
  rule: FeeBreakdownRule | null,
  options: { platformFeePercent: number; isPaid: boolean },
): FeeBreakdown {
  const gross = roundMoney(grossAmount)
  if (rule === null) return { epayment_fee: 0, epayment_fee_tax: 0, platform_fee: 0, net_amount: gross }

  const epaymentFee = calcTaxAmount(gross, rule)
  const epaymentFeeTax =
    rule.epayment_tax_type === null || rule.epayment_tax_value === null
      ? 0
      : roundMoney(rule.epayment_tax_type === 'flat'
        ? rule.epayment_tax_value
        : epaymentFee * (rule.epayment_tax_value / PERCENTAGE_DIVISOR))
  const platformFee = rule.platform_fee_applies && options.isPaid
    ? roundMoney(gross * (options.platformFeePercent / PERCENTAGE_DIVISOR))
    : 0

  return {
    epayment_fee: epaymentFee,
    epayment_fee_tax: epaymentFeeTax,
    platform_fee: platformFee,
    net_amount: roundMoney(gross - epaymentFee - epaymentFeeTax - platformFee),
  }
}
