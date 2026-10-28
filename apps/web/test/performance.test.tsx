// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { canAccessPath } from '../src/lib/roles'
import { supabaseRpc } from '../src/lib/supabase-rest'
import { useSession } from '../src/lib/useSession'
import {
  advertiserLabel,
  autoGranularity,
  deltaPercent,
  formatDeltaPercent,
  formatRoas,
  periodPresetRange,
  sortAdvertisers,
  type PerformanceDetail,
  type PerformanceDashboard,
} from '../src/lib/performance'

/** A46: Performa / Analitik — daftar semua pengiklan lalu detail satu pengiklan. */
vi.mock('../src/lib/useSession', () => ({ useSession: vi.fn() }))
vi.mock('../src/lib/supabase-rest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabase-rest')>()),
  supabaseRpc: vi.fn(),
  supabaseSelect: vi.fn(async (table: string) => {
    if (table === 'products') return [{ code: 'PAAA', name: 'Produk A' }]
    if (table === 'advertisers') return [{ code: '01', name: 'Zul' }, { code: '02', name: 'Rina' }]
    return []
  }),
}))

const dashboard: PerformanceDashboard = {
  advertisers: [
    {
      advertiser_code: '01',
      advertiser_name: 'Zul',
      spend: 400000,
      tax_amount: 33000,
      total_spend: 433000,
      leads: 3,
      paid: 2,
      tickets: 5,
      omzet: 950000,
      profit: 517000,
      closing_rate: 5 / 3,
      roas: 950000 / 433000,
      coverage: 0.2,
      top_products: [
        { product_code: 'PBBB', product_name: 'Produk B', tickets: 4, omzet: 800000 },
        { product_code: 'PAAA', product_name: 'Produk A', tickets: 1, omzet: 150000 },
      ],
    },
    {
      advertiser_code: '02',
      advertiser_name: 'Rina',
      spend: 300000,
      tax_amount: 33000,
      total_spend: 333000,
      leads: 2,
      paid: 2,
      tickets: 4,
      omzet: 600000,
      profit: 267000,
      closing_rate: 2,
      roas: 600000 / 333000,
      coverage: 0.75,
      top_products: [{ product_code: 'PAAA', product_name: 'Produk A', tickets: 4, omzet: 600000 }],
    },
  ],
}

const detail: PerformanceDetail = {
  summary: {
    spend: 400000,
    tax_amount: 33000,
    total_spend: 433000,
    leads: 3,
    paid: 2,
    tickets: 5,
    omzet: 950000,
    profit: 517000,
    closing_rate: 5 / 3,
    roas: 950000 / 433000,
    coverage: 0.2,
  },
  rows: [
    {
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      is_partial: false,
      spend: 400000,
      tax_amount: 33000,
      total_spend: 433000,
      leads: 3,
      paid: 2,
      tickets: 5,
      omzet: 950000,
      profit: 517000,
      closing_rate: 5 / 3,
      roas: 950000 / 433000,
      coverage: 0.2,
      prev: {
        spend: 400000,
        tax_amount: 44000,
        total_spend: 444000,
        leads: 1,
        paid: 1,
        tickets: 2,
        omzet: 300000,
        profit: -144000,
        closing_rate: 2,
        roas: 300000 / 444000,
        coverage: 1,
      },
      yoy: {
        spend: 0,
        tax_amount: 0,
        total_spend: 0,
        leads: 0,
        paid: 0,
        tickets: 0,
        omzet: 0,
        profit: 0,
        closing_rate: null,
        roas: null,
        coverage: null,
      },
    },
  ],
  top_products: [
    { product_code: 'PBBB', product_name: 'Produk B', tickets: 4, omzet: 800000 },
    { product_code: 'PAAA', product_name: 'Produk A', tickets: 1, omzet: 150000 },
  ],
  products: [
    { product_code: 'PBBB', product_name: 'Produk B', tickets: 4, omzet: 800000 },
    { product_code: 'PAAA', product_name: 'Produk A', tickets: 1, omzet: 150000 },
  ],
  batches: [
    { batch: '200', spend: 100000, tax_amount: 0, total_spend: 100000, tickets: 4, omzet: 800000, profit: 700000, roas: 8 },
    { batch: '100', spend: 300000, tax_amount: 33000, total_spend: 333000, tickets: 1, omzet: 150000, profit: -183000, roas: 150000 / 333000 },
  ],
}

