// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Profile } from '../src/lib/api'
import { ApiError } from '../src/lib/api'
import { authorizedRequest } from '../src/lib/session'

/** A50/A54: Manajer boleh tambah team; hapus hanya jika tanpa data. */
type Call = { path: string; method: string; body?: unknown }
const state = vi.hoisted(() => ({
  profile: null as unknown as Profile,
  users: [] as Array<Record<string, unknown>>,
  roles: [] as Array<{ id: string; name: string }>,
  calls: [] as Call[],
  deleteBlocked: false,
}))

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({ status: 'authenticated', profile: state.profile }),
}))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/queries')>()),
  fetchConfigLists: vi.fn(async () => ({
    products: [
      { value: 'KM', label: 'KM — Kuliner' },
      { value: 'BM', label: 'BM — Bisnis' },
    ],
    advertisers: [],
    eventTypes: [],
    eventTypeNames: [],
    sessions: [],
    paymentMethods: [],
  })),
  fetchAdvertiserChoices: vi.fn(async () => [
    { id: 'adv-1', code: '01', name: 'Zul', active: true },
  ]),
}))
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))

const manager: Profile = {
  user_id: 'user-mgr',
  username: 'mgr1',
  display_name: 'Manajer',
  role: 'manajer',
  avatar_emoji: null,
  has_all_product_access: false,
  allowed_product_codes: ['KM'],
  permissions: ['team.manage'],
}
const developer: Profile = {
  user_id: 'user-dev',
  username: 'dev1',
  display_name: 'Developer',
  role: 'developer',
  avatar_emoji: null,
  has_all_product_access: true,
  permissions: [],
}

beforeEach(() => {
  state.profile = manager
  state.users = [
    { id: 'user-member', username: 'member1', display_name: 'Member Satu', role: 'member', active: true, has_all_product_access: false, allowed_product_codes: ['KM'] },
  ]
  state.roles = [
    { id: 'member', name: 'Member' },
    { id: 'pimpro', name: 'Pimpro' },
    { id: 'advertiser', name: 'Advertiser' },
  ]
  state.calls.length = 0
  state.deleteBlocked = false
  vi.mocked(authorizedRequest).mockImplementation(async (path, options = {}) => {
    const method = options.method ?? 'GET'
    state.calls.push({ path, method, body: options.body })
    if (path === '/api/internal/users' && method === 'GET') return { users: state.users } as never
    if (path === '/api/roles') return { roles: state.roles } as never
    if (path.startsWith('/api/internal/users/')) {
      if (method === 'DELETE' && state.deleteBlocked) {
        throw new ApiError('USER_HAS_DATA', 'User memiliki data historis.', 409)
      }
      return {} as never
    }
    return {} as never
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const { TeamPage } = await import('../src/pages/team/TeamPage')

describe('Add Team: delegasi team.manage', () => {
  it('manajer scoped hanya bisa menambah, tanpa Edit/Hapus dan tanpa Semua Produk', async () => {
    render(<TeamPage />)
    expect(await screen.findByText('member1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tambah member' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull()
    expect((screen.getByLabelText('Semua Produk (All Products)') as HTMLInputElement).disabled).toBe(true)
    const roleOptions = Array.from((screen.getByLabelText('Role') as HTMLSelectElement).options).map((option) => option.value)
    expect(roleOptions).toEqual(['member', 'pimpro', 'advertiser'])
  })

  it('username yang sudah ada ditolak di field dan tidak memanggil API', async () => {
    render(<TeamPage />)
    await screen.findByText('member1')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'MEMBER1' } })
    fireEvent.change(screen.getByLabelText('Password awal'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah member' }))
    expect(await screen.findByText('Username sudah dipakai.')).toBeTruthy()
    expect(state.calls.some((call) => call.method === 'POST')).toBe(false)
  })
})

describe('Add Team: kebijakan hapus', () => {
  it('user berdata ditolak, lalu ditawari Non-Aktifkan', async () => {
    state.profile = developer
    state.users = [
      { id: 'adv-user', username: 'adv1', display_name: 'Adv', role: 'advertiser', active: true, has_all_product_access: false, allowed_product_codes: ['KM'], advertiser_id: 'adv-1' },
    ]
    state.deleteBlocked = true
    render(<TeamPage />)
    await screen.findByText('adv1')
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus Member' }))
    expect(await screen.findByText('Tidak Bisa Menghapus')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Non-Aktifkan' }))
    await waitFor(() => expect(state.calls.some((call) =>
      call.path === '/api/internal/users/adv-user'
      && call.method === 'PATCH'
      && (call.body as { active?: boolean } | undefined)?.active === false,
    )).toBe(true))
  })
})
