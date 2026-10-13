import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyCameraError,
  describeCameraFailure,
  describeEnvironmentFailure,
  isCameraApiAvailable,
  isSecureContext,
  queryCameraPermission,
} from '../src/pages/scanner/camera-permission'

/**
 * Izin kamera di browser (PRD §95–§98, H06).
 *
 * Ini bagian yang paling sering gagal di lapangan, dan penyebabnya berbeda-beda:
 * halaman diakses lewat http, izin pernah ditolak, kamera dipakai aplikasi lain,
 * atau perangkatnya memang tidak punya kamera. Semuanya harus menghasilkan
 * LANGKAH yang berbeda — "gagal" generik membuat panitia tidak punya jalan keluar.
 */

const originalNavigator = globalThis.navigator
const originalWindow = globalThis.window

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true })
})

function domException(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

describe('klasifikasi kegagalan getUserMedia', () => {
  it('izin ditolak dikenali dari beberapa nama yang dipakai browser', () => {
    for (const name of ['NotAllowedError', 'PermissionDeniedError', 'SecurityError']) {
      expect(classifyCameraError(domException(name))).toBe('denied')
    }
  })

  it('tidak ada kamera / batasan tidak terpenuhi', () => {
    for (const name of ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']) {
      expect(classifyCameraError(domException(name))).toBe('no-camera')
    }
  })

  it('kamera sedang dipakai proses lain', () => {
    for (const name of ['NotReadableError', 'TrackStartError', 'AbortError']) {
      expect(classifyCameraError(domException(name))).toBe('busy')
    }
  })

  it('error tak dikenal tidak dikarang sebabnya', () => {
    expect(classifyCameraError(new Error('apa saja'))).toBe('unknown')
    expect(classifyCameraError(undefined)).toBe('unknown')
  })
})

describe('langkah yang ditampilkan ke operator', () => {
  it('setiap jenis memberi minimal dua langkah konkret', () => {
    const kinds = ['insecure-context', 'unsupported', 'denied', 'no-camera', 'busy', 'unknown'] as const

    for (const kind of kinds) {
      const failure = describeCameraFailure(kind)
      expect(failure.steps.length, kind).toBeGreaterThanOrEqual(2)
      expect(failure.message.length, kind).toBeGreaterThan(0)
    }
  })

  it('izin ditolak menjelaskan bahwa mengulang tidak memunculkan dialog izin', () => {
    const failure = describeCameraFailure('denied')

    expect(failure.title).toBe('Izin kamera ditolak')
    expect(failure.message).toContain('tidak akan memunculkan dialog izin')
    // Langkahnya menyebut setelan situs, karena di situlah izinnya diubah.
    expect(failure.steps.join(' ')).toContain('Kamera')
  })

  it('konteks tidak aman mengarahkan ke https dan TIDAK menawarkan coba lagi', () => {
    const failure = describeCameraFailure('insecure-context')

    expect(failure.canRetry).toBe(false)
    expect(failure.steps.join(' ')).toContain('https://')
  })

  it('izin ditolak masih menawarkan coba lagi (setelah operator mengubah setelan)', () => {
    expect(describeCameraFailure('denied').canRetry).toBe(true)
  })
})

describe('pemeriksaan lingkungan', () => {
  it('konteks aman dikenali dari window.isSecureContext', () => {
    vi.stubGlobal('window', { isSecureContext: true, location: { hostname: 'app.example.com' } })
    expect(isSecureContext()).toBe(true)

    vi.stubGlobal('window', { isSecureContext: false, location: { hostname: 'app.example.com' } })
    expect(isSecureContext()).toBe(false)
  })

  it('localhost tetap dianggap aman pada browser tanpa isSecureContext', () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    expect(isSecureContext()).toBe(true)

    vi.stubGlobal('window', { location: { hostname: '192.168.1.10' } })
    expect(isSecureContext()).toBe(false)
  })

  it('API kamera tidak ada -> kegagalan dijelaskan sebelum mencoba', () => {
    vi.stubGlobal('window', { isSecureContext: false, location: { hostname: 'app.example.com' } })
    vi.stubGlobal('navigator', {})

    expect(isCameraApiAvailable()).toBe(false)
    expect(describeEnvironmentFailure()?.kind).toBe('insecure-context')
  })

  it('API ada dan konteks aman -> tidak ada kegagalan lingkungan', () => {
    vi.stubGlobal('window', { isSecureContext: true, location: { hostname: 'app.example.com' } })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({}) } })

    expect(describeEnvironmentFailure()).toBeNull()
  })
})

describe('permintaan status izin', () => {
  it('membaca status dari Permissions API', async () => {
    vi.stubGlobal('navigator', { permissions: { query: async () => ({ state: 'denied' }) } })
    expect(await queryCameraPermission()).toBe('denied')

    vi.stubGlobal('navigator', { permissions: { query: async () => ({ state: 'granted' }) } })
    expect(await queryCameraPermission()).toBe('granted')
  })

  it('browser tanpa Permissions API -> unknown, bukan gagal', async () => {
    vi.stubGlobal('navigator', {})
    expect(await queryCameraPermission()).toBe('unknown')
  })

  it('nama permission yang tidak dikenal tidak melempar error', async () => {
    vi.stubGlobal('navigator', {
      permissions: {
        query: async () => {
          throw new TypeError('camera bukan nama permission yang dikenal')
        },
      },
    })
    expect(await queryCameraPermission()).toBe('unknown')
  })
})
