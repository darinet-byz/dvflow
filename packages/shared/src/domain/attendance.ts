/**
 * Aturan presensi (PRD §107, §150).
 *
 *   Paid + 0 attendance   = Belum Hadir
 *   Paid + >= 1 attendance = Hadir
 *   Pending bukan Belum Hadir
 *
 * Database tetap row-based di attendance_events; UI yang mengubahnya menjadi
 * T1..T10. Tidak ada kolom timestamp_1..timestamp_10 di database.
 */

import type { AppStatus } from '../types'
import { TIMESTAMP_DISPLAY_LIMIT } from './constants'

export type AttendanceStatusLabel =
  | 'Hadir'
  | 'Hadir Sebagian'
  | 'Belum Hadir'
  | 'Reschedule'
  | 'Refund'
  | 'Pending'
  | 'Cancelled'

/**
 * A58: Refund adalah status order, jadi selalu menang. `Reschedule` hanya
 * berlaku selama peserta belum punya presensi sama sekali; setelah check-in
 * di acara tujuan ia kembali menjadi `Hadir`.
 *
 * A61: presensi dihitung per tiket. Bila `quantity` diberikan dan baru sebagian
 * tiket yang hadir, statusnya `Hadir Sebagian` (bukan `Hadir`).
 */
export function attendanceStatusLabel(
  appStatus: AppStatus,
  attendanceCount: number,
  rescheduled = false,
  quantity = 1,
): AttendanceStatusLabel {
  if (appStatus === 'Refund') return 'Refund'
  if (appStatus !== 'Paid') return appStatus
  if (rescheduled && attendanceCount === 0) return 'Reschedule'
  if (attendanceCount <= 0) return 'Belum Hadir'
  return attendanceCount >= Math.max(quantity, 1) ? 'Hadir' : 'Hadir Sebagian'
}

/**
 * Ambil N timestamp terbaru untuk kolom T1..T10.
 *
 * Input dari SQL sudah berurut terbaru-dulu, tetapi fungsi ini tetap mengurutkan
 * salinan sendiri supaya hasilnya tidak bergantung pada urutan pemanggil.
 * `total_activity` dihitung dari jumlah SELURUH baris attendance, bukan dari
 * panjang daftar yang ditampilkan.
 */
export function selectLatestTimestamps(
  clickedAt: readonly string[],
  limit: number = TIMESTAMP_DISPLAY_LIMIT,
): string[] {
  const sorted = [...clickedAt].sort((a, b) => {
    const left = Date.parse(a)
    const right = Date.parse(b)
    if (Number.isNaN(left) || Number.isNaN(right)) return a < b ? 1 : a > b ? -1 : 0
    return right - left
  })
  return sorted.slice(0, limit)
}
