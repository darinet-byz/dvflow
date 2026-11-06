import { authorizedRequest } from './session'

export type AdvertiserNote = {
  id: string
  title: string
  description: string | null
  batch: string | null
  event_at: string
  location: string | null
  monitor_from: string
  deadline_at: string
  status: 'Draft' | 'Aktif' | 'Selesai' | 'Dibatalkan'
  product_code: string | null
  product_name: string | null
  advertiser_code: string | null
  advertiser_name: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  orders: number
  paid: number
  tickets: number
  omzet: number | string
  last_order_at: string | null
  spend_reports: number
  spend_total: number | string
  last_spend_date: string | null
  last_spend_input_at: string | null
  activity_status: 'Spend Masuk' | 'Order Masuk, Spend Belum' | 'Belum Ada Aktivitas'
  overdue: boolean
  due_soon: boolean
}

export type AdvertiserNotesPage = {
  rows: AdvertiserNote[]
  total: number
  page: number
  pageSize: number
  summary: {
    total: number
    active: number
    overdue: number
    due_soon: number
    spend_missing: number
  }
  badge: number
}

export type AdvertiserNoteFilters = {
  q: string
  status: string
  advertiserCode: string
  productCode: string
  batch: string
  deadlineFrom: string
  deadlineTo: string
  page?: number
  pageSize?: number
}

export type SaveAdvertiserNoteInput = {
  advertiser_code: string
  product_code: string
  batch: string
  title: string
  description: string
  event_at: string
  location: string
  monitor_from: string
  deadline_at: string
  status: string
}

export async function fetchAdvertiserNotes(filters: AdvertiserNoteFilters): Promise<AdvertiserNotesPage> {
  const params = new URLSearchParams()
  if (filters.q.trim()) params.set('q', filters.q.trim())
  if (filters.status) params.set('status', filters.status)
  if (filters.advertiserCode) params.set('advertiser_code', filters.advertiserCode)
  if (filters.productCode) params.set('product_code', filters.productCode)
  if (filters.batch.trim()) params.set('batch', filters.batch.trim())
  if (filters.deadlineFrom) params.set('deadline_from', filters.deadlineFrom)
  if (filters.deadlineTo) params.set('deadline_to', filters.deadlineTo)
  params.set('page', String(filters.page ?? 1))
  params.set('pageSize', String(filters.pageSize ?? 100))
  return authorizedRequest<AdvertiserNotesPage>(`/api/advertiser-notes?${params.toString()}`)
}

export async function saveAdvertiserNote(input: SaveAdvertiserNoteInput, id: string | null): Promise<void> {
  await authorizedRequest(id === null ? '/api/advertiser-notes' : `/api/advertiser-notes/${encodeURIComponent(id)}`, {
    method: id === null ? 'POST' : 'PATCH',
    body: input,
  })
}

export async function archiveAdvertiserNote(id: string): Promise<void> {
  await authorizedRequest(`/api/advertiser-notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Input datetime-local dianggap WIB, bukan zona waktu perangkat. */
export function toWibDateTimeInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour') === '24' ? '00' : value('hour')}:${value('minute')}`
}

export function fromWibDateTimeInput(value: string): string | null {
  if (value.trim() === '') return null
  const parsed = new Date(`${value}:00+07:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function wibToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

export function wibDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(iso))
}
