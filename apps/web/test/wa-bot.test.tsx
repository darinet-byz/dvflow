// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../src/ui/Toast'

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: '1',
      username: 'admin1',
      role: 'admin',
      display_name: 'Admin',
      avatar_emoji: null,
      permissions: ['config.wa_bot', 'action.wa_bot_send'],
    },
  }),
}))

const overview = {
  settings: { has_token: true, updated_at: '2026-11-11T01:00:00Z' },
  products: [{
    id: 'prod-1',
    code: 'KM',
    name: 'Kuliner Masteri',
    active: true,
    group: {
      id: 'group-1', product_id: 'prod-1', fonnte_group_id: '111@g.us',
      is_active: true, created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
    },
    advertisers: [{ id: 'adv-1', code: '01', name: 'Zul', active: true, wa_phone: '628111111111' }],
  }],
  advertisers: [{
    id: 'adv-1', code: '01', name: 'Zul', active: true, wa_phone: '628111111111',
    products: [{ code: 'KM', name: 'Kuliner Masteri' }],
  }],
  templates: [{
    id: 'tpl-1', name: 'Pagi', message_content: 'Halo {{mention}} {{advertiser_name}}',
    is_active: true, created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
  }],
  schedules: [{
    id: 'sch-1', execution_time: '09:00:00', template_id: 'tpl-1', template_name: 'Pagi', days: [0, 1, 2, 3, 4, 5, 6],
    only_if_missing_report: true, is_active: true, created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
  }],
}

const logs = { rows: [], total: 0, page: 1, pageSize: 50 }

const deviceCheck = {
  has_token: true,
  reachable: true,
  connected: true,
  status: 'connect',
  device: {
    number: '6282227097005',
    name: 'Fonnte admin',
    status: 'connect',
    quota: '78',
    package: 'Reguler',
    expired: '18 November 2029',
  },
  error: null,
}

let overviewResponse: typeof overview = overview

const preview = {
  found: true,
  group_id: '111@g.us',
  message: 'Halo @628111111111, Zul Kuliner Masteri Seminar Offline 2026-11-10.',
  leads: 2,
  paid: 1,
  advertiser_id: 'adv-1',
  advertiser_name: 'Zul',
  advertiser_code: '01',
  product_code: 'KM',
  product_name: 'Kuliner Masteri',
  event_type: 'Seminar Offline',
  reminder_date: '2026-11-11',
}

vi.mock('../src/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/session')>()
  return {
    ...actual,
    authorizedRequest: vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path.startsWith('/api/wa-bot/logs')) return logs
      if (path === '/api/wa-bot/settings/verify') return deviceCheck
      if (path === '/api/wa-bot/test-preview') return preview
      if (path === '/api/wa-bot/test-send') return { sent: true, error: null, message: preview.message, group_id: preview.group_id }
      if (path.startsWith('/api/wa-bot/advertisers/') && options?.method === 'PATCH') return { id: 'adv-1', wa_phone: '6281234567890' }
      if (path === '/api/wa-bot' && options?.method === undefined) return overviewResponse
      throw new Error(`Unexpected request: ${options?.method ?? 'GET'} ${path}`)
    }),
  }
})

const { WaBotPage } = await import('../src/pages/wa-bot/WaBotPage')
const { authorizedRequest } = await import('../src/lib/session')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  overviewResponse = overview
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <WaBotPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('WA Admin Bot page', () => {
  it('menampilkan koneksi, grup per produk, jadwal, dan riwayat lewat tab', async () => {
    renderPage()
    expect(await screen.findByText('WA Admin Bot')).toBeTruthy()
    expect(await screen.findByText('Terhubung')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Produk & Grup' }))
    expect(await screen.findByText('Grup WhatsApp per Produk')).toBeTruthy()
    expect(screen.getByText('111@g.us')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Jadwal' }))
    expect(await screen.findByText('Setiap hari')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Riwayat' }))
    expect(await screen.findByText('Riwayat Pengiriman')).toBeTruthy()
    expect(screen.getByText(/Disimpan 3 hari/)).toBeTruthy()
  })

  it('menolak placeholder asing sebelum memanggil server', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Template' }))
    fireEvent.click(await screen.findByRole('button', { name: '+ Tambah Template' }))
    const textarea = screen.getByLabelText('Isi Pesan')
    fireEvent.change(textarea, { target: { value: 'Halo {{lead}}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText(/Placeholder tidak dikenal/)).toBeTruthy()
    await waitFor(() => {
      expect(authorizedRequest).not.toHaveBeenCalledWith('/api/wa-bot/templates', expect.anything())
    })
  })

  it('menampilkan status device Fonnte, bukan hanya penanda token tersimpan', async () => {
    renderPage()
    expect(await screen.findByText('Terhubung')).toBeTruthy()
    expect(screen.getByText(/Terhubung ke WhatsApp 6282227097005/)).toBeTruthy()
    expect(screen.getByText(/Kuota 78/)).toBeTruthy()
    expect(authorizedRequest).toHaveBeenCalledWith('/api/wa-bot/settings/verify', { method: 'POST' })
  })

  it('menjelaskan kenapa Kirim Tes belum bisa dipakai saat belum ada grup produk', async () => {
    overviewResponse = { ...overview, products: [] }
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Kirim Tes' }))

    expect(await screen.findByText(/Belum ada produk dengan grup WhatsApp aktif/)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Kirim Pesan Tes' })).toBeNull()
  })

  it('menampilkan form kirim tes dengan pilihan produk dan pengiklan', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Kirim Tes' }))
    expect(await screen.findByRole('dialog', { name: 'Kirim Pesan Tes' })).toBeTruthy()
    expect(screen.getByText('KM — Kuliner Masteri')).toBeTruthy()
    expect(screen.getByRole('option', { name: '01 — Zul (628111111111)' })).toBeTruthy()
  })

  it('menyimpan nomor WA pengiklan dari tab khusus', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Nomor WA Pengiklan' }))
    const input = await screen.findByLabelText('Nomor WA Zul')
    fireEvent.change(input, { target: { value: '0812-3456-7890' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => {
      expect(authorizedRequest).toHaveBeenCalledWith('/api/wa-bot/advertisers/adv-1', {
        method: 'PATCH',
        body: { wa_phone: '0812-3456-7890' },
      })
    })
  })

  it('preview tidak mengirim pesan', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Kirim Tes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/Tujuan 111@g.us/)).toBeTruthy()
    expect(authorizedRequest).toHaveBeenCalledWith('/api/wa-bot/test-preview', expect.anything())
    expect(authorizedRequest).not.toHaveBeenCalledWith('/api/wa-bot/test-send', expect.anything())
  })
})
