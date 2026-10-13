import { describe, expect, it } from 'vitest'
import {
  buildCheckinPath,
  buildCheckinUrl,
  extractOrderIdFromQrPayload,
  isOrderIdShaped,
} from '../src/domain/checkin-qr'

const ORDER_ID = '283033796'

describe('payload QR check-in (PRD §94, 04 §11)', () => {
  it('G03 payload hanya berisi URL check-in, tanpa token atau data pribadi', () => {
    const path = buildCheckinPath(ORDER_ID)

    expect(path).toBe('/checkin/283033796')
    expect(path).not.toContain('?')
    expect(path).not.toContain('&')
    expect(path).not.toContain('=')
    expect(path).not.toContain('token')
  })

  it('G03 URL lengkap dibentuk dari origin dan Order ID', () => {
    expect(buildCheckinUrl('https://app.domain', ORDER_ID)).toBe('https://app.domain/checkin/283033796')
    expect(buildCheckinUrl('https://app.domain/', ORDER_ID)).toBe('https://app.domain/checkin/283033796')
  })

  it('menerima Order ID telanjang, path relatif, dan URL lengkap', () => {
    expect(extractOrderIdFromQrPayload(ORDER_ID)).toBe(ORDER_ID)
    expect(extractOrderIdFromQrPayload(`/checkin/${ORDER_ID}`)).toBe(ORDER_ID)
    expect(extractOrderIdFromQrPayload(`https://app.domain/checkin/${ORDER_ID}`)).toBe(ORDER_ID)
    expect(extractOrderIdFromQrPayload(`  https://app.domain/checkin/${ORDER_ID}  `)).toBe(ORDER_ID)
  })

  it('mengabaikan query string dan fragment pada URL', () => {
    expect(extractOrderIdFromQrPayload(`https://app.domain/checkin/${ORDER_ID}?utm=qr`)).toBe(ORDER_ID)
    expect(extractOrderIdFromQrPayload(`https://app.domain/checkin/${ORDER_ID}#top`)).toBe(ORDER_ID)
  })

  it('mengembalikan null untuk payload yang tidak dikenali', () => {
    for (const payload of [
      '',
      '   ',
      'https://evil.example.com/',
      'https://app.domain/access/283033796',
      '/checkin/',
      '/checkin/   ',
      '/checkin/a b',
      'nama peserta',
      '{"orderId":"283033796"}',
    ]) {
      expect(extractOrderIdFromQrPayload(payload), `payload: ${payload}`).toBeNull()
    }
  })

  it('hanya mengembalikan Order ID, tidak pernah URL atau potongan lain', () => {
    const extracted = extractOrderIdFromQrPayload(`https://app.domain/checkin/${ORDER_ID}/extra`)

    expect(extracted).toBe(ORDER_ID)
    expect(extracted).not.toContain('/')
    expect(extracted).not.toContain('http')
  })

  it('isOrderIdShaped menolak nilai kosong dan yang mengandung spasi', () => {
    expect(isOrderIdShaped(ORDER_ID)).toBe(true)
    expect(isOrderIdShaped('')).toBe(false)
    expect(isOrderIdShaped('a b')).toBe(false)
    expect(isOrderIdShaped('a/b')).toBe(false)
    expect(isOrderIdShaped('x'.repeat(65))).toBe(false)
  })
})
