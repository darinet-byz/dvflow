// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { canAccessPath } from '../src/lib/roles'
import { supabaseRpc } from '../src/lib/supabase-rest'

/** A39: Resume Batch — tiket Paid per sesi dalam satu batch, gabungan semua pengiklan. */
vi.mock('../src/lib/supabase-rest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabase-rest')>()),
  supabaseRpc: vi.fn(),
}))
vi.mock('../src/lib/useConfigLists', () => ({
  useConfigLists: () => ({
    lists: {
      products: [{ value: 'KM', label: 'KM — Kuliner Masteri' }],
      advertisers: [],
      eventTypes: [],
      eventTypeNames: [{ value: 'Seminar Offline', label: 'Seminar Offline' }],
      sessions: [],
    },
    error: null,
  }),
}))

const { ResumeBatchPage, advertiserLabel, sessionLabel } = await import('../src/pages/resume-batch/ResumeBatchPage')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Resume Batch: label', () => {
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

describe('Resume Batch: halaman', () => {
  it('tanpa produk + batch tidak memanggil RPC', () => {
    render(<ResumeBatchPage />)
    expect(screen.getByText('Pilih produk dan isi batch')).toBeTruthy()
    expect(supabaseRpc).not.toHaveBeenCalled()
  })

  it('menampilkan tiket per sesi dan rincian per pengiklan', async () => {
    vi.mocked(supabaseRpc).mockResolvedValue({
      summary: { tickets: 7, sessions: 2 },
      rows: [
        {
          session: 'S1', city: 'Solo', event_type: 'Seminar Offline', tickets: 5,
          advertisers: [
            { advertiser_code: '01', advertiser_name: 'Zul', ots: false, tickets: 3 },
            { advertiser_code: null, advertiser_name: null, ots: true, tickets: 2 },
          ],
        },
        { session: 'S2', city: 'Semarang', event_type: 'Seminar Offline', tickets: 2, advertisers: [{ advertiser_code: '02', advertiser_name: 'Rina', ots: false, tickets: 2 }] },
      ],
    })
    render(<ResumeBatchPage />)
    fireEvent.change(screen.getByLabelText('Filter produk'), { target: { value: 'KM' } })
    fireEvent.change(screen.getByLabelText('Filter batch'), { target: { value: '392' } })

    fireEvent.click(await screen.findByRole('button', { name: 'S1' }))
    expect(supabaseRpc).toHaveBeenCalledWith('batch_session_summary', { p_product_code: 'KM', p_batch: '392', p_event_type: null })
    const drawer = screen.getByRole('dialog', { name: 'Sesi S1 · Solo' })
    expect(within(drawer).getByText('Zul (01)')).toBeTruthy()
    expect(within(drawer).getByText('OTS (bayar di lokasi)')).toBeTruthy()
  })
})

describe('Resume Batch: izin', () => {
  it('halaman butuh izin operasional.resume_batch', () => {
    expect(canAccessPath({ role: 'manajer', permissions: ['operasional.resume_batch'] }, '/resume-batch')).toBe(true)
    expect(canAccessPath({ role: 'member', permissions: ['operasional.presensi'] }, '/resume-batch')).toBe(false)
    expect(canAccessPath({ role: 'owner', permissions: [] }, '/resume-batch')).toBe(true)
  })
})
