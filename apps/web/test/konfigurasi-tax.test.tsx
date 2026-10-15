// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Konfigurasi Tax (A15): kartu PLATFORM FEE dan contoh perhitungan Rp100.000 di form
 * metode pembayaran memakai rumus yang sama dengan server (shared/calculateFees).
 */

const PROFILE = {
  user_id: 'user-1', username: 'admin1', display_name: 'Admin', role: 'admin' as const,
  has_all_product_access: true, permissions: ['config.tax'], avatar_emoji: null,
}
vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: PROFILE }) }))
const authorizedRequest = vi.fn(async (path: string) => (path === '/api/config/platform-fee' ? { percent: 2 } : {}))
vi.mock('../src/lib/session', () => ({
  getAccessToken: () => 'token',
  authorizedRequest: (path: string, ...rest: unknown[]) => authorizedRequest(path, ...(rest as [])),
}))
vi.mock('../src/lib/supabase-rest', () => ({ supabaseRpc: vi.fn(), supabaseSelect: vi.fn(async () => []) }))

const { KonfigurasiTaxPage } = await import('../src/pages/config/KonfigurasiTaxPage')
const { ToastProvider } = await import('../src/ui/Toast')

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Konfigurasi Tax: platform fee & contoh perhitungan', () => {
  async function openForm() {
    render(<MemoryRouter><ToastProvider><KonfigurasiTaxPage /></ToastProvider></MemoryRouter>)
    expect(await screen.findByDisplayValue('2')).toBeDefined() // Platform Fee tersimpan 2%
    fireEvent.click(screen.getAllByRole('button', { name: /Tambah/ })[0]!)
    const dialog = await screen.findByRole('dialog')
    const set = (label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })
    const example = () => within(dialog).getByTestId('fee-example').textContent ?? ''
    return { dialog, set, example }
  }

  it('field persen dan flat terpisah; tidak ada lagi dropdown tipe', async () => {
    const { dialog } = await openForm()
    expect(within(dialog).getByLabelText('E-payment Fee — Persen (%)')).toBeDefined()
    expect(within(dialog).getByLabelText('E-payment Fee — Flat (Rp)')).toBeDefined()
    expect(within(dialog).queryByLabelText('E-payment Fee — Tipe')).toBeNull()
  })

  it('tanpa potongan apa pun: net = nominal order', async () => {
    const { example } = await openForm()
    expect(example()).toContain('Rp100.000')
    expect(example()).toMatch(/Nets*Rp100.000/)
  })

  it('flat Rp4.000 dihitung Rp4.000 (bukan 4.000%)', async () => {
    const { set, example } = await openForm()
    set('E-payment Fee — Flat (Rp)', '4000')
    expect(example()).toMatch(/Nets*Rp96.000/)
  })

  it('persentase + platform fee', async () => {
    const { dialog, set, example } = await openForm()
    set('E-payment Fee — Persen (%)', '0.7')
    fireEvent.click(within(dialog).getByLabelText('Kena Platform Fee'))
    // 100.000 − 700 − 2.000 (2%) = 97.300
    expect(example()).toMatch(/Nets*Rp97.300/)
  })

  it('flat + persentase + PPN 1% + platform fee', async () => {
    const { dialog, set, example } = await openForm()
    set('E-payment Fee — Persen (%)', '0.7')
    set('E-payment Fee — Flat (Rp)', '4000')
    fireEvent.click(within(dialog).getByLabelText('Kena Platform Fee'))
    set('E-payment Fee Tax — Tipe', 'percentage')
    set('E-payment Fee Tax — Nilai', '1')
    // fee 700 + 4.000 = 4.700; PPN 1% = 47; platform 2.000; net 100.000 − 6.747 = 93.253
    expect(example()).toContain('Rp4.700')
    expect(example()).toContain('Rp47')
    expect(example()).toMatch(/Nets*Rp93.253/)
  })

  it('kode metode dipilih dari daftar provider', async () => {
    const { dialog } = await openForm()
    const code = within(dialog).getByLabelText('Kode Metode Bayar (OrderOnline)') as HTMLSelectElement
    expect(Array.from(code.options).map((option) => option.value)).toEqual(expect.arrayContaining(['bank_transfer', 'bca_va', 'echannel', 'gopay']))
  })

  it.each([
    [{ percent: '0', flat: '0' }, { fee_type: 'flat', fee_value: 0, fee_flat_value: 0 }],
    [{ percent: '0.7', flat: '0' }, { fee_type: 'percentage', fee_value: 0.7, fee_flat_value: 0 }],
    [{ percent: '0', flat: '4000' }, { fee_type: 'flat', fee_value: 4000, fee_flat_value: 0 }],
    [{ percent: '0.7', flat: '4000' }, { fee_type: 'percentage_flat', fee_value: 0.7, fee_flat_value: 4000 }],
  ])('Simpan %j mengirim kolom API yang benar', async (input, expected) => {
    const { dialog, set } = await openForm()
    set('E-payment Fee — Persen (%)', input.percent)
    set('E-payment Fee — Flat (Rp)', input.flat)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(authorizedRequest.mock.calls.some(([path]) => path === '/api/config/payment-fee-rules')).toBe(true))
    const [, options] = authorizedRequest.mock.calls.find(([path]) => path === '/api/config/payment-fee-rules') as unknown as [string, { body: Record<string, unknown> }]
    expect(options.body).toMatchObject(expected)
    expect(options.body).not.toHaveProperty('fee_percent')
  })

  it('peringatan bila Kena Platform Fee dicentang tetapi tarif global masih 0%', async () => {
    authorizedRequest.mockImplementation(async (path: string) => (path === '/api/config/platform-fee' ? { percent: 0 } : {}))
    render(<MemoryRouter><ToastProvider><KonfigurasiTaxPage /></ToastProvider></MemoryRouter>)
    expect(await screen.findByDisplayValue('0')).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: /Tambah/ })[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('alert')).toBeNull()
    fireEvent.click(within(dialog).getByLabelText('Kena Platform Fee'))
    expect(within(dialog).getByRole('alert').textContent).toContain('PLATFORM FEE global masih 0%')
    authorizedRequest.mockImplementation(async (path: string) => (path === '/api/config/platform-fee' ? { percent: 2 } : {}))
  })
})
