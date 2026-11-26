// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAsyncData } from '../src/lib/useAsyncData'

/** A101: permintaan lama harus dibatalkan saat deps berubah atau komponen dilepas. */

afterEach(cleanup)

describe('useAsyncData: pembatalan permintaan', () => {
  it('mengirim AbortSignal dan membatalkan request lama saat deps berubah / unmount', async () => {
    const signals: AbortSignal[] = []
    const load = vi.fn((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signals.push(signal)
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))

    const { rerender, unmount } = renderHook(
      ({ key }: { key: number }) => useAsyncData((signal) => load(signal), [key]),
      { initialProps: { key: 1 } },
    )

    await waitFor(() => expect(signals).toHaveLength(1))
    expect(signals[0]?.aborted).toBe(false)

    rerender({ key: 2 })
    await waitFor(() => expect(signals[0]?.aborted).toBe(true))
    await waitFor(() => expect(signals).toHaveLength(2))
    expect(signals[1]?.aborted).toBe(false)

    unmount()
    expect(signals[1]?.aborted).toBe(true)
  })

  it('tidak menampilkan error ketika request dibatalkan', async () => {
    const load = vi.fn((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const { result, unmount } = renderHook(() => useAsyncData((signal) => load(signal), []))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))

    act(() => unmount())
    expect(result.current.error).toBeNull()
  })
})
