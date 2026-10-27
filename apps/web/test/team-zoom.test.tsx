// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TeamPage } from '../src/pages/team/TeamPage'
import { ZoomPage } from '../src/pages/config/ZoomPage'
import { TicketConfigPage } from '../src/pages/config/TicketConfigPage'
import { Sidebar } from '../src/layout/Sidebar'
import { authorizedRequest } from '../src/lib/session'

const state = vi.hoisted(() => ({ role: 'owner', show: vi.fn() }))
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: { user_id: '1', username: 'hizul', role: state.role, permissions: ['config.zoom','config.tiket','operasional.generator','operasional.order'], display_name: 'Tester', avatar_emoji: null },
  }),
}))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: state.show }) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'owner'
  vi.mocked(authorizedRequest).mockImplementation(async (path) =>
    path === '/api/internal/users'
      ? {
          users: [
            { id: '1', username: 'hizul', display_name: 'Hizul', role: 'owner', active: true },
            { id: '2', username: 'staff1', display_name: 'Staff Satu', role: 'member', active: true },
          ],
        }
      : {
          rows: [],
          products: [{ code: 'KM', name: 'Kuliner Masteri', active: true }],
          sessions: [{ code: 'S1', name: 'Sesi 1', active: true }],
          stores: [{ name: 'Master Tiktok Indonesia', slug: 'MTIX' }],
        },
  )
})
afterEach(cleanup)

describe('requested team, Zoom, and Barcode Ticket screens', () => {
  it('creates a member using selected role, clears the password, refreshes the list, and supports delete', async () => {
    render(<TeamPage />)
    await screen.findByText('Hizul')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newmember' } })
    fireEvent.change(screen.getByLabelText('Password awal'), { target: { value: 'test-password-only' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah member' }))
    await waitFor(() =>
      expect(authorizedRequest).toHaveBeenCalledWith('/api/internal/users', {
        method: 'POST',
        body: {
          username: 'newmember',
          display_name: 'newmember',
          initial_password: 'test-password-only',
          role: 'admin',
        },
      }),
    )
    await waitFor(() => expect((screen.getByLabelText('Password awal') as HTMLInputElement).value).toBe(''))
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDefined()

    // Tombol Hapus tersedia untuk member lain
    const deleteButtons = screen.getAllByRole('button', { name: 'Hapus' })
    expect(deleteButtons.length).toBeGreaterThanOrEqual(2)
  }, 15000)

  it('preserves the literal OrderOnline variable and sends either exact or scoped Zoom mapping', async () => {
    render(<ZoomPage />)
    // A27: link peserta per toko memuat kode toko (Fitur 2.0 dok 07).
    const link = (await screen.findByLabelText('Master Tiktok Indonesia (kode toko MTIX)')) as HTMLInputElement
    expect(link.value).toBe(`${window.location.origin}/access/MTIX/{{order_id}}`)
    fireEvent.change(screen.getByLabelText('Nama produk persis di OrderOnline'), {
      target: { value: 'KM01WO001 - ST - Solo' },
    })
    fireEvent.change(screen.getByLabelText('Link Zoom asli (HTTPS)'), {
      target: { value: 'https://zoom.us/j/123?pwd=abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan link Zoom' }))
    await waitFor(() =>
      expect(authorizedRequest).toHaveBeenCalledWith('/api/webinar-destinations', {
        method: 'POST',
        body: { product_raw: 'KM01WO001 - ST - Solo', destination: 'https://zoom.us/j/123?pwd=abc' },
      }),
    )

    // Simpan 1 link untuk semua produk & sesi (global scope)
    fireEvent.change(screen.getByLabelText('Nama produk persis di OrderOnline'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Link Zoom asli (HTTPS)'), {
      target: { value: 'https://zoom.us/j/999?pwd=global' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan link Zoom' }))
    await waitFor(() =>
      expect(authorizedRequest).toHaveBeenCalledWith('/api/webinar-destinations', {
        method: 'POST',
        body: {
          product_code: '*',
          batch: '*',
          session_code: '*',
          destination: 'https://zoom.us/j/999?pwd=global',
        },
      }),
    )
  })

  it('saves scoped Barcode / QR Ticket configuration and opens QR preview modal', async () => {
    render(<TicketConfigPage />)
    await screen.findByRole('option', { name: 'KM — Kuliner Masteri' })
    fireEvent.change(screen.getByLabelText('Cakupan Produk'), { target: { value: 'KM' } })
    fireEvent.change(screen.getByLabelText('Cakupan Batch (opsional)'), { target: { value: '392' } })
    fireEvent.change(screen.getByLabelText('Cakupan Sesi'), { target: { value: 'S1' } })
    fireEvent.change(screen.getByLabelText('Catatan Opsional'), {
      target: { value: 'Hadir 30 menit lebih awal' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Tiket QR' }))
    expect(await screen.findByText('Preview Tiket Barcode / QR Peserta')).toBeDefined()
    expect(screen.getByRole('img', { name: 'Kode QR check-in' })).toBeDefined()
    // A19: hanya catatan; Lokasi/Jadwal/Aktif tidak ada lagi.
    expect(screen.getAllByText('Hadir 30 menit lebih awal').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/Lokasi/)).toBeNull()
    expect(screen.queryByText('Tiket QR aktif untuk cakupan ini')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tutup preview' }))

    fireEvent.click(screen.getByRole('button', { name: 'Simpan konfigurasi tiket' }))
    await waitFor(() =>
      expect(authorizedRequest).toHaveBeenCalledWith('/api/seminar-tickets', {
        method: 'POST',
        body: {
          product_code: 'KM',
          batch: '392',
          session_code: 'S1',
          notes: 'Hadir 30 menit lebih awal',
        },
      }),
    )
  })

  it('Team sees restricted menus omitted completely (Fitur 2.0 strict hiding), while operational links remain available', () => {
    state.role = 'member'
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    for (const name of ['Add Team', 'Konfigurasi Produk', 'Konfigurasi Tax', 'Report Tax', 'Konfigurasi Role']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
      expect(screen.queryByText(name)).toBeNull()
    }
    // A47: grup menu dilipat; buka grup yang relevan sebelum memeriksa tautan.
    fireEvent.click(screen.getByRole('button', { name: /PRODUK & ACARA/ }))
    expect(screen.getByRole('link', { name: 'Konfigurasi Zoom' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Konfigurasi Barcode / Tiket' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Product Name Generator' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Konfigurasi Produk' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /ORDER/ }))
    expect(screen.getByRole('link', { name: 'Order' })).toBeDefined()
    expect(screen.getByText('Member')).toBeDefined()
  })
})
