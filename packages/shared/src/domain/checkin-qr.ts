/**
 * Payload QR check-in seminar (PRD §94, 04-RBAC-AUTH-AND-SECURITY §11).
 *
 * QR hanya membawa identitas order — tidak ada token, tidak ada data pribadi.
 * QR bukan otorisasi: server selalu memvalidasi ulang operator, keberadaan order,
 * status Paid, event Seminar Offline, dan status duplikat.
 *
 * QR dibuat client-side; Worker tidak pernah membuat gambar QR.
 */

export const CHECKIN_PATH_PREFIX = '/checkin/'

/** Order ID boleh berupa huruf/angka/tanda hubung; contoh nyata: 283033796. */
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function isOrderIdShaped(value: string): boolean {
  return ORDER_ID_PATTERN.test(value)
}

export function buildCheckinPath(orderId: string): string {
  return `${CHECKIN_PATH_PREFIX}${orderId}`
}

export function buildCheckinUrl(origin: string, orderId: string): string {
  return `${origin.replace(/\/+$/, '')}${buildCheckinPath(orderId)}`
}

/**
 * Ambil Order ID dari isi QR.
 *
 * Menerima tiga bentuk yang mungkin muncul di lapangan:
 *   - Order ID telanjang       : 283033796
 *   - path relatif             : /checkin/283033796
 *   - URL lengkap              : https://app.domain/checkin/283033796
 *
 * Mengembalikan null bila tidak ada Order ID yang dapat dikenali. Nilai yang
 * dikembalikan selalu hanya Order ID — tidak pernah URL atau data lain.
 */
export function extractOrderIdFromQrPayload(payload: string): string | null {
  const trimmed = payload.trim()
  if (trimmed.length === 0) return null

  if (ORDER_ID_PATTERN.test(trimmed)) return trimmed

  const markerIndex = trimmed.indexOf(CHECKIN_PATH_PREFIX)
  if (markerIndex === -1) return null

  const afterPrefix = trimmed.slice(markerIndex + CHECKIN_PATH_PREFIX.length)
  const withoutQuery = afterPrefix.split(/[?#]/)[0] ?? ''
  const firstSegment = withoutQuery.split('/')[0] ?? ''
  const candidate = firstSegment.trim()

  return candidate.length > 0 && ORDER_ID_PATTERN.test(candidate) ? candidate : null
}
