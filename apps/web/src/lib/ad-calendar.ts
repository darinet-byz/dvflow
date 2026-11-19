import { authorizedRequest } from './session'

/**
 * A80: Kalender Iklan — satu deadline tayang per pengiklan + produk + batch.
 *
 * Tanggal tayang tidak diinput: server menurunkannya dari order/lead pertama
 * atau report spend pertama. Skor 0–10 dihitung dari selisih tayang vs deadline.
 */
export type AdCalendarStatus = 'on_time' | 'late' | 'unpublished' | 'upcoming'

export type AdCalendarRow = {
  id: string
  event_id: string | null
  event_date: string | null
  category: string | null
  start_time: string | null
  location: string | null
  product_code: string
  product_name: string
  advertiser_code: string | null
  advertiser_name: string | null
  batch: string
  deadline_date: string
  publish_date: string | null
  publish_source: 'order' | 'report' | null
  days_late: number | null
  score: number | null
  status: AdCalendarStatus
}

export type AdCalendarEventOption = {
  id: string
  product_code: string
  product_name: string
  category: string
  event_date: string
  start_time: string
  location: string
}

export type AdCalendarPage = {
  rows: AdCalendarRow[]
  products: Array<{ code: string; name: string }>
  advertisers: Array<{ code: string; name: string }>
  events: AdCalendarEventOption[]
}

export type SaveAdCalendarInput = {
  event_id: string
  advertiser_code: string
  batch: string
  deadline_date: string
}

export async function fetchAdCalendar(from: string, to: string): Promise<AdCalendarPage> {
  const params = new URLSearchParams({ from, to })
  return authorizedRequest<AdCalendarPage>(`/api/ad-calendar?${params.toString()}`)
}

export async function createAdCalendar(input: SaveAdCalendarInput): Promise<void> {
  await authorizedRequest('/api/ad-calendar', { method: 'POST', body: input })
}

export async function updateAdCalendar(id: string, input: SaveAdCalendarInput): Promise<void> {
  await authorizedRequest(`/api/ad-calendar/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })
}

export async function deleteAdCalendar(id: string): Promise<void> {
  await authorizedRequest(`/api/ad-calendar/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function adCalendarStatusLabel(row: Pick<AdCalendarRow, 'status' | 'days_late'>): string {
  if (row.status === 'on_time') return 'Tepat waktu'
  if (row.status === 'upcoming') return 'Belum jatuh tempo'
  if (row.status === 'unpublished') return 'Belum tayang'
  const days = Math.max(1, row.days_late ?? 0)
  return `Terlambat ${days} hari`
}

export function adCalendarScoreText(row: Pick<AdCalendarRow, 'score' | 'status'>): string {
  if (row.status === 'upcoming' || row.score === null) return '-'
  return `${row.score}/10`
}

/** Persentase kedisiplinan dari total skor 0–10 per batch. */
export function disciplinePercent(score: number, batches: number): number | null {
  if (!Number.isFinite(score) || !Number.isFinite(batches) || batches <= 0) return null
  return (score / (batches * 10)) * 100
}
