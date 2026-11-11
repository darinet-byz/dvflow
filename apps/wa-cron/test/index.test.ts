import { describe, expect, it, vi } from 'vitest'
import { runScheduled } from '../src'

const env = { APP_BASE_URL: 'https://dvflow.pages.dev/', WA_CRON_SECRET: 'cron-secret' }

describe('WA cron worker', () => {
  it('memanggil endpoint internal dengan metode dan secret yang benar', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const result = await runScheduled(env, fetchMock as unknown as typeof fetch)

    expect(result).toEqual({ status: 200, body: '{"ok":true}' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://dvflow.pages.dev/api/internal/wa-reminders/run')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-wa-cron-secret']).toBe('cron-secret')
  })

  it('meneruskan status gagal tanpa melempar, agar cron tetap tercatat', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":false}', { status: 404 }))
    await expect(runScheduled(env, fetchMock as unknown as typeof fetch)).resolves.toEqual({
      status: 404,
      body: '{"ok":false}',
    })
  })

  it('menolak konfigurasi yang tidak lengkap sebelum menghubungi jaringan', async () => {
    const fetchMock = vi.fn()
    await expect(runScheduled({ ...env, WA_CRON_SECRET: '' }, fetchMock as unknown as typeof fetch))
      .rejects.toThrow('WA_CRON_SECRET')
    await expect(runScheduled({ ...env, APP_BASE_URL: '' }, fetchMock as unknown as typeof fetch))
      .rejects.toThrow('APP_BASE_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
