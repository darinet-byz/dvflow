// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'
import { fetchOtsReferenceData } from '../src/lib/queries'
import { isOtsOrder, paymentMethodLabel } from '../src/lib/access-link'

/** A29 + A34: form OTS cepat — konteks meja, produk searchable, harga x tiket, check-in otomatis. */
const show = vi.fn()
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/lib/queries', () => ({ fetchOtsReferenceData: vi.fn() }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show }) }))

const EVENT = { key: 'KULI|392|S1|Solo|Seminar Offline', product_code: 'KULI', product_name: 'Kuliner Masteri', batch: '392', session: 'S1', city: 'Solo', event_type: 'Seminar Offline' }
const ROW = {
  order_id: 'OTS-000007', name: 'Budi', phone: '0812', product_code: 'KULI', product_name: 'Kuliner Masteri', batch: '392', session: 'S1', city: 'Solo',
  event_type: 'Seminar Offline', quantity: 2, gross_amount: 300000, payment_method: 'ots_qris', created_at: '2026-10-17T02:00:00Z', collected_by: 'Petugas',
}

// jsdom di proyek ini tidak menyediakan localStorage: pakai tiruan berbasis Map.
const memory = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(fetchOtsReferenceData).mockResolvedValue({
    products: [{ code: 'KULI', name: 'Kuliner Masteri' }],
    sessions: [{ code: 'S1', name: 'Sesi 1' }, { code: 'S2', name: 'Sesi 2' }],
  })
  vi.mocked(authorizedRequest).mockImplementation(async (path, init) => {
    if (path === '/api/ots/events') return { events: [EVENT] }
    if (path === '/api/ots' && init?.method === 'POST') return { order_id: 'OTS-000008', action: 'created', quantity: 2, gross_amount: 300000, checked_in_at: null }
    if (path === '/api/ots' && init?.method === 'DELETE') return {}
    if (path === '/api/ots') return { rows: [ROW] }
    return {}
  })
})
afterEach(cleanup)

const { OtsDrawer } = await import('../src/pages/scanner/OtsDrawer')

async function chooseEvent(): Promise<void> {
  const picker = screen.getByLabelText('Cari produk atau acara')
  fireEvent.focus(picker)
  fireEvent.change(picker, { target: { value: 'Kuliner' } })
  fireEvent.click(await screen.findByRole('option', { name: 'Kuliner Masteri · Batch 392 · S1 · Solo' }))
}

