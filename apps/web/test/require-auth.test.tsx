// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Profil kosong sesaat (gangguan jaringan/5xx saat memuat profil) dipulihkan sendiri:
 * layar memuat dulu, bukan langsung "Akses belum dapat diverifikasi". Tetap fail-closed:
 * tanpa profil tidak ada halaman yang dirender.
 */

const PROFILE = {
  user_id: 'u1', username: 'dev', display_name: 'Dev', role: 'developer', avatar_emoji: null,
  has_all_product_access: true, allowed_product_codes: [], permissions: [],
}
let snapshot: { status: string; profile: typeof PROFILE | null } = { status: 'authenticated', profile: null }
const listeners = new Set<() => void>()
const setSnapshot = (next: typeof snapshot) => { snapshot = next; listeners.forEach((l) => l()) }
const refreshProfile = vi.fn(async () => {})

vi.mock('../src/lib/useSession', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSession: () => useSyncExternalStore((l: () => void) => { listeners.add(l); return () => listeners.delete(l) }, () => snapshot),
  }
})
vi.mock('../src/lib/session', () => ({
  bootstrapSession: vi.fn(async () => {}),
  refreshProfile: () => refreshProfile(),
  getAccessToken: () => 'token',
  authorizedRequest: vi.fn(async () => ({})),
}))
vi.mock('../src/pages/dashboard/DashboardPage', () => ({ DashboardPage: () => <p>Halaman Dashboard</p> }))
vi.mock('../src/layout/AppShell', async () => {
  const { Outlet } = await import('react-router-dom')
  return { AppShell: () => <Outlet /> }
})

const { App } = await import('../src/App')

beforeEach(() => { vi.useFakeTimers(); snapshot = { status: 'authenticated', profile: null } })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); refreshProfile.mockImplementation(async () => {}) })

async function flush(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('RequireAuth: pemulihan profil kosong', () => {
  it('menampilkan loading, mencoba lagi, lalu pulih tanpa layar "Muat ulang"', async () => {
    // Gangguan sesaat: semua pemuatan profil gagal sampai jaringan pulih.
    let networkUp = false
    refreshProfile.mockImplementation(async () => { if (networkUp) setSnapshot({ status: 'authenticated', profile: PROFILE }) })
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    await flush()
    expect(screen.queryByText('Akses belum dapat diverifikasi')).toBeNull()
    expect(screen.queryByText('Halaman Dashboard')).toBeNull() // fail-closed selama profil kosong
    networkUp = true
    await flush(2000)
    expect(screen.getByText('Halaman Dashboard')).toBeDefined()
    expect(screen.queryByText('Akses belum dapat diverifikasi')).toBeNull()
  })

  it('layar "Muat ulang" hanya setelah semua percobaan gagal', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    for (let i = 0; i < 5; i += 1) await flush(2000)
    expect(screen.getByText('Akses belum dapat diverifikasi')).toBeDefined()
    // 4 percobaan pemulihan (+ pemuatan profil biasa saat navigasi).
    expect(refreshProfile.mock.calls.length).toBeGreaterThanOrEqual(4)
  })
})
