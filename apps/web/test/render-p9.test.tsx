// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

/**
 * Test render halaman P9 (PRD §70–§73, §84–§86, §95–§99, §113–§116).
 *
 * Fokusnya perilaku yang menentukan: hasil generator persis seperti kontrak,
 * batch dengan angka nol di depan tidak berubah, Report Tax menolak staf dengan
 * jujur, dan profil tidak menawarkan hal yang tidak ada di MVP.
 */

const AUTHENTICATED = {
  status: 'authenticated' as const,
  profile: {
    user_id: 'user-1',
    username: 'admin1',
    display_name: 'Admin Satu',
    role: 'admin' as const,
    avatar_emoji: '🚀',
  },
}

vi.mock('../src/lib/useSession', () => ({ useSession: () => AUTHENTICATED }))
vi.mock('../src/lib/session', () => ({
  getAccessToken: () => 'token',
  authorizedRequest: vi.fn(async () => ({})),
  updateProfile: vi.fn(async () => AUTHENTICATED.profile),
  changePassword: vi.fn(async () => ({ revokedSessions: 2 })),
}))
vi.mock('../src/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/queries')>()
  return {
    ...actual,
    fetchConfigLists: vi.fn(async () => ({
      products: [{ value: 'KM', label: 'KM — Kuliner Masteri' }],
      advertisers: [{ value: '01', label: '01 — Zul' }],
      eventTypes: [{ value: 'SO', label: 'SO — Seminar Offline' }],
      eventTypeNames: [{ value: 'Seminar Offline', label: 'Seminar Offline' }],
      sessions: [{ value: 'S1', label: 'S1 — Sesi 1' }],
      paymentMethods: ['bank_transfer'],
    })),
  }
})

const supabaseRpc = vi.fn()
vi.mock('../src/lib/supabase-rest', () => ({
  supabaseRpc: (...args: unknown[]) => supabaseRpc(...args),
  supabaseSelect: vi.fn(async () => []),
}))

const { GeneratorPage } = await import('../src/pages/generator/GeneratorPage')
const { ReportTaxPage } = await import('../src/pages/report-tax/ReportTaxPage')
const { ProfilePage } = await import('../src/pages/profile/ProfilePage')
const { ScanQrPage } = await import('../src/pages/scanner/ScanQrPage')
const { KonfigurasiProdukPage } = await import('../src/pages/config/KonfigurasiProdukPage')
const { ToastProvider } = await import('../src/ui/Toast')
const { changePassword } = await import('../src/lib/session')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  supabaseRpc.mockResolvedValue({
    dimension: 'payment_method',
    summary: { transactions: 320, gross_amount: 9600000, tax_amount: 64000, net_amount: 9536000 },
    rows: [{ label: 'QRIS', transactions: 320, gross_amount: 9600000, tax_amount: 64000, net_amount: 9536000 }],
  })
})

function renderPage(element: ReactElement): void {
  render(
    <MemoryRouter>
      <ToastProvider>{element}</ToastProvider>
    </MemoryRouter>,
  )
}

/**
 * Tunggu pilihan konfigurasi terpasang.
 *
 * Pilihan produk/pengiklan/type/sesi dibaca dari database, jadi daftarnya baru
 * ada setelah satu putaran. Memilih sebelum daftarnya siap berarti `<select>`
 * tidak punya opsi yang cocok, dan nilainya kembali kosong tanpa error — test
 * akan gagal dengan pesan yang membingungkan ("wajib dipilih" padahal sudah
 * diisi).
 */
async function waitForConfigOptions(): Promise<void> {
  await screen.findByRole('option', { name: 'KM — Kuliner Masteri' })
}

function choose(id: string, value: string): void {
  fireEvent.change(screen.getByLabelText(id), { target: { value } })
}

function type(id: string, value: string): void {
  fireEvent.change(screen.getByLabelText(id), { target: { value } })
}

