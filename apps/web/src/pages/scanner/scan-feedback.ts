import { ApiError } from '../../lib/api'
import type { BadgeTone } from '../../ui/Badge'

/**
 * Terjemahan hasil check-in menjadi kartu hasil scanner (PRD §96, §98, §101).
 *
 * Dipisah dari komponen karena inilah yang menentukan apa yang dibaca panitia
 * di lapangan: "berhasil", "sudah check-in", atau "ditolak". Semuanya di sini
 * supaya tidak ada halaman kedua yang menyusun pesannya sendiri dengan kata
 * yang berbeda.
 *
 * Warna mengikuti guideline §37: berhasil = hijau soft, gagal = merah soft.
 * "Sudah check-in" memakai kuning soft karena bukan kegagalan — pesertanya
 * memang sudah tercatat, dan operator perlu tahu itu tanpa panik.
 */
export type ScanTone = Extract<BadgeTone, 'success' | 'danger' | 'warning' | 'neutral'>

export type ScanOutcome = {
  tone: ScanTone
  title: string
  detail: string
  /** Nama peserta, bila server mengirimkannya. */
  name: string | null
  orderId: string | null
  /** Waktu check-in dari server (bukan waktu perangkat). */
  clickedAt: string | null
  /** Apakah ini hasil yang perlu perhatian operator. */
  alert: boolean
}

export type CheckinResponse = {
  state: 'CHECKIN_SUCCESS' | 'ALREADY_CHECKED_IN'
  order_id: string
  name: string | null
  event_type: string | null
  session: string | null
  clicked_at: string
  attendance_id: string
  scanner: { user_id: string; display_name: string }
}

export function fromCheckinSuccess(payload: CheckinResponse): ScanOutcome {
  if (payload.state === 'ALREADY_CHECKED_IN') {
    return {
      tone: 'warning',
      title: 'Sudah check-in',
      detail: 'Peserta ini sudah tercatat hadir sebelumnya.',
      name: payload.name,
      orderId: payload.order_id,
      clickedAt: payload.clicked_at,
      alert: false,
    }
  }

  return {
    tone: 'success',
    title: 'Check-in berhasil',
    detail: 'Presensi tercatat atas nama operator ini.',
    name: payload.name,
    orderId: payload.order_id,
    clickedAt: payload.clicked_at,
    alert: false,
  }
}

/**
 * Pesan penolakan (PRD §98).
 *
 * Pesannya berasal dari backend yang sudah berbahasa Indonesia; di sini hanya
 * ditambahkan judul singkat supaya terbaca dari jauh. Tidak ada detail internal
 * yang ditambahkan.
 */
export function fromCheckinError(error: unknown): ScanOutcome {
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR'
  const message = error instanceof ApiError ? error.message : 'Check-in tidak dapat diproses.'

  const titles: Partial<Record<string, string>> = {
    ORDER_NOT_FOUND: 'Order tidak ditemukan',
    ORDER_NOT_PAID: 'Check-in ditolak',
    NOT_SEMINAR_ORDER: 'Bukan seminar',
    SESSION_INVALID: 'Sesi berakhir',
    USER_DISABLED: 'Akun nonaktif',
    FORBIDDEN: 'Tidak punya akses',
  }

  return {
    tone: 'danger',
    title: titles[code] ?? 'Gagal',
    detail: message,
    name: null,
    orderId: null,
    clickedAt: null,
    alert: true,
  }
}

/**
 * QR yang isinya bukan Order ID yang dapat dikenali.
 *
 * Terjadi ketika panitia tidak sengaja mengarahkan kamera ke QR lain (poster,
 * tiket lain, tautan umum). Ditampilkan sebagai penolakan, bukan dibiarkan
 * tanpa reaksi — operator harus tahu bahwa yang dipindai bukan tiket peserta.
 */
export function fromUnknownQr(rawPayload: string): ScanOutcome {
  return {
    tone: 'danger',
    title: 'QR tidak dikenali',
    detail: `Isi QR bukan tiket peserta: ${rawPayload.slice(0, 60)}`,
    name: null,
    orderId: null,
    clickedAt: null,
    alert: true,
  }
}

/**
 * QR yang sama tidak diproses berulang dalam rentang ini.
 *
 * Ini BUKAN aturan produk: server tetap idempoten, dan scan berulang tetap
 * diperbolehkan (peserta bisa keluar-masuk). Tujuannya murni teknis — QR yang
 * masih berada di depan kamera akan terbaca puluhan kali per detik, dan tanpa
 * jeda aplikasi mengirim puluhan permintaan yang semuanya mengembalikan
 * "sudah check-in" sehingga operator tidak sempat membaca hasilnya.
 */
export const SAME_QR_COOLDOWN_MS = 3000

export function shouldProcessQr(
  previous: { orderId: string; at: number } | null,
  orderId: string,
  now: number,
  cooldownMs: number = SAME_QR_COOLDOWN_MS,
): boolean {
  if (previous === null) return true
  if (previous.orderId !== orderId) return true
  return now - previous.at >= cooldownMs
}
