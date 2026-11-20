/**
 * Parser jadwal Citta (A82).
 *
 * Model hanya mengekstrak teks menjadi JSON. Semua normalisasi dan keputusan
 * akhir dilakukan di sini, sehingga hasil model tidak pernah langsung dipakai:
 * tanggal, jam, jenis acara, dan panjang field divalidasi ulang.
 */
import { normalizeBatch } from '@dvflow/shared'

export const EVENT_CATEGORIES = ['Seminar', 'Webinar', 'Workshop'] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const MAX_ADD_ITEMS = 10
export const MAX_DELETE_CANDIDATES = 10
export const MAX_INPUT_CHARS = 8000
export const MAX_LOCATION_CHARS = 200
export const MAX_CITY_CHARS = 80

export type NormalizedAddItem = {
  category: EventCategory
  category_source: 'explicit' | 'location'
  event_date: string
  start_time: string
  city: string | null
  location: string
  valid: boolean
  issues: string[]
}

export type DeleteMatch = {
  event_date: string | null
  start_time: string | null
  city: string | null
  location: string | null
}

export type ParsedAdd = {
  items: NormalizedAddItem[]
  issues: string[]
  /** A84: batch kampanye bila disebut di chat; null = belum lengkap. */
  batch: string | null
  /** A84: kode pengiklan yang disebut; kosong = belum lengkap. */
  advertiserCodes: string[]
}

export type ParsedDelete = {
  match: DeleteMatch
  issues: string[]
}

const MONTHS: Record<string, number> = {
  januari: 1, jan: 1,
  februari: 2, feb: 2, pebruari: 2,
  maret: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, agu: 8, agt: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10,
  november: 11, nov: 11,
  desember: 12, des: 12, dec: 12,
}

/** Tanggal hari ini menurut WIB, dalam bentuk YYYY-MM-DD. */
export function todayWib(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function buildAddPrompt(
  productCode: string,
  productName: string,
  today: string,
  advertisers: ReadonlyArray<{ code: string; name: string }> = [],
): string {
  const year = today.slice(0, 4)
  const advertiserList = advertisers.length === 0
    ? '(belum ada pengiklan aktif di produk ini)'
    : advertisers.map((advertiser) => `${advertiser.code} - ${advertiser.name}`).join(', ')
  return [
    'Anda adalah mesin ekstraksi jadwal untuk Citta - DVFLOW AI.',
    `Produk sudah ditentukan dari grup WhatsApp: ${productCode} - ${productName}. JANGAN mengubah produk.`,
    `Pengiklan produk: ${advertiserList}.`,
    `Hari ini: ${today} (WIB).`,
    'Tugas: baca teks pengguna, lalu balas HANYA satu objek JSON tanpa penjelasan.',
    'Skema:',
    '{"batch":null,"advertiser_codes":[],"items":[{"category":null,"event_date":"YYYY-MM-DD","start_time":"HH:MM","city":null,"location":"..."}],"issues":[]}',
    'Aturan:',
    '- Satu baris jadwal = satu item. Maksimal 10 item.',
    '- Abaikan teks hiasan seperti "jadwal terbaru".',
    `- Tahun tidak disebut: pakai ${year}. Jika tanggalnya sudah lewat, tetap tulis tanggal itu dan tambahkan issue "TANGGAL_LALU".`,
    '- Jam memakai format 24 jam. "09.00 WIB" -> "09:00". "2 siang" -> "14:00".',
    '- Pisahkan kota dan lokasi bila jelas. "Hotel Aston Pekalongan" adalah location; "PEKALONGAN" adalah city.',
    '- category hanya diisi bila teks menyebut Seminar, Webinar, atau Workshop. Selain itu null; server yang menyimpulkan.',
    '- batch diisi hanya bila teks menyebut batch (mis. "Batch 61" -> "61"). Jika tidak disebut, null.',
    '- advertiser_codes diisi kode pengiklan yang disebut, hanya dari daftar pengiklan produk. Jika tidak disebut, [].',
    '- Batch dan pengiklan boleh tidak disebut. Jangan bertanya dan jangan menolak hanya karena itu; cukup null/kosong.',
    '- Jangan mengarang. Field yang tidak ada -> null/kosong, dan tambahkan issue yang menjelaskan.',
  ].join('\n')
}

export function buildDeletePrompt(productCode: string, productName: string, today: string): string {
  return [
    'Anda adalah mesin pembaca perintah hapus jadwal untuk Citta - DVFLOW AI.',
    `Produk sudah ditentukan dari grup WhatsApp: ${productCode} - ${productName}. JANGAN mengubah produk.`,
    `Hari ini: ${today} (WIB).`,
    'Tugas: baca teks pengguna, lalu balas HANYA satu objek JSON tanpa penjelasan.',
    'Skema:',
    '{"match":{"event_date":"YYYY-MM-DD","start_time":null,"city":null,"location":null},"issues":[]}',
    'Aturan:',
    '- event_date wajib. Jika teks tidak memuat tanggal, isi null dan tambahkan issue "TANGGAL_TIDAK_ADA".',
    '- start_time, city, dan location diisi hanya bila disebut; selain itu null.',
    '- Jam memakai format 24 jam.',
    '- Jangan mengarang.',
  ].join('\n')
}

export function normalizeAdd(
  raw: unknown,
  today: string,
  advertisers: ReadonlyArray<{ code: string; name: string }> = [],
): ParsedAdd {
  const issues: string[] = []
  const object = asObject(raw)
  const rawItems = Array.isArray(object?.['items']) ? (object?.['items'] as unknown[]) : []
  if (rawItems.length === 0) {
    return {
      items: [],
      issues: ['Tidak ada jadwal yang bisa dibaca dari pesan.'],
      batch: null,
      advertiserCodes: [],
    }
  }

  const limited = rawItems.slice(0, MAX_ADD_ITEMS)
  if (rawItems.length > MAX_ADD_ITEMS) {
    issues.push(`Hanya ${MAX_ADD_ITEMS} baris pertama yang diproses.`)
  }

  const items = limited.map((value) => normalizeAddItem(asObject(value), today))
  return {
    items,
    issues,
    batch: normalizeOptionalBatch(object?.['batch']),
    advertiserCodes: normalizeAdvertiserCodes(object?.['advertiser_codes'], advertisers),
  }
}

function normalizeOptionalBatch(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string' ? value.trim() : ''
  if (text === '' || text === '?') return null
  const normalized = normalizeBatch(text)
  if (normalized === '' || normalized.length > 32) return null
  return normalized
}

function normalizeAdvertiserCodes(
  value: unknown,
  advertisers: ReadonlyArray<{ code: string; name: string }>,
): string[] {
  if (!Array.isArray(value) || advertisers.length === 0) return []
  const byKey = new Map<string, string>()
  for (const advertiser of advertisers) {
    byKey.set(advertiser.code.trim().toLowerCase(), advertiser.code)
    byKey.set(advertiser.name.trim().toLowerCase(), advertiser.code)
  }
  const result: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isFinite(raw))) continue
    const text = String(raw).trim().toLowerCase()
    const code = byKey.get(text) ?? byKey.get(text.padStart(2, '0'))
    if (code !== undefined && !result.includes(code)) result.push(code)
    if (result.length >= 20) break
  }
  return result
}