describe('OtsDrawer', () => {
  it('pilih acara terakhir -> konteks terisi; simpan 2 tiket x 150rb = 300rb', async () => {
    render(<OtsDrawer open onClose={() => {}} canDelete={false} />)
    await chooseEvent()

    expect(screen.getAllByText('Kuliner Masteri · Batch 392 · S1 · Solo').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Ubah acara' }))
    expect((screen.getByLabelText('Batch') as HTMLInputElement).value).toBe('392')
    expect((screen.getByLabelText('Sesi') as HTMLSelectElement).value).toBe('S1')
    expect((screen.getByLabelText('Kota') as HTMLInputElement).value).toBe('Solo')

    fireEvent.change(screen.getByLabelText('Nama peserta'), { target: { value: 'Siti' } })
    fireEvent.change(screen.getByLabelText('No HP'), { target: { value: '081234567890' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah jumlah tiket' }))
    fireEvent.click(screen.getByRole('radio', { name: '150rb' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Bank Transfer' }))
    expect(screen.getAllByText(/Rp.?300\.000/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Check-in' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/ots', {
      method: 'POST',
      body: {
        name: 'Siti',
        phone: '081234567890',
        product_code: 'KULI',
        batch: '392',
        session: 'S1',
        city: 'Solo',
        quantity: 2,
        unit_price: 150000,
        method: 'ots_transfer',
      },
    }))
    expect(show).toHaveBeenCalledWith(expect.stringContaining('OTS tersimpan'), 'success')
    expect((screen.getByLabelText('Nama peserta') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('No HP') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Jumlah tiket') as HTMLInputElement).value).toBe('1')
    expect(screen.getByRole('radio', { name: '150rb' }).getAttribute('aria-checked')).toBe('true')
    expect(window.localStorage.getItem('dvflow.ots.context')).toContain('KULI')
    expect(window.localStorage.getItem('dvflow.ots.price')).toBe('150000')
    expect(window.localStorage.getItem('dvflow.ots.method')).toBe('ots_transfer')
  })

  it('produk dicari lewat combobox, lalu batch/sesi/kota diisi manual', async () => {
    render(<OtsDrawer open onClose={() => {}} canDelete={false} />)
    const picker = screen.getByLabelText('Cari produk atau acara')
    fireEvent.change(picker, { target: { value: 'KULI' } })
    fireEvent.click(await screen.findByRole('option', { name: 'KULI — Kuliner Masteri' }))

    expect(screen.getAllByText(/Kuliner Masteri/).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: '392' } })
    fireEvent.change(screen.getByLabelText('Sesi'), { target: { value: 'S1' } })
    fireEvent.change(screen.getByLabelText('Kota'), { target: { value: 'Solo' } })
    fireEvent.change(screen.getByLabelText('Nama peserta'), { target: { value: 'Siti' } })
    fireEvent.change(screen.getByLabelText('No HP'), { target: { value: '0812' } })
    fireEvent.click(screen.getByRole('radio', { name: '100rb' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Check-in' }))

    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/ots', {
      method: 'POST',
      body: expect.objectContaining({
        product_code: 'KULI', batch: '392', session: 'S1', city: 'Solo', quantity: 1, unit_price: 100000,
      }),
    }))
  })

  it('validasi: konteks, nama, No HP, dan harga wajib', async () => {
    render(<OtsDrawer open onClose={() => {}} canDelete={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Check-in' }))
    expect(await screen.findByText(/Lengkapi acara meja terlebih dahulu/)).toBeDefined()

    await chooseEvent()
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Check-in' }))
    expect(await screen.findByText('Nama peserta wajib diisi.')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Nama peserta'), { target: { value: 'Siti' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Check-in' }))
    expect(await screen.findByText('No HP wajib diisi.')).toBeDefined()

    fireEvent.change(screen.getByLabelText('No HP'), { target: { value: '0812' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Check-in' }))
    expect(await screen.findByText('Pilih harga per tiket.')).toBeDefined()
  })

  it('edit mengisi qty/harga dan mengirim order_id; hapus hanya dengan izin', async () => {
    const { unmount } = render(<OtsDrawer open onClose={() => {}} canDelete={false} />)
    await screen.findByText('Budi')
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Nama peserta') as HTMLInputElement).value).toBe('Budi')
    expect((screen.getByLabelText('Jumlah tiket') as HTMLInputElement).value).toBe('2')
    expect(screen.getByRole('radio', { name: '150rb' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'QRIS' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/ots', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ order_id: 'OTS-000007', quantity: 2, unit_price: 150000, method: 'ots_qris' }),
    })))

    unmount()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OtsDrawer open onClose={() => {}} canDelete />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/ots/OTS-000007', { method: 'DELETE' }))
  })

  it('harga OTS lama di luar preset tampil sebagai opsi tersimpan', async () => {
    vi.mocked(authorizedRequest).mockImplementation(async (path, init) => {
      if (path === '/api/ots/events') return { events: [EVENT] }
      if (path === '/api/ots') return { rows: [{ ...ROW, quantity: 1, gross_amount: 175000 }] }
      if (init?.method === 'POST') return { order_id: 'OTS-000007', action: 'updated', checked_in_at: null }
      return {}
    })
    render(<OtsDrawer open onClose={() => {}} canDelete={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('radio', { name: /Tersimpan Rp.?175\.000/ }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('penanda OTS', () => {
  it('Order ID & label metode', () => {
    expect(isOtsOrder('OTS-000001')).toBe(true)
    expect(isOtsOrder('MTIX-283818331')).toBe(false)
    expect(paymentMethodLabel('ots_tunai')).toBe('OTS · Tunai')
    expect(paymentMethodLabel('ots_transfer')).toBe('OTS · Bank Transfer')
    expect(paymentMethodLabel('bca_va')).toBe('bca_va')
  })
})
