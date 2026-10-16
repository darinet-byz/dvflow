// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScannerStick } from '../src/pages/scanner/useScannerStick'

/** Scanner Stick baru "terhubung" setelah halaman menerima tembakan scan dari alat. */
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 16, 9, 0, 0)) })
afterEach(() => { cleanup(); vi.useRealTimers() })

function type(text: string, gapMs: number) {
  for (const key of [...text, 'Enter']) {
    vi.setSystemTime(Date.now() + gapMs)
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  }
}

describe('useScannerStick', () => {
  it('awal: menunggu (tidak langsung aktif)', () => {
    const { result } = renderHook(() => useScannerStick(true, () => {}))
    expect(result.current.connected).toBe(false)
    expect(result.current.lastScanAt).toBeNull()
  })

  it('tembakan secepat alat -> terhubung + payload diproses', () => {
    const onPayload = vi.fn()
    const { result } = renderHook(() => useScannerStick(true, onPayload))
    act(() => type('/checkin/283033796', 10))
    expect(onPayload).toHaveBeenCalledWith('/checkin/283033796')
    expect(result.current.connected).toBe(true)
    expect(result.current.lastScanAt).not.toBeNull()
  })

  it('ketikan tangan tidak menandai terhubung', () => {
    const { result } = renderHook(() => useScannerStick(true, () => {}))
    act(() => type('283033796', 250))
    expect(result.current.connected).toBe(false)
  })

  it('mode kamera: tidak mendengar keyboard', () => {
    const onPayload = vi.fn()
    const { result } = renderHook(() => useScannerStick(false, onPayload))
    act(() => type('/checkin/1', 10))
    expect(onPayload).not.toHaveBeenCalled()
    expect(result.current.connected).toBe(false)
  })

  it('jendela kehilangan fokus -> ditandai tidak fokus', () => {
    const { result } = renderHook(() => useScannerStick(true, () => {}))
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(result.current.focused).toBe(false)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(result.current.focused).toBe(true)
  })
})
