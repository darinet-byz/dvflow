import { describe, expect, it } from 'vitest'
import { normalizeMasterCode, SESSION_CODES } from '../src/domain/config-code'
import { validateProductNameInput } from '../src/domain/product-name'

describe('master code standards', () => {
  it('enforces strict codes for the generator while retaining historical parsing inputs', () => {
    const input = { productCode: 'KM', advertiserCode: '01', typeCode: 'SO', sessionCode: 'S1', batch: '392', city: 'Solo' }
    expect(validateProductNameInput(input).ok).toBe(true)
    expect(validateProductNameInput(input, { strictCodes: true }).ok).toBe(false)
    expect(validateProductNameInput({ ...input, productCode: ' kuli ' }, { strictCodes: true })).toEqual({ ok: true, value: 'KULI01SO392 - S1 - Solo' })
  })
  it('normalizes capitals and preserves leading zeroes', () => {
    expect(normalizeMasterCode('products', ' kuli ')).toBe('KULI')
    expect(normalizeMasterCode('advertisers', '01')).toBe('01')
    expect(normalizeMasterCode('event-types', 'wo')).toBe('WO')
    for (const code of SESSION_CODES) expect(normalizeMasterCode('sessions', code)).toBe(code)
  })
  it('rejects bad lengths, characters and noncanonical sessions', () => {
    for (const code of ['', 'KM', 'ABCDE', 'AB01', 'A BC', 'A-BC']) expect(normalizeMasterCode('products', code)).toBeNull()
    for (const code of ['1', '001', 'A1']) expect(normalizeMasterCode('advertisers', code)).toBeNull()
    for (const code of ['S', 'S01', 'S1']) expect(normalizeMasterCode('event-types', code)).toBeNull()
    for (const code of ['S0', 'S9', 'SS', 'S01']) expect(normalizeMasterCode('sessions', code)).toBeNull()
  })
})
