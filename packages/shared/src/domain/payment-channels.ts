/**
 * Metode bayar OrderOnline (informasi provider 15 Okt 2026, AMENDMENTS VA-1/A16).
 *
 * Bank transfer: `payment.method = "bank_transfer"`.
 * E-payment: `payment.method = "instant"` dan kode channel di `payment.channels`.
 * Kode-kode ini adalah identifier yang dicocokkan persis dengan rule Konfigurasi Tax.
 */
export const BANK_TRANSFER_METHOD = 'bank_transfer'
export const INSTANT_METHOD = 'instant'

export const ORDERONLINE_PAYMENT_CHANNELS = [
  { code: 'bca_va', label: 'VA BCA' },
  { code: 'bri_va', label: 'VA BRI' },
  { code: 'bni_va', label: 'VA BNI' },
  { code: 'bsi_va', label: 'VA BSI' },
  { code: 'permata_va', label: 'VA Permata' },
  { code: 'echannel', label: 'VA Mandiri' },
  { code: 'gopay', label: 'GoPay' },
  { code: 'ovo', label: 'OVO' },
  { code: 'dana', label: 'DANA' },
  { code: 'shopeepay', label: 'ShopeePay' },
  { code: 'alfamart', label: 'Alfamart' },
  { code: 'credit_card', label: 'Kartu Kredit' },
] as const

/** Semua identifier yang dikenal, termasuk bank transfer dan cadangan `instant` (channel tidak terbaca). */
export const KNOWN_PAYMENT_IDENTIFIERS = [
  { code: BANK_TRANSFER_METHOD, label: 'Bank Transfer' },
  ...ORDERONLINE_PAYMENT_CHANNELS,
  { code: INSTANT_METHOD, label: 'E-payment (channel tidak terbaca)' },
] as const

const CHANNEL_CODES: ReadonlySet<string> = new Set(ORDERONLINE_PAYMENT_CHANNELS.map((c) => c.code))

export function isKnownPaymentChannel(value: string): boolean {
  return CHANNEL_CODES.has(value.trim().toLowerCase())
}