function normalizeAddItem(raw: Record<string, unknown> | null, today: string): NormalizedAddItem {
  const issues: string[] = []
  const location = text(raw?.['location'])
  const city = text(raw?.['city'])
  const dateRaw = text(raw?.['event_date'])
  const timeRaw = text(raw?.['start_time'])
  const categoryRaw = text(raw?.['category'])

  const eventDate = parseDate(dateRaw, today)
  if (eventDate === null) {
    issues.push(dateRaw === null ? 'Tanggal tidak ditemukan.' : 'Tanggal tidak valid.')
  } else if (eventDate < today) {
    issues.push('Tanggal sudah lewat.')
  }

  const startTime = parseTime(timeRaw)
  if (startTime === null) {
    issues.push(timeRaw === null ? 'Jam tidak ditemukan.' : 'Jam tidak valid.')
  }

  if (location === null) {
    issues.push('Lokasi tidak ditemukan.')
  } else if (location.length > MAX_LOCATION_CHARS) {
    issues.push(`Lokasi terlalu panjang (maks ${MAX_LOCATION_CHARS} karakter).`)
  }

  if (city !== null && city.length > MAX_CITY_CHARS) {
    issues.push(`Kota terlalu panjang (maks ${MAX_CITY_CHARS} karakter).`)
  }

  const category = resolveCategory(categoryRaw, location)
  if (category === null) {
    issues.push('Jenis acara tidak dikenal.')
  }

  return {
    category: category?.category ?? 'Seminar',
    category_source: category?.source ?? 'location',
    event_date: eventDate ?? '',
    start_time: startTime ?? '',
    city,
    location: location ?? '',
    valid: issues.length === 0,
    issues,
  }
}

