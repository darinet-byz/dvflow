import { describe, expect, it } from 'vitest'
import {
  findAmbiguousCodeCombinations,
  listCodeCombinations,
  parseProductRaw,
  type ParsedProductInvalid,
  type ParsedProductValid,
  type ProductParseFailureReason,
  type ProductParseResult,
} from '../src/domain/product-parser'
import type { ProductConfigSet } from '../src/types'
import { AMBIGUOUS_CONFIG, TEST_CONFIG } from './fixtures'

function expectValid(result: ProductParseResult): ParsedProductValid {
  expect(result.product_parse_status).toBe('valid')
  if (result.product_parse_status !== 'valid') throw new Error('hasil parser seharusnya valid')
  return result
}

function expectInvalid(result: ProductParseResult, reason: ProductParseFailureReason): ParsedProductInvalid {
  expect(result.product_parse_status).toBe('invalid')
  if (result.product_parse_status !== 'invalid') throw new Error('hasil parser seharusnya invalid')
  expect(result.failure_reason).toBe(reason)
  return result
}

describe('parser product_raw (PRD §67, 01 §10)', () => {
  it('C11 contoh kanonik KM01SO392 - S1 - Solo menghasilkan field sesuai konfigurasi', () => {
    const parsed = expectValid(parseProductRaw('KM01SO392 - S1 - Solo', TEST_CONFIG))

    expect(parsed.product_code).toBe('KM')
    expect(parsed.product_name).toBe('Kuliner Masteri')
    expect(parsed.advertiser_code).toBe('01')
    expect(parsed.advertiser_name).toBe('Zul')
    expect(parsed.event_type).toBe('Seminar Offline')
    expect(parsed.event_kind).toBe('seminar')
    expect(parsed.batch).toBe('392')
    expect(parsed.session).toBe('S1')
    expect(parsed.city).toBe('Solo')
  })

  it('C11 webinar memakai sesi tunggal dan kota Online', () => {
    const parsed = expectValid(parseProductRaw('KM01WO392 - ST - Online', TEST_CONFIG))

    expect(parsed.event_type).toBe('Webinar Online')
    expect(parsed.event_kind).toBe('webinar')
    expect(parsed.session).toBe('ST')
    expect(parsed.city).toBe('Online')
  })

  it('C11 leading zero pada batch dipertahankan sebagai string', () => {
    const parsed = expectValid(parseProductRaw('KM01SO001 - S1 - Solo', TEST_CONFIG))

    expect(parsed.batch).toBe('001')
    expect(typeof parsed.batch).toBe('string')
  })

  it('D04/C41 spasi di tepi segmen dan di tepi keseluruhan di-trim', () => {
    const parsed = expectValid(parseProductRaw('  KM01SO392 - S1 -   Solo  ', TEST_CONFIG))

    expect(parsed.batch).toBe('392')
    expect(parsed.session).toBe('S1')
    expect(parsed.city).toBe('Solo')
  })

  it('city disimpan sebagai display string apa adanya setelah trim', () => {
    const parsed = expectValid(parseProductRaw('KM01SO392 - S1 - Kota Bandung', TEST_CONFIG))

    expect(parsed.city).toBe('Kota Bandung')
  })

  it('pencocokan kode tidak peka huruf besar/kecil, tetapi tersimpan sesuai konfigurasi', () => {
    const parsed = expectValid(parseProductRaw('km01so392 - s1 - solo', TEST_CONFIG))

    expect(parsed.product_code).toBe('KM')
    expect(parsed.product_name).toBe('Kuliner Masteri')
    expect(parsed.session).toBe('S1')
    expect(parsed.advertiser_code).toBe('01')
  })

  it('C10 product_raw tidak valid tetap menghasilkan status invalid tanpa field terisi', () => {
    const parsed = expectInvalid(parseProductRaw('produk tidak jelas', TEST_CONFIG), 'WRONG_SEGMENT_COUNT')

    expect(parsed.product_code).toBeNull()
    expect(parsed.product_name).toBeNull()
    expect(parsed.advertiser_code).toBeNull()
    expect(parsed.advertiser_name).toBeNull()
    expect(parsed.event_type).toBeNull()
    expect(parsed.event_kind).toBeNull()
    expect(parsed.batch).toBeNull()
    expect(parsed.session).toBeNull()
    expect(parsed.city).toBeNull()
  })

  it('product_raw kosong atau null dianggap invalid', () => {
    expectInvalid(parseProductRaw('', TEST_CONFIG), 'EMPTY_PRODUCT_RAW')
    expectInvalid(parseProductRaw('   ', TEST_CONFIG), 'EMPTY_PRODUCT_RAW')
    expectInvalid(parseProductRaw(null, TEST_CONFIG), 'EMPTY_PRODUCT_RAW')
    expectInvalid(parseProductRaw(undefined, TEST_CONFIG), 'EMPTY_PRODUCT_RAW')
  })

  it('jumlah segmen harus tepat tiga', () => {
    expectInvalid(parseProductRaw('KM01SO392 - S1', TEST_CONFIG), 'WRONG_SEGMENT_COUNT')
    expectInvalid(parseProductRaw('KM01SO392', TEST_CONFIG), 'WRONG_SEGMENT_COUNT')
    expectInvalid(parseProductRaw('KM01SO392 - S1 - Solo - Tambahan', TEST_CONFIG), 'WRONG_SEGMENT_COUNT')
  })

  it('segmen kosong ditolak', () => {
    expectInvalid(parseProductRaw('KM01SO392 - S1 - ', TEST_CONFIG), 'EMPTY_SEGMENT')
    expectInvalid(parseProductRaw('KM01SO392 -  - Solo', TEST_CONFIG), 'EMPTY_SEGMENT')
    expectInvalid(parseProductRaw(' - S1 - Solo', TEST_CONFIG), 'EMPTY_SEGMENT')
  })

  it('sesi yang tidak dikenal ditolak', () => {
    expectInvalid(parseProductRaw('KM01SO392 - S9 - Solo', TEST_CONFIG), 'UNKNOWN_SESSION')
  })

  it('kombinasi kode yang tidak dikenal ditolak', () => {
    expectInvalid(parseProductRaw('ZZ99SO392 - S1 - Solo', TEST_CONFIG), 'UNKNOWN_CODE_COMBINATION')
  })

  it('kombinasi kode yang dikenal tetapi tanpa batch ditolak (batch wajib non-kosong)', () => {
    expectInvalid(parseProductRaw('KM01SO - S1 - Solo', TEST_CONFIG), 'UNKNOWN_CODE_COMBINATION')
  })

  it('kombinasi ambigu ditolak, bukan dipilih salah satu', () => {
    const parsed = expectInvalid(
      parseProductRaw('KM01SO392 - S1 - Solo', AMBIGUOUS_CONFIG),
      'AMBIGUOUS_CODE_COMBINATION',
    )

    expect(parsed.candidates).toHaveLength(2)
    expect(parsed.candidates).toEqual(expect.arrayContaining(['KM+01+SO', 'KM0+1+SO']))
  })

  it('guard konfigurasi mendeteksi kombinasi kode yang saling menaungi', () => {
    expect(findAmbiguousCodeCombinations(TEST_CONFIG)).toEqual([])

    const conflicts = findAmbiguousCodeCombinations(AMBIGUOUS_CONFIG)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.prefix).toBe('KM01SO')
  })

  it('listCodeCombinations hanya mengembalikan kandidat yang benar-benar prefix', () => {
    expect(listCodeCombinations('KM01SO392', TEST_CONFIG)).toHaveLength(1)
    expect(listCodeCombinations('MT02WO7', TEST_CONFIG)).toHaveLength(1)
    expect(listCodeCombinations('XX01SO392', TEST_CONFIG)).toHaveLength(0)
  })

  it('batch boleh memuat spasi internal dan tetap dapat diparse', () => {
    const parsed = expectValid(parseProductRaw('KM01SObatch 1 - S1 - Solo', TEST_CONFIG))

    expect(parsed.batch).toBe('batch 1')
  })

  it('konfigurasi nonaktif tetap dipakai untuk order lama yang sudah ada', () => {
    const withInactiveProduct: ProductConfigSet = {
      ...TEST_CONFIG,
      products: TEST_CONFIG.products.map((product) =>
        product.code === 'KM' ? { ...product, active: false } : product,
      ),
    }

    const parsed = expectValid(parseProductRaw('KM01SO392 - S1 - Solo', withInactiveProduct))
    expect(parsed.product_code).toBe('KM')
  })
})