const { PerformancePage, formatAxisMoney, formatPeriodLabel } = await import('../src/pages/performance/PerformancePage')

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({ status: 'authenticated', profile: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Performa / Analitik: perhitungan murni', () => {
  it('rentang preset bulan berjalan dan granularitas otomatis', () => {
    const today = new Date(2026, 9, 27)
    expect(periodPresetRange('thisMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-27' })
    expect(periodPresetRange('last12m', today)).toEqual({ from: '2025-11-01', to: '2026-10-27' })
    expect(autoGranularity('2026-10-01', '2026-10-27')).toBe('day')
    expect(autoGranularity('2026-01-01', '2026-10-27')).toBe('month')
    expect(autoGranularity('2024-01-01', '2026-10-27')).toBe('year')
  })

  it('ROAS, delta, dan label pengiklan', () => {
    expect(formatRoas(3.2)).toBe('3,2x')
    expect(formatRoas(2)).toBe('2,0x')
    expect(formatRoas(null)).toBe('-')
    expect(deltaPercent(120, 100)).toBe(20)
    expect(formatDeltaPercent(120, 100)).toBe('+20,0%')
    expect(formatDeltaPercent(80, 100)).toBe('-20,0%')
    expect(formatDeltaPercent(10, 0)).toBe('-')
    expect(advertiserLabel({ advertiser_code: '01', advertiser_name: 'Zul' })).toBe('Zul (01)')
    expect(advertiserLabel({ advertiser_code: '01', advertiser_name: null })).toBe('01')
  })

  it('mengurutkan pengiklan dan ROAS kosong di bawah', () => {
    const rows = [
      { ...dashboard.advertisers[0]!, advertiser_code: '01', tickets: 1, roas: null },
      { ...dashboard.advertisers[1]!, advertiser_code: '02', tickets: 4, roas: 2 },
    ]
    expect(sortAdvertisers(rows, 'tickets').map((row) => row.advertiser_code)).toEqual(['02', '01'])
    expect(sortAdvertisers(rows, 'roas').map((row) => row.advertiser_code)).toEqual(['02', '01'])
  })

  it('label grafik harian/bulanan/tahunan dan angka sumbu', () => {
    expect(formatPeriodLabel('2026-10-01', 'day')).toMatch(/01/)
    expect(formatPeriodLabel('2026-10-01', 'month')).toMatch(/2026/)
    expect(formatPeriodLabel('2026-01-01', 'year')).toBe('2026')
    expect(formatAxisMoney(5_000_000)).toBe('5 jt')
    expect(formatAxisMoney(250_000)).toBe('250 rb')
  })
})

describe('Performa / Analitik: izin', () => {
  it('halaman butuh operasional.analytics', () => {
    expect(canAccessPath({ role: 'manajer', permissions: ['operasional.analytics'] }, '/performa')).toBe(true)
    expect(canAccessPath({ role: 'advertiser', permissions: ['operasional.report_spend'] }, '/performa')).toBe(false)
    expect(canAccessPath({ role: 'owner', permissions: [] }, '/performa')).toBe(true)
  })
})

describe('Performa / Analitik: halaman', () => {
  it('menampilkan semua pengiklan sebagai kartu, lalu detail saat diklik', async () => {
    vi.mocked(supabaseRpc).mockImplementation(async (_fn, args) => {
      const advertiser = (args as { p_advertiser_code?: string | null }).p_advertiser_code
      return advertiser === null || advertiser === undefined ? dashboard : detail
    })

    render(<PerformancePage />)

    expect(await screen.findByText('Semua Pengiklan')).toBeTruthy()
    expect(screen.getByText('Zul (01)')).toBeTruthy()
    expect(screen.getByText('Rina (02)')).toBeTruthy()
    expect(screen.getAllByText(/Top 2 Produk/).length).toBeGreaterThan(0)
    expect(supabaseRpc).toHaveBeenCalledWith('advertiser_performance', expect.objectContaining({ p_advertiser_code: null }))

    fireEvent.click(screen.getByRole('button', { name: /Zul \(01\)/ }))

    expect(await screen.findByRole('heading', { name: '01 - Zul' })).toBeTruthy()
    expect(screen.getByText('Top 2 Produk')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Grafik garis spend dan omzet' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Grafik garis tiket dan leads' })).toBeTruthy()
    expect(screen.getByText('Breakdown Batch')).toBeTruthy()
    expect(supabaseRpc).toHaveBeenLastCalledWith(
      'advertiser_performance',
      expect.objectContaining({ p_advertiser_code: '01', p_granularity: 'day' }),
    )
  }, 20_000)

  it('A48: advertiser hanya melihat pengiklannya sendiri dan langsung membuka detail', async () => {
    vi.mocked(useSession).mockReturnValue({
      status: 'authenticated',
      profile: {
        user_id: 'u-adv',
        username: 'adv',
        display_name: 'Adv',
        role: 'advertiser',
        avatar_emoji: null,
        has_all_product_access: false,
        allowed_product_codes: ['PAAA'],
        advertiser_code: '01',
        advertiser_name: 'Zul',
        permissions: ['operasional.analytics'],
      },
    })
    vi.mocked(supabaseRpc).mockResolvedValue(detail)

    render(<PerformancePage />)

    expect(await screen.findByRole('heading', { name: '01 - Zul' })).toBeTruthy()
    expect(screen.queryByLabelText('Filter pengiklan')).toBeNull()
    expect(screen.queryByText('← Semua pengiklan')).toBeNull()
    expect(supabaseRpc).toHaveBeenCalledWith(
      'advertiser_performance',
      expect.objectContaining({ p_advertiser_code: '01' }),
    )
  }, 20_000)

  it('A48: pimpro hanya mendapat pilihan pengiklan dari hasil analitik produknya', async () => {
    vi.mocked(useSession).mockReturnValue({
      status: 'authenticated',
      profile: {
        user_id: 'u-pim',
        username: 'pim',
        display_name: 'Pim',
        role: 'pimpro',
        avatar_emoji: null,
        has_all_product_access: false,
        allowed_product_codes: ['PAAA'],
        advertiser_code: null,
        advertiser_name: null,
        permissions: ['operasional.analytics'],
      },
    })
    vi.mocked(supabaseRpc).mockResolvedValue({ advertisers: [dashboard.advertisers[0]!] })

    render(<PerformancePage />)

    expect(await screen.findByText('Zul (01)')).toBeTruthy()
    expect(await screen.findByRole('option', { name: '01 - Zul' })).toBeTruthy()
    expect(screen.queryByText('Rina (02)')).toBeNull()
    const select = screen.getByLabelText('Filter pengiklan') as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['', '01'])
    expect(Array.from(select.options).map((option) => option.text)).toEqual(['Semua pengiklan', '01 - Zul'])
  }, 20_000)
})
