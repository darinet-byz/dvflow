// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

/**
 * Test render untuk kontrak yang berbentuk TAMPILAN.
 *
 * Yang diuji di sini bukan gaya visual, melainkan hal-hal yang dipaku dokumen
 * dan mudah rusak tanpa terlihat: urutan kolom tabel Master Order (PRD §45),
 * kolom T1–T10 presensi (PRD §103), dan tidak adanya kontrol signup/forgot
 * password (04 §2, 05 §A10).
 */

// Lapisan data diganti: yang diuji adalah tampilannya, bukan jaringannya.
vi.mock('../src/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/queries')>()
  return {
    ...actual,
    fetchDashboardSummary: vi.fn(async () => ({
      leads: 4,
      paid: 2,
      pending: 1,
      cancelled: 1,
      conversion_rate: 0.5,
      gross_amount: 800000,
      tax_amount: 6100,
      net_amount: 793900,
      sudah_hadir: 2,
      belum_hadir: 0,
      attendance_rate: 1,
    })),
    fetchOrdersPage: vi.fn(async () => ({
      rows: [
        {
          id: 'order-1',
          order_id: '283033796',
          name: 'Ahmad',
          phone: '+628111',
          email: 'ahmad@example.com',
          product_raw: 'KM01SO392 - S1 - Solo',
          product_parse_status: 'valid',
          product_code: 'KM',
          product_name: 'Kuliner Masteri',
          advertiser_code: '01',
          advertiser_name: 'Zul',
          event_type: 'Seminar Offline',
          batch: '392',
          session: 'S1',
          city: 'Solo',
          raw_status: 'processing',
          app_status: 'Paid',
          payment_method: 'bank_transfer',
          payment_provider: null,
          payment_identifier: 'bank_transfer',
          gross_amount: 300000,
          tax_amount: 4000,
          net_amount: 296000,
          tax_mapping_status: 'mapped',
          fee_rule_name_snapshot: 'Admin Bank Transfer',
          fee_type_snapshot: 'flat',
          fee_value_snapshot: 4000,
          source_created_at: '2026-09-15T02:31:33Z',
          source_updated_at: null,
          created_at: '2026-10-13T08:00:00.000Z',
          paid_at: '2026-10-13T08:05:00.000Z',
          updated_at: '2026-10-13T08:05:00.000Z',
        },
      ],
      total: 1,
      summary: { total: 1, paid: 1, pending: 0 },
    })),
    fetchPresensiPage: vi.fn(async () => ({
      rows: [
        {
          order_id: '283033796',
          name: 'Ahmad',
          phone: '+628111',
          product_code: 'KM',
          product_name: 'Kuliner Masteri',
          advertiser_code: '01',
          advertiser_name: 'Zul',
          event_type: 'Seminar Offline',
          batch: '392',
          session: 'S1',
          city: 'Solo',
          product_parse_status: 'valid',
          app_status: 'Paid',
          attendance_status: 'Hadir',
          total_activity: 3,
          latest_activity: '2026-10-13T09:00:00.000Z',
          timestamps: ['2026-10-13T09:00:00.000Z', '2026-10-13T08:30:00.000Z'],
          created_at: '2026-10-13T08:00:00.000Z',
          paid_at: '2026-10-13T08:05:00.000Z',
          updated_at: '2026-10-13T08:05:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      page_size: 50,
    })),
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

const { OrderPage } = await import('../src/pages/order/OrderPage')
const { PresensiPage } = await import('../src/pages/presensi/PresensiPage')
const { LoginPage } = await import('../src/pages/LoginPage')
const { ToastProvider } = await import('../src/ui/Toast')

afterEach(() => {
  cleanup()
})

function renderPage(element: ReactElement): void {
  render(
    <MemoryRouter>
      <ToastProvider>{element}</ToastProvider>
    </MemoryRouter>,
  )
}

/** Judul kolom tabel, berurutan. */
async function columnHeaders(): Promise<string[]> {
  const table = await screen.findByRole('table')
  const headers = within(table).getAllByRole('columnheader')
  return headers.map((header) => (header.textContent ?? '').replace(/[▲▼↕]/g, '').trim())
}

describe('tabel Master Order (PRD §45)', () => {
  it('menampilkan seluruh kolom dengan urutan yang ditentukan dokumen', async () => {
    renderPage(<OrderPage />)

    expect(await columnHeaders()).toEqual([
      'Order ID',
      'Nama',
      'No WA',
      'Email',
      'Produk',
      'Pengiklan',
      'Seminar / Webinar',
      'Batch',
      'Sesi',
      'Kota',
      'Status',
      'Payment Method',
      'Provider',
      'Gross',
      'Tax',
      'Net',
      'Created At',
      'Paid At',
      'Updated At',
    ])
  })

  it('menampilkan ringkasan kecil Total Result / Paid / Pending (PRD §46)', async () => {
    renderPage(<OrderPage />)

    // "Total Result" hanya ada di ringkasan, jadi aman dipakai sebagai penanda
    // bahwa ringkasannya benar-benar dirender.
    expect(await screen.findByText('Total Result')).toBeDefined()
    // "Paid" dan "Pending" juga muncul sebagai badge status di tabel, jadi
    // yang diperiksa adalah keberadaannya, bukan jumlahnya.
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
  })

  it('tidak ada tombol edit atau delete pada baris order (PRD §49–§50)', async () => {
    renderPage(<OrderPage />)
    await screen.findByRole('table')

    const texts = screen.queryAllByRole('button').map((button) => (button.textContent ?? '').toLowerCase())
    expect(texts.some((text) => text.includes('edit'))).toBe(false)
    expect(texts.some((text) => text.includes('hapus') || text.includes('delete'))).toBe(false)
  })

  it('pagination hanya menawarkan 50 dan 100 baris (PRD §33)', async () => {
    renderPage(<OrderPage />)
    const selector = (await screen.findByLabelText('Baris')) as HTMLSelectElement

    expect(Array.from(selector.options).map((option) => option.value)).toEqual(['50', '100'])
  })
})

describe('tabel Presensi (PRD §103, §105)', () => {
  it('menampilkan T1 sampai T10 tepat sekali', async () => {
    renderPage(<PresensiPage />)

    const headers = await columnHeaders()
    const timestamps = headers.filter((header) => /^T\d+$/.test(header))

    expect(timestamps).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'])
  })

  it('menampilkan Total Activity, bukan hanya jumlah yang tampil', async () => {
    renderPage(<PresensiPage />)

    const headers = await columnHeaders()
    expect(headers).toContain('Total Activity')
    // Fixture punya 3 aktivitas dan hanya 2 timestamp tersimpan.
    expect(await screen.findByText('3')).toBeDefined()
  })

  it('kolom penting di lapangan berada di depan (PRD §103)', async () => {
    renderPage(<PresensiPage />)

    const headers = await columnHeaders()
    expect(headers.slice(0, 3)).toEqual(['Order ID', 'Nama', 'No WA'])
  })
})

describe('halaman login (04 §2, 05 §A10)', () => {
  it('tidak menawarkan signup, lupa password, atau OAuth', () => {
    renderPage(<LoginPage />)

    const body = document.body.textContent?.toLowerCase() ?? ''
    for (const forbidden of ['daftar', 'sign up', 'signup', 'register', 'lupa password', 'forgot', 'google', 'oauth']) {
      expect(body, `login tidak boleh menawarkan "${forbidden}"`).not.toContain(forbidden)
    }

    const linkCount = screen.queryAllByRole('link').length
    expect(linkCount).toBe(0)
  })

  it('hanya meminta username dan password', () => {
    renderPage(<LoginPage />)

    expect(screen.getByLabelText('Username')).toBeDefined()
    expect(screen.getByLabelText('Password')).toBeDefined()
  })
})
