import { describe, expect, it } from 'vitest'
import {
  renderFollowUpTemplate,
  toWhatsAppNumber,
  validateFollowUpTemplate,
  whatsAppSendUrl,
} from '../src/domain/follow-up'

describe('Follow Up Manual: nomor WhatsApp (A76)', () => {
  it('menerima format Indonesia yang lazim', () => {
    expect(toWhatsAppNumber('0812-3456-7890')).toBe('6281234567890')
    expect(toWhatsAppNumber('0812 3456 7890')).toBe('6281234567890')
    expect(toWhatsAppNumber('81234567890')).toBe('6281234567890')
    expect(toWhatsAppNumber('+62 812-3456-7890')).toBe('6281234567890')
    expect(toWhatsAppNumber('6281234567890')).toBe('6281234567890')
    expect(toWhatsAppNumber('0062 812 3456 7890')).toBe('6281234567890')
  })

  it('menolak nomor yang tidak wajar atau bukan Indonesia', () => {
    expect(toWhatsAppNumber(null)).toBeNull()
    expect(toWhatsAppNumber('')).toBeNull()
    expect(toWhatsAppNumber('abc')).toBeNull()
    expect(toWhatsAppNumber('0812')).toBeNull()
    expect(toWhatsAppNumber('+1 415 555 0100')).toBeNull()
    expect(toWhatsAppNumber('12345678901234567890')).toBeNull()
  })
})

describe('Follow Up Manual: template (A76)', () => {
  it('hanya menerima placeholder yang dikenal', () => {
    const ok = validateFollowUpTemplate('Halo {nama}, acara {produk} batch {batch}. {link}')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.placeholders).toEqual(expect.arrayContaining(['nama', 'produk', 'batch', 'link']))

    const unknown = validateFollowUpTemplate('Halo {nama} {lead}')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.unknown).toEqual(['lead'])
  })

  it('menolak teks kosong, terlalu panjang, dan kurung kurawal rusak', () => {
    expect(validateFollowUpTemplate('   ').ok).toBe(false)
    expect(validateFollowUpTemplate('x'.repeat(2001)).ok).toBe(false)
    expect(validateFollowUpTemplate('Halo {nama').ok).toBe(false)
    expect(validateFollowUpTemplate('Halo {{nama}}').ok).toBe(false)
  })

  it('merender nilai dan mengosongkan placeholder yang tidak ada nilainya', () => {
    const text = renderFollowUpTemplate('Halo {nama}, {jenis} di {kota}. Link: {link}', {
      nama: 'Budi',
      jenis: 'Workshop',
      kota: 'Solo',
      // OTS: link sengaja kosong
      link: null,
    })

    expect(text).toBe('Halo Budi, Workshop di Solo. Link: ')
  })

  it('URL memakai api.whatsapp.com, bukan wa.me', () => {
    const url = whatsAppSendUrl('6281234567890', 'Halo Budi & rekan')
    expect(url.startsWith('https://api.whatsapp.com/send?phone=6281234567890&text=')).toBe(true)
    expect(url).toContain(encodeURIComponent('Halo Budi & rekan'))
    expect(url.includes('wa.me')).toBe(false)
  })
})
