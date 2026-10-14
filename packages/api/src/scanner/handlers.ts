import { SCANNER_SEARCH_LIMIT } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { buildIlikeOrFilter, sanitizeSearchTerm } from '../http/postgrest-filter'
import { ok, readJsonObject, readString } from '../http/response'
import type { Db } from '../db/types'
import type { RouteContext } from '../router'
import { requirePermission, productAccess, productFilter } from '../permissions'
import { checkinSeminar } from '../participant/handlers'

/**
 * Scanner (03 §9–§11, 01 §14).
 *
 * Prinsip yang sama seperti check-in: QR hanyalah pengenal, dan seluruh syarat
 * diperiksa ulang di server. Manual Search memakai validasi yang **persis sama**
 * dengan QR — tidak ada jalur yang mem-bypass aturan Paid (H09).
 */

export type ScannerCandidate = {
  order_id: string
  name: string | null
  phone: string | null
  app_status: string
  product_name: string | null
  batch: string | null
  session: string | null
  city: string | null
  already_checked_in: boolean
  checked_in_at: string | null
}

type OrderSearchRow = {
  order_id: string
  name: string | null
  phone: string | null
  app_status: string
  product_name: string | null
  batch: string | null
  session: string | null
  city: string | null
}

/**
 * GET /api/scanner/search?q= (03 §10).
 *
 * Batasan yang dijaga:
 *   * hanya order dengan check-in di lokasi (**Seminar Offline**, **Hybrid**) — order webinar tidak pernah muncul di
 *     scanner seminar (03 §10);
 *   * hasil maksimum 20, dikerjakan server-side (H08);
 *   * teks pencarian dibersihkan lebih dulu supaya tidak dapat mengubah arti
 *     filter PostgREST (L06).
 *
 * Status Paid TIDAK dipakai sebagai filter di sini: operator justru perlu
 * menemukan order Pending untuk tahu bahwa peserta belum membayar, dan
 * check-in-nya tetap ditolak server dengan `ORDER_NOT_PAID` (H04).
 */
export async function scannerSearch(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.scan_qr')
  const access = await productAccess(context, actor)

  const raw = context.url.searchParams.get('q')
  const term = sanitizeSearchTerm(raw)
  if (term === null || !isSearchLongEnough(term)) {
    return ok({ query: raw, candidates: [], checked_in_lookup: false })
  }

  const rows = await context.db.selectRows<OrderSearchRow>(
    'orders',
    {
      ...productFilter(access),
      // Hybrid juga punya jalur check-in di lokasi (A14).
      event_type: 'in.("Seminar Offline","Hybrid")',
      or: buildIlikeOrFilter(['order_id', 'name', 'phone'], term),
    },
    'order_id,name,phone,app_status,product_name,batch,session,city',
  )

  const ranked = rankCandidates(rows, term).slice(0, SCANNER_SEARCH_LIMIT)
  const checkins = await loadSeminarCheckins(
    context.db,
    ranked.map((row) => row.order_id),
  )

  return ok({
    query: raw,
    candidates: ranked.map((row) => {
      const clickedAt = checkins.get(row.order_id) ?? null
      return {
        ...row,
        already_checked_in: clickedAt !== null,
        checked_in_at: clickedAt,
      } satisfies ScannerCandidate
    }),
  })
}

/**
 * POST /api/scanner/manual-checkin (03 §11).
 *
 * Memakai validasi yang sama persis dengan QR — RPC yang sama, dengan
 * `source = seminar_manual` supaya jejaknya berbeda di presensi.
 */
export async function scannerManualCheckin(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'action.manual_checkin')

  const body = await readJsonObject(context.request)
  const orderId = readString(body, 'order_id')
  if (orderId === null || orderId.trim() === '') {
    throw new ApiFailure('INVALID_PAYLOAD', 'order_id wajib diisi')
  }

  return checkinSeminar(context, { orderId: orderId.trim(), source: 'seminar_manual' })
}

/**
 * Pencarian satu karakter.
 *
 * 01 §7 menetapkan minimal 2 karakter kecuali untuk Order ID numerik. Aturan itu
 * dipakai apa adanya di sini; pencarian yang terlalu pendek menghasilkan daftar
 * kosong, bukan error — operator tidak perlu diberi pesan kesalahan hanya karena
 * baru mengetik satu huruf.
 */
function isSearchLongEnough(term: string): boolean {
  if (term.length >= 2) return true
  return /^[0-9]$/.test(term)
}

/**
 * Urutkan kandidat supaya yang paling mungkin dicari berada di depan: Order ID
 * yang cocok persis, lalu yang diawali istilah, lalu sisanya menurut nama.
 */
function rankCandidates(rows: OrderSearchRow[], term: string): OrderSearchRow[] {
  const lower = term.toLowerCase()

  return [...rows].sort((left, right) => {
    const leftScore = score(left, lower)
    const rightScore = score(right, lower)
    if (leftScore !== rightScore) return leftScore - rightScore

    const leftName = left.name ?? ''
    const rightName = right.name ?? ''
    if (leftName !== rightName) return leftName.localeCompare(rightName, 'id')
    return left.order_id.localeCompare(right.order_id, 'id')
  })
}

function score(row: OrderSearchRow, lowerTerm: string): number {
  if (row.order_id.toLowerCase() === lowerTerm) return 0
  if (row.order_id.toLowerCase().startsWith(lowerTerm)) return 1
  if ((row.phone ?? '').toLowerCase().includes(lowerTerm)) return 2
  return 3
}

/** Ambil status check-in seminar untuk kandidat yang tersaring (satu query). */
async function loadSeminarCheckins(db: Db, orderIds: string[]): Promise<Map<string, string>> {
  const checkins = new Map<string, string>()
  if (orderIds.length === 0) return checkins

  const rows = await db.selectRows<{ order_id: string; clicked_at: string }>(
    'attendance_events',
    {
      attendance_type: 'eq.seminar',
      order_id: `in.(${orderIds.join(',')})`,
    },
    'order_id,clicked_at',
  )

  for (const row of rows) checkins.set(row.order_id, row.clicked_at)
  return checkins
}
