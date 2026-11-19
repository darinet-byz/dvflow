// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../src/ui/Toast'

const sessionState = vi.hoisted(() => ({
  permissions: ['config.wa_bot', 'action.wa_bot_send'] as string[],
}))

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: '1',
      username: 'admin1',
      role: 'admin',
      display_name: 'Admin',
      avatar_emoji: null,
      permissions: sessionState.permissions,
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
      is_active: true, ai_enabled: false,
      created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
    },
    advertisers: [{ id: 'adv-1', code: '01', name: 'Zul', active: true }],
  }],
  advertisers: [{
    id: 'adv-1', code: '01', name: 'Zul', active: true,
    products: [{ code: 'KM', name: 'Kuliner Masteri' }],
  }],
  templates: [{
    id: 'tpl-1', name: 'Pagi', message_content: 'Halo {{mention}} {{advertiser_name}}',
    is_active: true, created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
  }],
  schedules: [{
    id: 'sch-1', execution_time: '09:00:00', template_id: 'tpl-1', template_name: 'Pagi', days: [0, 1, 2, 3, 4, 5, 6],
    only_if_missing_report: true, mention_scope: 'all', is_active: true,
    created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
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
  detail: null,
}

let overviewResponse: typeof overview = overview

const preview = {
  found: true,
  group_id: '111@g.us',
  message: 'Pagi Mas @Zul, jangan lupa report kemarin ya.',
  leads: 2,
  paid: 1,
  advertisers: [{ code: '01', name: 'Zul' }],
  mention_scope: 'all',
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
      if (path === '/api/ai/settings') {
        return { enabled: true, base_url: 'https://api.deepseek.com', model: 'deepseek-flash', has_key: true, updated_at: null }
      }
      if (path === '/api/ai/drafts') return { drafts: [] }
      if (path === '/api/ai/runs') return { runs: [] }
      if (path === '/api/ai/settings/test') {
        return { ok: true, reachable: true, model: 'deepseek-flash', error: null, detail: null, reply: 'OK' }
      }
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
  sessionState.permissions = ['config.wa_bot', 'action.wa_bot_send']
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

  it('jadwal punya pilihan audiens semua atau hanya yang belum lapor', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Jadwal' }))
    fireEvent.click(await screen.findByRole('button', { name: '+ Tambah Jadwal' }))
    expect(await screen.findByLabelText('Siapa yang disebut')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Hanya pengiklan yang belum lapor' })).toBeTruthy()
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

  it('menampilkan form kirim tes dengan pilihan produk dan jenis acara', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Kirim Tes' }))
    expect(await screen.findByRole('dialog', { name: 'Kirim Pesan Tes' })).toBeTruthy()
    expect(screen.getByText('KM — Kuliner Masteri')).toBeTruthy()
    expect(screen.getByLabelText('Jenis Acara')).toBeTruthy()
  })

  it('preview tidak mengirim pesan', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Kirim Tes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/Tujuan 111@g.us/)).toBeTruthy()
    expect(await screen.findByText(/Disebut: Zul/)).toBeTruthy()
    expect(screen.getByText(/Pagi Mas @Zul/)).toBeTruthy()
    expect(authorizedRequest).toHaveBeenCalledWith('/api/wa-bot/test-preview', expect.anything())
    expect(authorizedRequest).not.toHaveBeenCalledWith('/api/wa-bot/test-send', expect.anything())
  })

  it('tab Citta AI hanya muncul dengan config.ai_citta dan tidak menampilkan key', async () => {
    sessionState.permissions = ['config.wa_bot', 'action.wa_bot_send', 'config.ai_citta']
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Citta AI' }))

    expect(await screen.findByLabelText('API Key')).toBeTruthy()
    expect(screen.getByPlaceholderText('Tersimpan - isi untuk mengganti')).toBeTruthy()
    expect(screen.queryByDisplayValue('sk-test')).toBeNull()
    expect(authorizedRequest).toHaveBeenCalledWith('/api/ai/settings')

    fireEvent.click(screen.getByRole('button', { name: 'Tes Koneksi' }))
    expect(await screen.findByText('Koneksi berhasil.')).toBeTruthy()
    expect(authorizedRequest).toHaveBeenCalledWith('/api/ai/settings/test', expect.anything())
  })

  it('A84: draft pending bisa dikonfirmasi dari dashboard tanpa balasan YA', async () => {
    sessionState.permissions = ['config.wa_bot', 'action.wa_bot_send', 'config.ai_citta']
    const original = vi.mocked(authorizedRequest).getMockImplementation()
    const draft = {
      id: 'draft-1',
      wa_group_id: '111@g.us',
      command: 'add',
      product_code: 'KM',
      status: 'pending',
      code: 'AB12',
      created_ids: [],
      deleted_ids: [],
      error: null,
      expires_at: '2026-11-19T14:15:46Z',
      confirmed_at: null,
      created_at: '2026-11-19T13:15:46Z',
      item_count: 8,
      batch: null,
      advertiser_codes: [],
      incomplete: true,
    }
    vi.mocked(authorizedRequest).mockImplementation(async (path: string, options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'; body?: unknown }) => {
      if (path === '/api/ai/drafts' && options?.method === undefined) return { drafts: [draft] }
      if (path === '/api/ai/drafts/draft-1/confirm') {
        return {
          status: 'CONFIRMED',
          saved: 8,
          skipped: 0,
          ad_calendar_saved: 2,
          ad_calendar_incomplete: true,
          ad_batch: '?',
          ad_deadline_date: '2026-11-17',
          ad_deadline_rule: 'H-14',
          group_message_sent: true,
        }
      }
      if (original === undefined) throw new Error(`Unexpected request: ${path}`)
      return original(path, options)
    })

    try {
      renderPage()
      fireEvent.click(await screen.findByRole('tab', { name: 'Citta AI' }))

      expect(await screen.findByText('AB12')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }))
      const dialog = await screen.findByRole('dialog', { name: 'Konfirmasi Draft' })
      expect(screen.getByText(/Simpan 8 jadwal/)).toBeTruthy()
      expect(screen.getByText(/belum lengkap/)).toBeTruthy()

      fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }))
      expect(await screen.findByText(/8 jadwal disimpan/)).toBeTruthy()
      expect(authorizedRequest).toHaveBeenCalledWith('/api/ai/drafts/draft-1/confirm', { method: 'POST' })
    } finally {
      if (original !== undefined) vi.mocked(authorizedRequest).mockImplementation(original)
    }
  })
})
