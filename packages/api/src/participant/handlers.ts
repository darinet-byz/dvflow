import { requirePermission, productAccess, assertProductAccess } from '../permissions'
import { resolveProductAlias } from '../webhooks/handlers'
import { buildCheckinPath, isOrderIdShaped } from '@dvflow/shared'
import type { Db } from '../db/types'
import { ApiFailure } from '../http/errors'
import { ok } from '../http/response'
import type { RouteContext } from '../router'
import type { UserRow } from '../users'
import {
  candidateSettingKeys,
  parseSeminarTicketValue,
  TICKET_PREFIX,
  WEBINAR_PREFIX,
} from '../webinar/handlers'
import { renderErrorPage, renderTicketPage, type TicketData } from './pages'

/**
 * Rute peserta (03 §8–§9, PRD §87–§93).
 *
 * Aturan tunggalnya: **akses hanya bila order ada + Paid + produk terparse
 * valid**. Pending, Cancelled, order tidak dikenal, atau produk yang tidak
 * dapat dipetakan acara — semuanya ditolak, tanpa pengecualian.
 *
 * Rute ini PUBLIK: Order ID adalah identitas akses peserta (04 §12), jadi tidak
 * ada token tambahan yang ditambahkan di sini.
 */

type OrderRow = {
  order_id: string
  name: string | null
  app_status: string
  product_parse_status: string
  event_type: string | null
  product_raw: string | null
  product_code?: string | null
  product_name: string | null
  advertiser_name: string | null
  batch: string | null
  session: string | null
  city: string | null
}

const ORDER_COLUMNS =
  'order_id,name,app_status,product_parse_status,event_type,product_raw,product_code,product_name,advertiser_name,batch,session,city'

export async function loadOrder(db: Db, orderId: string): Promise<OrderRow | null> {
  const rows = await db.selectRows<OrderRow>('orders', { order_id: `eq.${orderId}` }, ORDER_COLUMNS)
  return rows[0] ?? null
}

/**
 * GET /access/:orderId (03 §8).
 *
 * Webinar: catat presensi lalu **302** ke destination.
 * Seminar: halaman tiket + payload QR (QR sendiri dibuat browser — Worker tidak
 * pernah membuat gambar QR).
 */
export async function accessOrder(context: RouteContext): Promise<Response> {
  // 03 §15: peserta selalu menerima halaman HTML, tidak pernah JSON 500 dari router.
  try {
    return await accessOrderPage(context)
  } catch (error) {
    console.error(`[access] gagal ${error instanceof Error ? error.name : typeof error}`)
    return renderErrorPage('GENERIC_ACCESS_ERROR', null)
  }
}

