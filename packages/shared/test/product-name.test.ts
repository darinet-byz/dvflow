import { describe, expect, it } from 'vitest'
import {
  buildProductName,
  InvalidProductNameError,
  PRODUCT_SEGMENT_SEPARATOR,
  validateProductNameInput,
} from '../src/domain/product-name'
import { parseProductRaw } from '../src/domain/product-parser'
import { TEST_CONFIG } from './fixtures'

const VALID_INPUT = {
  productCode: 'KM',
  advertiserCode: '01',
  typeCode: 'SO',
  batch: '392',
  sessionCode: 'S1',
  city: 'Solo',
} as const

describe('Product Name Generator (PRD §54, §72)', () => {
  it('D01 menghasilkan persis KM01SO392 - S1 - Solo', () => {
    expect(buildProductName(VALID_INPUT)).toBe('KM01SO392 - S1 - Solo')
  })

  it('D05 batch 001 tidak kehilangan leading zero', () => {
    expect(buildProductName({ ...VALID_INPUT, batch: '001' })).toBe('KM01SO001 - S1 - Solo')
    expect(buildProductName({ ...VALID_INPUT, batch: '000392' })).toBe('KM01SO000392 - S1 - Solo')
  })

  it('batch non-string ditolak, tidak diam-diam dikonversi menjadi angka', () => {
    expect(() => buildProductName({ ...VALID_INPUT, batch: 1 as unknown as string })).toThrow(
      InvalidProductNameError,
    )
  })

  it('D04 spasi di kota dan batch di-trim', () => {
    expect(buildProductName({ ...VALID_INPUT, city: '  Solo  ' })).toBe('KM01SO392 - S1 - Solo')
    expect(buildProductName({ ...VALID_INPUT, batch: '  392  ' })).toBe('KM01SO392 - S1 - Solo')
  })

  it('D03 input wajib yang kosong tidak menghasilkan kode, hanya error per field', () => {
    const result = validateProductNameInput({ ...VALID_INPUT, city: '   ', productCode: '' })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('seharusnya gagal')
    expect(result.errors.city).toBeDefined()
    expect(result.errors.productCode).toBeDefined()
    expect(result.errors.advertiserCode).toBeUndefined()
  })

  it('D03 buildProductName melempar bila input tidak valid', () => {
    expect(() => buildProductName({ ...VALID_INPUT, sessionCode: '' })).toThrow(InvalidProductNameError)
  })

  it('kode hanya boleh huruf dan angka, tanpa spasi atau tanda hubung', () => {
    expect(validateProductNameInput({ ...VALID_INPUT, productCode: 'K M' }).ok).toBe(false)
    expect(validateProductNameInput({ ...VALID_INPUT, advertiserCode: '01-02' }).ok).toBe(false)
    expect(validateProductNameInput({ ...VALID_INPUT, typeCode: 'S O' }).ok).toBe(false)
  })

  it('batch dan kota dilarang memuat pemisah, supaya hasilnya selalu bisa diparse', () => {
    expect(validateProductNameInput({ ...VALID_INPUT, batch: '39 - 2' }).ok).toBe(false)
    expect(validateProductNameInput({ ...VALID_INPUT, city: 'Solo - Baru' }).ok).toBe(false)
  })

  it('D06 nilai yang dihasilkan adalah nilai yang disalin apa adanya', () => {
    const result = validateProductNameInput(VALID_INPUT)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value).toBe('KM01SO392 - S1 - Solo')
    expect(result.value.split(PRODUCT_SEGMENT_SEPARATOR)).toHaveLength(3)
  })

  it('round-trip: setiap nama yang dihasilkan selalu dapat diparse kembali', () => {
    const cases = [
      { ...VALID_INPUT },
      { ...VALID_INPUT, batch: '001' },
      { ...VALID_INPUT, sessionCode: 'ST', city: 'Online', typeCode: 'WO' },
      { ...VALID_INPUT, batch: 'batch 1', city: 'Kota Bandung' },
      { ...VALID_INPUT, productCode: 'WA', advertiserCode: '03', typeCode: 'WO', city: 'Jakarta' },
    ]

    for (const input of cases) {
      const generated = buildProductName(input)
      const parsed = parseProductRaw(generated, TEST_CONFIG)

      expect(parsed.product_parse_status, `gagal parse: ${generated}`).toBe('valid')
      if (parsed.product_parse_status !== 'valid') continue

      expect(parsed.batch).toBe(input.batch.trim())
      expect(parsed.session).toBe(input.sessionCode)
      expect(parsed.city).toBe(input.city.trim())
      expect(parsed.product_code).toBe(input.productCode)
      expect(parsed.advertiser_code).toBe(input.advertiserCode)
    }
  })
})
