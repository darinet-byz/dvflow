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
  advertisers: [{ id: 'adv-1', code: '01', name: 'Zul', active: true }],
  groups: [{
    id: 'group-1', advertiser_id: 'adv-1', advertiser_code: '01', advertiser_name: 'Zul', advertiser_active: true,
    fonnte_group_id: '111@g.us', pic_phone: '628111111111', pic_name: 'PIC', is_active: true,
    created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
  }],
  templates: [{
    id: 'tpl-1', name: 'Pagi', message_content: 'Halo {{mention}} {{store_name}}', is_active: true,
    created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
  }],
  schedules: [{
    id: 'sch-1', execution_time: '09:00:00', template_id: 'tpl-1', template_name: 'Pagi', days: [0, 1, 2, 3, 4, 5, 6],
    only_if_missing_report: true, is_active: true, created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z',
  }],
}

const logs = { rows: [], total: 0, page: 1, pageSize: 50 }

vi.mock('../src/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/session')>()
  return {
    ...actual,
    authorizedRequest: vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path.startsWith('/api/wa-bot/logs')) return logs
      if (path === '/api/wa-bot' && options?.method === undefined) return overview
      throw new Error(`Unexpected request: ${options?.method ?? 'GET'} ${path}`)
    }),
  }
})

vi.mock('../src/lib/useConfigLists', () => ({
  useConfigLists: () => ({ lists: { products: [{ value: 'KM', label: 'KM — Kuliner Masteri' }] }, error: null }),
}))

const { WaBotPage } = await import('../src/pages/wa-bot/WaBotPage')
const { authorizedRequest } = await import('../src/lib/session')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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
  it('menampilkan konfigurasi, jadwal, dan riwayat', async () => {
    renderPage()
    expect(await screen.findByText('WA Admin Bot')).toBeTruthy()
    expect(screen.getByText('Token terpasang')).toBeTruthy()
    expect(screen.getByText('111@g.us')).toBeTruthy()
    expect(screen.getByText('Setiap hari')).toBeTruthy()
    expect(screen.getByText('Riwayat Pengiriman')).toBeTruthy()
  })

  it('menolak placeholder asing sebelum memanggil server', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '+ Tambah Template' }))
    const textarea = screen.getByLabelText('Isi Pesan')
    fireEvent.change(textarea, { target: { value: 'Halo {{lead}}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText(/Placeholder tidak dikenal/)).toBeTruthy()
    await waitFor(() => {
      expect(authorizedRequest).not.toHaveBeenCalledWith('/api/wa-bot/templates', expect.anything())
    })
  })

  it('menampilkan form kirim tes dengan pilihan pengiklan dan produk', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Kirim Tes' }))
    expect(await screen.findByRole('dialog', { name: 'Kirim Pesan Tes' })).toBeTruthy()
    expect(screen.getByText('KM — Kuliner Masteri')).toBeTruthy()
  })
})
