// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'
import { formatSpendRoi, parseSpendInput, parseTaxPercent, ReportSpendPage, sessionMatrixCell, spendProfit, spendTax } from '../src/pages/report-spend/ReportSpendPage'

/** A45: kartu Jumlah Tiket memakai tiket (sum quantity), bukan jumlah Order ID seperti `paid`. */
const spendFixture = vi.hoisted(() => ({
  summary: { reports: 1, spend: 6000000, tax_amount: 660000, total_spend: 6660000, leads: 9, paid: 8, omzet: 9000000 },
  rows: [{
    id: 'r1', date_from: '2026-10-18', date_to: '2026-10-26', product_code: 'AAAA', product_name: 'Produk A',
    advertiser_code: '91', advertiser_name: 'Zul', batch: '122', spend: 6000000, tax_percent: 11,
    tax_amount: 660000, total_spend: 6660000, leads: 9, paid: 8, tickets: 9, omzet: 9000000, own: true,
  }],
  sessions: {
    tickets: 9,
    advertisers: [{ advertiser_code: '91', advertiser_name: 'Zul', tickets: 9 }],
    rows: [{ session: 'S1', city: 'Solo', event_type: 'Seminar Offline', tickets: 9, advertisers: [{ advertiser_code: '91', tickets: 9 }] }],
  },
  comparison: {
    totals: { spend: 6000000, tax_amount: 660000, total_spend: 6660000, leads: 9, paid: 8, tickets: 9, omzet: 9000000 },
    rows: [
      { product_code: 'AAAA', product_name: 'Produk A', batch: '122', advertiser_code: '91', advertiser_name: 'Zul', spend: 4000000, tax_amount: 440000, total_spend: 4440000, leads: 5, paid: 5, tickets: 6, omzet: 6000000 },
      { product_code: 'AAAA', product_name: 'Produk A', batch: '122', advertiser_code: '92', advertiser_name: 'Rina', spend: 2000000, tax_amount: 220000, total_spend: 2220000, leads: 4, paid: 3, tickets: 3, omzet: 3000000 },
    ],
  },
}))
vi.mock('../src/lib/supabase-rest', () => ({
  supabaseRpc: vi.fn(async () => spendFixture),
  supabaseSelect: vi.fn(async () => []),
}))
vi.mock('../src/lib/useConfigLists', () => ({
  useConfigLists: () => ({
    lists: {
      products: [{ value: 'AAAA', label: 'AAAA - Produk A' }],
      advertisers: [{ value: '91', label: '91 - Zul' }, { value: '92', label: '92 - Rina' }],
      eventTypes: [],
      eventTypeNames: [],
      sessions: [],
      paymentMethods: [],
    },
    error: null,
  }),
}))

/** A37: checkbox "Input Biaya Iklan" hanya untuk role Advertiser. */
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: { user_id: '1', username: 'dev', role: 'developer', permissions: [], display_name: 'Dev', avatar_emoji: null } }) }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

const role = (id: string, name: string) => ({ id, name, description: null, is_system: true, user_count: 0, permission_count: 1, created_at: '', updated_at: '' })
vi.mocked(authorizedRequest).mockImplementation(async (path) => {
  if (path === '/api/roles') return { roles: [role('advertiser', 'Advertiser'), role('manajer', 'Manajer')] }
  if (path === '/api/permissions') return { modules: [
    { module: 'operasional', module_name: 'Operasional', permissions: [{ key: 'operasional.report_spend', name: 'Report Spend Iklan', module: 'operasional', description: '', sort_order: 7 }] },
    { module: 'aksi', module_name: 'Aksi Khusus', permissions: [{ key: 'action.input_spend', name: 'Input Biaya Iklan', module: 'aksi', description: '', sort_order: 44 }] },
  ] }
  return { permissions: ['operasional.report_spend'] }
})

const { RoleConfigPage } = await import('../src/pages/config/RoleConfigPage')
afterEach(cleanup)

describe('Konfigurasi Role: Input Biaya Iklan', () => {
  it.each([[0, 'Advertiser', true], [1, 'Manajer', false]])('baris %i (%s) -> checkbox tampil: %s', async (index, _name, visible) => {
    render(<RoleConfigPage />)
    const buttons = await screen.findAllByRole('button', { name: 'Atur Hak Akses' })
    fireEvent.click(buttons[index]!)
    await screen.findByText('Report Spend Iklan')
    expect(screen.queryByText('Input Biaya Iklan') !== null).toBe(visible)
  })
})

