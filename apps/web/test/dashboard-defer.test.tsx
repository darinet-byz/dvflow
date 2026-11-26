// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A100: KPI utama tampil lebih dulu; tabel pembanding Online/OTS menyusul. */

const summary = {
  leads: 10, paid: 6, paid_tickets: 9, pending: 3, cancelled: 1, conversion_rate: 0.6,
  gross_amount: 750436, tax_amount: 9250, epayment_tax_amount: 440, platform_fee_amount: 4500, net_amount: 736246,
  sudah_hadir: 2, belum_hadir: 4, attendance_rate: 0.33,
}

vi.mock('../src/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/queries')>()
  return {
    ...actual,
    fetchDashboardSummary: vi.fn(),
    fetchConfigLists: vi.fn(async () => ({ products: [], advertisers: [], eventTypes: [], eventTypeNames: [], sessions: [], paymentMethods: [] })),
    fetchDashboardSessionSummary: vi.fn(async () => ({ summary: { tickets: 0, sessions: 0 }, rows: [] })),
  }
})

const { fetchDashboardSummary } = await import('../src/lib/queries')
const { DashboardPage } = await import('../src/pages/dashboard/DashboardPage')

afterEach(() => cleanup())

describe('Dashboard: pemuatan bertahap (A100)', () => {
  it('pembanding Online/OTS baru diminta setelah ringkasan utama selesai', async () => {
    let resolveMain!: (value: typeof summary) => void
    const main = new Promise<typeof summary>((resolve) => { resolveMain = resolve })
    vi.mocked(fetchDashboardSummary)
      .mockImplementationOnce(() => main)
      .mockResolvedValue(summary)

    render(<MemoryRouter><DashboardPage /></MemoryRouter>)

    await waitFor(() => expect(fetchDashboardSummary).toHaveBeenCalledTimes(1))
    // Selama KPI utama belum selesai, dua panggilan pembanding belum dikirim.
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link', { name: 'OTS' })).toBeNull()

    await act(async () => {
      resolveMain(summary)
      await main
    })

    await waitFor(() => expect(fetchDashboardSummary).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('link', { name: 'OTS' })).toBeTruthy()
  })
})
