// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import {
  ALL_PRODUCTS,
  PRODUCT_SCOPE_TTL_MS,
  clearStoredProductScope,
  expireAllStoredProductScopes,
  isProductScopedPath,
  persistProductScope,
  productScopeStorageKey,
  readStoredProductScope,
  readStoredProductScopeState,
} from '../src/lib/product-scope'
import { ProductScopeBar, ProductScopeOutlet, ProductScopeProvider, useProductScope } from '../src/layout/ProductScope'

/** A97: produk dipilih sekali, dipakai semua halaman data, kedaluwarsa 24 jam. */

vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/queries')>()),
  fetchProductOptions: vi.fn(),
}))

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: 'u1',
      username: 'u1',
      display_name: 'Uji',
      role: 'developer',
      avatar_emoji: null,
      permissions: [],
    },
  }),
}))

// AppShell membawa sidebar, pencarian global, dan chat; fokus tes ini adalah scope produk.
vi.mock('../src/layout/Sidebar', () => ({ Sidebar: () => <nav>Menu</nav> }))
vi.mock('../src/layout/GlobalSearch', () => ({ GlobalSearchButton: () => null, GlobalSearchDialog: () => null }))
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

function Shell() {
  const location = useLocation()
  return (
    <ProductScopeProvider>
      <ProductScopeBar />
      <ProductScopeOutlet scoped={isProductScopedPath(location.pathname)} />
    </ProductScopeProvider>
  )
}

function ScopeProbe() {
  const scope = useProductScope()
  return <p>{scope?.chosen ? `Halaman ${scope.code || 'semua'}` : 'Halaman tanpa scope'}</p>
}

