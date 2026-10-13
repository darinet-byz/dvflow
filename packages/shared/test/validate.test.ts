import { describe, expect, it } from 'vitest'
import {
  INVALID_PAYLOAD,
  validateCanonicalOrderWebhook,
  validateConfigCode,
  validatePasswordChangeInput,
} from '../src/domain/validate'

const VALID_PAYLOAD = {
  orderId: '283033796',
  customerName: 'Ahmad',
  phone: '081234567890',
  email: 'ahmad@example.com',
  productRaw: 'KM01SO392 - S1 - Solo',
  rawStatus: 'processing',
  paymentMethod: 'QRIS',
  paymentProvider: 'Midtrans',
  paymentIdentifier: 'QRIS',
  grossAmount: 300000,
  sourceCreatedAt: '2026-10-12T03:00:00.000Z',
  sourceUpdatedAt: null,
}

describe('validasi objek kanonik webhook (03-API-CONTRACT §3)', () => {
  it('payload lengkap diterima dan dinormalkan', () => {
    const result = validateCanonicalOrderWebhook(VALID_PAYLOAD)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value.orderId).toBe('283033796')
    expect(result.value.rawStatus).toBe('processing')
    expect(result.value.grossAmount).toBe(300000)
    expect(result.value.customerName).toBe('Ahmad')
    expect(result.value.sourceUpdatedAt).toBeNull()
  })

  it('payload minimal (hanya field wajib) diterima', () => {
    const result = validateCanonicalOrderWebhook({
      orderId: '283033796',
      rawStatus: 'pending',
      grossAmount: 0,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value.productRaw).toBeNull()
    expect(result.value.paymentIdentifier).toBeNull()
  })

  it('C08 tanpa Order ID ditolak', () => {
    const result = validateCanonicalOrderWebhook({ rawStatus: 'pending', grossAmount: 1000 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('seharusnya gagal')
    expect(result.code).toBe(INVALID_PAYLOAD)
    expect(result.message).toMatch(/Order ID/i)
  })

  it('C08 Order ID kosong atau hanya spasi ditolak', () => {
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, orderId: '' }).ok).toBe(false)
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, orderId: '   ' }).ok).toBe(false)
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, orderId: '283 033796' }).ok).toBe(false)
  })

  it('C08 tanpa status ditolak', () => {
    const result = validateCanonicalOrderWebhook({ orderId: '1', grossAmount: 1000 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('seharusnya gagal')
    expect(result.message).toMatch(/status/i)
  })

  it('C09 gross non-numerik atau NaN ditolak', () => {
    for (const grossAmount of [Number.NaN, Number.POSITIVE_INFINITY, 'abc', '300000', null, undefined]) {
      const result = validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, grossAmount })
      expect(result.ok, `gross: ${String(grossAmount)}`).toBe(false)
    }
  })

  it('C09 gross negatif ditolak', () => {
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, grossAmount: -1 }).ok).toBe(false)
  })

  it('gross dibulatkan ke 2 desimal', () => {
    const result = validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, grossAmount: 300000.005 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value.grossAmount).toBe(300000.01)
  })

  it('badan payload non-objek ditolak', () => {
    for (const input of [null, undefined, 'string', 42, [], true]) {
      expect(validateCanonicalOrderWebhook(input).ok, `input: ${String(input)}`).toBe(false)
    }
  })

  it('teks opsional yang kosong menjadi null, bukan string kosong', () => {
    const result = validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, customerName: '   ', email: '' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value.customerName).toBeNull()
    expect(result.value.email).toBeNull()
  })

  it('teks opsional yang terlalu panjang ditolak', () => {
    const result = validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, customerName: 'a'.repeat(201) })

    expect(result.ok).toBe(false)
  })

  it('tipe teks opsional yang salah ditolak', () => {
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, phone: 81234 }).ok).toBe(false)
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, productRaw: ['x'] }).ok).toBe(false)
  })

  it('XSS payload pada nama tetap berupa teks, tidak ditafsirkan', () => {
    const payload = '<script>alert(1)</script>'
    const result = validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, customerName: payload })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value.customerName).toBe(payload)
  })

  it('timestamp sumber harus ISO-8601', () => {
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, sourceCreatedAt: '12/10/2026 10:00' }).ok).toBe(
      false,
    )
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, sourceCreatedAt: '2026-10-12T10:00:00Z' }).ok).toBe(
      true,
    )
    expect(validateCanonicalOrderWebhook({ ...VALID_PAYLOAD, sourceUpdatedAt: '' }).ok).toBe(true)
  })
})

describe('validasi ganti password (01 §4)', () => {
  it('menerima input yang benar', () => {
    const result = validatePasswordChangeInput({
      current_password: 'lama12345',
      new_password: 'baru12345',
      new_password_confirmation: 'baru12345',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value.newPassword).toBe('baru12345')
  })

  it('password baru kurang dari 8 karakter ditolak', () => {
    const result = validatePasswordChangeInput({
      current_password: 'lama12345',
      new_password: 'pendek',
      new_password_confirmation: 'pendek',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('seharusnya gagal')
    expect(result.message).toMatch(/8/)
  })

  it('konfirmasi tidak sama ditolak', () => {
    const result = validatePasswordChangeInput({
      current_password: 'lama12345',
      new_password: 'baru12345',
      new_password_confirmation: 'baru12346',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('seharusnya gagal')
    expect(result.message).toMatch(/konfirmasi/i)
  })

  it('password saat ini wajib diisi', () => {
    expect(
      validatePasswordChangeInput({
        new_password: 'baru12345',
        new_password_confirmation: 'baru12345',
      }).ok,
    ).toBe(false)
  })

  it('password baru sama dengan password saat ini ditolak', () => {
    expect(
      validatePasswordChangeInput({
        current_password: 'sama12345',
        new_password: 'sama12345',
        new_password_confirmation: 'sama12345',
      }).ok,
    ).toBe(false)
  })

  it('password tetap case-sensitive dan tidak ditrim', () => {
    const result = validatePasswordChangeInput({
      current_password: 'Lama12345',
      new_password: 'Baru 12345',
      new_password_confirmation: 'Baru 12345',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value.newPassword).toBe('Baru 12345')
  })
})

describe('validasi kode konfigurasi', () => {
  it('menerima kode huruf/angka dan menormalkan tepi', () => {
    const result = validateConfigCode('  KM  ', 'Kode produk')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('seharusnya valid')
    expect(result.value).toBe('KM')
  })

  it('menolak kode kosong, berspasi, atau bertanda hubung', () => {
    expect(validateConfigCode('', 'Kode produk').ok).toBe(false)
    expect(validateConfigCode('   ', 'Kode produk').ok).toBe(false)
    expect(validateConfigCode('K M', 'Kode produk').ok).toBe(false)
    expect(validateConfigCode('K-M', 'Kode produk').ok).toBe(false)
    expect(validateConfigCode(null, 'Kode produk').ok).toBe(false)
  })
})
