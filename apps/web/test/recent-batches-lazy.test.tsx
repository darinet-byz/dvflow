// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A101: saran batch tidak boleh dimuat sebelum field batch benar-benar dibuka. */

const mocks = vi.hoisted(() => ({ supabaseRpc: vi.fn() }))
vi.mock('../src/lib/supabase-rest', () => ({ supabaseRpc: mocks.supabaseRpc, supabaseSelect: vi.fn() }))

const { useRecentBatches } = await import('../src/lib/recent-batches')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useRecentBatches: lazy (A101)', () => {
  it('tidak memanggil RPC saat disabled, lalu memanggil setelah diaktifkan', async () => {
    mocks.supabaseRpc.mockResolvedValue({ batches: [] })
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRecentBatches('KM', '', enabled),
      { initialProps: { enabled: false } },
    )

    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(mocks.supabaseRpc).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() =>
      expect(mocks.supabaseRpc).toHaveBeenCalledWith(
        'recent_batches',
        expect.objectContaining({ p_product_code: 'KM', p_limit: 3 }),
        expect.anything(),
      ),
    )
  })
})
