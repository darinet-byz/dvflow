/**
 * Pemformat tampilan.
 *
 * Dikumpulkan di satu tempat supaya "Rp" tidak muncul dalam tiga gaya berbeda
 * di tiga halaman. Semuanya memakai locale Indonesia dan sengaja deterministik
 * (bukan bergantung locale runtime) agar hasilnya sama di mesin mana pun —
 * penting karena nilai-nilai ini dipakai di test.
 */

const LOCALE = 'id-ID'

const CURRENCY = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const NUMBER = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })

/** Money dari NUMERIC(18,2); nilainya datang sebagai string dari PostgREST. */
export function formatMoney(value: string | number | null | undefined): string {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  if (!Number.isFinite(parsed)) return '-'
  return CURRENCY.format(parsed)
}

export function formatCount(value: string | number | null | undefined): string {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  if (!Number.isFinite(parsed)) return '-'
  return NUMBER.format(parsed)
}

/**
 * Rasio (0–1) menjadi persen.
 *
 * `null` berarti penyebutnya nol — ditampilkan sebagai "-", bukan "0%", supaya
 * "belum ada data" tidak terbaca sebagai "nol persen" (STATE.md K4).
 */
export function formatRate(rate: string | number | null | undefined): string {
  if (rate === null || rate === undefined || rate === '') return '-'
  const parsed = typeof rate === 'number' ? rate : Number(rate)
  if (!Number.isFinite(parsed)) return '-'
  return `${(parsed * 100).toFixed(parsed === 0 || parsed >= 0.1 ? 0 : 1)}%`
}

/** Tanggal + jam ringkas, zona waktu perangkat. */
export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

/** Jam saja — dipakai daftar timestamp presensi (PRD §104). */
export function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(parsed)
}

/** Tanggal saja (YYYY-MM-DD dari kolom date/timestamp). */
export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

/** Nilai kosong ditampilkan sebagai tanda hubung, bukan sel kosong. */
export function formatText(value: string | null | undefined): string {
  if (value === null || value === undefined) return '-'
  const trimmed = String(value).trim()
  return trimmed === '' ? '-' : trimmed
}
