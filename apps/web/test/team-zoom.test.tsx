// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TeamPage } from '../src/pages/team/TeamPage'
import { ZoomPage } from '../src/pages/config/ZoomPage'
import { Sidebar } from '../src/layout/Sidebar'
import { authorizedRequest } from '../src/lib/session'

const state = vi.hoisted(() => ({ role: 'master_admin', show: vi.fn() }))
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: { role: state.role, display_name: 'Tester', avatar_emoji: null } }) }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: state.show }) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'master_admin'
  vi.mocked(authorizedRequest).mockImplementation(async (path) => path === '/api/internal/users' ? { users: [{ id: '1', username: 'hizul', display_name: 'Hizul', role: 'master_admin', active: true }] } : { rows: [] })
})
afterEach(cleanup)

describe('requested team and Zoom screens', () => {
  it('creates a member using selected role, clears the password and refreshes the list', async () => {
    render(<TeamPage />)
    await screen.findByText('Hizul')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newmember' } })
    fireEvent.change(screen.getByLabelText('Password awal'), { target: { value: 'test-password-only' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah member' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/internal/users', { method: 'POST', body: { username: 'newmember', display_name: 'newmember', initial_password: 'test-password-only', role: 'admin' } }))
    await waitFor(() => expect((screen.getByLabelText('Password awal') as HTMLInputElement).value).toBe(''))
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDefined()
  })
  it('preserves the literal OrderOnline variable and sends a product-specific mapping', async () => {
    render(<ZoomPage />)
    const link = screen.getByLabelText('Link peserta untuk template followup OrderOnline') as HTMLInputElement
    expect(link.value).toBe(`${window.location.origin}/access/{{order_id}}`)
    fireEvent.change(screen.getByLabelText('Nama produk persis di OrderOnline'), { target: { value: 'KM01WO001 - ST - Solo' } })
    fireEvent.change(screen.getByLabelText('Link Zoom asli (HTTPS)'), { target: { value: 'https://zoom.us/j/123?pwd=abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan link Zoom' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/webinar-destinations', { method: 'POST', body: { product_raw: 'KM01WO001 - ST - Solo', destination: 'https://zoom.us/j/123?pwd=abc' } }))
  })
  it('Team sees restricted menus disabled, while operational links remain available', () => {
    state.role = 'staff'
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    for (const name of ['Add Team', 'Konfigurasi Produk', 'Konfigurasi Tax', 'Report Tax']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
      expect(screen.getByText(name).getAttribute('aria-disabled')).toBe('true')
    }
    expect(screen.getByRole('link', { name: 'Konfigurasi Zoom' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Order' })).toBeDefined()
    expect(screen.getByText('Team')).toBeDefined()
  })
})
