/**
 * Izin & kegagalan kamera di browser (PRD §95–§98, H06).
 *
 * Aplikasi ini berjalan di BROWSER, bukan aplikasi terpasang, jadi kamera hanya
 * bisa dipakai kalau tiga syarat browser terpenuhi — dan ketiganya gagal dengan
 * cara yang berbeda:
 *
 *   1. **Konteks aman.** `navigator.mediaDevices` tidak ada sama sekali di
 *      `http://` (kecuali localhost). Ini penyebab paling sering "kamera tidak
 *      muncul" saat aplikasi diakses lewat IP atau domain tanpa HTTPS.
 *   2. **Izin pengguna.** Browser menampilkan dialog izin; kalau pernah ditolak,
 *      dialog TIDAK muncul lagi dan `getUserMedia` gagal seketika. Karena itu
 *      "coba lagi" tidak menolong — operator harus membuka setelan situs.
 *   3. **Perangkat & gesture.** iOS Safari mensyaratkan kamera diminta dari
 *      aksi pengguna (tombol), dan kamera bisa sedang dipakai aplikasi lain.
 *
 * Semua pemetaan ini murni dan diuji; tanpa itu, kegagalan kamera di lapangan
 * hanya tampak sebagai "tidak jalan" dan panitia tidak punya langkah berikutnya.
 */

export type CameraFailureKind =
  | 'insecure-context'
  | 'unsupported'
  | 'denied'
  | 'no-camera'
  | 'busy'
  | 'unknown'

export type CameraFailure = {
  kind: CameraFailureKind
  title: string
  message: string
  /** Langkah konkret yang bisa dilakukan operator. */
  steps: string[]
  /** Apakah menekan tombol lagi punya kemungkinan berhasil. */
  canRetry: boolean
}

export type CameraPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

/** Apakah browser ini punya API kamera sama sekali. */
export function isCameraApiAvailable(): boolean {
  if (typeof navigator === 'undefined') return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/**
 * Apakah halaman berjalan di konteks aman.
 *
 * Dipisah dari `isCameraApiAvailable` supaya pesannya dapat dibedakan: "buka
 * lewat https" sangat berbeda dari "browser ini tidak mendukung".
 */
export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false
  // `isSecureContext` tidak ada di browser sangat tua; localhost tetap dianggap aman.
  if (typeof window.isSecureContext === 'boolean') return window.isSecureContext
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

/**
 * Status izin yang sudah tercatat browser, bila dapat dibaca.
 *
 * `navigator.permissions` tidak ada di Safari, jadi hasilnya sering 'unknown' —
 * dan itu diperlakukan sama seperti 'prompt' (coba minta izin). Fungsinya hanya
 * satu: menghindari meminta izin yang sudah PASTI ditolak, karena permintaan itu
 * gagal tanpa dialog dan operator tidak tahu kenapa.
 */
export async function queryCameraPermission(): Promise<CameraPermissionState> {
  if (typeof navigator === 'undefined' || navigator.permissions?.query === undefined) return 'unknown'

  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') return status.state
    return 'unknown'
  } catch {
    // Nama permission 'camera' tidak dikenal di sebagian browser.
    return 'unknown'
  }
}

/**
 * Terjemahkan kegagalan `getUserMedia` menjadi jenis yang dapat ditindaklanjuti.
 *
 * Nama error mengikuti spesifikasi MediaDevices; yang tidak dikenal jatuh ke
 * 'unknown' dengan tombol coba lagi, bukan pesan yang mengarang penyebab.
 */
export function classifyCameraError(error: unknown): CameraFailureKind {
  const name = error instanceof Error ? error.name : ''

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'no-camera'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy'
    default:
      return 'unknown'
  }
}

const HELP_STEPS: Record<CameraFailureKind, string[]> = {
  'insecure-context': [
    'Buka aplikasi lewat alamat https:// (bukan http:// atau alamat IP).',
    'Kamera hanya tersedia di koneksi aman — ini aturan browser, bukan pengaturan aplikasi.',
  ],
  unsupported: [
    'Browser ini tidak menyediakan akses kamera.',
    'Pakai Chrome, Edge, Firefox, atau Safari versi terbaru.',
  ],
  denied: [
    'Ketuk ikon gembok / setelan situs di address bar, lalu izinkan Kamera.',
    'Android (Chrome): ⋮ → Setelan → Setelan situs → Kamera → izinkan untuk situs ini.',
    'iPhone (Safari): ikon "aA" → Setelan Situs Web → Kamera → Izinkan. Bila masih ditolak, buka Setelan → Safari → Kamera.',
    'Setelah diizinkan, muat ulang halaman ini lalu tekan Nyalakan kamera lagi.',
  ],
  'no-camera': [
    'Perangkat ini tidak memiliki kamera, atau kameranya tidak dapat dipakai.',
    'Gunakan Manual Search di bawah halaman ini untuk mencari peserta.',
  ],
  busy: [
    'Kamera sedang dipakai aplikasi lain — tutup aplikasi kamera/video call itu.',
    'Tutup tab lain yang juga memakai kamera, lalu tekan Nyalakan kamera lagi.',
  ],
  unknown: [
    'Coba tekan Nyalakan kamera sekali lagi.',
    'Bila tetap gagal, gunakan Manual Search di bawah halaman ini.',
  ],
}

export function describeCameraFailure(kind: CameraFailureKind): CameraFailure {
  const base = { kind, steps: HELP_STEPS[kind] }

  switch (kind) {
    case 'insecure-context':
      return {
        ...base,
        title: 'Kamera butuh koneksi aman',
        message: 'Halaman ini tidak diakses lewat HTTPS, sehingga browser menyembunyikan kamera.',
        canRetry: false,
      }
    case 'unsupported':
      return {
        ...base,
        title: 'Kamera tidak didukung',
        message: 'Browser ini tidak dapat membuka kamera.',
        canRetry: false,
      }
    case 'denied':
      return {
        ...base,
        title: 'Izin kamera ditolak',
        message:
          'Browser memblokir akses kamera untuk situs ini. Menekan tombol lagi tidak akan memunculkan dialog izin — izinnya harus diubah di setelan browser.',
        canRetry: true,
      }
    case 'no-camera':
      return {
        ...base,
        title: 'Kamera tidak tersedia',
        message: 'Tidak ada kamera yang bisa dipakai di perangkat ini.',
        canRetry: true,
      }
    case 'busy':
      return {
        ...base,
        title: 'Kamera sedang dipakai',
        message: 'Kamera gagal dibuka karena sedang digunakan proses lain.',
        canRetry: true,
      }
    default:
      return {
        ...base,
        title: 'Kamera gagal dibuka',
        message: 'Kamera tidak dapat dimulai saat ini.',
        canRetry: true,
      }
  }
}

/** Kegagalan yang ditentukan sebelum mencoba: konteks tidak aman / API tidak ada. */
export function describeEnvironmentFailure(): CameraFailure | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null
  if (!isCameraApiAvailable()) {
    return describeCameraFailure(isSecureContext() ? 'unsupported' : 'insecure-context')
  }
  return null
}
