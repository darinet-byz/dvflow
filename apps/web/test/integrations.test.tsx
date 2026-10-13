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
  fireEvent.change(screen.getByLabelText('Nama koneksi / toko'), { target: { value: 'Toko satu' } })
  fireEvent.change(screen.getByLabelText(/Personal access token/), { target: { value: 'test-private-token' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tambah koneksi' }))
  await waitFor(() => expect(authorizedRequest).toHaveBeenCalledWith('/api/integrations/orderonline', { method: 'POST', body: { name: 'Toko satu', api_token: 'test-private-token', active: true } }))
  await screen.findByLabelText('URL webhook: Toko satu')
  expect((screen.getByLabelText(/Personal access token/) as HTMLInputElement).value).toBe('')
})
