/**
 * Normalisasi status order (PRD §52, 03-API-CONTRACT §3).
 *
 *   pending    -> Pending
 *   processing -> Paid
 *   complete   -> Paid
 *   cancelled  -> Cancelled
 *
 * Status tak dikenal TIDAK boleh dipetakan diam-diam ke salah satu nilai di atas.
 * Ia melempar error dan route webhook mengembalikan 422 UNSUPPORTED_ORDER_STATUS.
 */

import type { AppStatus } from '../types'

export const RAW_STATUS_TO_APP_STATUS = {
  pending: 'Pending',
  processing: 'Paid',
  complete: 'Paid',
  cancelled: 'Cancelled',
} as const satisfies Record<string, AppStatus>

export type KnownRawStatus = keyof typeof RAW_STATUS_TO_APP_STATUS

export const UNSUPPORTED_ORDER_STATUS = 'UNSUPPORTED_ORDER_STATUS'

export class UnsupportedOrderStatusError extends Error {
  readonly code = UNSUPPORTED_ORDER_STATUS

  constructor(readonly rawStatus: string) {
    super(`Status order tidak didukung: "${rawStatus}"`)
    this.name = 'UnsupportedOrderStatusError'
  }
}

/**
 * Pemetaan status provider ke status aplikasi.
 *
 * Trim + lowercase HANYA untuk mencocokkan nilai yang sudah dikenal pada daftar
 * di atas — bukan pencarian mendekati. Nilai di luar daftar tetap ditolak.
 */
export function normalizeAppStatus(rawStatus: string): AppStatus {
  const key = rawStatus.trim().toLowerCase()
  const mapped = (RAW_STATUS_TO_APP_STATUS as Record<string, AppStatus | undefined>)[key]
  if (mapped === undefined) throw new UnsupportedOrderStatusError(rawStatus)
  return mapped
}

export function isKnownRawStatus(rawStatus: string): boolean {
  const key = rawStatus.trim().toLowerCase()
  return (RAW_STATUS_TO_APP_STATUS as Record<string, AppStatus | undefined>)[key] !== undefined
}

/** Paid = processing OR complete (PRD §151). */
export function isPaidStatus(appStatus: AppStatus): boolean {
  return appStatus === 'Paid'
}
