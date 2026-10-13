import { describe, expect, it } from 'vitest'
import { adaptOrderOnlineWebhook, toIsoTimestamp } from '../src/webhooks/adapter'
import { coFormOrder, storefrontOrder } from './fixtures/orderonline'

function expectOk(outcome: ReturnType<typeof adaptOrderOnlineWebhook>) {
  if (!outcome.ok) throw new Error(`adapter menolak: ${outcome.reason}`)
  return outcome
}

function expectFailure(outcome: ReturnType<typeof adaptOrderOnlineWebhook>) {
  if (outcome.ok) throw new Error('adapter seharusnya menolak')
  return outcome
}

describe('adapter: envelope CO Form', () => {
  it('memetakan key yang teramati menjadi objek kanonik', () => {
    const adapted = expectOk(adaptOrderOnlineWebhook(coFormOrder()))

    expect(adapted.shape).toBe('co_form')
    expect(adapted.value).toEqual({
      orderId: '281343516',
      customerName: 'Budi Pengunjung',
      phone: '+628080080808',
      email: 'budi.pengunjung@example.com',
      // product_raw = nama produk di OrderOnline (keputusan pengguna 2026-10-13)
      productRaw: 'Test',
      rawStatus: 'pending',
      paymentMethod: 'bank_transfer',
      paymentProvider: null,
      paymentIdentifier: 'bank_transfer',
      grossAmount: 22000,
      sourceCreatedAt: '2026-09-15T02:31:33Z',
      sourceUpdatedAt: '2026-09-15T02:31:33Z',
    })
  })

  it('TIDAK membaca payment.status sebagai status order (PRD §52)', () => {
    const unpaid = expectOk(adaptOrderOnlineWebhook(coFormOrder()))
    expect(unpaid.value.rawStatus).toBe('pending')

    // Walaupun payment.status berubah, rawStatus tetap dari `status` order.
    const paidPayment = expectOk(
      adaptOrderOnlineWebhook(coFormOrder({ payment: { method: 'qris', status: 'paid' }, status: 'processing' })),
    )
    expect(paidPayment.value.rawStatus).toBe('processing')
    expect(paidPayment.value.paymentIdentifier).toBe('qris')
  })

  it('menolak envelope dengan type yang bukan "order"', () => {
    const failure = expectFailure(adaptOrderOnlineWebhook(coFormOrder({}, { type: 'customer' })))
    expect(failure.reason).toBe('UNSUPPORTED_TYPE')
    expect(failure.detail).toBe('customer')
  })

  it('order_id boleh angka maupun teks', () => {
    expect(expectOk(adaptOrderOnlineWebhook(coFormOrder({ order_id: '281343516' }))).value.orderId).toBe('281343516')
    expect(expectOk(adaptOrderOnlineWebhook(coFormOrder({ order_id: 281343516 }))).value.orderId).toBe('281343516')
  })

  it('field yang hilang menjadi null, BUKAN dicari "yang mirip"', () => {
    const adapted = expectOk(
      adaptOrderOnlineWebhook(coFormOrder({ customer_data: {}, payment: {}, updated_at: undefined })),
    )
    expect(adapted.value.customerName).toBeNull()
    expect(adapted.value.phone).toBeNull()
    expect(adapted.value.email).toBeNull()
    expect(adapted.value.paymentMethod).toBeNull()
    expect(adapted.value.paymentIdentifier).toBeNull()
    // updated_at hilang -> jatuh ke created_at, bukan null
    expect(adapted.value.sourceUpdatedAt).toBe('2026-09-15T02:31:33Z')
  })
})

describe('adapter: dokumen storefront', () => {
  it('mengenali bentuk tanpa envelope dan memakai label provider sebagai identifier', () => {
    const adapted = expectOk(adaptOrderOnlineWebhook(storefrontOrder()))

    expect(adapted.shape).toBe('storefront')
    expect(adapted.value.orderId).toBe('283033796')
    expect(adapted.value.grossAmount).toBe(384942)
    expect(adapted.value.paymentMethod).toBe('bank_transfer')
    expect(adapted.value.paymentProvider).toBe('BCA')
    expect(adapted.value.paymentIdentifier).toBe('BCA')
    expect(adapted.value.sourceCreatedAt).toBe('2026-10-06T09:18:47.000Z')
  })

  it('product_raw DIBIARKAN null karena order memuat banyak produk (VA-1 butir 4)', () => {
    const adapted = expectOk(adaptOrderOnlineWebhook(storefrontOrder()))

    expect(adapted.value.productRaw).toBeNull()
    expect(adapted.warnings).toContain('storefront_product_raw_undetermined')
  })
})

describe('adapter: penolakan payload', () => {
  it('body bukan objek ditolak', () => {
    for (const body of [null, 'teks', 42, []]) {
      expect(expectFailure(adaptOrderOnlineWebhook(body)).reason).toBe('NOT_AN_OBJECT')
    }
  })

  it('order_id hilang / tidak masuk akal ditolak', () => {
    for (const orderId of [undefined, null, '', '   ', '12 34', -1, 1.5]) {
      expect(expectFailure(adaptOrderOnlineWebhook(coFormOrder({ order_id: orderId }))).reason).toBe('MISSING_ORDER_ID')
    }
  })

  it('status order hilang ditolak', () => {
    expect(expectFailure(adaptOrderOnlineWebhook(coFormOrder({ status: undefined }))).reason).toBe('MISSING_STATUS')
  })

  it('total_price hilang atau bukan angka ditolak', () => {
    for (const total of [undefined, null, 'abc', -5]) {
      expect(expectFailure(adaptOrderOnlineWebhook(coFormOrder({ total_price: total }))).reason).toBe(
        'MISSING_GROSS_AMOUNT',
      )
    }
  })

  it('total_price berupa teks angka diterima', () => {
    expect(expectOk(adaptOrderOnlineWebhook(coFormOrder({ total_price: '22000' }))).value.grossAmount).toBe(22000)
  })

  it('gross 0 diterima tetapi ditandai peringatan', () => {
    const adapted = expectOk(adaptOrderOnlineWebhook(coFormOrder({ total_price: 0 })))
    expect(adapted.value.grossAmount).toBe(0)
    expect(adapted.warnings).toContain('gross_amount_zero')
  })
})

describe('adapter: normalisasi timestamp', () => {
  it('"YYYY-MM-DD HH:mm:ss" diperlakukan UTC (keputusan VA-1)', () => {
    expect(toIsoTimestamp('2026-09-15 02:31:33')).toBe('2026-09-15T02:31:33Z')
  })

  it('Extended JSON `$date` dipakai apa adanya', () => {
    expect(toIsoTimestamp({ $date: '2026-10-06T09:18:47.000Z' })).toBe('2026-10-06T09:18:47.000Z')
  })

  it('ISO-8601 dengan offset dipertahankan', () => {
    expect(toIsoTimestamp('2026-10-06T09:18:47+07:00')).toBe('2026-10-06T09:18:47+07:00')
  })

  it('nilai yang tidak dapat dipastikan menjadi null, bukan ditebak', () => {
    for (const value of [null, undefined, '', '   ', 'kemarin', '15/09/2026', 42, {}, { $date: 5 }, []]) {
      expect(toIsoTimestamp(value)).toBeNull()
    }
  })
})
