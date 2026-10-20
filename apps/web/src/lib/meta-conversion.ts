import type { OrderFilters } from './filters'

/**
 * Export Meta Conversion Audience (A35).
 *
 * Format dibekukan di `docs/Reference-Meta-Conversion-Audience-Format.md`.
 * Fungsi di sini murni: tidak menyentuh DOM/server, sehingga bisa diuji tanpa browser.
 *
 * Dua hal yang sengaja TIDAK dilakukan:
 *   * menambahkan BOM (bukan format yang diminta);
 *   * menambahkan apostrof formula guard di depan `+62` (akan merusak nomor HP).
 */

export type MetaConversionColumn = { key: string; header: string }

/** Urutan kolom persis mengikuti contoh Meta yang diberikan pengguna. */
export const META_CONVERSION_COLUMNS: readonly MetaConversionColumn[] = [
  { key: 'order_id', header: 'order_id' },
  { key: 'fn', header: 'fn' },
  { key: 'email', header: 'email' },
  { key: 'phone', header: 'phone' },
  { key: 'ct', header: 'ct' },
  { key: 'country', header: 'country' },
  { key: 'value', header: 'value' },
  { key: 'currency', header: 'currency' },
  { key: 'event_name', header: 'event_name' },
  { key: 'event_time', header: 'event_time' },
  { key: 'data_processing_options', header: 'data_processing_options' },
]

export type MetaConversionOrder = {
  order_id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  city?: string | null
  app_status?: string | null
  gross_amount: number | string
  paid_at?: string | null
  source_created_at?: string | null
  created_at?: string | null
}

export type MetaConversionResult = {
  rows: Array<Record<string, string>>
  skipped: number
}

/** Export Meta selalu hanya Paid, terlepas dari filter status yang sedang tampil. */
export function metaConversionFilters(filters: OrderFilters): OrderFilters {
  return { ...filters, appStatus: 'Paid' }
}

/** Apakah tombol Export Meta masuk akal untuk filter status saat ini. */
export function canExportMetaForStatus(appStatus: string): boolean {
  return appStatus === '' || appStatus === 'Paid'
}

export function normalizeMetaEmail(value: string | null | undefined): string {
  const email = (value ?? '').trim().toLowerCase()
  if (email === '') return ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

/**
 * Normalisasi nomor Indonesia ke `+62...`.
 *
 * Contoh: `0812-3456-7890`, `+62 812 3456 7890`, `62812...`, `812...` → `+62812...`.
 * Nomor yang tidak bisa dipastikan formatnya dikosongkan, bukan ditebak.
 */
export function normalizeMetaPhone(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return ''

  let digits = trimmed.replace(/\D/g, '')
  if (digits === '') return ''

  if (digits.startsWith('620')) digits = `62${digits.slice(3)}`
  if (digits.startsWith('62')) {
    // sudah berkode negara
  } else if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`
  } else if (digits.startsWith('8')) {
    digits = `62${digits}`
  } else {
    // Bukan pola Indonesia yang dikenal: jangan menebak kode negara.
    return ''
  }

  // E.164: maksimal 15 digit. Nomor Indonesia yang valid minimal 9 digit total.
  if (digits.length < 9 || digits.length > 15) return ''
  return `+${digits}`
}

/** Waktu WIB tanpa offset, mengikuti contoh: `YYYY-MM-DDTHH:mm:ss`. */
export function formatMetaEventTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const valueOf = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '00'
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}T${valueOf('hour')}:${valueOf('minute')}:${valueOf('second')}`
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function formatNumber(value: number | string): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '0'
  if (Number.isInteger(parsed)) return String(parsed)
  return parsed.toFixed(2).replace(/\.?0+$/, '')
}

/**
 * Satu baris Meta, atau `null` kalau baris tidak punya identifier yang bisa dipakai.
 * Hanya `Paid` yang boleh menjadi `Purchase`.
 */
export function toMetaConversionRow(order: MetaConversionOrder): Record<string, string> | null {
  if (order.app_status !== 'Paid') return null

  const email = normalizeMetaEmail(order.email)
  const phone = normalizeMetaPhone(order.phone)
  if (email === '' && phone === '') return null

  return {
    order_id: cleanText(order.order_id),
    fn: cleanText(order.name),
    email,
    phone,
    ct: cleanText(order.city),
    country: 'ID',
    value: formatNumber(order.gross_amount),
    currency: 'IDR',
    event_name: 'Purchase',
    event_time: formatMetaEventTime(order.paid_at ?? order.source_created_at ?? order.created_at),
    data_processing_options: '[]',
  }
}

export function toMetaConversionRows(orders: readonly MetaConversionOrder[]): MetaConversionResult {
  const rows: Array<Record<string, string>> = []
  let skipped = 0
  for (const order of orders) {
    const row = toMetaConversionRow(order)
    if (row === null) skipped += 1
    else rows.push(row)
  }
  return { rows, skipped }
}

/**
 * Serializer CSV khusus Meta.
 *
 * - tanpa BOM;
 * - tanpa formula guard (agar `+62` tidak menjadi `'+62`);
 * - quoting standar CSV hanya bila perlu.
 */
export function toMetaConversionCsv(
  rows: Array<Record<string, unknown>>,
  columns: readonly MetaConversionColumn[] = META_CONVERSION_COLUMNS,
): string {
  const cell = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [
    columns.map((column) => cell(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => cell(row[column.key])).join(',')),
  ].join('\r\n')
}
