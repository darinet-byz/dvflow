// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'
import { ReportSpendPage } from '../src/pages/report-spend/ReportSpendPage'

/** A88: card template, laporan harian, tab Berjalan/Selesai, Aktifkan resume. */
const fixture = vi.hoisted(() => ({
  summary: { reports: 2, spend: 12000000, tax_amount: 660000, total_spend: 12660000, leads: 8, paid: 6, tickets: 7, omzet: 1250000 },
  cards: [{
    id: 'card-1', name: 'Card Batch 122', status: 'berjalan',
    product_code: 'AAAA', product_name: 'Produk A', advertiser_code: '91', advertiser_name: 'Zul',
    batch: '122', event_type: 'Seminar Offline', own: true, can_edit: true,
  }],
  entries: [{
    id: 'entry-1', card_id: 'card-1', card_name: 'Card Batch 122',
    date_from: '2026-10-20', date_to: '2026-10-21', product_code: 'AAAA', product_name: 'Produk A',
    advertiser_code: '91', advertiser_name: 'Zul', batch: '122', event_type: 'Seminar Offline',
    spend: 10000000, tax_amount: 660000, tax_percent: 6.6, total_spend: 10660000,
    leads: 3, paid: 2, tickets: 3, omzet: 250000, own: true, can_edit: true,
    spends: [
      { id: 'line-1', date_from: '2026-10-20', date_to: '2026-10-21', spend: 6000000, tax_percent: 11, tax_amount: 660000 },
      { id: 'line-2', date_from: '2026-10-20', date_to: '2026-10-21', spend: 4000000, tax_percent: 0, tax_amount: 0 },
    ],
  }],
  resumes: [{
    id: 'resume-1', card_id: 'card-2', name: 'Card Selesai', status: 'draft', frozen: false,
    date_from: '2026-10-01', date_to: '2026-10-02', finished_at: '2026-10-03T12:00:00.000Z', retention_until: '2027-01-02',
    product_code: 'AAAA', product_name: 'Produk A', advertiser_code: '91', advertiser_name: 'Zul',
    batch: '200', event_type: 'Webinar Online', spend: 2000000, tax_amount: 0, tax_percent: 0,
    total_spend: 2000000, leads: 5, paid: 4, tickets: 4, omzet: 1000000,
    own: true, can_edit: true, can_activate: true,
    entries: [{ id: 'day-1', date_from: '2026-10-01', date_to: '2026-10-02', spend: 2000000, tax_amount: 0 }],
  }],
  sessions: { tickets: 3, advertisers: [{ advertiser_code: '91', advertiser_name: 'Zul', tickets: 3 }], rows: [] },
  comparison: { totals: { spend: 0, tax_amount: 0, total_spend: 0, leads: 0, paid: 0, tickets: 0, omzet: 0 }, rows: [] },
}))

const session = vi.hoisted(() => ({
  profile: {
    user_id: '1', username: 'zul', role: 'advertiser', display_name: 'Zul', avatar_emoji: null,
    advertiser_code: '91', permissions: ['operasional.report_spend', 'action.input_spend'],
  },
}))

vi.mock('../src/lib/supabase-rest', () => ({
  supabaseRpc: vi.fn(async () => fixture),
  supabaseSelect: vi.fn(async () => []),
}))
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn(async () => ({ action: 'updated' })) }))
vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: session.profile }) }))
vi.mock('../src/lib/useConfigLists', () => ({
  useConfigLists: () => ({
    lists: {
      products: [
        { value: 'AAAA', label: 'AAAA - Produk A' },
        { value: 'BBBB', label: 'BBBB - Produk B' },
      ],
      advertisers: [{ value: '91', label: '91 - Zul' }],
      eventTypes: [],
      eventTypeNames: [],
      sessions: [],
      paymentMethods: [],
    },
    error: null,
  }),
}))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.mocked(authorizedRequest).mockClear()
})

