// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

/** A28: susunan, urutan, dan lebar filter sama di Dashboard, Order, Presensi, Report Tax. */
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/queries')>()),
  fetchConfigLists: vi.fn(async () => ({ products: [], advertisers: [], eventTypes: [], eventTypeNames: [], sessions: [], paymentMethods: [] })),
  fetchDashboardSummary: vi.fn(async () => ({ leads: 0, paid: 0, pending: 0, cancelled: 0, conversion_rate: null, gross_amount: 0, tax_amount: 0, net_amount: 0, sudah_hadir: 0, belum_hadir: 0, attendance_rate: null })),
  fetchPresensiSummary: vi.fn(async () => ({ paid_tickets: 0, sudah_hadir: 0, belum_hadir: 0, attendance_rate: null })),
  fetchOrdersPage: vi.fn(async () => ({ rows: [], total: 0, page: 1, page_size: 50, summary: { total: 0, paid: 0, pending: 0 } })),
  fetchPresensiPage: vi.fn(async () => ({ rows: [], total: 0, page: 1, page_size: 50 })),
}))
vi.mock('../src/lib/supabase-rest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabase-rest')>()),
  supabaseRpc: vi.fn(async () => ({ dimension: 'payment_method', summary: { transactions: 0, gross_amount: 0, tax_amount: 0, net_amount: 0 }, rows: [] })),
}))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

const { DashboardPage } = await import('../src/pages/dashboard/DashboardPage')
const { OrderPage } = await import('../src/pages/order/OrderPage')
const { PresensiPage } = await import('../src/pages/presensi/PresensiPage')
const { ReportTaxPage } = await import('../src/pages/report-tax/ReportTaxPage')
afterEach(cleanup)

const COMMON = ['Filter produk', 'Filter pengiklan', 'Filter seminar atau webinar', 'Filter batch', 'Filter sesi', 'Filter kota']
const pages: Array<[string, () => ReactElement, string[]]> = [
  ['Dashboard', () => <DashboardPage />, []],
  ['Order', () => <OrderPage />, ['Filter status', 'Filter payment method']],
  ['Presensi', () => <PresensiPage />, ['Filter status presensi']],
  ['Report Tax', () => <ReportTaxPage />, []],
]

describe('filter seragam (A28)', () => {
  it.each(pages)('%s: baris 2 = Produk, Pengiklan, Seminar/Webinar, Batch, Sesi, Kota, lalu filter khusus', async (_name, page, extra) => {
    render(<MemoryRouter>{page()}</MemoryRouter>)
    const bar = await screen.findByTestId('standard-filter-bar')
    const row = bar.querySelector('[data-filter-row="filters"]') as HTMLElement
    const labels = Array.from(row.querySelectorAll('input, select')).map((el) => el.getAttribute('aria-label'))
    expect(labels).toEqual([...COMMON, ...extra])
    // Semua kontrol lebar yang sama.
    for (const el of Array.from(row.querySelectorAll('input, select'))) {
      expect((el.closest('[class*="w-["]') as HTMLElement | null)?.className ?? (el as HTMLElement).className).toContain('w-[190px]')
    }
    // Tanggal selalu di baris pertama; tidak ada "More Filters".
    const primary = bar.querySelector('[data-filter-row="primary"]') as HTMLElement
    expect(primary.textContent).toContain('Hari Ini')
    expect(screen.queryByRole('button', { name: /More Filters/ })).toBeNull()
  })
})
