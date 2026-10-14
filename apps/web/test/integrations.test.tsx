vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: { role: 'developer' } }) }))
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntegrationsPage } from '../src/pages/config/IntegrationsPage'
import { authorizedRequest } from '../src/lib/session'
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('saves a connection, clears its token and displays the generated webhook', async () => {
  vi.mocked(authorizedRequest).mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return { id: 'connection1' }
    if (path.endsWith('/webhook')) return { url: 'https://dvflow.test/api/webhooks/orderonline/connection1/secret' }
    return { rows: [] }
  })
  render(<IntegrationsPage />)
  fireEvent.change(screen.getByLabelText('Nama Toko'), { target: { value: 'Toko satu' } })
  fireEvent.change(screen.getByLabelText(/Kode Toko/), { target: { value: 'TK1' } })
  fireEvent.change(screen.getByLabelText(/Personal Access Token/), { target: { value: 'test-private-token' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tambah Koneksi' }))
  await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/integrations/orderonline', { method: 'POST', body: { name: 'Toko satu', slug: 'TK1', api_token: 'test-private-token', active: true } }))
  await screen.findByText(/1. URL Webhook OrderOnline/)
  expect((screen.getByLabelText(/Personal Access Token/) as HTMLInputElement).value).toBe('')
})