async function accessOrderPage(context: RouteContext): Promise<Response> {
  const kodeToko = context.params['kodeToko']?.trim().toUpperCase()
  const orderId = context.params['orderId'] ?? ''

  // Order ID dari URL adalah input tak terpercaya: bentuknya diperiksa sebelum
  // menyentuh database supaya tidak ada nilai aneh yang sampai ke query.
  if (!isOrderIdShaped(orderId)) return renderErrorPage('ORDER_NOT_FOUND', null)
  if (kodeToko && !/^[A-Z0-9]{1,4}$/.test(kodeToko)) return renderErrorPage('ORDER_NOT_FOUND', null)

  let order: OrderRow | null = null
  if (kodeToko) {
    const effectiveId = orderId.startsWith(`${kodeToko}-`) ? orderId : `${kodeToko}-${orderId}`
    order = await loadOrder(context.db, effectiveId)
    if (!order) {
      const rows = await context.db.selectRows<OrderRow>('orders', {
        raw_order_id: `eq.${orderId}`,
        order_id: `like.${kodeToko}-*`,
      }, ORDER_COLUMNS)
      order = rows[0] ?? null
    }
  } else {
    order = await loadOrder(context.db, orderId)
    if (!order) {
      const rows = await context.db.selectRows<OrderRow>('orders', {
        raw_order_id: `eq.${orderId}`,
      }, ORDER_COLUMNS)
      if (rows.length === 1) {
        order = rows[0]!
      }
    }
  }

  if (order === null) return renderErrorPage('ORDER_NOT_FOUND', orderId)

  if (order.app_status !== 'Paid') return renderErrorPage('ORDER_NOT_PAID', orderId)

  // Event harus dapat ditentukan. parse invalid berarti event_type NULL dan
  // akses acara ditolak (01 §9).
  if (order.product_parse_status !== 'valid' || order.event_type === null) {
    return renderErrorPage('INVALID_EVENT_PRODUCT', orderId)
  }

  // Webinar: selalu ke Zoom. Hybrid (A14): link yang sama membuka tiket QR, dan
  // tombol "Gabung via Zoom" kembali ke link ini dengan ?via=zoom.
  const wantsZoom = order.event_type === 'Webinar Online' ||
    (order.event_type === 'Hybrid' && context.url.searchParams.get('via') === 'zoom')
  if (wantsZoom) {
    return redirectToWebinar(context, order)
  }

  const [ticketRows, attendanceRows] = await Promise.all([
    context.db.selectRows<{ key: string; value_text: string | null }>(
      'app_settings',
      { key: `like.${TICKET_PREFIX}*` },
      'key,value_text',
    ),
    context.db.selectRows<{ id: string; clicked_at: string }>(
      'attendance_events',
      { order_id: `eq.${order.order_id}`, attendance_type: 'eq.seminar' },
      'id,clicked_at',
    ),
  ])

  const byKey = new Map(ticketRows.map((row) => [row.key, row.value_text]))
  let matchedRaw: string | null = null
  for (const candidate of candidateSettingKeys({ ...order, alias_target: await resolveProductAlias(context.db, order.product_raw) }, TICKET_PREFIX)) {
    const val = byKey.get(candidate)
    if (val !== undefined && val !== null && val.trim() !== '') {
      matchedRaw = val
      break
    }
  }

  const ticketMeta = matchedRaw !== null ? parseSeminarTicketValue(matchedRaw) : null
  if (ticketMeta !== null && !ticketMeta.active) {
    return renderErrorPage('WEBINAR_DESTINATION_NOT_CONFIGURED', order.order_id)
  }

  const checkedInEvent = attendanceRows[0] ?? null

  const data: TicketData = {
    orderId: order.order_id,
    participantName: order.name,
    eventType: order.event_type,
    productName: order.product_name,
    advertiserName: order.advertiser_name,
    batch: order.batch,
    session: order.session,
    city: order.city,
    venue: ticketMeta?.venue ?? null,
    schedule: ticketMeta?.schedule ?? null,
    notes: ticketMeta?.notes ?? null,
    checkinPath: buildCheckinPath(order.order_id),
    alreadyCheckedIn: checkedInEvent !== null,
    checkedInAt: checkedInEvent?.clicked_at ?? null,
    zoomPath: order.event_type === 'Hybrid' && (await findWebinarDestination(context, order)) !== null
      ? `${context.url.pathname}?via=zoom`
      : null,
  }
  return renderTicketPage(data)
}

/**
 * Destination webinar (01 §15).
 *
 * Lookup memakai urutan prioritas dari paling spesifik (`product_raw` persis,
 * lalu kombinasi `product_code`, `batch`, `session_code`) hingga link global `*:*:*`.
 *
 * Bila mapping tidak ada: JANGAN catat presensi, JANGAN redirect ke URL
 * sembarang, dan tampilkan error konfigurasi. Presensi yang tercatat untuk
 * peserta yang tidak pernah sampai ke Zoom akan merusak laporan kehadiran.
 */
/** Link Zoom yang berlaku untuk order ini, atau null bila belum ada / tidak aman. */
async function findWebinarDestination(context: RouteContext, order: OrderRow): Promise<string | null> {
  const rows = await context.db.selectRows<{ key: string; value_text: string | null }>(
    'app_settings',
    { key: `like.${WEBINAR_PREFIX}*` },
    'key,value_text',
  )

  const byKey = new Map(rows.map((row) => [row.key, row.value_text]))
  let destination: string | null = null
  for (const candidate of candidateSettingKeys({ ...order, alias_target: await resolveProductAlias(context.db, order.product_raw) }, WEBINAR_PREFIX)) {
    const val = byKey.get(candidate)
    if (val !== undefined && val !== null && val.trim() !== '') {
      destination = val
      break
    }
  }

  // Destination yang tidak aman diperlakukan sama seperti destination yang
  // tidak ada: tidak ada presensi, tidak ada redirect.
  if (destination === null || destination.trim() === '' || !isAcceptableDestination(destination, context)) return null
  return destination.trim()
}

async function redirectToWebinar(context: RouteContext, order: OrderRow): Promise<Response> {
  const destination = await findWebinarDestination(context, order)
  if (destination === null) {
    return renderErrorPage('WEBINAR_DESTINATION_NOT_CONFIGURED', order.order_id)
  }

  // Setiap klik valid = satu baris presensi baru (PRD §91 — sengaja TIDAK
  // di-deduplicate supaya keluar/masuk peserta terlihat).
  await context.db.insertRow('attendance_events', {
    order_id: order.order_id,
    attendance_type: 'webinar',
    source: 'webinar_redirect',
  })

  return new Response(null, {
    status: 302,
    headers: { location: destination, 'cache-control': 'no-store' },
  })
}

