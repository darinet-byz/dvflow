import { describe, expect, it } from 'vitest'
import { parseProductRaw } from '../src/domain/product-parser'
import { normalizeBatch } from '../src/domain/text'
import type { ProductConfigSet } from '../src/types'

/**
 * A32: batch boleh berapa pun panjangnya. Awalan kode berlebar tetap (produk 4 huruf + pengiklan
 * 2 digit + tipe 2 huruf, dikunci MASTER_CODE_RULES), jadi seluruh sisa blok kode = batch.
 */
const CONFIG: ProductConfigSet = {
  products: [{ name: 'Kuliner Masteri', code: 'KULI', active: true }, { name: 'Master Tiktok', code: 'MTIX', active: true }],
  advertisers: [{ name: 'Zul', code: '01', active: true }, { name: 'Rina', code: '10', active: true }],
  eventTypes: [{ name: 'Seminar Offline', code: 'SO', kind: 'seminar', active: true }, { name: 'Webinar Online', code: 'WO', kind: 'webinar', active: true }],
  sessions: [{ name: 'Sesi 1', code: 'S1', active: true }, { name: 'Sesi Tunggal', code: 'ST', active: true }],
}

describe('batch berbagai panjang (A32)', () => {
  it.each([
    ['KULI01SO5 - S1 - Solo', '5'],
    ['KULI01SO58 - S1 - Solo', '58'],
    ['KULI01SO392 - S1 - Solo', '392'],
    ['KULI01SO1001 - S1 - Solo', '1001'],
    ['KULI01SO123456 - S1 - Solo', '123456'],
    // A33: nol di depan diabaikan, nol tengah/belakang tetap berarti.
    ['KULI01SO001 - S1 - Solo', '1'],
    ['KULI01SO058 - S1 - Solo', '58'],
    ['KULI01SO0058 - S1 - Solo', '58'],
    ['KULI01SO00058 - S1 - Solo', '58'],
    ['KULI01SO508 - S1 - Solo', '508'],
    ['KULI01SO580 - S1 - Solo', '580'],
    ['KULI01SO100 - S1 - Solo', '100'],
    ['KULI01SO101 - S1 - Solo', '101'],
    ['KULI01SO000 - S1 - Solo', '0'],
    ['KULI01SO058a - S1 - Solo', '58A'],
    ['KULI01SO58A - S1 - Solo', '58A'],
    ['KULI01SO58-S1-Solo', '58'],
    ['kuli01so58 - s1 - Solo', '58'],
    ['MTIX10WO7 - ST - Online', '7'],
  ])('%s -> batch %s', (raw, batch) => {
    const result = parseProductRaw(raw, CONFIG)
    expect(result.product_parse_status).toBe('valid')
    expect(result.batch).toBe(batch)
  })

  it('produk, pengiklan, tipe tetap benar walau batch panjang', () => {
    expect(parseProductRaw('KULI10SO123456 - S1 - Solo', CONFIG)).toMatchObject({
      product_code: 'KULI', advertiser_code: '10', event_type: 'Seminar Offline', batch: '123456', session: 'S1', city: 'Solo',
    })
  })

  it.each([
    ['KULI01SO058 - S1 - Solo', '01', '58'],
    ['KULI10SO0058 - S1 - Solo', '10', '58'],
    ['MTIX01SO508 - S1 - Solo', '01', '508'],
  ])('A33 pengaman: %s -> pengiklan %s tetap utuh, batch %s', (raw, advertiser, batch) => {
    expect(parseProductRaw(raw, CONFIG)).toMatchObject({ product_parse_status: 'valid', advertiser_code: advertiser, batch })
  })

  it('normalizeBatch hanya untuk batch', () => {
    expect(['058', '0058', '00058', '508', '580', '100', '101', '0', '000', ' 058a '].map(normalizeBatch))
      .toEqual(['58', '58', '58', '508', '580', '100', '101', '0', '0', '58A'])
  })

  it('batch kosong ditolak (tidak menebak)', () => {
    expect(parseProductRaw('KULI01SO - S1 - Solo', CONFIG).product_parse_status).toBe('invalid')
  })
})
