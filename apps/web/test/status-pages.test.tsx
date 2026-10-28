// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { supabaseRpc } from '../src/lib/supabase-rest'

/** A52: halaman Status Produk dan Status Pengiklan. */
vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: 'user-mgr',
      username: 'mgr1',
      display_name: 'Manajer',
      role: 'manajer',
      avatar_emoji: null,
      has_all_product_access: true,
      allowed_product_codes: [],
      permissions: ['operasional.product_status', 'operasional.advertiser_status'],
    },
  }),
}))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../src/lib/supabase-rest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabase-rest')>()),
  supabaseRpc: vi.fn(),
  supabaseSelect: vi.fn(async () => []),
}))

beforeEach(() => {
  vi.mocked(supabaseRpc).mockImplementation(async (fn) => {
    if (fn === 'product_status_list') {
      return [{
        id: 'p-km', code: 'KM', name: 'Kuliner', status: 'Active', active: true,
        advertisers: [{ id: 'a-01', code: '01', name: 'Zul' }],
      }] as never
    }
    if (fn === 'advertiser_status_list') {
      return [{
        id: 'a-01', code: '01', name: 'Zul', status: 'In-House', active: true,
        products: [{ id: 'p-km', code: 'KM', name: 'Kuliner' }],
      }] as never
    }
    return {} as never
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const { ProductStatusPage } = await import('../src/pages/status/ProductStatusPage')
const { AdvertiserStatusPage } = await import('../src/pages/status/AdvertiserStatusPage')

describe('Status Produk', () => {
  it('menampilkan produk, mapping, dan mengubah status', async () => {
    render(<ProductStatusPage />)
    expect(await screen.findByText('Kuliner')).toBeTruthy()
    expect(screen.getByText('01')).toBeTruthy()
    const select = screen.getByLabelText('Status KM') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'On-Hold' } })
    expect(supabaseRpc).toHaveBeenCalledWith('set_product_status', {
      p_product_id: 'p-km',
      p_status: 'On-Hold',
    })
  })
})

describe('Status Pengiklan', () => {
  it('Resign meminta konfirmasi sebelum disimpan', async () => {
    render(<AdvertiserStatusPage />)
    expect(await screen.findByText('Zul')).toBeTruthy()
    const select = screen.getByLabelText('Status 01') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'Resign' } })
    expect(await screen.findByText('Ubah Status Menjadi Resign')).toBeTruthy()
    expect(supabaseRpc).not.toHaveBeenCalledWith('set_advertiser_status', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Resign' }))
    expect(supabaseRpc).toHaveBeenCalledWith('set_advertiser_status', {
      p_advertiser_id: 'a-01',
      p_status: 'Resign',
    })
  })
})
