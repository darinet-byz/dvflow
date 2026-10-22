// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'
import { formatSpendRoi, parseSpendInput, parseTaxPercent, spendProfit, spendTax } from '../src/pages/report-spend/ReportSpendPage'

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
