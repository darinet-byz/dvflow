// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'
import { ReportSpendPage } from '../src/pages/report-spend/ReportSpendPage'

/** A87: satu card banyak baris budget; PPN tiap baris tidak boleh tertukar. */
const fixture = vi.hoisted(() => ({
  summary: { reports: 1, spend: 10000000, tax_amount: 660000, total_spend: 10660000, leads: 3, paid: 2, omzet: 250000 },
  cards: [{
    id: 'card-1', name: 'Card Batch 122', status: 'berjalan',
    date_from: '2026-10-20', date_to: '2026-10-21', product_code: 'AAAA', product_name: 'Produk A',
    advertiser_code: '91', advertiser_name: 'Zul', batch: '122', event_type: 'Seminar Offline',
    spend: 10000000, tax_percent: 6.6, tax_amount: 660000, total_spend: 10660000,
    leads: 3, paid: 2, tickets: 3, omzet: 250000, own: true, can_edit: true,
    spends: [
      { id: 'line-1', date_from: '2026-10-20', date_to: '2026-10-21', spend: 6000000, tax_percent: 11, tax_amount: 660000 },
      { id: 'line-2', date_from: '2026-10-20', date_to: '2026-10-21', spend: 4000000, tax_percent: 0, tax_amount: 0 },
    ],
  }],
  rows: [],
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
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn(async () => ({ action: 'updated', id: 'card-1' })) }))
vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: session.profile }) }))
vi.mock('../src/lib/useConfigLists', () => ({
  useConfigLists: () => ({
    lists: {
      products: [{ value: 'AAAA', label: 'AAAA - Produk A' }],
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

describe('Card Report: baris budget', () => {
  it('PPN tiap baris tetap milik barisnya saat baris lain diubah/ditambah', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Card Batch 122', {}, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Budget' }))

    const budgets = screen.getAllByLabelText('Budget (Rp)') as HTMLInputElement[]
    const taxes = screen.getAllByLabelText('PPN (%)') as HTMLInputElement[]
    expect(budgets).toHaveLength(2)
    expect(taxes.map((input) => input.value)).toEqual(['11', '0'])

    fireEvent.change(taxes[1]!, { target: { value: '5' } })
    expect(taxes[0]!.value).toBe('11')

    fireEvent.click(screen.getByRole('button', { name: '+ Tambah Budget' }))
    const nextBudgets = screen.getAllByLabelText('Budget (Rp)') as HTMLInputElement[]
    const nextTaxes = screen.getAllByLabelText('PPN (%)') as HTMLInputElement[]
    expect(nextBudgets).toHaveLength(3)
    expect(nextTaxes[2]!.value).toBe('')
    fireEvent.change(nextBudgets[2]!, { target: { value: '1000000' } })
    fireEvent.change(nextTaxes[2]!, { target: { value: '2' } })

    // Baris lama tidak bergeser.
    expect(nextBudgets[0]!.value).toBe('6000000')
    expect(nextTaxes[0]!.value).toBe('11')
    expect(nextBudgets[1]!.value).toBe('4000000')
    expect(nextTaxes[1]!.value).toBe('5')

    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalled())
    const [path, options] = vi.mocked(authorizedRequest).mock.calls.at(-1)!
    expect(path).toBe('/api/ad-spend-cards/card-1')
    const body = (options as { body: { spends: Array<{ spend: number; tax_percent: number; id: string | null }> } }).body
    expect(body.spends.map((line) => ({ id: line.id, spend: line.spend, tax: line.tax_percent }))).toEqual([
      { id: 'line-1', spend: 6000000, tax: 11 },
      { id: 'line-2', spend: 4000000, tax: 5 },
      { id: null, spend: 1000000, tax: 2 },
    ])
  })

  it('buat card baru mengirim produk/batch/jenis dan dua PPN terpisah', async () => {
    vi.mocked(authorizedRequest).mockResolvedValueOnce({ action: 'created', id: 'card-new' })
    render(<ReportSpendPage />)
    await screen.findByText('Card Batch 122', {}, { timeout: 5000 })

    fireEvent.change(screen.getByLabelText('Filter produk'), { target: { value: 'AAAA' } })
    fireEvent.change(screen.getByLabelText('Filter batch'), { target: { value: '122' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Buat Card Report' }))
    fireEvent.change(screen.getByLabelText('Nama Card'), { target: { value: 'Card Baru' } })
    fireEvent.change(screen.getByLabelText('Jenis Acara'), { target: { value: 'Seminar Offline' } })

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
    expect(path).toBe('/api/ad-spend-cards')
    const body = (options as { body: { product_code: string; batch: string; event_type: string; spends: Array<{ tax_percent: number }> } }).body
    expect(body.product_code).toBe('AAAA')
    expect(body.batch).toBe('122')
    expect(body.event_type).toBe('Seminar Offline')
    expect(body.spends.map((line) => line.tax_percent)).toEqual([11, 0])
  })
})
