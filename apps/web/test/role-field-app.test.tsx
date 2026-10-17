// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'

/** A30: checkbox "Tampilan Apps Lapangan" hanya untuk Pimpro, Staff, Member. */
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: { user_id: '1', username: 'dev', role: 'developer', permissions: [], display_name: 'Dev', avatar_emoji: null } }) }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

const role = (id: string, name: string) => ({ id, name, description: null, is_system: true, user_count: 0, permission_count: 1, created_at: '', updated_at: '' })
vi.mocked(authorizedRequest).mockImplementation(async (path) => {
  if (path === '/api/roles') return { roles: [role('staff', 'Staff (Legacy)'), role('admin', 'Admin')] }
  if (path === '/api/permissions') return { modules: [
    { module: 'operasional', module_name: 'Operasional', permissions: [{ key: 'operasional.scan_qr', name: 'Scan QR Tiket', module: 'operasional', description: '', sort_order: 1 }] },
    { module: 'tampilan', module_name: 'Tampilan', permissions: [{ key: 'ui.field_app', name: 'Tampilan Apps Lapangan', module: 'tampilan', description: '', sort_order: 50 }] },
  ] }
  return { permissions: ['operasional.scan_qr'] }
})

const { RoleConfigPage } = await import('../src/pages/config/RoleConfigPage')
afterEach(cleanup)

describe('Konfigurasi Role: Tampilan Apps Lapangan', () => {
  it.each([[0, 'Staff', true], [1, 'Admin', false]])('baris %i (%s) -> checkbox tampil: %s', async (index, _name, visible) => {
    render(<RoleConfigPage />)
    const buttons = await screen.findAllByRole('button', { name: 'Atur Hak Akses' })
    fireEvent.click(buttons[index]!)
    await screen.findByText('Scan QR Tiket')
    expect(screen.queryByText('Tampilan Apps Lapangan') !== null).toBe(visible)
  })
})
