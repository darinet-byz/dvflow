// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useSession } from '../src/lib/useSession'
import { supabaseSelect } from '../src/lib/supabase-rest'

/**
 * A74: status sesi hanya Developer.
 *
 * Role lain tetap bisa menambah sesi (selalu aktif) dan menyunting nama, tetapi
 * switch on/off dinonaktifkan di UI. Penegakan sebenarnya ada di API.
 */
vi.mock('../src/lib/useSession', () => ({ useSession: vi.fn() }))
vi.mock('../src/lib/supabase-rest', () => ({ supabaseSelect: vi.fn() }))
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

const { ConfigSection } = await import('../src/pages/config/ConfigSection')
const { SESSION_SPEC } = await import('../src/pages/config/specs')

const ST_ROW = { id: 'session-st', name: 'Sesi Tunggal', code: 'ST', active: true }

function profile(role: string) {
  return {
    user_id: `u-${role}`,
    username: role,
    display_name: role,
    role,
    avatar_emoji: null,
    has_all_product_access: true,
    allowed_product_codes: [],
    advertiser_code: null,
    advertiser_name: null,
    permissions: ['config.produk', 'action.delete_master'],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabaseSelect).mockResolvedValue([ST_ROW])
})
afterEach(cleanup)

describe('toggle status sesi (A74)', () => {
  it('Developer dapat menggeser switch', async () => {
    vi.mocked(useSession).mockReturnValue({ status: 'authenticated', profile: profile('developer') })
    render(<ConfigSection spec={SESSION_SPEC} />)

    const toggle = await screen.findByRole('switch', { name: 'Aktif ST' })
    expect(toggle).toHaveProperty('disabled', false)
    expect(toggle).toHaveProperty('checked', true)
  })

  it('owner/admin hanya melihat switch terkunci', async () => {
    vi.mocked(useSession).mockReturnValue({ status: 'authenticated', profile: profile('owner') })
    render(<ConfigSection spec={SESSION_SPEC} />)

    const toggle = await screen.findByRole('switch', { name: 'Aktif ST' })
    expect(toggle).toHaveProperty('disabled', true)
  })

  it('role lain tidak melihat tombol hapus permanen sesi', async () => {
    vi.mocked(useSession).mockReturnValue({ status: 'authenticated', profile: profile('admin') })
    render(<ConfigSection spec={SESSION_SPEC} />)

    await screen.findByRole('switch', { name: 'Aktif ST' })
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull()
  })

  it('Developer melihat tombol hapus permanen sesi', async () => {
    vi.mocked(useSession).mockReturnValue({ status: 'authenticated', profile: profile('developer') })
    render(<ConfigSection spec={SESSION_SPEC} />)

    expect(await screen.findByRole('button', { name: 'Hapus' })).toBeTruthy()
  })
})
