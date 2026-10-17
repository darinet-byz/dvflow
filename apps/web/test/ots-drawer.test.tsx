// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'
import { isOtsOrder, paymentMethodLabel } from '../src/lib/access-link'

/** A29: drawer Peserta OTS — acara diingat per perangkat, simpan = Paid + hadir, edit & hapus. */
const show = vi.fn()
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show }) }))

const EVENT = { key: 'KULI|392|S1|Solo|Seminar Offline', product_code: 'KULI', product_name: 'Kuliner Masteri', batch: '392', session: 'S1', city: 'Solo', event_type: 'Seminar Offline' }
const ROW = { order_id: 'OTS-000007', name: 'Budi', phone: '0812', product_code: 'KULI', product_name: 'Kuliner Masteri', batch: '392', session: 'S1', city: 'Solo',
  event_type: 'Seminar Offline', gross_amount: 150000, payment_method: 'ots_qris', created_at: '2026-10-17T02:00:00Z', collected_by: 'Petugas' }

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
  vi.mocked(authorizedRequest).mockImplementation(async (path, init) => {
    if (path === '/api/ots/events') return { events: [EVENT] }
    if (path === '/api/ots' && init?.method === 'POST') return { order_id: 'OTS-000008', action: 'created', checked_in_at: null }
    if (path === '/api/ots') return { rows: [ROW] }
    return {}
  })
})
afterEach(cleanup)

const { OtsDrawer } = await import('../src/pages/scanner/OtsDrawer')

describe('OtsDrawer', () => {
  it('simpan mengirim acara + nama + nominal + metode, lalu mengingat acara & nominal', async () => {
    render(<OtsDrawer open onClose={() => {}} canDelete={false} />)
    await screen.findByRole('option', { name: 'Kuliner Masteri · Batch 392 · S1 · Solo' })
    fireEvent.change(screen.getByLabelText('Acara'), { target: { value: EVENT.key } })
    fireEvent.change(screen.getByLabelText('Nama peserta'), { target: { value: 'Siti' } })
    fireEvent.change(screen.getByLabelText('Nominal (Rp)'), { target: { value: '150.000' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Transfer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Check-in' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/ots', {
      method: 'POST',
      body: { name: 'Siti', phone: '', product_code: 'KULI', batch: '392', session: 'S1', city: 'Solo', event_type: 'Seminar Offline', amount: 150000, method: 'ots_transfer' },
    }))
    expect(show).toHaveBeenCalledWith('OTS tersimpan · peserta hadir', 'success')
    expect(window.localStorage.getItem('dvflow.ots.event')).toBe(EVENT.key)
    expect(window.localStorage.getItem('dvflow.ots.amount')).toBe('150000')
    // Nama dikosongkan untuk peserta berikutnya, acara tetap.
    expect((screen.getByLabelText('Nama peserta') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Acara') as HTMLSelectElement).value).toBe(EVENT.key)
  })

  it('tanpa acara: ditolak di form', async () => {
    render(<OtsDrawer open onClose={() => {}} canDelete={false} />)
    await screen.findByRole('option', { name: /Kuliner Masteri/ })
    fireEvent.change(screen.getByLabelText('Nama peserta'), { target: { value: 'Siti' } })
    fireEvent.change(screen.getByLabelText('Nominal (Rp)'), { target: { value: '150000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Check-in' }))
    expect(await screen.findByText('Pilih acara terlebih dahulu.')).toBeDefined()
  })

  it('daftar hari ini: edit mengisi form & mengirim order_id; Hapus hanya dengan izin', async () => {
    const { unmount } = render(<OtsDrawer open onClose={() => {}} canDelete={false} />)
    await screen.findByText('Budi')
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Nama peserta') as HTMLInputElement).value).toBe('Budi')
    expect(screen.getByRole('radio', { name: 'QRIS' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))
    await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/ots', expect.objectContaining({
      body: expect.objectContaining({ order_id: 'OTS-000007', amount: 150000, method: 'ots_qris' }),
    })))
    unmount()
    render(<OtsDrawer open onClose={() => {}} canDelete />)
    expect(await screen.findByRole('button', { name: 'Hapus' })).toBeDefined()
  })
})

describe('penanda OTS', () => {
  it('Order ID & label metode', () => {
    expect(isOtsOrder('OTS-000001')).toBe(true)
    expect(isOtsOrder('MTIX-283818331')).toBe(false)
    expect(paymentMethodLabel('ots_tunai')).toBe('OTS · Tunai')
    expect(paymentMethodLabel('bca_va')).toBe('bca_va')
  })
})
