// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateRangeField } from '../src/pages/shared/DateRangeField'

/** Satu field tanggal: preset langsung diterapkan, kalender untuk tanggal tunggal/rentang, tanpa input teks. */

let last: { from: string; to: string } = { from: '', to: '' }
function Harness({ initial = { from: '', to: '' } }: { initial?: { from: string; to: string } }) {
  const [range, setRange] = useState(initial)
  return <DateRangeField from={range.from} to={range.to} onChange={(next) => { last = next; setRange(next) }} />
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 16, 10, 0, 0))
  last = { from: '', to: '' }
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Filter tanggal' }))
const panel = () => screen.getByRole('dialog', { name: 'Pilih tanggal' })

describe('DateRangeField', () => {
  it('satu field tanpa input teks; kalender langsung tampil saat dibuka', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Filter tanggal' }).textContent).toContain('Semua tanggal')
    open()
    expect(within(panel()).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(panel()).getByText('Oktober 2026')).toBeDefined()
    for (const label of ['Hari Ini', 'Kemarin', '7 Hari Terakhir', '30 Hari Terakhir', 'Custom']) {
      expect(within(panel()).getByText(label)).toBeDefined()
    }
  })

  it('preset "7 Hari Terakhir" langsung diterapkan dan panel ditutup', () => {
    render(<Harness />)
    open()
    fireEvent.click(within(panel()).getByText('7 Hari Terakhir'))
    expect(last).toEqual({ from: '2026-10-10', to: '2026-10-16' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Filter tanggal' }).textContent).toContain('7 Hari Terakhir')
  })

  it('Custom: klik 1 tanggal + Terapkan = tanggal tunggal', () => {
    render(<Harness />)
    open()
    fireEvent.click(within(panel()).getByRole('button', { name: '2026-10-05' }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Terapkan' }))
    expect(last).toEqual({ from: '2026-10-05', to: '2026-10-05' })
  })

  it('Custom: klik 2 tanggal (terbalik) = rentang terurut', () => {
    render(<Harness />)
    open()
    fireEvent.click(within(panel()).getByRole('button', { name: '2026-10-15' }))
    fireEvent.click(within(panel()).getByRole('button', { name: '2026-10-03' }))
    expect(within(panel()).getByRole('button', { name: '2026-10-08' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(panel()).getByRole('button', { name: 'Terapkan' }))
    expect(last).toEqual({ from: '2026-10-03', to: '2026-10-15' })
  })

  it('klik ketiga memulai pilihan baru', () => {
    render(<Harness />)
    open()
    for (const day of ['2026-10-01', '2026-10-10', '2026-10-20']) fireEvent.click(within(panel()).getByRole('button', { name: day }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Terapkan' }))
    expect(last).toEqual({ from: '2026-10-20', to: '2026-10-20' })
  })

  it('pindah bulan lalu pilih tanggal di bulan sebelumnya', () => {
    render(<Harness />)
    open()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Bulan sebelumnya' }))
    expect(within(panel()).getByText('September 2026')).toBeDefined()
    fireEvent.click(within(panel()).getByRole('button', { name: '2026-09-28' }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Terapkan' }))
    expect(last).toEqual({ from: '2026-09-28', to: '2026-09-28' })
  })

  it('Hapus tanggal mengosongkan filter', () => {
    render(<Harness initial={{ from: '2026-10-01', to: '2026-10-15' }} />)
    open()
    fireEvent.click(within(panel()).getByText('Hapus tanggal'))
    expect(last).toEqual({ from: '', to: '' })
  })

  it('Esc menutup panel tanpa mengubah filter', () => {
    render(<Harness />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(last).toEqual({ from: '', to: '' })
  })
})
