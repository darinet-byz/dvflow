// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ResetDataPage } from '../src/pages/developer/ResetDataPage'
import { authorizedRequest } from '../src/lib/session'

vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('menampilkan ringkasan data, pemilihan cakupan, dan modal 2x verifikasi', async () => {
  const fakeSummary = {
    orders_count: 42,
    unmapped_orders_count: 5,
    attendance_events_count: 30,
    order_sources_count: 17,
    webhook_logs_count: 100,
    product_aliases_count: 3,
    connections_count: 2,
    products_count: 10,
  }

  vi.mocked(authorizedRequest).mockImplementation(async (path, options) => {
    if (typeof path === 'string' && path === '/api/developer/data-summary') {
      return fakeSummary
    }
    if (typeof path === 'string' && path === '/api/developer/reset-data' && options?.method === 'POST') {
      return { success: true, deleted: { orders: 42 } }
    }
    return {}
  })

  render(<ResetDataPage />)

  // 1. Memastikan judul dan statistik tampil
  expect(await screen.findByText(/Reset Data \(Developer Only\)/)).toBeDefined()
  expect(await screen.findByText('42')).toBeDefined()
  expect(await screen.findByText('100')).toBeDefined()

  // 2. Tombol quick action "Pilih Semua Data Transaksi Uji Coba"
  const selectAllBtn = screen.getByText(/Pilih Semua Data Transaksi Uji Coba/)
  fireEvent.click(selectAllBtn)

  // 3. Tombol Reset Data Terpilih aktif
  const openModalBtn = screen.getByText(/Reset Data Terpilih \(4\)/)
  expect(openModalBtn).toBeDefined()
  fireEvent.click(openModalBtn)

  // 4. Modal Verifikasi Tahap 1 muncul
  expect(await screen.findByText(/Verifikasi Tahap 1: Konfirmasi Teks/)).toBeDefined()

  const nextBtn = screen.getByText(/Lanjut ke Verifikasi Password/)
  // Awalnya disabled karena belum ketik "Ya, Aku yakin"
  expect((nextBtn as HTMLButtonElement).disabled).toBe(true)

  // Ketik teks yang salah
  const confirmInput = screen.getByLabelText(/Kalimat Konfirmasi:/)
  fireEvent.change(confirmInput, { target: { value: 'ya yakin' } })
  expect((nextBtn as HTMLButtonElement).disabled).toBe(true)

  // Ketik teks yang benar
  fireEvent.change(confirmInput, { target: { value: 'Ya, Aku yakin' } })
  expect((nextBtn as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(nextBtn)

  // 5. Masuk ke Verifikasi Tahap 2 (Password)
  expect(await screen.findByText(/Verifikasi Tahap 2: Autentikasi Password Developer/)).toBeDefined()

  const passwordInput = screen.getByLabelText(/Password Akun Developer Anda:/)
  fireEvent.change(passwordInput, { target: { value: 'rahasiaDev123' } })

  const executeBtn = screen.getByText(/Hapus Permanen Sekarang/)
  fireEvent.click(executeBtn)

  await waitFor(() => {
    expect(authorizedRequest).toHaveBeenCalledWith(
      '/api/developer/reset-data',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          confirmationText: 'Ya, Aku yakin',
          password: 'rahasiaDev123',
        }),
      }),
    )
  })
})

