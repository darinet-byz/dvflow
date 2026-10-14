import type { RouteContext } from '../router'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import { requireActiveUser } from '../users'
import type { DataSummaryResult, ResetDataResult } from '@dvflow/shared'

/**
 * GET /api/developer/data-summary
 * Mengambil ringkasan jumlah baris data aktif di database untuk dashboard Developer Reset.
 */
export async function getDataSummary(context: RouteContext): Promise<Response> {
  if (context.claims?.app_role !== 'developer') {
    throw new ApiFailure('FORBIDDEN', 'Hanya role developer yang diizinkan mengakses fitur ini')
  }

  const actor = await requireActiveUser(context)
  if (actor.role !== 'developer') {
    throw new ApiFailure('FORBIDDEN', 'Hanya role developer yang diizinkan mengakses fitur ini')
  }

  const [orders, unmappedOrders, attendance, orderSources, logs, aliases, connections, products] = await Promise.all([
    context.db.selectRows('orders', { limit: '100000' }, 'id'),
    context.db.selectRows('orders', { product_parse_status: 'eq.invalid', limit: '100000' }, 'id'),
    context.db.selectRows('attendance_events', { limit: '100000' }, 'id'),
    context.db.selectRows('orderonline_order_sources', { limit: '100000' }, 'order_id'),
    context.db.selectRows('webhook_logs', { limit: '100000' }, 'id'),
    context.db.selectRows('product_aliases', { limit: '100000' }, 'id'),
    context.db.selectRows('orderonline_connections', { limit: '100000' }, 'id'),
    context.db.selectRows('products', { limit: '100000' }, 'id'),
  ])

  const summary: DataSummaryResult = {
    orders_count: orders.length,
    unmapped_orders_count: unmappedOrders.length,
    attendance_events_count: attendance.length,
    order_sources_count: orderSources.length,
    webhook_logs_count: logs.length,
    product_aliases_count: aliases.length,
    connections_count: connections.length,
    products_count: products.length,
  }

  return ok(summary)
}

/**
 * POST /api/developer/reset-data
 * Menghapus data uji coba dengan 2x verifikasi: (1) teks "Ya, Aku yakin", (2) password developer.
 */
export async function resetData(context: RouteContext): Promise<Response> {
  if (context.claims?.app_role !== 'developer') {
    throw new ApiFailure('FORBIDDEN', 'Hanya role developer yang diizinkan mengakses fitur reset data')
  }

  const actor = await requireActiveUser(context)
  if (actor.role !== 'developer') {
    throw new ApiFailure('FORBIDDEN', 'Hanya role developer yang diizinkan mengakses fitur reset data')
  }

  const body = await readJsonObject(context.request)
  const scopes = Array.isArray(body['scopes'])
    ? (body['scopes'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const confirmationText = readString(body, 'confirmationText')?.trim()
  const password = readString(body, 'password')

  if (scopes.length === 0) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Pilih minimal satu cakupan data yang ingin direset')
  }

  if (confirmationText !== 'Ya, Aku yakin') {
    throw new ApiFailure('INVALID_ARGUMENT', 'Teks konfirmasi harus persis "Ya, Aku yakin"')
  }

  if (!password || password.trim() === '') {
    throw new ApiFailure('INVALID_CREDENTIALS', 'Password developer wajib diisi')
  }

  // Verifikasi password developer via database RPC verify_developer_password
  const isPasswordValid = await context.db.rpc<boolean>('verify_developer_password', {
    p_user_id: actor.id,
    p_password: password,
  })

  if (!isPasswordValid) {
    throw new ApiFailure('INVALID_CREDENTIALS', 'Password developer salah. Tindakan reset dibatalkan.')
  }

  const result = await context.db.rpc<ResetDataResult>('developer_reset_data', {
    p_scopes: scopes,
    p_actor_id: actor.id,
  })

  return ok(result)
}

/**
 * POST /api/developer/purge-unmapped
 * Menjalankan pembersihan manual order unmapped yang melewati batas 90 hari.
 */
export async function purgeExpiredUnmapped(context: RouteContext): Promise<Response> {
  if (context.claims?.app_role !== 'developer') {
    throw new ApiFailure('FORBIDDEN', 'Hanya role developer yang diizinkan mengakses fitur ini')
  }

  const actor = await requireActiveUser(context)
  if (actor.role !== 'developer') {
    throw new ApiFailure('FORBIDDEN', 'Hanya role developer yang diizinkan mengakses fitur ini')
  }

  const result = await context.db.rpc<Record<string, unknown>>('purge_expired_unmapped_orders', {
    p_retention_days: 90,
  })

  return ok(result)
}
