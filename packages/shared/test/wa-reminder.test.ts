import { describe, expect, it } from 'vitest'
import {
  formatWaDays,
  listWaTemplatePlaceholders,
  normalizeWhatsAppPhone,
  renderWaTemplate,
  validateWaTemplate,
} from '../src'

describe('WA Admin Bot — template', () => {
  it('menerima placeholder yang didokumentasikan', () => {
    const result = validateWaTemplate(
      'Halo {{mention}}, laporan {{store_name}} produk {{product_name}} belum diisi. Leads {{leads}}, Paid {{paid}}. {{report_url}}',
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.placeholders.sort()).toEqual(['leads', 'mention', 'paid', 'product_name', 'report_url', 'store_name'])
  })

  it('menolak placeholder asing dan kurung kurawal rusak', () => {
    expect(validateWaTemplate('Halo {{lead}}').ok).toBe(false)
    expect(validateWaTemplate('Halo {{store_name').ok).toBe(false)
    expect(validateWaTemplate('   ').ok).toBe(false)
  })

  it('render mengganti semua nilai yang diberikan', () => {
    const text = renderWaTemplate('@{{mention}} {{store_name}} / {{product_name}}: {{leads}} leads, {{paid}} paid', {
      mention: '628123',
      store_name: 'Zul',
      product_name: 'Kuliner',
      leads: 12,
      paid: 3,
    })
    expect(text).toBe('@628123 Zul / Kuliner: 12 leads, 3 paid')
  })

  it('daftar placeholder tidak duplikat', () => {
    expect(listWaTemplatePlaceholders('{{leads}} {{leads}} {{paid}}')).toEqual(['leads', 'paid'])
  })
})

describe('WA Admin Bot — nomor PIC', () => {
  it('menormalisasi bentuk yang lazim ke 62', () => {
    expect(normalizeWhatsAppPhone('0812-3456-7890')).toBe('6281234567890')
    expect(normalizeWhatsAppPhone('81234567890')).toBe('6281234567890')
    expect(normalizeWhatsAppPhone('+62 812 3456 7890')).toBe('6281234567890')
    expect(normalizeWhatsAppPhone('6281234567890')).toBe('6281234567890')
  })

  it('menolak nomor yang tidak masuk akal', () => {
    expect(normalizeWhatsAppPhone('')).toBeNull()
    expect(normalizeWhatsAppPhone('12345')).toBeNull()
    expect(normalizeWhatsAppPhone('1234567890')).toBeNull()
  })
})

describe('WA Admin Bot — label hari', () => {
  it('meringkas tujuh hari dan menyebut hari lain', () => {
    expect(formatWaDays([0, 1, 2, 3, 4, 5, 6])).toBe('Setiap hari')
    expect(formatWaDays([1, 3, 5])).toBe('Senin, Rabu, Jumat')
    expect(formatWaDays([0])).toBe('Minggu')
  })
})
