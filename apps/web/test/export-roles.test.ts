import { describe, expect, it, vi } from 'vitest'
import { collectPages, toCsv } from '../src/lib/export'
import { canAccessPath, ROLE_LABELS } from '../src/lib/roles'

describe('filtered export', () => {
  it('exports every page, including the final partial page, in server order', async () => {
    const load = vi.fn(async (page: number) => ({ rows: page === 1 ? [{ id: 'filtered-a' }, { id: 'filtered-b' }] : [{ id: 'filtered-c' }], total: 3 }))
    expect(await collectPages(load)).toEqual([{ id: 'filtered-a' }, { id: 'filtered-b' }, { id: 'filtered-c' }])
    expect(load.mock.calls).toEqual([[1], [2]])
  })
  it('does not silently save a partial export on errors or changed counts', async () => {
    await expect(collectPages(async page => ({ rows: [{ id: page }], total: page === 1 ? 3 : 2 }))).rejects.toThrow('Data berubah')
    await expect(collectPages(async () => { throw new Error('Sesi berakhir') })).rejects.toThrow('Sesi berakhir')
  })
  it('quotes commas, Unicode, newlines and formulas, excluding unselected secrets', () => {
    const csv = toCsv([{ name: 'A,"B"\nCafé', formula: ' =HYPERLINK("bad")', money: -15, password: 'NEVER_EXPORT' }],
      [{ key: 'name', header: 'Nama' }, { key: 'formula', header: 'Nilai' }, { key: 'money', header: 'Jumlah' }])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"A,""B""\nCafé"')
    expect(csv).toContain('"\' =HYPERLINK(""bad"")"')
    expect(csv).toContain('"-15"')
    expect(csv).not.toContain('NEVER_EXPORT')
  })
})

describe('requested role matrix', () => {
  it('uses standard labels and restricts direct page navigation', () => {
    expect(ROLE_LABELS['developer']).toBe('Developer')
    expect(ROLE_LABELS['owner']).toBe('Owner')
    expect(ROLE_LABELS['manajer']).toBe('Manajer')
    expect(ROLE_LABELS['admin']).toBe('Admin')
    expect(ROLE_LABELS['pimpro']).toBe('Pimpro')
    expect(ROLE_LABELS['member']).toBe('Member')
    expect(ROLE_LABELS['master_admin']).toBe('Admin Master')
    expect(ROLE_LABELS['staff']).toBe('Team')
    for (const path of ['/add-team', '/konfigurasi-produk', '/konfigurasi-tax', '/report-tax']) {
      expect(canAccessPath('master_admin', path)).toBe(true)
      expect(canAccessPath('staff', path)).toBe(false)
    }
    expect(canAccessPath('admin', '/add-team')).toBe(false)
    expect(canAccessPath('admin', '/report-tax')).toBe(true)
    expect(canAccessPath('staff', '/konfigurasi-zoom')).toBe(true)
    expect(canAccessPath('staff', '/generator')).toBe(true)
  })
})
