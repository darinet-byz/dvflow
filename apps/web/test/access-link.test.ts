import { describe, expect, it } from 'vitest'
import { participantAccessPath, participantAccessUrl, participantLinkTemplate } from '../src/lib/access-link'

/** A27: link peserta memakai kode toko sebagai segmen sendiri (Fitur 2.0 dok 07). */
describe('link akses peserta', () => {
  it('order berkode toko -> /access/KODE/nomor', () => {
    expect(participantAccessPath('MTIX-283818331')).toBe('/access/MTIX/283818331')
    expect(participantAccessUrl('MTIX-283818331', 'https://dvflow.pages.dev')).toBe('https://dvflow.pages.dev/access/MTIX/283818331')
  })

  it('order lama tanpa kode toko tetap /access/<order_id>', () => {
    expect(participantAccessPath('283033796')).toBe('/access/283033796')
  })

  it('template OrderOnline per toko', () => {
    expect(participantLinkTemplate('MTIX', 'https://dvflow.pages.dev')).toBe('https://dvflow.pages.dev/access/MTIX/{{order_id}}')
  })
})