/** 05 §F08: destination wajib HTTPS, kecuali localhost yang diizinkan eksplisit. */
function isAcceptableDestination(destination: string, context: RouteContext): boolean {
  let url: URL
  try {
    url = new URL(destination.trim())
  } catch {
    return false
  }

  if (url.protocol === 'https:') return true
  if (context.env.ALLOW_INSECURE_WEBINAR_DESTINATION !== 'true') return false

  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

/**
 * GET /checkin/:orderId (03 §9).
 *
 * Rute GET **tidak pernah mengubah apa pun** — kontraknya eksplisit: mutasi
 * hanya lewat POST. Halaman ini untuk orang yang membuka isi QR dengan kamera
 * biasa: yang tampil adalah instruksi, bukan hasil check-in.
 */
export async function checkinInfoPage(context: RouteContext): Promise<Response> {
  const orderId = context.params['orderId'] ?? ''
  const hint =
    isOrderIdShaped(orderId)
      ? `Tunjukkan Order ID <strong>${escapeForPage(orderId)}</strong> kepada panitia.`
      : 'Tunjukkan Order ID Anda kepada panitia.'

  return new Response(
    `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Check-in Seminar</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; padding: 32px 16px; max-width: 420px;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 14px; line-height: 1.5; color: #171821; background: #f7f8fc; text-align: center; }
  .card { padding: 20px; background: #fff; border: 1px solid #eceef4; border-radius: 18px; }
  h1 { margin: 0 0 8px; font-size: 18px; }
  p { margin: 0; color: #737786; }
</style></head>
<body><div class="card">
<h1>Bukan halaman check-in</h1>
<p>Check-in dilakukan panitia melalui aplikasi scanner, bukan dengan membuka tautan ini. ${hint}</p>
</div></body></html>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

function escapeForPage(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export type CheckinResult = {
  order_id: string
  state: 'CHECKIN_SUCCESS' | 'ALREADY_CHECKED_IN'
  attendance_id: string
  clicked_at: string
  scanner_user_id: string | null
}

/**
 * Check-in seminar (03 §9, §11).
 *
 * Dipakai `POST /checkin/:orderId` (QR) dan `POST /api/scanner/manual-checkin`
 * (manual) — validasinya satu dan sama, dijalankan RPC `checkin_seminar`, dan
 * tidak ada jalur yang melewatinya (01 §14).
 *
 * Mutasi diverifikasi ulang di database (order ada, Paid, Seminar Offline) walau
 * handler sudah memeriksa peran operator: QR bukan otorisasi (04 §11).
 */
export async function checkinSeminar(
  context: RouteContext,
  input: { orderId: string; source: 'seminar_qr' | 'seminar_manual' },
): Promise<Response> {
  const operator = await requirePermission(context, 'operasional.scan_qr')
  if (input.source === 'seminar_manual') await requirePermission(context, 'action.manual_checkin')

  if (!isOrderIdShaped(input.orderId)) {
    throw new ApiFailure('ORDER_NOT_FOUND', `order id tidak berbentuk wajar: ${input.orderId}`)
  }

  const access = await productAccess(context, operator)
  const orderBefore = await loadOrder(context.db, input.orderId)
  if (!orderBefore) throw new ApiFailure('ORDER_NOT_FOUND')
  assertProductAccess(access, orderBefore.product_code)

  const result = await context.db.rpc<CheckinResult>('checkin_seminar', {
    p_order_id: input.orderId,
    p_source: input.source,
    p_scanner_user_id: operator.id,
  })

  // Nama peserta dibaca setelah RPC berhasil, hanya untuk ditampilkan di kartu
  // hasil scanner (PRD §96). Satu query tambahan lebih murah daripada
  // mengubah tanda tangan RPC yang sudah teruji.
  const order = await loadOrder(context.db, result.order_id)

  return ok({
    state: result.state,
    order_id: result.order_id,
    name: order?.name ?? null,
    event_type: order?.event_type ?? null,
    session: order?.session ?? null,
    clicked_at: result.clicked_at,
    attendance_id: result.attendance_id,
    scanner: describeOperator(operator),
  })
}

function describeOperator(user: UserRow): { user_id: string; display_name: string } {
  return { user_id: user.id, display_name: user.display_name }
}

/** POST /checkin/:orderId — jalur QR (03 §9). */
export async function checkinByQr(context: RouteContext): Promise<Response> {
  return checkinSeminar(context, { orderId: context.params['orderId'] ?? '', source: 'seminar_qr' })
}