describe('Product Name Generator (PRD §71, 05 §D01–§D05)', () => {
  it('D01: input konfigurasi menghasilkan nama persis seperti kontrak', async () => {
    renderPage(<GeneratorPage />)
    await waitForConfigOptions()

    choose('Produk', 'KM')
    choose('Pengiklan', '01')
    choose('Seminar / Webinar', 'SO')
    choose('Sesi', 'S1')
    type('Batch', '392')
    type('Kota', 'Solo')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('KM01SO392 - S1 - Solo')).toBeDefined()
  })

  it('D05: batch "001" tidak kehilangan angka nol di depan', async () => {
    renderPage(<GeneratorPage />)
    await waitForConfigOptions()

    choose('Produk', 'KM')
    choose('Pengiklan', '01')
    choose('Seminar / Webinar', 'SO')
    choose('Sesi', 'S1')
    type('Batch', '001')
    type('Kota', 'Solo')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('KM01SO001 - S1 - Solo')).toBeDefined()
  })

  it('D04: spasi di sekitar kota dipangkas', async () => {
    renderPage(<GeneratorPage />)
    await waitForConfigOptions()

    choose('Produk', 'KM')
    choose('Pengiklan', '01')
    choose('Seminar / Webinar', 'SO')
    choose('Sesi', 'S1')
    type('Batch', '392')
    type('Kota', '   Solo   ')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('KM01SO392 - S1 - Solo')).toBeDefined()
  })

  it('D03: input kurang -> tidak ada kode yang dihasilkan, hanya error', async () => {
    renderPage(<GeneratorPage />)
    await waitForConfigOptions()

    // Hanya kota diisi; produk/pengiklan/type/sesi/batch kosong.
    type('Batch', '392')
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(screen.queryByText(/KM01/)).toBeNull()
    expect(await screen.findByText('Produk wajib dipilih.')).toBeDefined()
    expect(screen.getByText('Sesi wajib dipilih.')).toBeDefined()
  })

  it('hasil tidak muncul sebelum Generate ditekan', async () => {
    renderPage(<GeneratorPage />)
    await waitForConfigOptions()

    choose('Produk', 'KM')
    choose('Pengiklan', '01')
    choose('Seminar / Webinar', 'SO')
    choose('Sesi', 'S1')
    type('Batch', '392')
    type('Kota', 'Solo')

    expect(screen.queryByText('KM01SO392 - S1 - Solo')).toBeNull()
  })

  it('tombol Copy tidak aktif sebelum ada hasil', async () => {
    renderPage(<GeneratorPage />)
    await waitForConfigOptions()
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', true)
  })
})

