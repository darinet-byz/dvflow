// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { CommonFilters } from '../src/lib/filters'

/** A59: Data per Sesi — Resume Batch yang dipindahkan ke Dashboard. */
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/queries')>()),
  fetchDashboardSessionSummary: vi.fn(),
}))

const { SessionSummaryCard, advertiserLabel, sessionLabel } = await import(
  '../src/pages/dashboard/SessionSummaryCard'
)
const { fetchDashboardSessionSummary } = await import('../src/lib/queries')

const FILTERS: CommonFilters = {
  search: '',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31',
  productCode: 'KM',
  advertiserCode: '',
  eventType: '',
  batch: '392',
  session: '',
  city: '',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Data per Sesi: label', () => {
  it('pengiklan, OTS, dan order tanpa pengiklan', () => {
    expect(advertiserLabel({ advertiser_code: '01', advertiser_name: 'Zul', ots: false, tickets: 3 })).toBe('Zul (01)')
    expect(advertiserLabel({ advertiser_code: '02', advertiser_name: null, ots: false, tickets: 1 })).toBe('02')
    expect(advertiserLabel({ advertiser_code: null, advertiser_name: null, ots: true, tickets: 1 })).toBe('OTS (bayar di lokasi)')
    expect(advertiserLabel({ advertiser_code: null, advertiser_name: null, ots: false, tickets: 1 })).toBe('Tanpa pengiklan')
  })

  it('sesi + kota; webinar tanpa kota', () => {
    expect(sessionLabel({ session: 'S1', city: 'Solo' })).toBe('S1 · Solo')
    expect(sessionLabel({ session: 'S2', city: null })).toBe('S2')
    expect(sessionLabel({ session: null, city: null })).toBe('Tanpa sesi')
  })
})

describe('Data per Sesi: kartu Dashboard', () => {
  it('produk/batch belum lengkap -> tabel kosong dengan instruksi, RPC tidak dipanggil', () => {
    render(<SessionSummaryCard filters={{ ...FILTERS, productCode: '', batch: '' }} />)

    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('Pilih spesifik produk dan batch')).toBeTruthy()
    expect(fetchDashboardSessionSummary).not.toHaveBeenCalled()
  })

  it('filter lengkap -> RPC memakai seluruh filter dan rincian pengiklan bisa dibuka', async () => {
    vi.mocked(fetchDashboardSessionSummary).mockResolvedValue({
      summary: { tickets: 7, sessions: 2 },
      rows: [
        {
          session: 'S1',
          city: 'Solo',
          event_type: 'Seminar Offline',
          tickets: 5,
          advertisers: [
            { advertiser_code: '01', advertiser_name: 'Zul', ots: false, tickets: 3 },
            { advertiser_code: null, advertiser_name: null, ots: true, tickets: 2 },
          ],
        },
        {
          session: 'S2',
          city: 'Semarang',
          event_type: 'Seminar Offline',
          tickets: 2,
          advertisers: [{ advertiser_code: '02', advertiser_name: 'Rina', ots: false, tickets: 2 }],
        },
      ],
    })

    render(
      <SessionSummaryCard
        filters={{ ...FILTERS, advertiserCode: '01', eventType: 'Seminar Offline', city: 'Solo' }}
      />,
    )

    await vi.waitFor(() =>
      expect(fetchDashboardSessionSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          productCode: 'KM',
          batch: '392',
          advertiserCode: '01',
          eventType: 'Seminar Offline',
          city: 'Solo',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-31',
        }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'S1' }))
    const drawer = screen.getByRole('dialog', { name: 'Sesi S1 · Solo' })
    expect(within(drawer).getByText('Zul (01)')).toBeTruthy()
    expect(within(drawer).getByText('OTS (bayar di lokasi)')).toBeTruthy()
    expect(screen.getByText('7 tiket · 2 sesi')).toBeTruthy()
  })
})
