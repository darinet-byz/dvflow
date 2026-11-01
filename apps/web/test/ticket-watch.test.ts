import { describe, expect, it, vi } from 'vitest'
import { CHECKIN_POLL_MS, watchCheckin } from '../src/ticket/watch'

/** A19: tiket memeriksa ulang halamannya sendiri dan memuat ulang sesudah check-in. */
function harness(pages: Array<string | Error>, initialCount?: string | null) {
  const queue: Array<{ run: () => void; ms: number }> = []
  const onCheckedIn = vi.fn()
  const onChanged = vi.fn()
  const fetchPage = vi.fn(async () => {
    const next = pages.shift() ?? ''
    if (next instanceof Error) throw next
    return next
  })
  watchCheckin({
    url: '/access/1',
    fetchPage,
    onCheckedIn,
    ...(initialCount === undefined ? {} : { initialCount, onChanged }),
    schedule: (run, ms) => queue.push({ run, ms }),
  })
  const step = async () => { queue.shift()?.run(); await new Promise((r) => setTimeout(r, 0)) }
  return { queue, onCheckedIn, onChanged, fetchPage, step }
}

describe('watchCheckin', () => {
  it('memuat ulang begitu halaman bertanda data-checked-in="true"', async () => {
    const h = harness(['<section data-checked-in="false">', '<section data-checked-in="true">'])
    expect(h.queue[0]?.ms).toBe(CHECKIN_POLL_MS)
    await h.step()
    expect(h.onCheckedIn).not.toHaveBeenCalled()
    await h.step()
    expect(h.onCheckedIn).toHaveBeenCalledTimes(1)
    expect(h.queue).toHaveLength(0)
    expect(h.fetchPage).toHaveBeenCalledWith('/access/1')
  })

  it('jaringan gagal -> tetap mencoba lagi', async () => {
    const h = harness([new Error('offline'), '<section data-checked-in="true">'])
    await h.step()
    expect(h.queue).toHaveLength(1)
    await h.step()
    expect(h.onCheckedIn).toHaveBeenCalledTimes(1)
  })

  it('A62: jumlah tiket hadir berubah -> halaman dimuat ulang', async () => {
    const h = harness(
      [
        '<section data-checked-in="false" data-checkin-count="1/2">',
        '<section data-checked-in="false" data-checkin-count="1/2">',
        '<section data-checked-in="false" data-checkin-count="2/2">',
      ],
      '1/2',
    )
    await h.step()
    expect(h.onChanged).not.toHaveBeenCalled()
    await h.step()
    expect(h.onChanged).not.toHaveBeenCalled()
    await h.step()
    expect(h.onChanged).toHaveBeenCalledTimes(1)
    expect(h.onCheckedIn).not.toHaveBeenCalled()
    expect(h.queue).toHaveLength(0)
  })
})
