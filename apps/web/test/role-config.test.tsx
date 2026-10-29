// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RoleConfigPage } from '../src/pages/config/RoleConfigPage'
import { authorizedRequest } from '../src/lib/session'

const state = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: state.show }) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authorizedRequest).mockImplementation(async (path) => {
    if (path === '/api/roles') {
      return {
        roles: [
          {
            id: 'developer',
            name: 'Developer',
            description: 'Akses teknis penuh',
            is_system: true,
            user_count: 1,
            permission_count: 17,
          },
          {
            id: 'pimpro',
            name: 'Pimpro',
            description: 'Pimpinan proyek produk',
            is_system: true,
            user_count: 2,
            permission_count: 6,
          },
          {
            id: 'koordinator_gate',
            name: 'Koordinator Gate',
            description: 'Penjaga gate presensi',
            is_system: false,
            user_count: 0,
            permission_count: 3,
          },
        ],
      }
    }
    if (path === '/api/permissions') {
      return {
        modules: [
          {
            module: 'operasional',
            module_name: 'Operasional',
            permissions: [
              { key: 'operasional.scan_qr', name: 'Scan QR Tiket', description: 'Memindai tiket' },
              { key: 'operasional.dashboard', name: 'Dashboard', description: 'Melihat KPI' },
            ],
          },
          {
            module: 'konfigurasi',
            module_name: 'Konfigurasi',
            permissions: [
              { key: 'config.produk', name: 'Konfigurasi Produk', description: 'Kelola produk' },
              { key: 'config.roles', name: 'Konfigurasi Role & Permission', description: 'Khusus Developer/Owner' },
            ],
          },
          {
            module: 'team',
            module_name: 'Manajemen Tim',
            permissions: [
              { key: 'team.manage', name: 'Manajemen Tim', description: 'Kelola anggota' },
            ],
          },
        ],
      }
    }
    if (path === '/api/roles/pimpro') {
      return {
        id: 'pimpro',
        name: 'Pimpro',
        is_system: true,
        permissions: ['operasional.scan_qr', 'operasional.dashboard'],
      }
    }
    return {}
  })
})

afterEach(cleanup)

describe('Fitur 2.0: RoleConfigPage', () => {
  it('menampilkan tabel role, badge tipe, dan tombol aksi', async () => {
    render(
      <MemoryRouter>
        <RoleConfigPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Developer')).toBeDefined()
    expect(await screen.findByText('Pimpro')).toBeDefined()
    expect(await screen.findByText('Koordinator Gate')).toBeDefined()

    // Cek badge
    expect(screen.getAllByText('Bawaan Sistem').length).toBe(2)
    expect(screen.getByText('Kustom')).toBeDefined()

    // Tombol "+ Tambah Role Baru"
    expect(screen.getByRole('button', { name: '+ Tambah Role Baru' })).toBeDefined()

    // Role kustom punya tombol Hapus, role sistem tidak punya
    const deleteButtons = screen.getAllByRole('button', { name: 'Hapus' })
    expect(deleteButtons.length).toBe(1)
  })

  it('membuka modal Atur Hak Akses dan memuat checklist per modul', async () => {
    render(
      <MemoryRouter>
        <RoleConfigPage />
      </MemoryRouter>,
    )

    await screen.findByText('Pimpro')
    const configButtons = screen.getAllByRole('button', { name: 'Atur Hak Akses' })
    fireEvent.click(configButtons[1]!) // klik Pimpro

    expect(await screen.findByText('Atur Hak Akses: Pimpro')).toBeDefined()
    expect(await screen.findByText('Operasional')).toBeDefined()
    expect(await screen.findByText('Konfigurasi')).toBeDefined()
    expect(await screen.findByText('Scan QR Tiket')).toBeDefined()
    // A50: config.roles tetap master-only; team.manage dapat didelegasikan.
    expect(screen.queryByText('Konfigurasi Role & Permission')).toBeNull()
    expect(screen.getAllByText('Manajemen Tim').length).toBeGreaterThan(0)
  })

  it('membuka modal Tambah Role Baru dan dapat mengisi form', async () => {
    render(
      <MemoryRouter>
        <RoleConfigPage />
      </MemoryRouter>,
    )

    const addBtn = await screen.findByRole('button', { name: '+ Tambah Role Baru' })
    fireEvent.click(addBtn)

    expect(await screen.findByText('ID / Kode Role')).toBeDefined()
    fireEvent.change(screen.getByLabelText('ID / Kode Role'), { target: { value: 'operator_baru' } })
    fireEvent.change(screen.getByLabelText('Nama Role'), { target: { value: 'Operator Baru' } })

    expect((screen.getByLabelText('ID / Kode Role') as HTMLInputElement).value).toBe('operator_baru')
    expect((screen.getByLabelText('Nama Role') as HTMLInputElement).value).toBe('Operator Baru')
  })
})
