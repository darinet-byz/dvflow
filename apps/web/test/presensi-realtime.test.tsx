// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * A68: halaman Presensi Acara punya dua basis tanggal.
 *   * Berdasarkan Order  -> p_date_mode 'order'
 *   * Realtime Presensi  -> p_date_mode 'attendance'
 * KPI juga harus menampilkan total tiket + OTS, bukan hanya salah satu sumber.
 */

vi.mock('../src/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/queries')>()
  return {
    ...actual,
    fetchPresensiSummary: vi.fn(async () => ({
      paid_tickets: 5,
      sudah_hadir: 3,
      belum_hadir: 2,
      attendance_rate: 0.6,
      paid_tickets_online: 3,
      paid_tickets_ots: 2,
      sudah_hadir_online: 2,
      sudah_hadir_ots: 1,
      attending_orders: 2,
    })),
    fetchPresensiPage: vi.fn(async () => ({ rows: [], total: 0, page: 1, page_size: 50 })),
    fetchConfigLists: vi.fn(async () => ({
      products: [],
      advertisers: [],
      eventTypes: [],
      eventTypeNames: [],
      sessions: [],
      paymentMethods: [],
    })),
  }
})

const { PresensiPage } = await import('../src/pages/presensi/PresensiPage')
const { ToastProvider } = await import('../src/ui/Toast')
const queries = await import('../src/lib/queries')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <PresensiPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('A68: tab Presensi Acara', () => {
  it('default Berdasarkan Order memakai p_date_mode order dan menampilkan rincian Online/OTS', async () => {
    renderPage()

    const orderTab = await screen.findByRole('tab', { name: 'Berdasarkan Order' })
    expect(orderTab.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText(/Online 2 · OTS 1/)).toBeDefined()
    expect(queries.fetchPresensiPage).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'order')
    expect(queries.fetchPresensiSummary).toHaveBeenCalledWith(expect.anything(), 'order')
  })

  it('tab Realtime Presensi memakai p_date_mode attendance dan card Total Peserta Hari Ini', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('tab', { name: 'Realtime Presensi' }))

    expect(await screen.findByText('Total Peserta Hari Ini')).toBeDefined()
    expect(screen.getByText(/tiap 5 detik/)).toBeDefined()
    expect(queries.fetchPresensiPage).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'attendance')
    expect(queries.fetchPresensiSummary).toHaveBeenLastCalledWith(expect.anything(), 'attendance')
  })
})
