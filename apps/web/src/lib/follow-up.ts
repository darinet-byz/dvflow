import { authorizedRequest } from './session'

/**
 * Klien Follow Up Manual (A76).
 *
 * Semua endpoint backend: template dan penanda tidak dibaca langsung dari
 * Supabase, supaya cakupan produk/pengiklan dan izin diperiksa di satu tempat.
 */
export type FollowUpOrderInfo = {
  order_id: string
  name: string | null
  phone: string | null
  phone_wa: string | null
  product_code: string | null
  product_name: string | null
  advertiser_name: string | null
  event_type: string | null
  batch: string | null
  session: string | null
  city: string | null
  is_ots: boolean
}

export type FollowUpContext = {
  order: FollowUpOrderInfo
  event_type: { code: string; name: string } | null
  templates: Array<{ slot: number; body: string }>
  marks: Array<{ slot: number; used_at: string; used_by_name: string | null }>
  template_updated: { at: string; by: string | null } | null
}

export type FollowUpMark = {
  order_id: string
  slot: number
  used_at: string
  used_by_name: string | null
}

/** Ringkasan per halaman daftar Order: slot yang punya template + yang sudah dipakai. */
export type FollowUpSummary = {
  order_id: string
  slots: number[]
  used: number[]
  /** Jumlah tiket order (dipakai kartu HP; orders_page tidak memuatnya). */
  quantity: number
}

export type FollowUpTemplateRow = {
  event_type_id: string
  slot: number
  body: string
  updated_at: string
}

export type FollowUpTemplateMatrix = {
  product: { code: string; name: string }
  event_types: Array<{ id: string; code: string; name: string; kind: string; active: boolean }>
  templates: FollowUpTemplateRow[]
}

export function fetchFollowUpContext(orderId: string): Promise<FollowUpContext> {
  return authorizedRequest<FollowUpContext>(`/api/orders/${encodeURIComponent(orderId)}/follow-up`)
}

export function markFollowUpSlot(orderId: string, slot: number): Promise<FollowUpMark> {
  return authorizedRequest<FollowUpMark>(`/api/orders/${encodeURIComponent(orderId)}/follow-up`, {
    method: 'POST',
    body: { slot },
  })
}

export function fetchFollowUpSummaries(orderIds: readonly string[]): Promise<{ orders: FollowUpSummary[] }> {
  const ids = orderIds.map((id) => encodeURIComponent(id)).join(',')
  return authorizedRequest<{ orders: FollowUpSummary[] }>(`/api/orders/follow-up-summary?ids=${ids}`)
}

export function fetchFollowUpTemplates(productCode: string): Promise<FollowUpTemplateMatrix> {
  return authorizedRequest<FollowUpTemplateMatrix>(
    `/api/follow-up-templates?product=${encodeURIComponent(productCode)}`,
  )
}

export function saveFollowUpTemplates(input: {
  productCode: string
  eventTypeCode: string
  slots: Record<string, string>
}): Promise<{ saved: boolean }> {
  return authorizedRequest<{ saved: boolean }>('/api/follow-up-templates', {
    method: 'PUT',
    body: input,
  })
}
