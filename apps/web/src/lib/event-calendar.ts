import { authorizedRequest } from './session'

/** A79: Kalender Event — Seminar / Webinar / Workshop per produk. */
export const EVENT_CATEGORIES = ['Seminar', 'Webinar', 'Workshop'] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export type CalendarProduct = { code: string; name: string }

export type CalendarEvent = {
  id: string
  product_code: string
  product_name: string
  category: EventCategory
  event_date: string
  /** "HH:MM" atau "HH:MM:SS" dari kolom time. */
  start_time: string
  location: string
  /** A82: kota opsional; diisi manual atau oleh Citta. */
  city: string | null
  source?: 'manual' | 'ai'
  created_at: string
  updated_at: string
}

export type EventCalendarPage = {
  events: CalendarEvent[]
  products: CalendarProduct[]
}

export type SaveEventInput = {
  product_code: string
  category: string
  event_date: string
  start_time: string
  location: string
  city?: string
}

export async function fetchEventCalendar(from: string, to: string): Promise<EventCalendarPage> {
  const params = new URLSearchParams({ from, to })
  return authorizedRequest<EventCalendarPage>(`/api/event-calendar?${params.toString()}`)
}

export async function createEventCalendar(input: SaveEventInput): Promise<void> {
  await authorizedRequest('/api/event-calendar', { method: 'POST', body: input })
}

export async function updateEventCalendar(id: string, input: SaveEventInput): Promise<void> {
  await authorizedRequest(`/api/event-calendar/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })
}

export async function deleteEventCalendar(id: string): Promise<void> {
  await authorizedRequest(`/api/event-calendar/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** "10:00:00" -> "10:00" untuk input type=time dan tampilan ringkas. */
export function shortTime(value: string): string {
  return value.slice(0, 5)
}
