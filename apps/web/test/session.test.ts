import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sesi di sisi klien (01 §2, 04 §7, CLAUDE.md §8).
 *
 * Yang dibuktikan berkas ini:
 *   * access token hidup HANYA di memori — penyimpanan browser tidak pernah
 *     disentuh, jadi XSS tidak dapat memanen sesi 7 hari;
 *   * saat access token kedaluwarsa, satu refresh membuat pengguna tidak perlu
 *     login ulang selama refresh session-nya masih hidup;
 *   * bila refresh gagal, sesi lokal benar-benar dibersihkan.
 */

vi.mock('../src/lib/env', () => ({
  readPublicEnv: () => ({
    supabaseUrl: 'https://project.supabase.co',
    supabasePublishableKey: 'publishable-key',
    apiBaseUrl: '',
  }),
}))

const { ApiError } = await import('../src/lib/api')
const { bootstrapSession, getAccessToken, getSessionSnapshot, login, logout, authorizedRequest, resetSessionForTests } =
  await import('../src/lib/session')

const PROFILE = {
  user_id: 'user-1',
  username: 'admin1',
  display_name: 'Admin Satu',
  role: 'admin' as const,
  avatar_emoji: null,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sessionEnvelope(token: string): Response {
  return jsonResponse(200, { ok: true, data: { profile: PROFILE, access_token: token, expires_in: 1800 } })
}

function failureResponse(code: string, status: number): Response {
  return jsonResponse(status, { ok: false, error: { code, message: 'gagal' } })
}

const storageSpies: Array<{ name: string; spy: ReturnType<typeof vi.fn> }> = []

beforeEach(() => {
  resetSessionForTests()

  // Penyimpanan browser dipasang sebagai spy yang akan MELEDAK bila disentuh.
  storageSpies.length = 0
  for (const name of ['localStorage', 'sessionStorage']) {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error(`${name} tidak boleh dibaca`)
      }),
      setItem: vi.fn(() => {
        throw new Error(`${name} tidak boleh ditulis`)
      }),
      removeItem: vi.fn(() => {
        throw new Error(`${name} tidak boleh diubah`)
      }),
      clear: vi.fn(() => {
        throw new Error(`${name} tidak boleh dibersihkan`)
      }),
    }
    vi.stubGlobal(name, storage)
    for (const spy of Object.values(storage)) storageSpies.push({ name, spy })
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function expectStorageUntouched(): void {
  for (const { name, spy } of storageSpies) {
    expect(spy, `${name} tidak boleh dipakai untuk menyimpan sesi`).not.toHaveBeenCalled()
  }
}

describe('login & penyimpanan token', () => {
  it('A01: login menyimpan access token di memori saja', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sessionEnvelope('token-dari-server')))

    await login('admin1', 'rahasia123')

    expect(getSessionSnapshot().status).toBe('authenticated')
    expect(getSessionSnapshot().profile?.username).toBe('admin1')
    expect(getAccessToken()).toBe('token-dari-server')

    // Inti aturan CLAUDE.md §8: tidak ada penyimpanan browser yang disentuh.
    expectStorageUntouched()
  })

  it('cookie refresh dikirim dengan kredensial same-origin', async () => {
    const fetchMock = vi.fn(async () => sessionEnvelope('t'))
    vi.stubGlobal('fetch', fetchMock)

    await login('admin1', 'rahasia123')

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(firstCall[1].credentials).toBe('same-origin')
    expect(firstCall[1].method).toBe('POST')
  })

  it('A02: kredensial salah -> ApiError, sesi tetap anonim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failureResponse('INVALID_CREDENTIALS', 401)))

    await expect(login('admin1', 'salah')).rejects.toBeInstanceOf(ApiError)
    expect(getSessionSnapshot().status).toBe('unknown')
    expect(getAccessToken()).toBeNull()
  })
})

describe('bootstrap saat aplikasi dimuat', () => {
  it('A07: refresh berhasil -> sesi terpulihkan tanpa login ulang', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sessionEnvelope('token-hasil-refresh')))

    await bootstrapSession()

    expect(getSessionSnapshot().status).toBe('authenticated')
    expect(getAccessToken()).toBe('token-hasil-refresh')
    expectStorageUntouched()
  })

  it('A06: sesi dicabut -> anonim, bukan galat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failureResponse('SESSION_INVALID', 401)))

    await bootstrapSession()

    expect(getSessionSnapshot().status).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
  })

  it('A04: user nonaktif -> anonim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failureResponse('USER_DISABLED', 401)))

    await bootstrapSession()

    expect(getSessionSnapshot().status).toBe('anonymous')
  })

  it('gangguan jaringan tidak dipalsukan menjadi "belum login"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )

    await bootstrapSession()

    // Status tetap tidak pasti supaya halaman dapat menampilkan galat yang jujur.
    expect(getSessionSnapshot().status).toBe('unknown')
  })
})

describe('authorizedRequest', () => {
  it('access token kedaluwarsa -> satu refresh lalu ulang sekali', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = []
    let protectedAttempts = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        calls.push({ url, authorization: headers.get('authorization') })

        if (url.endsWith('/api/auth/login')) return sessionEnvelope('token-awal')
        if (url.endsWith('/api/auth/refresh')) return sessionEnvelope('token-baru')
        if (url.endsWith('/api/profile')) {
          protectedAttempts += 1
          if (protectedAttempts === 1) return failureResponse('SESSION_INVALID', 401)
          return jsonResponse(200, { ok: true, data: { profile: PROFILE } })
        }
        throw new Error(`url tidak dikenal: ${url}`)
      }),
    )

    await login('admin1', 'rahasia123')
    const result = await authorizedRequest<{ profile: typeof PROFILE }>('/api/profile')

    expect(result.profile.username).toBe('admin1')
    expect(protectedAttempts).toBe(2)
    // Percobaan kedua memakai token hasil refresh, bukan token lama.
    expect(calls.at(-1)?.authorization).toBe('Bearer token-baru')
    expectStorageUntouched()
  })

  it('refresh gagal -> sesi dibersihkan dan pengguna diminta login ulang', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/api/auth/login')) return sessionEnvelope('token-awal')
        if (url.endsWith('/api/auth/refresh')) return failureResponse('SESSION_INVALID', 401)
        return failureResponse('SESSION_INVALID', 401)
      }),
    )

    await login('admin1', 'rahasia123')
    await expect(authorizedRequest('/api/profile')).rejects.toMatchObject({ code: 'SESSION_INVALID' })

    expect(getSessionSnapshot().status).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
  })

  it('tanpa token sama sekali -> langsung menolak tanpa memanggil jaringan', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(authorizedRequest('/api/profile')).rejects.toMatchObject({ code: 'SESSION_INVALID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('logout', () => {
  it('A05: sesi lokal dibersihkan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sessionEnvelope('token-awal')))
    await login('admin1', 'rahasia123')

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true, data: {} })))
    await logout()

    expect(getSessionSnapshot().status).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
    expectStorageUntouched()
  })

  it('A05: jaringan gagal tetap membuat klien logout (endpoint idempoten)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sessionEnvelope('token-awal')))
    await login('admin1', 'rahasia123')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )
    await expect(logout()).resolves.toBeUndefined()

    expect(getSessionSnapshot().status).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
  })
})
