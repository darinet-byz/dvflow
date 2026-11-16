// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MONTH_NAMES } from '../src/lib/date-range'
import { ToastProvider } from '../src/ui/Toast'

/** A79: Kalender Event — tampilan bulan/agenda, detail, dan form tambah. */
const sessionState = vi.hoisted(() => ({
  permissions: ['operasional.event_calendar', 'action.manage_event_calendar'] as string[],
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

const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const event = {
  id: EVENT_ID,
  product_code: 'BM',
  product_name: 'Bisnis Masteri',
  category: 'Webinar',
  event_date: '2026-11-20',
  start_time: '10:00:00',
  location: 'Zoom Meeting',
  created_at: '2026-11-16T01:00:00.000Z',
  updated_at: '2026-11-16T01:00:00.000Z',
}

const requestMock = vi.fn(async (path: string, init?: { method?: string }) => {
  if (path.startsWith('/api/event-calendar') && (init?.method === undefined || init.method === 'GET')) {
    return { events: [event], products: [{ code: 'BM', name: 'Bisnis Masteri' }] }
  }
  if (path === '/api/event-calendar' && init?.method === 'POST') return { event }
  if (path.startsWith('/api/event-calendar/') && init?.method === 'PATCH') return { updated: true }
  if (path.startsWith('/api/event-calendar/') && init?.method === 'DELETE') return { deleted: true }
  throw new Error(`Unexpected request: ${path}`)
})

vi.mock('../src/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/session')>()
  return { ...actual, authorizedRequest: requestMock }
})

const { EventCalendarPage } = await import('../src/pages/calendar/EventCalendarPage')

beforeEach(() => {
  requestMock.mockClear()
  sessionState.permissions = ['operasional.event_calendar', 'action.manage_event_calendar']
})
afterEach(cleanup)

function renderCalendar() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <EventCalendarPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('A79: Kalender Event', () => {
  it('menampilkan agenda dan detail event', async () => {
    renderCalendar()
    const matches = await screen.findAllByText('Zoom Meeting')
    expect(matches.length).toBeGreaterThan(0)

    fireEvent.click(matches[0]!)
    expect(await screen.findByText('Detail Event')).toBeTruthy()
    expect(screen.getByText('10:00 WIB')).toBeTruthy()
    expect(screen.getAllByText(/Bisnis Masteri/).length).toBeGreaterThan(0)
  })

  it('manajer menambah event dari form', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: '+ Tambah Event' }))

    fireEvent.change(await screen.findByLabelText('Nama Produk'), { target: { value: 'BM' } })
    fireEvent.change(screen.getByLabelText('Jenis Acara'), { target: { value: 'Workshop' } })
    fireEvent.change(screen.getByLabelText('Tanggal'), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText('Jam Mulai'), { target: { value: '09:30' } })
    fireEvent.change(screen.getByLabelText('Lokasi / Platform'), { target: { value: 'Hotel Solo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('/api/event-calendar', expect.objectContaining({
      method: 'POST',
      body: {
        product_code: 'BM',
        category: 'Workshop',
        event_date: '2026-12-01',
        start_time: '09:30',
        location: 'Hotel Solo',
      },
    })))
  })

  it('tanpa izin kelola, tombol tambah/edit/hapus tidak muncul', async () => {
    sessionState.permissions = ['operasional.event_calendar']
    renderCalendar()
    const matches = await screen.findAllByText('Zoom Meeting')
    expect(screen.queryByRole('button', { name: '+ Tambah Event' })).toBeNull()

    fireEvent.click(matches[0]!)
    expect(await screen.findByText('Detail Event')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull()
  })

  it('maksimal 3 chip per tanggal; +N lainnya membuka daftar lengkap hari itu', async () => {
    const now = new Date()
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-20`
    const many = [
      { ...event, id: 'e1', event_date: day, start_time: '08:00:00', category: 'Seminar', location: 'Hotel Solo' },
      { ...event, id: 'e2', event_date: day, start_time: '09:00:00', category: 'Webinar', location: 'Zoom A' },
      { ...event, id: 'e3', event_date: day, start_time: '10:00:00', category: 'Workshop', location: 'Zoom B' },
      { ...event, id: 'e4', event_date: day, start_time: '11:00:00', category: 'Webinar', location: 'Zoom C' },
    ]
    requestMock.mockImplementationOnce(async () => ({
      events: many,
      products: [{ code: 'BM', name: 'Bisnis Masteri' }],
    }))

    renderCalendar()
    fireEvent.click(await screen.findByText('+1 lainnya'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Hotel Solo')).toBeTruthy()
    expect(within(dialog).getByText('Zoom C')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '+ Tambah Event' })).toBeTruthy()
  })

  it('agenda berurutan Tanggal-Produk-Jenis-Jam-Lokasi dan dikelompokkan per produk', async () => {
    const now = new Date()
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-20`
    const expectedDate = `20 ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`
    const rows = [
      { ...event, id: 'b1', product_code: 'B1', product_name: 'Produk B', event_date: day, start_time: '09:00:00', category: 'Webinar', location: 'Lokasi B1' },
      { ...event, id: 'a1', product_code: 'A1', product_name: 'Produk A', event_date: day, start_time: '10:00:00', category: 'Seminar', location: 'Lokasi A1' },
      { ...event, id: 'b2', product_code: 'B1', product_name: 'Produk B', event_date: day, start_time: '08:00:00', category: 'Webinar', location: 'Lokasi B2' },
      { ...event, id: 'a2', product_code: 'A1', product_name: 'Produk A', event_date: day, start_time: '11:00:00', category: 'Seminar', location: 'Lokasi A2' },
    ]
    requestMock.mockImplementationOnce(async () => ({
      events: rows,
      products: [{ code: 'A1', name: 'Produk A' }, { code: 'B1', name: 'Produk B' }],
    }))

    renderCalendar()
    const agendaRows = await screen.findAllByRole('button', { name: /Produk A|Produk B/ })
    const texts = agendaRows.map((row) => row.textContent ?? '')

    expect(texts).toHaveLength(4)
    expect(texts[0]).toContain('A1 — Produk A')
    expect(texts[0]).toContain('10:00')
    expect(texts[1]).toContain('A1 — Produk A')
    expect(texts[1]).toContain('11:00')
    expect(texts[2]).toContain('B1 — Produk B')
    expect(texts[2]).toContain('08:00')
    expect(texts[3]).toContain('B1 — Produk B')
    expect(texts[3]).toContain('09:00')

    const positions = [expectedDate, 'A1 — Produk A', 'Lokasi A1', '10:00', 'Seminar']
      .map((value) => texts[0]!.indexOf(value))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)

    const dateCell = within(agendaRows[0]!).getByText(expectedDate)
    expect(dateCell.className).toContain('whitespace-nowrap')

    const locationCell = within(agendaRows[0]!).getByText('Lokasi A1')
    expect(locationCell.className).toContain('w-[42ch]')
    expect(locationCell.className).toContain('break-words')
  })
})
