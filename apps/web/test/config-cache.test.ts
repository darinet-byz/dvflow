// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A100: daftar konfigurasi dan opsi produk dibaca berkali-kali oleh filter,
 * picker, dan halaman. Cache singkat harus mencegah query berulang, tetap
 * memberi data baru setelah Konfigurasi diubah, dan kedaluwarsa sesuai TTL.
 */

const mocks = vi.hoisted(() => ({
  supabaseSelect: vi.fn(),
  supabaseRpc: vi.fn(),
}))

vi.mock('../src/lib/supabase-rest', () => mocks)

const { CONFIG_CACHE_TTL_MS, fetchConfigLists, fetchProductOptions, invalidateConfigCaches } =
  await import('../src/lib/queries')

beforeEach(() => {
  mocks.supabaseSelect.mockReset()
  mocks.supabaseSelect.mockResolvedValue([])
  mocks.supabaseRpc.mockReset()
  invalidateConfigCaches()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cache konfigurasi (A100)', () => {
  it('fetchConfigLists membaca 5 tabel sekali lalu memakai cache', async () => {
    await fetchConfigLists()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(5)

    await fetchConfigLists()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(5)

    invalidateConfigCaches()
    await fetchConfigLists()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(10)
  })

  it('fetchProductOptions memakai cache yang sama-sama dibersihkan', async () => {
    await fetchProductOptions()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(1)

    await fetchProductOptions()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(1)

    invalidateConfigCaches()
    await fetchProductOptions()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(2)
  })

  it('menghormati TTL 5 menit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    await fetchConfigLists()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(5)

    vi.setSystemTime(new Date(Date.now() + CONFIG_CACHE_TTL_MS - 1))
    await fetchConfigLists()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(5)

    vi.setSystemTime(new Date(Date.now() + 1))
    await fetchConfigLists()
    expect(mocks.supabaseSelect).toHaveBeenCalledTimes(10)
  })
})
