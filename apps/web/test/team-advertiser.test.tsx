// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'

/** A20: role Advertiser wajib memilih satu pengiklan; role lain tidak melihat pilihan itu. */
const show = vi.fn()
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({ status: 'authenticated', profile: { user_id: '1', username: 'dev', role: 'developer', permissions: [], display_name: 'Dev', avatar_emoji: null } }),
}))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show }) }))
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/queries')>()),
  fetchConfigLists: vi.fn(async () => ({ products: [{ value: 'KM', label: 'KM — Kuliner Masteri' }], advertisers: [], eventTypes: [], eventTypeNames: [], sessions: [], paymentMethods: [] })),
  fetchAdvertiserChoices: vi.fn(async () => [
    { id: 'adv-1', code: '01', name: 'Zul', active: true },
    { id: 'adv-2', code: '02', name: 'Rina', active: false },
  ]),
}))
vi.mocked(authorizedRequest).mockImplementation(async (path) =>
  path === '/api/internal/users'
    ? {
        users: [
          { id: '9', username: 'iklanzul', display_name: 'Iklan Zul', role: 'advertiser', active: true, has_all_product_access: false, allowed_product_codes: ['KM'], advertiser_id: 'adv-1' },
          { id: '10', username: 'semua', display_name: 'Anggota Semua', role: 'member', active: true, has_all_product_access: true },
          { id: '11', username: 'banyak', display_name: 'Banyak Produk', role: 'pimpro', active: true, has_all_product_access: false, allowed_product_codes: ['KM', 'SO', 'WEB', 'EVT', 'X1'] },
        ],
      }
    : path === '/api/roles' ? { roles: [{ id: 'pimpro', name: 'Pimpro' }, { id: 'advertiser', name: 'Advertiser' }, { id: 'member', name: 'Member' }] } : {},
)
const { TeamPage } = await import('../src/pages/team/TeamPage')
afterEach(cleanup)

describe('Add Team: role sama dengan Konfigurasi Role', () => {
  it('pilihan role memakai nama dari Konfigurasi Role, tanpa label "Team"', async () => {
    render(<TeamPage />)
    await screen.findByRole('option', { name: 'Member' })
    const options = Array.from((screen.getByLabelText('Role') as HTMLSelectElement).options).map((o) => o.text)
    expect(options).toEqual(['Pimpro', 'Advertiser', 'Member'])
    expect(screen.queryByRole('option', { name: 'Team' })).toBeNull()
  })
})

describe('Add Team: role Advertiser', () => {
  it('pilihan Pengiklan hanya untuk role Advertiser dan wajib diisi', async () => {
    render(<TeamPage />)
    expect(await screen.findByText('iklanzul')).toBeDefined()
    // A49: info pengiklan tidak lagi ditampilkan di kolom Akses Produk.
    expect(screen.queryByText(/Pengiklan:/)).toBeNull()
    await screen.findByRole('option', { name: 'Advertiser' })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'iklanbaru' } })
    fireEvent.change(screen.getByLabelText('Password awal'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'pimpro' } })
    expect(screen.queryByLabelText(/Pengiklan \(hanya order/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'advertiser' } })
    const select = screen.getByLabelText(/Pengiklan \(hanya order/) as HTMLSelectElement
    // Pengiklan nonaktif tidak bisa dipilih untuk akun baru.
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['Pilih pengiklan', '01 — Zul'])
    fireEvent.click(screen.getByRole('button', { name: 'Tambah member' }))
    expect(await screen.findByText('Pilih pengiklan untuk role Advertiser.')).toBeDefined()
    fireEvent.change(select, { target: { value: 'adv-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah member' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/internal/users', {
      method: 'POST',
      body: { username: 'iklanbaru', display_name: 'iklanbaru', initial_password: 'password123', role: 'advertiser', advertiser_id: 'adv-1' },
    }))
  })
})

describe('Add Team: akses produk proporsional (A49)', () => {
  it('semua produk tampil satu badge; produk tertentu dibatasi empat badge + ringkasan', async () => {
    render(<TeamPage />)

    expect(await screen.findByText('semua')).toBeDefined()
    expect(screen.getByText('Semua Produk')).toBeDefined()
    expect(screen.getByText('+1 produk')).toBeDefined()
    expect(screen.getByText('EVT')).toBeDefined()
    expect(screen.queryByText('X1')).toBeNull()
  })
})
