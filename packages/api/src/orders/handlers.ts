import { isOrderIdShaped } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import { requirePermission } from '../permissions'
import type { RouteContext } from '../router'

/**
 * Aksi siklus hidup order (A58): reschedule peserta dan refund.
 *
 * Semua aturan bisnis ditegakkan ulang di RPC database (SECURITY DEFINER):
 * order harus Paid, reschedule hanya sebelum presensi, refund penuh, dan scope
 * produk/pengiklan aktor. Handler hanya memvalidasi bentuk input dan meneruskan
 * aktor yang sudah diverifikasi.
 */
type RescheduleResult = {
  order_id: string
  from_batch: string | null
  from_session: string | null
  from_city: string | null
  batch: string | null
  session: string
  city: string
  rescheduled: boolean
}

type RefundResult = {
  order_id: string
  refund_id: string
  status: string
  amount: number | string
  refunded_at: string
}

type CancelRefundResult = {
  order_id: string
  refund_id: string
  status: string
  reverted_at: string
}

export async function rescheduleOrder(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.reschedule')
  const orderId = readOrderId(context)
  const body = await readJsonObject(context.request)

  const batch = optionalText(body, 'batch', 32)
  const session = requiredText(body, 'session', 64, 'Pilih sesi tujuan.')
  const city = requiredText(body, 'city', 100, 'Kota tujuan wajib diisi.')
  const reason = optionalText(body, 'reason', 300)

  const result = await context.db.rpc<RescheduleResult>('reschedule_order', {
    p_actor: actor.id,
    p_order_id: orderId,
    p_batch: batch,
    p_session: session,
    p_city: city,
    p_reason: reason,
  })
  return ok(result)
}

export async function refundOrder(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.refund')
  const orderId = readOrderId(context)
  const body = await readJsonObject(context.request)
  const reason = requiredText(body, 'reason', 500, 'Alasan refund wajib diisi.')

  const result = await context.db.rpc<RefundResult>('refund_order', {
    p_actor: actor.id,
    p_order_id: orderId,
    p_reason: reason,
  })
  return ok(result)
}

export async function cancelRefund(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.refund')
  const orderId = readOrderId(context)
  const body = await readJsonObject(context.request)
  const reason = optionalText(body, 'reason', 500)

  const result = await context.db.rpc<CancelRefundResult>('cancel_refund', {
    p_actor: actor.id,
    p_order_id: orderId,
    p_reason: reason,
  })
  return ok(result)
}

function readOrderId(context: RouteContext): string {
  const orderId = (context.params['orderId'] ?? '').trim()
  if (!isOrderIdShaped(orderId)) throw new ApiFailure('ORDER_NOT_FOUND')
  return orderId
}

function requiredText(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
  message: string,
): string {
  const value = (readString(body, key) ?? '').trim()
  if (value === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, message)
  if (value.length > maxLength) throw new ApiFailure('INVALID_ARGUMENT', undefined, message)
  return value
}

function optionalText(body: Record<string, unknown>, key: string, maxLength: number): string | null {
  const value = (readString(body, key) ?? '').trim()
  if (value === '') return null
  if (value.length > maxLength) throw new ApiFailure('INVALID_ARGUMENT')
  return value
}
