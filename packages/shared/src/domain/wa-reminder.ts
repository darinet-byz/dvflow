/**
 * Aturan murni WA Admin Bot (Fitur 3.0).
 *
 * Template disimpan apa adanya; validasi placeholder dilakukan SEBELUM disimpan
 * supaya salah ketik `{{lead}}` tidak diam-diam terkirim sebagai teks mentah.
 * Penggantian nilai di SQL (`wa_reminder_claim`) memakai daftar placeholder yang
 * sama; fungsi di sini adalah cermin untuk preview dan unit test.
 */
export const WA_TEMPLATE_PLACEHOLDERS = [
  'mention',
  'store_name',
  'product_name',
  'leads',
  'paid',
  'report_url',
] as const

export type WaTemplatePlaceholder = (typeof WA_TEMPLATE_PLACEHOLDERS)[number]
export type WaTemplateValues = Record<WaTemplatePlaceholder, string | number>

export const WA_TEMPLATE_MAX_LENGTH = 4000
export const WA_MESSAGE_MAX_LENGTH = 60000
export const WA_TEMPLATE_NAME_MAX_LENGTH = 50
export const WA_GROUP_ID_MAX_LENGTH = 100
export const WA_PIC_NAME_MAX_LENGTH = 50
export const WA_TOKEN_MAX_LENGTH = 512

/** Placeholder yang muncul di teks, termasuk yang tidak dikenal. */
export function listWaTemplatePlaceholders(content: string): string[] {
  const found = new Set<string>()
  for (const match of content.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const name = match[1]
    if (name !== undefined) found.add(name)
  }
  return [...found]
}

export type WaTemplateValidation =
  | { ok: true; placeholders: WaTemplatePlaceholder[] }
  | { ok: false; message: string; unknown?: string[] }

export function validateWaTemplate(content: string): WaTemplateValidation {
  const text = content.trim()
  if (text === '') return { ok: false, message: 'Isi template wajib diisi.' }
  if (text.length > WA_TEMPLATE_MAX_LENGTH) {
    return { ok: false, message: `Isi template maksimal ${WA_TEMPLATE_MAX_LENGTH} karakter.` }
  }

  const known = new Set<string>(WA_TEMPLATE_PLACEHOLDERS)
  const used = listWaTemplatePlaceholders(text)
  const unknown = used.filter((name) => !known.has(name))
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Placeholder tidak dikenal: ${unknown.map((name) => `{{${name}}}`).join(', ')}.`,
      unknown,
    }
  }

  // Kurung kurawal yang tidak membentuk placeholder sah juga ditolak: teks itu
  // akan terkirim apa adanya dan terlihat seperti kesalahan sistem.
  const withoutPlaceholders = text.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '')
  if (withoutPlaceholders.includes('{{') || withoutPlaceholders.includes('}}')) {
    return { ok: false, message: 'Ada kurung kurawal yang tidak membentuk placeholder yang sah.' }
  }

  return { ok: true, placeholders: used as WaTemplatePlaceholder[] }
}

/** Ganti seluruh placeholder yang dikenal. Nilai hilang dibiarkan apa adanya. */
export function renderWaTemplate(content: string, values: Partial<WaTemplateValues>): string {
  return WA_TEMPLATE_PLACEHOLDERS.reduce((text, name) => {
    const value = values[name]
    if (value === undefined) return text
    return text.replaceAll(`{{${name}}}`, String(value))
  }, content)
}

/**
 * Nomor PIC dinormalisasi ke format `628xxx` (dokumen Fitur 3.0 §2.1).
 * Menerima `08…`, `8…`, `628…`, dan bentuk bertanda baca.
 */
export function normalizeWhatsAppPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (digits === '') return null

  let normalized: string
  if (digits.startsWith('62')) normalized = digits
  else if (digits.startsWith('0')) normalized = `62${digits.slice(1)}`
  else if (digits.startsWith('8')) normalized = `62${digits}`
  else return null

  return normalized.length >= 10 && normalized.length <= 15 ? normalized : null
}

/** `@628xxx` untuk mention di grup. */
export function waMention(phone: string): string {
  return `@${phone}`
}

/** Nama hari untuk tampilan jadwal (0 = Minggu, mengikuti PostgreSQL DOW). */
export const WA_DAY_LABELS: Readonly<Record<number, string>> = {
  0: 'Minggu',
  1: 'Senin',
  2: 'Selasa',
  3: 'Rabu',
  4: 'Kamis',
  5: 'Jumat',
  6: 'Sabtu',
}

export function formatWaDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b)
  if (sorted.length === 7) return 'Setiap hari'
  return sorted.map((day) => WA_DAY_LABELS[day] ?? String(day)).join(', ')
}
