// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/** A47: sidebar accordion — hanya satu grup terbuka, grup halaman aktif otomatis terbuka. */
vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: '1',
      username: 'dev',
      role: 'owner',
      permissions: [],
      display_name: 'Dev',
      avatar_emoji: null,
    },
  }),
}))

// Vitest 4 di Node tidak selalu menyediakan localStorage di jsdom; sidebar hanya butuh API ini.
const memory = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
    clear: () => { memory.clear() },
  },
})

const { Sidebar } = await import('../src/layout/Sidebar')

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('Sidebar accordion (A47)', () => {
  it('Dashboard langsung terlihat; grup lain tertutup sampai diklik', () => {
    render(<MemoryRouter initialEntries={['/']}><Sidebar /></MemoryRouter>)

    expect(screen.getByText('Dashboard Resume')).toBeTruthy()
    const acara = screen.getByRole('button', { name: 'ACARA' })
    expect(acara.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Scan QR')).toBeNull()

    fireEvent.click(acara)
    expect(acara.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Scan QR')).toBeTruthy()
    expect(window.localStorage.getItem('dvflow.sidebar.open')).toBe('ACARA')
  })

  it('membuka grup lain menutup grup sebelumnya', () => {
    render(<MemoryRouter initialEntries={['/']}><Sidebar /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'ACARA' }))
    expect(screen.getByText('Scan QR')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'ORDER' }))
    expect(screen.getByText('Order')).toBeTruthy()
    expect(screen.queryByText('Scan QR')).toBeNull()
  })

  it('grup halaman aktif otomatis terbuka', async () => {
    render(<MemoryRouter initialEntries={['/performa']}><Sidebar /></MemoryRouter>)
    expect(await screen.findByText('Performa / Analitik')).toBeTruthy()
    expect(screen.getByRole('button', { name: /LAPORAN & PAJAK/ }).getAttribute('aria-expanded')).toBe('true')
  })
})