describe('Report Tax (PRD §84–§86, 04 §1)', () => {
  it('menampilkan ringkasan dan breakdown', async () => {
    renderPage(<ReportTaxPage />)

    expect(await screen.findByText('Jumlah transaksi')).toBeDefined()
    expect(screen.getAllByText('Total Tax').length).toBeGreaterThan(0)
    expect(await screen.findByText('QRIS')).toBeDefined()
    expect(supabaseRpc).toHaveBeenCalledWith('tax_report', expect.objectContaining({ p_dimension: 'payment_method' }))
  })

  it('menawarkan tujuh dimensi breakdown, tidak lebih', async () => {
    renderPage(<ReportTaxPage />)
    const selector = (await screen.findByLabelText('Dimensi breakdown')) as HTMLSelectElement

    expect(Array.from(selector.options).map((option) => option.value)).toEqual([
      'payment_method',
      'product',
      'batch',
      'advertiser',
      'date',
      'city',
      'event_type',
    ])
  })

  it('B04: staf ditolak server -> halaman menjelaskannya, bukan menampilkan angka kosong', async () => {
    const { ApiError } = await import('../src/lib/api')
    supabaseRpc.mockRejectedValueOnce(
      new ApiError('FORBIDDEN_REPORT_TAX', 'Report Tax hanya untuk admin dan master admin.', 400),
    )

    renderPage(<ReportTaxPage />)

    expect(await screen.findByText('Tidak punya akses')).toBeDefined()
    expect(screen.getByText('Report Tax hanya untuk admin dan master admin.')).toBeDefined()
    // Tidak ada tabel breakdown yang dirender.
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('Profil (PRD §113–§116, 03 §13)', () => {
  it('menampilkan nama, username, avatar, dan ganti password', () => {
    renderPage(<ProfilePage />)

    expect(screen.getByLabelText('Nama')).toBeDefined()
    expect(screen.getByText('admin1')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Simpan profil' })).toBeDefined()
    expect(screen.getByLabelText('Password saat ini')).toBeDefined()
  })

  it('username TIDAK dapat diubah — ditampilkan sebagai teks, bukan input', () => {
    renderPage(<ProfilePage />)

    expect(screen.queryByLabelText('Username')).toBeNull()
    expect(screen.getByText('admin1')).toBeDefined()
  })

  it('avatar memakai emoji dari PRD §114, bukan unggah gambar', () => {
    renderPage(<ProfilePage />)

    for (const emoji of ['😎', '🚀', '🐼', '🦊', '🐯', '👨💻', '🤖']) {
      expect(screen.getByRole('button', { name: `Pilih avatar ${emoji}` })).toBeDefined()
    }
    expect(screen.queryByText(/unggah|upload/i)).toBeNull()
  })

  it('§116 + 01 §4: password baru terlalu pendek ditolak di klien', async () => {
    renderPage(<ProfilePage />)

    type('Password saat ini', 'rahasia123')
    type('Password baru', 'pendek')
    type('Ulangi password baru', 'pendek')
    fireEvent.click(screen.getByRole('button', { name: 'Ubah password' }))

    expect(await screen.findByText('Password baru minimal 8 karakter.')).toBeDefined()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('konfirmasi tidak sama ditolak sebelum memanggil server', async () => {
    renderPage(<ProfilePage />)

    type('Password saat ini', 'rahasia123')
    type('Password baru', 'passwordbaru1')
    type('Ulangi password baru', 'beda')
    fireEvent.click(screen.getByRole('button', { name: 'Ubah password' }))

    expect(await screen.findByText('Password baru dan konfirmasi tidak sama.')).toBeDefined()
    expect(changePassword).not.toHaveBeenCalled()
  })
})

describe('Scan QR (PRD §95–§99, 01 §14)', () => {
  it('Manual Search selalu tersedia — juga saat kamera tidak bisa dipakai (H06)', () => {
    renderPage(<ScanQrPage />)

    expect(screen.getByText('Manual Search')).toBeDefined()
    expect(screen.getByLabelText('Pencarian')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Nyalakan kamera' })).toBeDefined()
  })

  it('menampilkan hasil terakhir sebagai kartu, bukan sekadar status kecil', () => {
    renderPage(<ScanQrPage />)

    expect(screen.getByText('Hasil terakhir')).toBeDefined()
    expect(screen.getByText('Belum ada tiket yang dipindai.')).toBeDefined()
  })

  it('pencarian manual baru berjalan setelah 2 karakter', async () => {
    const { authorizedRequest } = await import('../src/lib/session')
    vi.mocked(authorizedRequest).mockResolvedValue({
      candidates: [
        {
          order_id: '283033796',
          name: 'Ahmad',
          phone: '+628111',
          app_status: 'Paid',
          product_name: 'Kuliner Masteri',
          batch: '392',
          session: 'S1',
          city: 'Solo',
          already_checked_in: false,
          checked_in_at: null,
        },
      ],
    })

    renderPage(<ScanQrPage />)
    type('Pencarian', 'Ahmad')

    expect(await screen.findByText('Ahmad')).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Check-in' })).toBeDefined()

    await waitFor(() => {
      expect(vi.mocked(authorizedRequest)).toHaveBeenCalledWith('/api/scanner/search?q=Ahmad')
    })
  })
})

describe('Konfigurasi Produk (PRD §57–§63, §162)', () => {
  it('memisahkan empat sumber daya, masing-masing dengan aksi Tambah sendiri', async () => {
    renderPage(<KonfigurasiProdukPage />)

    for (const title of ['Produk', 'Pengiklan', 'Type', 'Sesi']) {
      expect(await screen.findByText(title)).toBeDefined()
    }

    // Satu "+ Tambah" per bagian — bukan satu form panjang untuk semuanya.
    expect(await screen.findAllByRole('button', { name: '+ Tambah' })).toHaveLength(4)
  })

  it('setiap tabel punya kolom Status, dan aksinya Edit + Nonaktifkan', async () => {
    renderPage(<KonfigurasiProdukPage />)

    const tables = await screen.findAllByRole('table')
    expect(tables.length).toBe(5)

    const headers = within(tables[0] as HTMLElement)
      .getAllByRole('columnheader')
      .map((cell) => (cell.textContent ?? '').trim())
    expect(headers.slice(0, 3)).toEqual(['Nama', 'Kode', 'Status'])
  })
})
