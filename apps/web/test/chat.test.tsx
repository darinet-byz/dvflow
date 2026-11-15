// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../src/ui/Toast'

/**
 * A79: panel chat internal. Launcher hanya ikon, daftar percakapan memakai
 * nama orang, dan kiriman "Semua [Role]" dikirim dengan `all: true`.
 */
vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: 'user-main',
      username: 'manajer',
      role: 'manajer',
      display_name: 'Manajer',
      avatar_emoji: null,
      permissions: ['operasional.chat', 'action.send_chat'],
    },
  }),
}))

const THREAD_ID = '11111111-1111-4111-8111-111111111111'

const thread = {
  id: THREAD_ID,
  other_user_id: 'adv-zul',
  other_name: 'Zul',
  other_account_name: 'Akun Zul',
  other_role: 'advertiser',
  other_role_name: 'Advertiser',
  other_advertiser_name: 'Zul',
  last_message: 'Pengingat report',
  last_sender_id: 'user-main',
  last_message_at: '2026-11-16T02:00:00.000Z',
  unread: 1,
}

const requestMock = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
  if (path === '/api/chat/threads') return { threads: [thread], unread_total: 1 }
  if (path === `/api/chat/threads/${THREAD_ID}/messages`) {
    return {
      thread: {
        id: THREAD_ID,
        other_user_id: 'adv-zul',
        other_name: 'Zul',
        other_account_name: 'Akun Zul',
        other_role: 'advertiser',
        other_role_name: 'Advertiser',
        other_advertiser_name: 'Zul',
      },
      messages: [
        { id: 'm1', sender_id: 'user-main', body: 'Pengingat report', created_at: '2026-11-16T02:00:00.000Z', mine: false },
      ],
    }
  }
  if (path === '/api/chat/recipients') {
    return {
      roles: [
        {
          id: 'advertiser',
          name: 'Advertiser',
          users: [
            { id: 'adv-zul', display_name: 'Zul', account_name: 'Akun Zul', is_advertiser: true, advertiser_name: 'Zul' },
          ],
        },
      ],
    }
  }
  if (path === '/api/chat/messages' && init?.method === 'POST') return { sent: 1, thread_ids: [THREAD_ID] }
  throw new Error(`Unexpected request: ${path}`)
})

vi.mock('../src/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/session')>()
  return { ...actual, authorizedRequest: requestMock }
})

const { ChatWorkspace } = await import('../src/pages/chat/ChatWorkspace')

beforeEach(() => {
  try { window.localStorage.clear() } catch { /* jsdom tanpa localStorage */ }
  requestMock.mockClear()
})
afterEach(cleanup)

function renderChat() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <ChatWorkspace />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('A79: panel Chat Internal', () => {
  it('launcher hanya ikon chat tanpa label teks', async () => {
    renderChat()
    expect(screen.queryByText('Notes')).toBeNull()
    const launcher = screen.getByRole('button', { name: 'Buka Chat' })
    expect(launcher.textContent).not.toContain('Chat')
  })

  it('membuka daftar percakapan lalu detail dan balasan', async () => {
    renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Buka Chat' }))
    expect(await screen.findByText('Zul')).toBeTruthy()

    fireEvent.click(screen.getByText('Zul'))
    expect(await screen.findByText('Pengingat report')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Tulis balasan…'), { target: { value: 'Siap, segera' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('/api/chat/messages', expect.objectContaining({
      method: 'POST',
      body: { role_id: 'advertiser', recipient_id: 'adv-zul', all: false, body: 'Siap, segera' },
    })))
  })

  it('kirim ke semua anggota role memakai all true', async () => {
    renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Buka Chat' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tulis pesan baru' }))

    const roleSelect = await screen.findByLabelText('Role penerima')
    fireEvent.change(roleSelect, { target: { value: 'advertiser' } })
    expect(screen.getByRole('option', { name: 'Semua Advertiser' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Pesan'), { target: { value: 'Halo semua' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('/api/chat/messages', expect.objectContaining({
      method: 'POST',
      body: { role_id: 'advertiser', recipient_id: null, all: true, body: 'Halo semua' },
    })))
  })
})