describe('Card Report A88', () => {
  it('card hanya menampilkan setting + Tambah Laporan; simpan laporan mengirim budget per baris', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Tiket Paid per Sesi', {}, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Laporan Iklan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Laporan' }))

    const budgets = screen.getAllByLabelText('Budget (Rp)') as HTMLInputElement[]
    const taxes = screen.getAllByLabelText('PPN (%)') as HTMLInputElement[]
    fireEvent.change(budgets[0]!, { target: { value: '6000000' } })
    fireEvent.change(taxes[0]!, { target: { value: '11' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Tambah Budget' }))
    const nextBudgets = screen.getAllByLabelText('Budget (Rp)') as HTMLInputElement[]
    const nextTaxes = screen.getAllByLabelText('PPN (%)') as HTMLInputElement[]
    fireEvent.change(nextBudgets[1]!, { target: { value: '4000000' } })
    fireEvent.change(nextTaxes[1]!, { target: { value: '0' } })

    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalled())
    const [path, options] = vi.mocked(authorizedRequest).mock.calls.at(-1)!
    expect(path).toBe('/api/ad-spend-cards/card-1/reports')
    const body = (options as { body: { spends: Array<{ spend: number; tax_percent: number }> } }).body
    expect(body.spends).toEqual([
      { id: null, spend: 6000000, tax_percent: 11 },
      { id: null, spend: 4000000, tax_percent: 0 },
    ])
  })

  it('edit laporan memakai entry yang ada; PPN baris lain tidak bergeser', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Tiket Paid per Sesi', {}, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const budgets = screen.getAllByLabelText('Budget (Rp)') as HTMLInputElement[]
    const taxes = screen.getAllByLabelText('PPN (%)') as HTMLInputElement[]
    expect(budgets.map((input) => input.value)).toEqual(['6000000', '4000000'])
    expect(taxes.map((input) => input.value)).toEqual(['11', '0'])
    fireEvent.change(taxes[1]!, { target: { value: '5' } })
    expect(taxes[0]!.value).toBe('11')

    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalled())
    const [path, options] = vi.mocked(authorizedRequest).mock.calls.at(-1)!
    expect(path).toBe('/api/ad-spend-cards/card-1/reports/entry-1')
    const body = (options as { body: { spends: Array<{ id: string | null; spend: number; tax_percent: number }> } }).body
    expect(body.spends.map((line) => ({ id: line.id, spend: line.spend, tax: line.tax_percent }))).toEqual([
      { id: 'line-1', spend: 6000000, tax: 11 },
      { id: 'line-2', spend: 4000000, tax: 5 },
    ])
  })

  it('tab Selesai menampilkan resume draft; Aktifkan memanggil endpoint activate', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Tiket Paid per Sesi', {}, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Laporan Selesai' }))
    await screen.findByText('Card Selesai')
    expect(screen.getByText('Ditandai Selesai')).toBeTruthy()
    expect(screen.getByText(/03 Okt 2026/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Detail' }))
    expect(await screen.findByText('Laporan Harian')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Aktifkan' }).at(-1)!)
    expect(await screen.findByText('Aktifkan Card')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Aktifkan' }).at(-1)!)

    await waitFor(() => expect(authorizedRequest).toHaveBeenCalled())
    const [path] = vi.mocked(authorizedRequest).mock.calls.at(-1)!
    expect(path).toBe('/api/ad-spend-cards/card-2/activate')
  })

  it('tombol Selesai di card memanggil finish', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Tiket Paid per Sesi', {}, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Laporan Iklan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalled())
    const [path] = vi.mocked(authorizedRequest).mock.calls.at(-1)!
    expect(path).toBe('/api/ad-spend-cards/card-1/finish')
  })

  it('buat card hanya mengirim setting, tanpa budget', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Tiket Paid per Sesi', {}, { timeout: 5000 })
    fireEvent.change(screen.getByLabelText('Filter produk'), { target: { value: 'AAAA' } })
    fireEvent.change(screen.getByLabelText('Filter batch'), { target: { value: '122' } })
    fireEvent.click(screen.getByRole('button', { name: 'Laporan Iklan' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Buat Kartu Baru' }))
    fireEvent.change(screen.getByLabelText('Nama Card'), { target: { value: 'Card Baru' } })
    fireEvent.change(screen.getByLabelText('Jenis Acara'), { target: { value: 'Seminar Offline' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(authorizedRequest).toHaveBeenCalled())
    const [path, options] = vi.mocked(authorizedRequest).mock.calls.at(-1)!
    expect(path).toBe('/api/ad-spend-cards')
    const body = (options as { body: Record<string, unknown> }).body
    expect(body).toMatchObject({ product_code: 'AAAA', batch: '122', event_type: 'Seminar Offline' })
    expect(body).not.toHaveProperty('spends')
  })

  it('urutan bagian: KPI, Tiket per Sesi, Perbandingan Pengiklan, lalu tabel laporan', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Tiket Paid per Sesi', {}, { timeout: 5000 })
    fireEvent.change(screen.getByLabelText('Filter produk'), { target: { value: 'AAAA' } })
    fireEvent.change(screen.getByLabelText('Filter batch'), { target: { value: '122' } })

    const order = (left: HTMLElement, right: HTMLElement): number => left.compareDocumentPosition(right)
    const kpi = screen.getByText('Jumlah Tiket')
    const tickets = screen.getByText('Tiket Paid per Sesi')
    const comparison = await screen.findByText('Perbandingan Pengiklan')
    const runningTab = screen.getByRole('button', { name: 'Laporan Berjalan' })

    expect(order(kpi, tickets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order(tickets, comparison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order(comparison, runningTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('tombol Laporan Iklan membuka popup kartu dengan filter produk', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Tiket Paid per Sesi', {}, { timeout: 5000 })
    expect(screen.queryByRole('button', { name: 'Tambah Laporan' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Laporan Iklan' }))
    expect(screen.getByRole('button', { name: '+ Buat Kartu Baru' })).toBeTruthy()
    expect(screen.getByLabelText('Filter berdasarkan produk')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tambah Laporan' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filter berdasarkan produk'), { target: { value: 'BBBB' } })
    expect(await screen.findByText('Tidak ada kartu laporan untuk produk ini.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filter berdasarkan produk'), { target: { value: 'AAAA' } })
    expect(await screen.findByRole('button', { name: 'Tambah Laporan' })).toBeTruthy()
  })
})