describe('Report Spend Iklan: angka', () => {
  it('profit = omzet − spend; boncos negatif', () => {
    expect(spendProfit('9000000.00', 6000000)).toBe(3000000)
    expect(spendProfit(0, '6000000')).toBe(-6000000)
  })

  it('persentase terhadap spend; spend 0 ditulis "-"', () => {
    expect(formatSpendRoi(9000000, 6000000)).toBe('+50.0%')
    expect(formatSpendRoi(0, 6000000)).toBe('-100.0%')
    expect(formatSpendRoi(6000000, 6000000)).toBe('0.0%')
    expect(formatSpendRoi(500000, 0)).toBe('-')
  })

  it('input spend menerima titik ribuan dan "Rp"', () => {
    expect(parseSpendInput('6.000.000')).toBe(6000000)
    expect(parseSpendInput('Rp 6.000.000')).toBe(6000000)
    expect(parseSpendInput('0')).toBe(0)
    expect(parseSpendInput('')).toBeNull()
  })
})

describe('Report Spend Iklan: PPN iklan', () => {
  it('PPN dihitung dari spend sebelum PPN; profit memakai total spend', () => {
    const tax = spendTax(6000000, 11)
    expect(tax).toBe(660000)
    expect(spendProfit(9000000, 6000000 + tax)).toBe(2340000)
    expect(formatSpendRoi(6660000, 6000000 + tax)).toBe('0.0%')
    expect(spendTax(1234567, 0)).toBe(0)
  })

  it('input PPN menerima "11", "11,5", "11%"; di luar 0–100 ditolak', () => {
    expect(parseTaxPercent('11')).toBe(11)
    expect(parseTaxPercent('11,5')).toBe(11.5)
    expect(parseTaxPercent('11%')).toBe(11)
    expect(parseTaxPercent('0')).toBe(0)
    expect(parseTaxPercent('')).toBeNull()
    expect(parseTaxPercent('101')).toBeNull()
    expect(parseTaxPercent('-1')).toBeNull()
    expect(parseTaxPercent('sebelas')).toBeNull()
  })
})

describe('Report Spend Iklan: tiket per sesi × pengiklan (A43)', () => {
  const row = { session: 'S1', city: 'Solo', event_type: 'Seminar Offline', tickets: 5, advertisers: [{ advertiser_code: '01', tickets: 3 }, { advertiser_code: '02', tickets: 2 }] }

  it('sel = tiket pengiklan di sesi itu; pengiklan tanpa tiket = 0', () => {
    expect(sessionMatrixCell(row, '01')).toBe(3)
    expect(sessionMatrixCell(row, '02')).toBe(2)
    expect(sessionMatrixCell(row, '03')).toBe(0)
  })
})

describe('Report Spend Iklan: perbandingan pengiklan (A46)', () => {
  it('kartu perbandingan muncul saat produk + batch dipilih', async () => {
    render(<ReportSpendPage />)
    await screen.findByText('Jumlah Tiket', {}, { timeout: 5000 })

    fireEvent.change(screen.getByLabelText('Filter produk'), { target: { value: 'AAAA' } })
    fireEvent.change(screen.getByLabelText('Filter batch'), { target: { value: '122' } })

    expect(await screen.findByText('Perbandingan Pengiklan')).toBeTruthy()
    expect(screen.getByText('Tertinggi')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Share Tiket' })).toBeTruthy()
    expect(screen.getAllByText('Zul').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rina').length).toBeGreaterThan(0)
    // Total baris perbandingan = summary report: 9 tiket.
    expect(screen.getAllByText('Total').length).toBeGreaterThan(0)
  })
})

describe('Report Spend Iklan: kartu Jumlah Tiket & kolom Total Tiket (A45)', () => {
  it('kartu memakai jumlah tiket (9) walau order Paid 8; tabel report memuat Paid dan Total Tiket', async () => {
    render(<ReportSpendPage />)

    // Timeout lebih longgar: suite paralel di mesin lambat bisa melewati batas default 1 dtk.
    const label = await screen.findByText('Jumlah Tiket', {}, { timeout: 5000 })
    const card = label.parentElement as HTMLElement
    expect(card.querySelectorAll('p')[1]?.textContent).toBe('9')
    expect(card.textContent).toContain('Total tiket dari order Paid')

    // Kartu "Paid" sudah diganti; "Paid" hanya tersisa sebagai kolom tabel report.
    expect(screen.getByText('Paid').tagName).toBe('TH')
    expect(screen.getByRole('columnheader', { name: 'Total Tiket' })).toBeTruthy()
    expect(screen.getByText('Jumlah tiket (quantity) per sesi, bukan jumlah Order ID.')).toBeTruthy()
  })
})
