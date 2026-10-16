import { describe, expect, it, vi } from 'vitest'
import { CHECKIN_POLL_MS, watchCheckin } from '../src/ticket/watch'

/** A19: tiket memeriksa ulang halamannya sendiri dan memuat ulang sesudah check-in. */
function harness(pages: Array<string | Error>) {
  const queue: Array<{ run: () => void; ms: number }> = []
  const onCheckedIn = vi.fn()
  const fetchPage = vi.fn(async () => {
    const next = pages.shift() ?? ''
    if (next instanceof Error) throw next
    return next
  })
  watchCheckin({ url: '/access/1', fetchPage, onCheckedIn, schedule: (run, ms) => queue.push({ run, ms }) })
  const step = async () => { queue.shift()?.run(); await new Promise((r) => setTimeout(r, 0)) }
  return { queue, onCheckedIn, fetchPage, step }
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
})
