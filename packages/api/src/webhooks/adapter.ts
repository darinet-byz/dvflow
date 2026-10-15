import { INSTANT_METHOD, isKnownPaymentChannel, type CanonicalOrderWebhook } from '@dvflow/shared'

/**
 * Batas adapter OrderOnline — SATU-SATUNYA berkas yang boleh menyentuh nama key
 * provider (03 §2, 06 §13).
 *
 * Aturan yang dijaga di sini:
 *   * hanya key yang SUDAH TERAMATI pada sample nyata yang dibaca
 *     (`docs/Reference-Webhook-*`, ringkasannya di `docs/AMENDMENTS.md` VA-1);
 *   * tidak ada satu pun key yang ditebak — bila sebuah nilai tidak ada, ia
 *     menjadi `null`, bukan dicari "yang mirip";
 *   * business logic di luar berkas ini hanya melihat objek kanonik.
 *
 * `app_status` TIDAK diputuskan di sini: ia diturunkan dari `status` ORDER
 * (`pending`/`processing`/`complete`/`cancelled`) oleh `packages/shared`
 * (PRD §52, `Paid = processing OR complete`). `payment.status` (mis. "unpaid")
 * TIDAK dipakai untuk apa pun dan tidak disimpan.
 */

export type AdapterShape = 'co_form' | 'storefront'

export type AdapterFailureReason =
  | 'NOT_AN_OBJECT'
  | 'UNSUPPORTED_TYPE'
  | 'MISSING_ORDER_ID'
  | 'MISSING_STATUS'
  | 'MISSING_GROSS_AMOUNT'

export type AdapterOutcome =
  | { ok: true; value: CanonicalOrderWebhook; shape: AdapterShape; warnings: string[]; paymentChannels: string[] }
  | { ok: false; reason: AdapterFailureReason; detail: string | null }

export function adaptOrderOnlineWebhook(body: unknown): AdapterOutcome {
  if (!isPlainObject(body)) return fail('NOT_AN_OBJECT', null)

  // CO Form mengirim envelope `{ type, action, payload }`; storefront mengirim
  // dokumen order langsung. Bentuk lain ditolak, bukan ditebak.
  const isEnvelope = isPlainObject(body['payload'])
  const shape: AdapterShape = isEnvelope ? 'co_form' : 'storefront'

  if (isEnvelope) {
    const type = body['type']
    if (typeof type === 'string' && type !== 'order') return fail('UNSUPPORTED_TYPE', type)
  }

  const order = isEnvelope ? (body['payload'] as Record<string, unknown>) : body
  const warnings: string[] = []

  const orderId = readOrderId(order['order_id'])
  if (orderId === null) return fail('MISSING_ORDER_ID', null)

  const rawStatus = readText(order['status'])
  if (rawStatus === null) return fail('MISSING_STATUS', null)

  const grossAmount = readAmount(order['total_price'])
  if (grossAmount === null) return fail('MISSING_GROSS_AMOUNT', null)

  const customer = isPlainObject(order['customer_data']) ? (order['customer_data'] as Record<string, unknown>) : {}
  const payment = isPlainObject(order['payment']) ? (order['payment'] as Record<string, unknown>) : {}

  const paymentMethod = readText(payment['method'])
  const paymentProvider = readProviderLabel(payment)
  // E-payment: method "instant", kode channel di payment.channels (info provider, VA-1/A16).
  const paymentChannels = readChannelCodes(payment['channels'])
  const instantChannel = paymentMethod?.toLowerCase() === INSTANT_METHOD ? singleKnownChannel(paymentChannels) : null
  if (paymentMethod?.toLowerCase() === INSTANT_METHOD && instantChannel === null) {
    // Kosong, lebih dari satu, atau kode di luar daftar provider: jangan menebak.
    warnings.push('payment_channel_undetermined')
  }

  // product_raw = nama produk di OrderOnline (keputusan pengguna 2026-10-13).
  //
  // CO Form: satu order satu produk, jadi `product_data.name` langsung menjadi
  // product_raw. Storefront: satu order dapat memuat BANYAK produk
  // (`products[]`), sedangkan Master Order hanya punya satu `product_raw` —
  // perilaku untuk kasus itu belum ditentukan (VA-1 butir 4), jadi product_raw
  // dibiarkan NULL. Order tetap tersimpan, parse menjadi `invalid`, dan akses
  // acara ditolak: itu perilaku yang sudah dikontrak untuk produk tak terbaca
  // (01 §9), bukan tebakan.
  const productData = isPlainObject(order['product_data']) ? (order['product_data'] as Record<string, unknown>) : {}
  const productRaw = readText(productData['name'])
  if (productRaw === null && shape === 'storefront') {
    warnings.push('storefront_product_raw_undetermined')
  }

  const createdAt = readText(order['created_at'])
  const updatedAt = readText(order['updated_at'])
  if (grossAmount === 0) warnings.push('gross_amount_zero')

  return {
    ok: true,
    shape,
    warnings,
    paymentChannels,
    value: {
      orderId,
      customerName: readText(customer['name']),
      phone: readText(customer['phone']),
      email: readText(customer['email']),
      productRaw,
      rawStatus,
      paymentMethod,
      paymentProvider,
      // Lihat VA-1: label provider lebih spesifik daripada `method`; keduanya
      // key yang teramati, dan urutannya didokumentasikan (bukan tebakan).
      paymentIdentifier: instantChannel ?? paymentProvider ?? paymentMethod,
      grossAmount,
      sourceCreatedAt: toIsoTimestamp(order['created_at']),
      sourceUpdatedAt: toIsoTimestamp(updatedAt ?? createdAt),
    },
  }
}

