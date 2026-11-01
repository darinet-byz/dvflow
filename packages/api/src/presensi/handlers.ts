import { isOrderIdShaped } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject } from '../http/response'
import { assertOrderAccess, productAccess, requirePermissions } from '../permissions'
import type { RouteContext } from '../router'
import type { UserRow } from '../users'
import { loadOrder } from '../participant/handlers'

/**
 * Koreksi presensi dari halaman Presensi (A62).
 *
 * Dua tindakan:
 *   * `mark-present` — menandai tiket hadir TANPA scan, memakai RPC
 *     `checkin_seminar` dengan source `seminar_manual` supaya operator yang
 *     melakukannya tercatat di kolom "Di-scan oleh";
 *   * `reset` — menghapus sebagian/seluruh presensi seminar order dari database.
 *
 * Izin mengikuti Manual Check-in (`action.manual_checkin`) + halaman Presensi.
 * Aturan bisnis tetap ditegakkan ulang di RPC: order harus Paid, Seminar
 * Offline/Hybrid, dan dalam cakupan produk aktor.
 */

type CheckinResult = {
  order_id: string
  state: 'CHECKIN_SUCCESS' | 'ALREADY_CHECKED_IN' | 'NEEDS_QUANTITY'
  attendance_id: string | null
  clicked_at: string | null
  first_clicked_at: string | null
  scanner_user_id: string | null
  quantity: number
  checked_in_tickets: number
  remaining_tickets: number
  tickets_confirmed: number
}

type ResetResult = {
  order_id: string
  removed_tickets: number
  quantity: number
  checked_in_tickets: number
  remaining_tickets: number
}

/** Body opsional `{ tickets: 2 }`. `null` berarti seluruh sisa/tercatat. */
function readTickets(body: Record<string, unknown>): number | null {
  const value = body['tickets']
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10000) {
    throw new ApiFailure('INVALID_ARGUMENT', 'jumlah tiket tidak valid')
  }
  return value
}

async function correctionTarget(context: RouteContext) {
  const actor = await requirePermissions(context, ['operasional.presensi', 'action.manual_checkin'])
  const orderId = context.params['orderId'] ?? ''
  if (!isOrderIdShaped(orderId)) {
    throw new ApiFailure('ORDER_NOT_FOUND', `order id tidak berbentuk wajar: ${orderId}`)
  }

  const access = await productAccess(context, actor)
  const order = await loadOrder(context.db, orderId)
  if (!order) throw new ApiFailure('ORDER_NOT_FOUND')
  assertOrderAccess(access, { product_code: order.product_code ?? null, advertiser_code: order.advertiser_code })
  return { actor, orderId }
}

function describeOperator(user: UserRow): { user_id: string; display_name: string } {
  return { user_id: user.id, display_name: user.display_name }
}

/**
 * POST /api/presensi/:orderId/mark-present
 *
 * Tanpa `tickets` = tandai semua sisa tiket hadir. Dengan `tickets` = tandai
 * sejumlah itu saja (dipotong ke sisa oleh RPC).
 */
export async function markPresensiPresent(context: RouteContext): Promise<Response> {
  const { actor, orderId } = await correctionTarget(context)
  const body = await readJsonObject(context.request)
  const tickets = readTickets(body)

  const result = await context.db.rpc<CheckinResult>('checkin_seminar', {
    p_order_id: orderId,
    p_source: 'seminar_manual',
    p_scanner_user_id: actor.id,
    // NULL = seluruh sisa tiket. Jangan pakai -1 (probe) di jalur koreksi:
    // operator Presensi sudah memilih jumlah sebelum menekan tombol.
    p_tickets: tickets,
  })

  const order = await loadOrder(context.db, result.order_id)

  return ok({
    state: result.state,
    order_id: result.order_id,
    name: order?.name ?? null,
    event_type: order?.event_type ?? null,
    session: order?.effective_session ?? order?.session ?? null,
    quantity: result.quantity ?? order?.quantity ?? 1,
    checked_in_tickets: result.checked_in_tickets ?? 0,
    remaining_tickets: result.remaining_tickets ?? 0,
    tickets_confirmed: result.tickets_confirmed ?? 0,
    clicked_at: result.clicked_at,
    first_clicked_at: result.first_clicked_at ?? null,
    attendance_id: result.attendance_id,
    scanner: describeOperator(actor),
  })
}

/**
 * POST /api/presensi/:orderId/reset
 *
 * Tanpa `tickets` = hapus seluruh presensi seminar order tersebut.
 * Dengan `tickets` = hapus N presensi terbaru, sehingga status dapat berubah
 * menjadi Hadir Sebagian.
 */
export async function resetPresensi(context: RouteContext): Promise<Response> {
  const { actor, orderId } = await correctionTarget(context)
  const body = await readJsonObject(context.request)
  const tickets = readTickets(body)

  const result = await context.db.rpc<ResetResult>('reset_presensi', {
    p_actor: actor.id,
    p_order_id: orderId,
    p_tickets: tickets,
  })

  return ok(result)
}
