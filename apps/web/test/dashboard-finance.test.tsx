// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Kartu Finansial: baris 1 Gross & Net (besar), baris 2 Platform Fee, E-payment Fee, E-payment Fee Tax. */

vi.mock('../src/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/queries')>()
  return {
    ...actual,
    fetchDashboardSummary: vi.fn(async () => ({
      leads: 10, paid: 6, paid_tickets: 9, pending: 3, cancelled: 1, conversion_rate: 0.6,
      gross_amount: 750436, tax_amount: 9250, epayment_tax_amount: 440, platform_fee_amount: 4500, net_amount: 736246,
      sudah_hadir: 2, belum_hadir: 4, attendance_rate: 0.33,
    })),
    fetchConfigLists: vi.fn(async () => ({ products: [], advertisers: [], eventTypes: [], eventTypeNames: [], sessions: [], paymentMethods: [] })),
    fetchDashboardSessionSummary: vi.fn(async () => ({ summary: { tickets: 0, sessions: 0 }, rows: [] })),
  }
})

const { DashboardPage } = await import('../src/pages/dashboard/DashboardPage')
afterEach(() => cleanup())

describe('Dashboard: kartu Finansial 2 baris', () => {
  it('urutan Gross, Net, Platform Fee, E-payment Fee, E-payment Fee Tax; Gross & Net lebar setengah', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    const gross = await screen.findByText('Gross')
    const section = gross.closest('div.grid') as HTMLElement
    const labels = Array.from(section.children).map((card) => card.querySelector('p')?.textContent)
    expect(labels).toEqual(['Gross', 'Net', 'Platform Fee', 'E-payment Fee', 'E-payment Fee Tax'])
    const cards = Array.from(section.children) as HTMLElement[]
    expect(cards.slice(0, 2).every((card) => card.className.includes('md:col-span-3'))).toBe(true)
    expect(cards.slice(2).every((card) => card.className.includes('md:col-span-2'))).toBe(true)
    expect(section.className).toContain('md:grid-cols-6')
  })
})

describe('Dashboard: urutan kartu (A59)', () => {
  it('Finansial, Order, Data per Sesi, Kehadiran', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    await screen.findByText('Gross')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Finansial', 'Order', 'Data per Sesi', 'Kehadiran'])
  })
})

describe('Dashboard: kartu Order (A25)', () => {
  it('Leads, Paid, Jumlah Tiket (total quantity order Paid), Pending, Conversion Rate', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    const tickets = await screen.findByText('Jumlah Tiket')
    const grid = tickets.closest('div.grid') as HTMLElement
    const labels = Array.from(grid.children).map((card) => card.querySelector('p')?.textContent)
    expect(labels).toEqual(['Leads', 'Paid', 'Jumlah Tiket', 'Pending', 'Conversion Rate'])
    expect(tickets.closest('div.grid > *')?.textContent).toContain('9')
  })
})