/** Hanya string pendek; objek/angka dibuang. Dicatat ke webhook_logs untuk memastikan bentuk aslinya. */
function readChannelCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '' && item.length <= 64)
    .map((item) => item.trim().toLowerCase())
}

function singleKnownChannel(codes: string[]): string | null {
  const known = [...new Set(codes.filter(isKnownPaymentChannel))]
  return known.length === 1 ? known[0]! : null
}

function fail(reason: AdapterFailureReason, detail: string | null): AdapterOutcome {
  return { ok: false, reason, detail }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  // Beberapa field (mis. `order_id`) dikirim sebagai angka.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function readOrderId(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null
    return String(value)
  }
  const text = readText(value)
  if (text === null) return null
  // `validateCanonicalOrderWebhook` menolak spasi pada Order ID; menolaknya di
  // sini membuat kegagalan tercatat sebagai INVALID_PAYLOAD, bukan 500.
  return /\s/.test(text) ? null : text
}

function readAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return null
}

/** `payment.providers` hanya muncul pada bentuk storefront (VA-1). */
function readProviderLabel(payment: Record<string, unknown>): string | null {
  const providers = payment['providers']
  if (!isPlainObject(providers)) return null
  return readText(providers['label']) ?? readText(providers['name'])
}

/**
 * Normalisasi timestamp sumber ke ISO-8601.
 *
 * Teramati dua format: `"2026-09-15 02:31:33"` (CO Form) dan Extended JSON
 * `{ "$date": "2026-10-06T09:18:47.000Z" }` (storefront).
 *
 * String tanpa keterangan zona diperlakukan sebagai **UTC**. Keputusan ini
 * dicatat di VA-1 karena blok waktunya belum terverifikasi, dan dampaknya kecil:
 * kolom `source_*_at` tidak dipakai untuk filter, sort, maupun perhitungan apa
 * pun — `orders.created_at` (waktu terima lokal) yang memegang peran itu (02 §9).
 * Nilai yang tidak dapat dipastikan menjadi `null`, bukan ditebak.
 */
export function toIsoTimestamp(value: unknown): string | null {
  if (isPlainObject(value)) {
    const extended = value['$date']
    return typeof extended === 'string' ? normalizeIso(extended) : null
  }
  if (typeof value !== 'string') return null
  return normalizeIso(value)
}

function normalizeIso(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  // Sudah ISO-8601 dengan zona eksplisit.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) return trimmed

  // "YYYY-MM-DD HH:mm:ss" tanpa zona -> diperlakukan UTC (lihat komentar di atas).
  const naive = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed)
  if (naive === null) return null

  const [, year, month, day, hour, minute, second] = naive
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}
