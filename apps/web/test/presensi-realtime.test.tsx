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

  it('A73: kartu Sisa Tiket membuka daftar order Hadir Sebagian dan bisa ditutup', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('tab', { name: 'Realtime Presensi' }))
    const card = await screen.findByRole('button', { name: 'Tampilkan order penyumbang Sisa Tiket' })
    expect(card.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(card)

    expect(queries.fetchPresensiPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ attendanceStatus: 'Hadir Sebagian' }),
      expect.anything(),
      'attendance',
    )
    expect(
      (await screen.findByRole('button', { name: 'Tampilkan order penyumbang Sisa Tiket' })).getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan order penyumbang Sisa Tiket' }))

    expect(queries.fetchPresensiPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ attendanceStatus: '' }),
      expect.anything(),
      'attendance',
    )
  })

  it('A73: baris Hadir Sebagian menyebut sisa tiketnya', async () => {
    vi.mocked(queries.fetchPresensiPage).mockResolvedValue({
      total: 1,
      page: 1,
      page_size: 50,
      rows: [{
        order_id: 'ORD-000042',
        name: 'Rombongan Keluarga',
        phone: '081200000042',
        product_code: 'PRTD',
        product_name: 'Produk Uji',
        advertiser_code: '01',
        advertiser_name: 'Pengiklan Uji',
        event_type: 'Seminar Offline',
        batch: 'B1',
        session: 'S1',
        city: 'Jakarta',
        product_parse_status: 'valid',
        app_status: 'Paid',
        gross_amount: 400000,
        quantity: 4,
        checked_in_tickets: 1,
        checked_in_in_range: 1,
        attendance_data_expired: false,
        attendance_status: 'Hadir Sebagian',
        total_activity: 1,
        latest_activity: '2026-11-12T02:00:00Z',
        timestamps: ['2026-11-12T02:00:00Z'],
        created_at: '2026-11-01T02:00:00Z',
        paid_at: null,
        updated_at: '2026-11-12T02:00:00Z',
      }],
    })

    renderPage()

    fireEvent.click(await screen.findByRole('tab', { name: 'Realtime Presensi' }))

    expect(await screen.findByText('1/4')).toBeDefined()
    expect(await screen.findByText('sisa 3')).toBeDefined()
  })
})
