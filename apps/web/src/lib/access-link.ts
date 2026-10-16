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