export function normalizeDelete(raw: unknown, today: string): ParsedDelete {
  const issues: string[] = []
  const object = asObject(raw)
  const match = asObject(object?.['match'])
  const dateRaw = text(match?.['event_date'])
  const eventDate = parseDate(dateRaw, today)
  if (eventDate === null) {
    issues.push(dateRaw === null ? 'Tanggal tidak ditemukan.' : 'Tanggal tidak valid.')
  }

  const timeRaw = text(match?.['start_time'])
  const startTime = timeRaw === null ? null : parseTime(timeRaw)
  if (timeRaw !== null && startTime === null) issues.push('Jam tidak valid.')

  return {
    match: {
      event_date: eventDate,
      start_time: startTime,
      city: text(match?.['city']),
      location: text(match?.['location']),
    },
    issues,
  }
}

export function resolveCategory(
  explicit: string | null,
  location: string | null,
): { category: EventCategory; source: 'explicit' | 'location' } | null {
  if (explicit !== null) {
    const normalized = explicit.trim().toLowerCase()
    if (normalized === 'seminar') return { category: 'Seminar', source: 'explicit' }
    if (normalized === 'webinar') return { category: 'Webinar', source: 'explicit' }
    if (normalized === 'workshop') return { category: 'Workshop', source: 'explicit' }
    return null
  }

  const haystack = (location ?? '').toLowerCase()
  if (/(zoom|gmeet|google\s*meet|online|virtual|streaming|webinar)/.test(haystack)) {
    return { category: 'Webinar', source: 'location' }
  }
  if (haystack.trim() !== '') return { category: 'Seminar', source: 'location' }
  return null
}

/** Terima ISO dan beberapa bentuk Indonesia; hasil selalu YYYY-MM-DD. */
export function parseDate(value: string | null, today: string): string | null {
  if (value === null) return null
  const raw = value.trim()
  if (raw === '') return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso !== null) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const numeric = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(raw)
  if (numeric !== null) return validDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))

  const numericShort = /^(\d{1,2})[\/\-.](\d{1,2})$/.exec(raw)
  if (numericShort !== null) {
    return validDate(Number(today.slice(0, 4)), Number(numericShort[2]), Number(numericShort[1]))
  }

  // "30 Nov 2026", "30 November 2026", "30 Nov"
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/.exec(raw)
  if (dayFirst !== null) {
    const month = MONTHS[(dayFirst[2] ?? '').toLowerCase()]
    if (month === undefined) return null
    const year = dayFirst[3] === undefined ? Number(today.slice(0, 4)) : Number(dayFirst[3])
    return validDate(year, month, Number(dayFirst[1]))
  }

  // "Nov 30, 2026", "November 30"
  const monthFirst = /^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(raw)
  if (monthFirst !== null) {
    const month = MONTHS[(monthFirst[1] ?? '').toLowerCase()]
    if (month === undefined) return null
    const year = monthFirst[3] === undefined ? Number(today.slice(0, 4)) : Number(monthFirst[3])
    return validDate(year, month, Number(monthFirst[2]))
  }

  return null
}

/** "09.00 WIB", "9:00", "2 siang" -> "09:00"/"14:00". */
export function parseTime(value: string | null): string | null {
  if (value === null) return null
  const raw = value.trim().toLowerCase()
  if (raw === '') return null

  const periodMatch = /^(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam)?(?:\s*wib)?$/.exec(raw)
  if (periodMatch === null) return null

  let hour = Number(periodMatch[1])
  const minute = periodMatch[2] === undefined ? 0 : Number(periodMatch[2])
  const period = periodMatch[3]

  if (period === 'siang' || period === 'sore' || period === 'malam') {
    if (hour < 12) hour += 12
  }
  if (period === 'pagi' && hour === 12) hour = 0

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function validDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const DAY_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

/** 2026-11-30 -> "30 Nov 2026". */
export function formatDateId(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  const month = MONTH_SHORT[Number(match[2]) - 1] ?? match[2]
  return `${Number(match[3])} ${month} ${match[1]}`
}

/**
 * 2026-11-30 -> "Senin, 30 Nov 2026".
 *
 * Dipakai di semua pesan WhatsApp Citta supaya operator tidak perlu menghitung
 * hari sendiri dari tanggal. `formatDateId` tetap dipakai saat tanggal bukan
 * untuk dibaca manusia (mis. perbandingan).
 */
export function formatDateIdWithDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
  const dayName = DAY_ID[day] ?? ''
  return `${dayName}, ${formatDateId(iso)}`
}

/** 09:00 -> "09:00"; 09:00:00 -> "09:00". */
export function shortTime(value: string): string {
  return value.slice(0, 5)
}
