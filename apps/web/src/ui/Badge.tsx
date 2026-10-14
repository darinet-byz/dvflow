import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Badge status (guideline §17–§18, CLAUDE.md §13, 05 §K12).
 *
 * Warna status TIDAK dipilih per halaman: pemetaannya ada di satu tempat di
 * bawah, sehingga "Paid" selalu hijau dan "Pending" selalu kuning di seluruh
 * aplikasi. Nilai yang tidak dikenal jatuh ke netral — bukan ke warna yang
 * kebetulan terlihat bagus.
 */
export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary' | 'webinar' | 'seminar'

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-success-soft text-[#28a95b]',
  warning: 'bg-warning-soft text-[#c78a21]',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-soft text-ink-soft',
  primary: 'bg-primary-soft text-primary',
  webinar: 'bg-webinar-soft text-webinar',
  seminar: 'bg-seminar-soft text-seminar',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-[7px] py-[4px] text-[10px] font-semibold',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export type AppStatus = 'Pending' | 'Paid' | 'Cancelled'
export type AttendanceStatusLabel = 'Hadir' | 'Belum Hadir' | 'Pending' | 'Cancelled'
export type EventTypeName = 'Seminar Offline' | 'Webinar Online' | 'Hybrid'

/** Status order (PRD §52, guideline §18). */
export function appStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'Paid':
      return 'success'
    case 'Pending':
      return 'warning'
    case 'Cancelled':
      return 'danger'
    default:
      return 'neutral'
  }
}

/**
 * Status presensi (PRD §107).
 *
 * "Belum Hadir" memakai netral, bukan kuning: kuning sudah dipakai Pending, dan
 * PRD §107 menegaskan ketiganya kondisi yang berbeda. Guideline §18 memang
 * membolehkan "gray atau orange soft".
 */
export function attendanceTone(status: string): BadgeTone {
  switch (status) {
    case 'Hadir':
      return 'success'
    case 'Pending':
      return 'warning'
    case 'Cancelled':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function eventTypeTone(eventType: string): BadgeTone {
  if (eventType === 'Seminar Offline') return 'seminar'
  if (eventType === 'Webinar Online') return 'webinar'
  if (eventType === 'Hybrid') return 'primary'
  return 'neutral'
}
