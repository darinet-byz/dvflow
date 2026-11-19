// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../src/ui/Toast'

/** A80: tab Kalender Iklan — deadline batch, status turunan, dan form. */
const sessionState = vi.hoisted(() => ({
  permissions: ['operasional.event_calendar', 'action.manage_event_calendar', 'action.manage_ad_calendar'] as string[],
}))

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: 'user-main',
      username: 'manajer',
      role: 'manajer',
      display_name: 'Manajer',
      avatar_emoji: null,
      permissions: sessionState.permissions,
    },
  }),
}))
vi.mock('../src/lib/supabase-rest', () => ({ supabaseRpc: vi.fn(async () => ({ batches: [] })) }))

const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const ROW_ID = '33333333-3333-4333-8333-333333333333'

const adPage = {
  rows: [
    {
      id: ROW_ID,
      event_id: EVENT_ID,
      event_date: '2026-11-25',
      category: 'Webinar',
      start_time: '10:00:00',
      location: 'Zoom Meeting',
      product_code: 'BM',
      product_name: 'Bisnis Masteri',
      advertiser_code: '01',
      advertiser_name: 'Zul',
      batch: '392',
      deadline_date: '2026-11-10',
      publish_date: '2026-11-08',
      publish_source: 'order',
      days_late: -2,
      score: 10,
      status: 'on_time',
    },
  ],
  products: [{ code: 'BM', name: 'Bisnis Masteri' }],
  advertisers: [{ code: '01', name: 'Zul' }],
  events: [
    {
      id: EVENT_ID,
      product_code: 'BM',
      product_name: 'Bisnis Masteri',
      category: 'Webinar',
      event_date: '2026-11-25',
      start_time: '10:00:00',
      location: 'Zoom Meeting',
    },
  ],
}

const requestMock = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
  if (path.startsWith('/api/event-calendar') && (init?.method === undefined || init.method === 'GET')) {
    return { events: [], products: [{ code: 'BM', name: 'Bisnis Masteri' }] }
  }
  if (path.startsWith('/api/ad-calendar') && (init?.method === undefined || init.method === 'GET')) return adPage
  if (path === '/api/ad-calendar' && init?.method === 'POST') return { calendar: { id: 'new-id' } }
  if (path.startsWith('/api/ad-calendar/') && init?.method === 'PATCH') return { updated: true }
  if (path.startsWith('/api/ad-calendar/') && init?.method === 'DELETE') return { deleted: true }
  throw new Error(`Unexpected request: ${path}`)
})

vi.mock('../src/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/session')>()
  return { ...actual, authorizedRequest: requestMock }
})

const { CalendarPage } = await import('../src/pages/calendar/CalendarPage')

beforeEach(() => {
  requestMock.mockClear()
  sessionState.permissions = ['operasional.event_calendar', 'action.manage_event_calendar', 'action.manage_ad_calendar']
})
afterEach(cleanup)

function renderCalendar() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <CalendarPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('A80: Kalender Iklan', () => {
  it('membuka tab Kalender Iklan dan menampilkan deadline + status', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('tab', { name: 'Kalender Iklan' }))

    expect(await screen.findByText('Agenda Deadline November 2026')).toBeTruthy()
    expect(screen.getAllByText(/Zul/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Tepat waktu/).length).toBeGreaterThan(0)
    expect(screen.getByText('10/10')).toBeTruthy()
    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining('/api/ad-calendar?'))
  })

  it('menambah deadline lewat form', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('tab', { name: 'Kalender Iklan' }))
    fireEvent.click(await screen.findByRole('button', { name: '+ Tambah Deadline' }))

    fireEvent.change(screen.getByLabelText('Event'), { target: { value: EVENT_ID } })
    fireEvent.change(screen.getByLabelText('Pengiklan'), { target: { value: '01' } })
    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: '392' } })
    fireEvent.change(screen.getByLabelText('Tanggal Deadline Tayang'), { target: { value: '2026-11-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/api/ad-calendar', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ event_id: EVENT_ID, advertiser_code: '01', batch: '392', deadline_date: '2026-11-20' }),
      }))
    })
  })

  it('membuka detail deadline dari agenda', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('tab', { name: 'Kalender Iklan' }))
    expect(await screen.findByText('Agenda Deadline November 2026')).toBeTruthy()
    fireEvent.click(screen.getByText(/Batch 392/).closest('button') as HTMLElement)

    expect(await screen.findByText('Detail Deadline Iklan')).toBeTruthy()
    expect(screen.getByText('Tanggal Tayang')).toBeTruthy()
    expect(screen.getAllByText(/8 November 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/leads/).length).toBeGreaterThan(0)
  })
})
