// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  PRODUCT_SCOPE_TTL_MS,
  clearAllStoredProductScopes,
  clearStoredProductScope,
  isProductScopedPath,
  persistProductScope,
  productScopeStorageKey,
  readStoredProductScope,
} from '../src/lib/product-scope'
import { useProductScope } from '../src/layout/ProductScope'

/** A97/A98: pilih produk full-screen, lalu shell baru terbuka. */

vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/queries')>()),
  fetchProductOptions: vi.fn(),
}))

const session = vi.hoisted(() => ({
  profile: {
    user_id: 'u1',
    username: 'u1',
    display_name: 'Uji',
    role: 'developer',
    avatar_emoji: null,
    permissions: [],
  } as Record<string, unknown>,
}))

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({ status: 'authenticated', profile: session.profile }),
}))

// Fokus tes ini adalah scope produk; komponen global lain cukup menjadi penanda.
vi.mock('../src/layout/GlobalSearch', () => ({
  GlobalSearchButton: ({ compact }: { compact?: boolean }) => (
    <button type="button" data-testid={compact ? 'search-compact' : 'search-full'}>Cari menu</button>
  ),
  GlobalSearchDialog: () => null,
}))
vi.mock('../src/pages/chat/ChatWorkspace', () => ({ ChatWorkspace: () => null }))

const { fetchProductOptions } = await import('../src/lib/queries')
const { AppShell } = await import('../src/layout/AppShell')

// jsdom di runner ini tidak menyediakan localStorage; tiruan kecil sudah cukup.
const memory = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => Array.from(memory.keys())[index] ?? null,
    get length() { return memory.size },
  },
})

const PRODUCTS = [
  { value: 'KM', label: 'KM — Kuliner Masteri', name: 'Kuliner Masteri' },
  { value: 'SO', label: 'SO — Seminar Online', name: 'Seminar Online' },
]
const USER_ID = 'u1'
const DEVELOPER_PROFILE = { ...session.profile }

function ScopeProbe() {
  const scope = useProductScope()
  return <p>{scope?.chosen ? `Halaman ${scope.code || 'semua'}` : 'Halaman tanpa scope'}</p>
}

function renderShell(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<ScopeProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function stored(userId = USER_ID) {
  const raw = window.localStorage.getItem(productScopeStorageKey(userId))
  return raw === null ? null : JSON.parse(raw) as { code?: string; chosenAt?: number }
}

async function chooseProduct(code: string): Promise<void> {
  const button = await screen.findByRole('button', { name: new RegExp(`\\b${code}\\b`) })
  act(() => button.click())
}

function mainNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Menu utama' })
}

