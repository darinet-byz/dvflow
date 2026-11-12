import { describe, expect, it } from 'vitest'
import {
  formatWaDays,
  isWaEventType,
  listWaTemplatePlaceholders,
  renderWaTemplate,
  validateWaTemplate,
  waMention,
  WA_LOG_RETENTION_DAYS,
} from '../src'

describe('WA Admin Bot — template', () => {
  it('menerima placeholder yang didokumentasikan', () => {
    const result = validateWaTemplate(
      'Halo {{mention}}, laporan {{advertiser_name}} ({{advertiser_code}}) produk {{product_name}} {{product_code}} {{event_type}} tanggal {{date}} belum diisi. {{report_url}}',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.placeholders.sort()).toEqual([
        'advertiser_code',
        'advertiser_name',
        'date',
        'event_type',
        'mention',
        'product_code',
        'product_name',
        'report_url',
      ])
    }
  })

  it('tetap mengenali placeholder warisan', () => {
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

describe('WA Admin Bot — jenis acara & retensi', () => {
  it('hanya menerima tiga jenis acara kanonik', () => {
    expect(isWaEventType('Seminar Offline')).toBe(true)
    expect(isWaEventType('Webinar Online')).toBe(true)
    expect(isWaEventType('Hybrid')).toBe(true)
    expect(isWaEventType('Workshop')).toBe(false)
    expect(WA_LOG_RETENTION_DAYS).toBe(3)
  })
})

describe('WA Admin Bot — sapaan mention', () => {
  it('memakai nama pengiklan, bukan nomor', () => {
    expect(waMention('Zul')).toBe('@Zul')
    expect(waMention('Advertiser Satu')).toBe('@Advertiser Satu')
  })
})

describe('WA Admin Bot — label hari', () => {
  it('meringkas tujuh hari dan menyebut hari lain', () => {
    expect(formatWaDays([0, 1, 2, 3, 4, 5, 6])).toBe('Setiap hari')
    expect(formatWaDays([1, 3, 5])).toBe('Senin, Rabu, Jumat')
    expect(formatWaDays([0])).toBe('Minggu')
  })
})
