// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  it('menampilkan Platform Fee tersimpan dan contoh Rp100.000 untuk VA', async () => {
    render(<MemoryRouter><ToastProvider><KonfigurasiTaxPage /></ToastProvider></MemoryRouter>)
    expect(await screen.findByDisplayValue('2')).toBeDefined()

    fireEvent.click(screen.getAllByRole('button', { name: /Tambah/ })[0]!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('E-payment Fee — Nilai'), { target: { value: '4000' } })
    fireEvent.click(within(dialog).getByLabelText('Kena Platform Fee'))
    fireEvent.change(within(dialog).getByLabelText('E-payment Fee Tax — Tipe'), { target: { value: 'percentage' } })
    fireEvent.change(within(dialog).getByLabelText('E-payment Fee Tax — Nilai'), { target: { value: '1' } })

    const example = within(dialog).getByTestId('fee-example')
    // 100.000 − 4.000 − 40 − 2.000 (2%) = 93.960
    expect(example.textContent).toContain('Rp4.000')
    expect(example.textContent).toContain('Rp40')
    expect(example.textContent).toContain('Rp2.000')
    expect(example.textContent).toContain('Rp93.960')
  })

  it('bank transfer (tanpa centang Platform Fee) tidak kena platform fee', async () => {
    render(<MemoryRouter><ToastProvider><KonfigurasiTaxPage /></ToastProvider></MemoryRouter>)
    await screen.findByDisplayValue('2')
    fireEvent.click(screen.getAllByRole('button', { name: /Tambah/ })[0]!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('E-payment Fee — Nilai'), { target: { value: '0' } })
    expect(within(dialog).getByTestId('fee-example').textContent).toContain('Rp100.000')
  })
})