function renderScope(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="*" element={<ScopeProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function stored(userId = USER_ID) {
  const raw = window.localStorage.getItem(productScopeStorageKey(userId))
  return raw === null ? null : JSON.parse(raw) as { code?: string; chosenAt?: number; expired?: boolean }
}

beforeEach(() => {
  window.localStorage.clear()
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
    expect(readStoredProductScopeState(USER_ID).status).toBe('valid')

    vi.setSystemTime(base + PRODUCT_SCOPE_TTL_MS)
    expect(readStoredProductScopeState(USER_ID).status).toBe('expired')
    expect(readStoredProductScope(USER_ID)).toBeNull()
    expect(stored()?.expired).toBe(true)
    expect(stored()?.code).toBeUndefined()
  })

  it('timestamp rusak / di masa depan dianggap kedaluwarsa', () => {
    const key = productScopeStorageKey(USER_ID)
    window.localStorage.setItem(key, '{bukan json')
    expect(readStoredProductScope(USER_ID)).toBeNull()

    window.localStorage.setItem(key, JSON.stringify({ code: 'KM', chosenAt: Date.now() + 60 * 60 * 1000 }))
    expect(readStoredProductScope(USER_ID)).toBeNull()
  })

  it('logout menandai semua pilihan kedaluwarsa tanpa menyimpan kode produk', () => {
    persistProductScope('u1', 'KM')
    persistProductScope('u2', 'SO')
    window.localStorage.setItem('dvflow.filters.order', 'tetap')

    expireAllStoredProductScopes()

    expect(stored('u1')?.expired).toBe(true)
    expect(stored('u1')?.code).toBeUndefined()
    expect(stored('u2')?.expired).toBe(true)
    expect(stored('u2')?.code).toBeUndefined()
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

describe('product scope: gate & pilihan', () => {
  it('gate muncul di halaman data saat belum memilih', async () => {
    renderScope('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(screen.queryByText('Halaman tanpa scope')).toBeNull()
  })

  it('halaman konfigurasi tidak digate', async () => {
    renderScope('/konfigurasi-produk')
    expect(await screen.findByText('Halaman tanpa scope')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
  })

  it('memilih produk membuka halaman, menyimpan pilihan, dan dipakai lagi saat remount', async () => {
    const first = renderScope('/')
    await screen.findByText('Pilih Produk Dulu')
    act(() => screen.getByRole('button', { name: /KM/ }).click())

    expect(await screen.findByText('Halaman KM')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
    expect(stored()?.code).toBe('KM')

    first.unmount()
    renderScope('/')
    expect(await screen.findByText('Halaman KM')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
  })

  it('"Semua Produk" adalah pilihan yang sah', async () => {
    renderScope('/')
    await screen.findByText('Pilih Produk Dulu')
    act(() => screen.getByRole('button', { name: /Semua Produk/ }).click())

    expect(await screen.findByText('Halaman semua')).toBeTruthy()
    expect(stored()?.code).toBe('')
  })

  it('hanya satu produk -> auto-pilih tanpa gate', async () => {
    vi.mocked(fetchProductOptions).mockResolvedValue([PRODUCTS[0]!])
    renderScope('/')
    expect(await screen.findByText('Halaman KM')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
    expect(stored()?.code).toBe('KM')
  })

  it('deep link productCode langsung memilih produk', async () => {
    renderScope('/order?productCode=SO')
    expect(await screen.findByText('Halaman SO')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
    expect(stored()?.code).toBe('SO')
  })

  it('produk tersimpan yang tidak ada di opsi dibuang dan gate muncul', async () => {
    window.localStorage.setItem(productScopeStorageKey(USER_ID), JSON.stringify({ code: 'ZZ', chosenAt: Date.now() }))
    renderScope('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    await waitFor(() => expect(stored()?.expired).toBe(true))
    expect(readStoredProductScope(USER_ID)).toBeNull()
  })

  it('pilihan tersimpan yang sudah lewat 24 jam dibuang saat mount', async () => {
    window.localStorage.setItem(
      productScopeStorageKey(USER_ID),
      JSON.stringify({ code: 'KM', chosenAt: Date.now() - PRODUCT_SCOPE_TTL_MS }),
    )
    renderScope('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
  })

  it('pilihan lama kedaluwarsa + satu produk: gate muncul, bukan auto-select', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const base = new Date('2026-11-26T08:00:00.000Z').getTime()
    vi.setSystemTime(base)
    persistProductScope(USER_ID, 'KM', base)
    vi.mocked(fetchProductOptions).mockResolvedValue([PRODUCTS[0]!])
    vi.setSystemTime(base + PRODUCT_SCOPE_TTL_MS)

    renderScope('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
  })

  it('tidak ada produk aktif -> arahan, tanpa opsi Semua Produk', async () => {
    vi.mocked(fetchProductOptions).mockResolvedValue([])
    renderScope('/')
    expect(await screen.findByText('Belum ada produk aktif.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Semua Produk/ })).toBeNull()
  })

  it('kedaluwarsa saat tab terbuka: focus memunculkan gate lagi', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const base = new Date('2026-11-26T08:00:00.000Z').getTime()
    vi.setSystemTime(base)

    renderScope('/')
    await screen.findByText('Pilih Produk Dulu')
    act(() => screen.getByRole('button', { name: /KM/ }).click())
    expect(await screen.findByText('Halaman KM')).toBeTruthy()

    act(() => {
      vi.setSystemTime(base + PRODUCT_SCOPE_TTL_MS)
      window.dispatchEvent(new Event('focus'))
    })

    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(stored()?.expired).toBe(true)
    expect(stored()?.code).toBeUndefined()
  })

  it('setelah expiry, user satu produk tidak auto-select ulang', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const base = new Date('2026-11-26T08:00:00.000Z').getTime()
    vi.setSystemTime(base)
    vi.mocked(fetchProductOptions).mockResolvedValue([PRODUCTS[0]!])

    persistProductScope(USER_ID, 'KM', base)
    const view = renderScope('/')
    expect(await screen.findByText('Halaman KM')).toBeTruthy()

    act(() => {
      vi.setSystemTime(base + PRODUCT_SCOPE_TTL_MS)
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()

    // Reload setelah expiry: marker tetap memaksa gate, bukan auto-select.
    view.unmount()
    renderScope('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
  })

  it('logout + satu produk: gate muncul, bukan auto-select', async () => {
    persistProductScope(USER_ID, 'KM')
    expireAllStoredProductScopes()
    vi.mocked(fetchProductOptions).mockResolvedValue([PRODUCTS[0]!])

    renderScope('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
  })

  it('bar memakai sentinel "Semua Produk"', async () => {
    renderScope('/konfigurasi-produk')
    await screen.findByText('Halaman tanpa scope')
    const select = screen.getByLabelText('Pilih produk aktif') as HTMLSelectElement
    expect(Array.from(select.options).some((option) => option.value === ALL_PRODUCTS)).toBe(true)
  })
})

describe('product scope: integrasi AppShell', () => {
  function renderShell(initialEntry: string) {
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

  it('bar produk tampil dan gate muncul di halaman data', async () => {
    renderShell('/')
    expect(await screen.findByText('Pilih Produk Dulu')).toBeTruthy()
    expect(screen.getByLabelText('Pilih produk aktif')).toBeTruthy()
  })

  it('halaman konfigurasi bisa dibuka tanpa memilih produk', async () => {
    renderShell('/konfigurasi-produk')
    expect(await screen.findByText('Halaman tanpa scope')).toBeTruthy()
    expect(screen.queryByText('Pilih Produk Dulu')).toBeNull()
    expect(screen.getByLabelText('Pilih produk aktif')).toBeTruthy()
  })
})
