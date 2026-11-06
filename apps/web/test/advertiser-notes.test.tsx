// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../src/ui/Toast'

/**
 * Panel Advertiser Notes: minimized dulu, dibuka lewat tombol Notes, lalu
 * menampilkan daftar dan detail note. Data jaringan diganti tiruan.
 */
vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: '1',
      username: 'manajer',
      role: 'manajer',
      display_name: 'Manajer',
      avatar_emoji: null,
      permissions: ['operasional.advertiser_notes', 'action.manage_advertiser_notes'],
    },
  }),
}))

const note = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Seminar Solo',
  description: 'Jalankan iklan sebelum deadline.',
  batch: '122',
  event_at: '2026-11-20T10:00:00.000Z',
  location: 'Solo',
  monitor_from: '2026-11-06',
  deadline_at: '2026-11-10T10:00:00.000Z',
  status: 'Aktif',
  product_code: 'KM',
  product_name: 'Kuliner Masteri',
  advertiser_code: '01',
  advertiser_name: 'Zul',
  created_by_name: 'Manajer',
  created_at: '2026-11-06T01:00:00.000Z',
  updated_at: '2026-11-06T01:00:00.000Z',
  orders: 3,
  paid: 2,
  tickets: 4,
  omzet: 600000,
  last_order_at: '2026-11-06T02:00:00.000Z',
  spend_reports: 1,
  spend_total: 250000,
  last_spend_date: '2026-11-05',
  last_spend_input_at: '2026-11-06T03:00:00.000Z',
  activity_status: 'Spend Masuk',
  overdue: false,
  due_soon: false,
}

vi.mock('../src/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/session')>()
  return {
    ...actual,
    authorizedRequest: vi.fn(async (path: string) => {
      if (path.startsWith('/api/advertiser-notes')) {
        return {
          rows: [note],
          total: 1,
          page: 1,
          pageSize: 100,
          summary: { total: 1, active: 1, overdue: 0, due_soon: 0, spend_missing: 0 },
          badge: 1,
        }
      }
      throw new Error(`Unexpected request: ${path}`)
    }),
  }
})

vi.mock('../src/lib/supabase-rest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/supabase-rest')>()
  return {
    ...actual,
    supabaseSelect: vi.fn(async (table: string) => table === 'products'
      ? [{ code: 'KM', name: 'Kuliner Masteri' }]
      : [{ code: '01', name: 'Zul' }]),
    supabaseRpc: vi.fn(async () => ({ batches: [] })),
  }
})

const { AdvertiserNotesWorkspace } = await import('../src/pages/notes/AdvertiserNotesWorkspace')
beforeEach(() => {
  try { window.localStorage.clear() } catch { /* jsdom tanpa localStorage */ }
})
afterEach(cleanup)

describe('Advertiser Notes panel', () => {
  it('minimized dulu; tombol Notes membuka daftar dan detail', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AdvertiserNotesWorkspace />
        </ToastProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Buka Advertiser Notes' }))
    expect(await screen.findByText('Seminar Solo')).toBeTruthy()
    fireEvent.click(screen.getByText('Seminar Solo'))
    expect(await screen.findByText('Lihat Order')).toBeTruthy()
    expect(screen.getByText('Lihat Report Spend')).toBeTruthy()
    expect(screen.getByText('Spend Masuk')).toBeTruthy()
  })

  it('manajer bisa membuka form buat note', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AdvertiserNotesWorkspace />
        </ToastProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Buka Advertiser Notes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Buat catatan pengiklan' }))
    expect(screen.getByText('Buat Catatan')).toBeTruthy()
    expect(screen.getByLabelText('Pengiklan')).toBeTruthy()
    expect(screen.getByLabelText('Produk')).toBeTruthy()
    expect(screen.getByLabelText('Deadline iklan running')).toBeTruthy()
  })
})