beforeEach(() => {
  window.localStorage.clear()
  session.profile = { ...DEVELOPER_PROFILE }
  vi.mocked(fetchProductOptions).mockResolvedValue(PRODUCTS)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('product scope: path', () => {
  it('delapan halaman data ber-scope, konfigurasi tidak', () => {
    for (const path of ['/', '/order', '/order-refund', '/presensi', '/kalender', '/report-spend', '/report-tax', '/performa']) {
      expect(isProductScopedPath(path)).toBe(true)
      expect(isProductScopedPath(`${path}/`)).toBe(true)
    }
    for (const path of ['/konfigurasi-produk', '/status-produk', '/ots', '/scan-qr', '/order-unmapped']) {
      expect(isProductScopedPath(path)).toBe(false)
    }
  })
})

describe('product scope: penyimpanan & TTL', () => {
  it('tersimpan per user; user lain tidak mewarisi', () => {
    persistProductScope('u1', 'KM')
    expect(readStoredProductScope('u1')?.code).toBe('KM')
    expect(readStoredProductScope('u2')).toBeNull()
  })

  it('berlaku 24 jam - 1 ms, kedaluwarsa tepat 24 jam', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const base = new Date('2026-11-26T08:00:00.000Z').getTime()
    vi.setSystemTime(base)

    persistProductScope(USER_ID, 'KM')
    vi.setSystemTime(base + PRODUCT_SCOPE_TTL_MS - 1)
    expect(readStoredProductScope(USER_ID)?.code).toBe('KM')

    vi.setSystemTime(base + PRODUCT_SCOPE_TTL_MS)
    expect(readStoredProductScope(USER_ID)).toBeNull()
    expect(window.localStorage.getItem(productScopeStorageKey(USER_ID))).toBeNull()
  })

  it('timestamp rusak / di masa depan dianggap kedaluwarsa', () => {
    const key = productScopeStorageKey(USER_ID)
    window.localStorage.setItem(key, '{bukan json')
    expect(readStoredProductScope(USER_ID)).toBeNull()

    window.localStorage.setItem(key, JSON.stringify({ code: 'KM', chosenAt: Date.now() + 60 * 60 * 1000 }))
    expect(readStoredProductScope(USER_ID)).toBeNull()
  })

  it('logout menghapus semua pilihan produk, bukan kunci lain', () => {
    persistProductScope('u1', 'KM')
    persistProductScope('u2', 'SO')
    window.localStorage.setItem('dvflow.filters.order', 'tetap')

    clearAllStoredProductScopes()

    expect(window.localStorage.getItem(productScopeStorageKey('u1'))).toBeNull()
    expect(window.localStorage.getItem(productScopeStorageKey('u2'))).toBeNull()
    expect(window.localStorage.getItem('dvflow.filters.order')).toBe('tetap')
  })

  it('clear satu user tidak menyentuh user lain', () => {
    persistProductScope('u1', 'KM')
    persistProductScope('u2', 'SO')
    clearStoredProductScope('u1')
    expect(readStoredProductScope('u1')).toBeNull()
    expect(readStoredProductScope('u2')?.code).toBe('SO')
  })
})

describe('product scope: layar pilih full-screen', () => {
  it('belum memilih: layar penuh tampil, menu dan search tidak dirender', async () => {
    renderShell('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Menu utama' })).toBeNull()
    expect(screen.queryByTestId('search-full')).toBeNull()
    expect(screen.queryByText('Halaman tanpa scope')).toBeNull()
    expect(await screen.findByRole('button', { name: /KM/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /SO/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Semua Produk/ })).toBeTruthy()
  })

  it('memilih produk membuka shell, menampilkan nama produk, dan mengingat pilihan', async () => {
    renderShell('/')
    await screen.findByText('Pilih Produk Dulu')
    await chooseProduct('KM')

    expect(await screen.findByText('Halaman KM')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
    expect(mainNav()).toBeTruthy()
    expect(screen.getByText('Kuliner Masteri')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Ganti produk/ })).toBeTruthy()
    expect(screen.getByTestId('search-full')).toBeTruthy()
    expect(within(mainNav()).queryByTestId('search-full')).toBeNull()
    expect(stored()?.code).toBe('KM')
  })

  it('"Semua Produk" adalah pilihan yang sah', async () => {
    renderShell('/')
    await screen.findByText('Pilih Produk Dulu')
    const all = await screen.findByRole('button', { name: /Semua Produk/ })
    act(() => all.click())

    expect(await screen.findByText('Halaman semua')).toBeTruthy()
    expect(stored()?.code).toBe('')
  })

  it('hanya satu produk: tetap harus memilih, tidak auto-select', async () => {
    vi.mocked(fetchProductOptions).mockResolvedValue([PRODUCTS[0]!])
    renderShell('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(await screen.findByRole('button', { name: /KM/ })).toBeTruthy()
    expect(screen.queryByText('Halaman KM')).toBeNull()
  })

  it('hanya produk yang ditugaskan yang tampil', async () => {
    session.profile = {
      ...DEVELOPER_PROFILE,
      role: 'pimpro',
      has_all_product_access: false,
      allowed_product_codes: ['KM'],
    }
    renderShell('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(await screen.findByRole('button', { name: /KM/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /SO/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Semua Produk/ })).toBeTruthy()
  })

  it('deep link productCode langsung memilih produk', async () => {
    renderShell('/order?productCode=SO')
    expect(await screen.findByText('Halaman SO')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
    expect(stored()?.code).toBe('SO')
  })

  it('produk tersimpan yang tidak ada di opsi dibuang', async () => {
    window.localStorage.setItem(productScopeStorageKey(USER_ID), JSON.stringify({ code: 'ZZ', chosenAt: Date.now() }))
    renderShell('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    await waitFor(() => expect(readStoredProductScope(USER_ID)).toBeNull())
  })

  it('pilihan tersimpan yang sudah lewat 24 jam dibuang saat mount', async () => {
    window.localStorage.setItem(
      productScopeStorageKey(USER_ID),
      JSON.stringify({ code: 'KM', chosenAt: Date.now() - PRODUCT_SCOPE_TTL_MS }),
    )
    renderShell('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(stored()).toBeNull()
  })

  it('tidak ada produk: arahan tanpa opsi Semua Produk, dan admin bisa ke Konfigurasi', async () => {
    vi.mocked(fetchProductOptions).mockResolvedValue([])
    renderShell('/konfigurasi-produk')
    expect(await screen.findByText('Belum ada produk yang ditugaskan.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Semua Produk/ })).toBeNull()

    const manage = await screen.findByRole('button', { name: 'Kelola Produk' })
    act(() => manage.click())
    expect(await screen.findByText('Halaman tanpa scope')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
    expect(mainNav()).toBeTruthy()
  })

  it('admin di Konfigurasi Produk bisa membuka picker lalu Batal kembali', async () => {
    vi.mocked(fetchProductOptions).mockResolvedValue([])
    renderShell('/konfigurasi-produk')
    await screen.findByText('Belum ada produk yang ditugaskan.')
    act(() => screen.getByRole('button', { name: 'Kelola Produk' }).click())
    expect(await screen.findByText('Halaman tanpa scope')).toBeTruthy()

    act(() => screen.getByRole('button', { name: /Pilih produk/ }).click())
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Batal' })).toBeTruthy()

    act(() => screen.getByRole('button', { name: 'Batal' }).click())
    expect(await screen.findByText('Halaman tanpa scope')).toBeTruthy()
  })

  it('kedaluwarsa saat tab terbuka: focus memunculkan layar pilih lagi', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const base = new Date('2026-11-26T08:00:00.000Z').getTime()
    vi.setSystemTime(base)

    renderShell('/')
    await screen.findByText('Pilih Produk Dulu')
    await chooseProduct('KM')
    expect(await screen.findByText('Halaman KM')).toBeTruthy()

    act(() => {
      vi.setSystemTime(base + PRODUCT_SCOPE_TTL_MS)
      window.dispatchEvent(new Event('focus'))
    })

    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(stored()).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Menu utama' })).toBeNull()
  })

  it('setelah expiry, reload tetap memunculkan layar pilih (satu produk)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const base = new Date('2026-11-26T08:00:00.000Z').getTime()
    vi.setSystemTime(base)
    vi.mocked(fetchProductOptions).mockResolvedValue([PRODUCTS[0]!])

    persistProductScope(USER_ID, 'KM', base)
    const view = renderShell('/')
    expect(await screen.findByText('Halaman KM')).toBeTruthy()

    act(() => {
      vi.setSystemTime(base + PRODUCT_SCOPE_TTL_MS)
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()

    view.unmount()
    renderShell('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
  })

  it('logout + satu produk: layar pilih muncul, bukan auto-select', async () => {
    persistProductScope(USER_ID, 'KM')
    clearAllStoredProductScopes()
    vi.mocked(fetchProductOptions).mockResolvedValue([PRODUCTS[0]!])

    renderShell('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
  })
})

describe('product scope: ganti produk', () => {
  it('klik nama produk membuka layar penuh; Batal kembali ke produk lama', async () => {
    renderShell('/')
    await screen.findByText('Pilih Produk Dulu')
    await chooseProduct('KM')
    expect(await screen.findByText('Halaman KM')).toBeTruthy()
    const pageBefore = screen.getByText('Halaman KM')

    act(() => screen.getByRole('button', { name: /Ganti produk/ }).click())
    expect(await screen.findByText('Ganti Produk')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Batal' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Menu utama' })).toBeNull()
    // A100: picker adalah overlay; shell tetap terpasang (node yang sama) dan inert.
    expect(screen.getByText('Halaman KM')).toBe(pageBefore)
    expect(pageBefore.closest('[inert]')).not.toBeNull()

    act(() => screen.getByRole('button', { name: 'Batal' }).click())
    expect(await screen.findByText('Halaman KM')).toBeTruthy()
    expect(screen.getByText('Halaman KM')).toBe(pageBefore)
    expect(pageBefore.closest('[inert]')).toBeNull()
    expect(screen.queryByText('Ganti Produk')).toBeNull()
    expect(stored()?.code).toBe('KM')
  })

  it('memilih produk lain dari layar ganti memperbarui halaman dan pilihan', async () => {
    renderShell('/')
    await screen.findByText('Pilih Produk Dulu')
    await chooseProduct('KM')
    expect(await screen.findByText('Halaman KM')).toBeTruthy()

    act(() => screen.getByRole('button', { name: /Ganti produk/ }).click())
    expect(await screen.findByText('Ganti Produk')).toBeTruthy()
    await chooseProduct('SO')

    expect(await screen.findByText('Halaman SO')).toBeTruthy()
    expect(stored()?.code).toBe('SO')
  })
})
