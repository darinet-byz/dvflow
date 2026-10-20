/**
 * Link akses peserta (Fitur 2.0 dok 07, A27).
 *
 * Order dari koneksi OrderOnline disimpan sebagai `KODE-nomor` (mis. `MTIX-283818331`), dan link
 * resminya memisahkan kode toko: `/access/MTIX/283818331`. Server menyusun ulang `KODE-nomor`, jadi
 * link ini selalu tepat satu order — tidak bergantung pada nomor OrderOnline yang unik antar toko.
 * Order tanpa kode toko (webhook lama) tetap `/access/<order_id>`.
 */
const STORE_PREFIX = /^([A-Z0-9]{1,4})-(.+)$/

export function participantAccessPath(orderId: string): string {
  const match = STORE_PREFIX.exec(orderId)
  if (match === null) return `/access/${encodeURIComponent(orderId)}`
  return `/access/${encodeURIComponent(match[1]!)}/${encodeURIComponent(match[2]!)}`
}

export function participantAccessUrl(orderId: string, origin: string = window.location.origin): string {
  return `${origin}${participantAccessPath(orderId)}`
}

/** Template untuk pesan/Redirect URL OrderOnline per toko; `{{order_id}}` diisi OrderOnline. */
export function participantLinkTemplate(slug: string, origin: string = window.location.origin): string {
  return `${origin}/access/${slug}/{{order_id}}`
}

/** Order peserta OTS (A29): prefix `OTS-` dicadangkan, tidak bisa dipakai kode toko OrderOnline. */
export function isOtsOrder(orderId: string): boolean {
  return /^OTS-\d+$/.test(orderId)
}

const OTS_PAYMENT_LABELS: Record<string, string> = { ots_tunai: 'OTS · Tunai', ots_transfer: 'OTS · Bank Transfer', ots_qris: 'OTS · QRIS' }

/** Label metode bayar; kode OTS dibuat terbaca, kode lain apa adanya. */
export function paymentMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null
  return OTS_PAYMENT_LABELS[method] ?? method
}

