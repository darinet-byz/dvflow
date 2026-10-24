vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: { role: 'developer' } }) }))
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OrderUnmappedPage } from '../src/pages/order/OrderUnmappedPage'
import { authorizedRequest } from '../src/lib/session'

vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../src/lib/useConfigLists', () => ({
  useConfigLists: () => ({
    lists: {
      products: [{ value: 'KM', label: 'KM — Kuliner Masteri' }],
      advertisers: [{ value: '01', label: '01 — Zul' }],
      eventTypes: [{ value: 'SO', label: 'SO — Seminar Offline' }],
      sessions: [{ value: 'S1', label: 'S1 — Sesi 1' }],
    },
    error: null,
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('menampilkan halaman Order Unmapped, checklist order, dan modal batch remapping', async () => {
  const fakeUnmappedOrders = [
    {
      id: 'ord-1',
      order_id: 'SOLO-1001',
      name: 'Ahmad Peserta',
      phone: '0812345678',
      email: 'ahmad@test.com',
      product_raw: 'Workshop Kuliner Solo VIP',
      gross_amount: 350000,
      app_status: 'Paid',
      created_at: new Date().toISOString(),
    },
  ]

  vi.mocked(authorizedRequest).mockImplementation(async (path, options) => {
    if (typeof path === 'string' && path.includes('/api/orders/unmapped')) {
      return { rows: fakeUnmappedOrders }
    }
    if (typeof path === 'string' && path === '/api/product-aliases') {
      return { rows: [] }
    }
    if (options?.method === 'POST') {
      return { success: true, updated_count: 1, alias_saved: true }
    }
    return { rows: [] }
  })

  render(<OrderUnmappedPage />)

  expect(await screen.findByText('Order Unmapped')).toBeDefined()
  expect(await screen.findByText('Workshop Kuliner Solo VIP')).toBeDefined()
  expect(screen.getByText('SOLO-1001')).toBeDefined()

  // Checklist order
  const checkbox = screen.getByLabelText('Pilih order SOLO-1001')
  fireEvent.click(checkbox)

  // Tombol aksi muncul
  const remapBtn = await screen.findByRole('button', { name: /Petakan Terpilih/ })
  expect(remapBtn).toBeDefined()
  fireEvent.click(remapBtn)

  // Modal muncul
  expect(screen.getByText(/Petakan 1 Order Terpilih/)).toBeDefined()
  expect(screen.getByLabelText(/Nama Alias di OrderOnline/)).toBeDefined()
})

it('A40: hapus order terpilih lewat modal konfirmasi', async () => {
  vi.mocked(authorizedRequest).mockImplementation(async (path) => {
    if (path === '/api/orders/unmapped/delete') return { deleted_count: 1, skipped_count: 0 }
    if (typeof path === 'string' && path.includes('/api/orders/unmapped')) {
      return { rows: [{ id: 'ord-9', order_id: 'SOLO-9', name: 'Budi', phone: null, email: null, product_raw: 'Produk Lama', gross_amount: 100000, app_status: 'Pending', created_at: new Date().toISOString() }] }
    }
    return { rows: [] }
  })

  render(<OrderUnmappedPage />)
  fireEvent.click(await screen.findByLabelText('Pilih order SOLO-9'))
  fireEvent.click(await screen.findByRole('button', { name: 'Hapus (1)' }))
  expect(screen.getByText('Hapus 1 Order Unmapped')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))

  await vi.waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/orders/unmapped/delete', {
    method: 'POST',
    body: { orderIds: ['SOLO-9'] },
  }))
})
