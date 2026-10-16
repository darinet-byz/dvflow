/**
 * Filter tanggal satu field: preset + rentang kustom dari kalender.
 *
 * Nilai yang disimpan tetap `dateFrom`/`dateTo` (YYYY-MM-DD) sehingga argumen RPC
 * (`p_date_from`/`p_date_to`) tidak berubah. Semua tanggal memakai kalender LOKAL browser.
 */
export type DateRange = { from: string; to: string }
export type DatePresetKey = 'today' | 'yesterday' | 'last7' | 'last30'

export const DATE_PRESETS: ReadonlyArray<{ key: DatePresetKey; label: string; daysBack: number; span: number }> = [
  { key: 'today', label: 'Hari Ini', daysBack: 0, span: 1 },
  { key: 'yesterday', label: 'Kemarin', daysBack: 1, span: 1 },
  { key: 'last7', label: '7 Hari Terakhir', daysBack: 0, span: 7 },
  { key: 'last30', label: '30 Hari Terakhir', daysBack: 0, span: 30 },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** Date lokal -> "YYYY-MM-DD" (tanpa konversi UTC yang bisa menggeser hari). */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

export function presetRange(key: DatePresetKey, today: Date = new Date()): DateRange {
  const preset = DATE_PRESETS.find((p) => p.key === key)!
  const end = addDays(today, -preset.daysBack)
  return { from: toIsoDate(addDays(end, -(preset.span - 1))), to: toIsoDate(end) }
}

/** Satu tanggal = tanggal tunggal; dua tanggal = rentang terurut. */
export function rangeFromPicks(first: string, second?: string | null): DateRange {
  if (!second) return { from: first, to: first }
  return first <= second ? { from: first, to: second } : { from: second, to: first }
}

export function matchPreset(from: string, to: string, today: Date = new Date()): DatePresetKey | null {
  for (const preset of DATE_PRESETS) {
    const range = presetRange(preset.key, today)
    if (range.from === from && range.to === to) return preset.key
  }
  return null
}

function shortDate(date: Date, withYear: boolean): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${withYear ? ` ${date.getFullYear()}` : ''}`
}

/** Label tampilan: "Semua tanggal", nama preset, "16 Okt 2026", atau "1–15 Okt 2026". */
export function describeRange(fromRaw: string, toRaw: string, today: Date = new Date()): string {
  const from = fromRaw.trim()
  const to = toRaw.trim()
  if (from === '' && to === '') return 'Semua tanggal'
  if (from !== '' && to !== '') {
    const preset = matchPreset(from, to, today)
    if (preset) return DATE_PRESETS.find((p) => p.key === preset)!.label
  }
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)
  if (start && !end) return `Sejak ${shortDate(start, true)}`
  if (!start && end) return `Sampai ${shortDate(end, true)}`
  if (!start || !end) return 'Semua tanggal'
  if (from === to) return shortDate(start, true)
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${shortDate(end, true)}`
  }
  if (start.getFullYear() === end.getFullYear()) return `${shortDate(start, false)} – ${shortDate(end, true)}`
  return `${shortDate(start, true)} – ${shortDate(end, true)}`
}

export const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

/** Sel kalender satu bulan, minggu mulai Senin; `null` = sel kosong sebelum tanggal 1. */
export function monthGrid(year: number, month: number): Array<string | null> {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const cells: Array<string | null> = Array.from({ length: offset }, () => null)
  for (let day = 1; day <= days; day += 1) cells.push(toIsoDate(new Date(year, month, day)))
  return cells
}
