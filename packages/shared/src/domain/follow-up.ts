/**
 * Aturan murni Follow Up Manual (A76).
 *
 * Fitur ini TIDAK memakai gateway: operator membuka WhatsApp miliknya sendiri
 * lewat `api.whatsapp.com/send`, lalu pesan masih bisa diedit di WhatsApp sebelum
 * dikirim. Karena itu di sini hanya ada aturan teks, nomor, dan URL — tidak ada
 * pemanggilan jaringan.
 *
 * Template disimpan apa adanya. Validasi placeholder dilakukan SEBELUM disimpan
 * supaya salah ketik seperti `{lead}` tidak terkirim sebagai teks mentah.
 */
export const FOLLOW_UP_TEMPLATE_PLACEHOLDERS = [
  'nama',
  'order_id',
  'produk',
  'pengiklan',
  'jenis',
  'batch',
  'sesi',
  'kota',
  'link',
] as const

export const FOLLOW_UP_SLOTS = [1, 2, 3, 4] as const
export const FOLLOW_UP_TEMPLATE_MAX_LENGTH = 2000

/** WhatsApp membuka tautan ini sebagai chat baru; pesan belum terkirim. */
export const WHATSAPP_SEND_BASE = 'https://api.whatsapp.com/send'

export type FollowUpSlot = (typeof FOLLOW_UP_SLOTS)[number]
export type FollowUpPlaceholder = (typeof FOLLOW_UP_TEMPLATE_PLACEHOLDERS)[number]
export type FollowUpTemplateValues = Partial<Record<FollowUpPlaceholder, string | null | undefined>>

export function isFollowUpSlot(value: unknown): value is FollowUpSlot {
  return typeof value === 'number' && (FOLLOW_UP_SLOTS as readonly number[]).includes(value)
}

/** Placeholder yang muncul di teks, termasuk yang tidak dikenal. */
export function listFollowUpPlaceholders(content: string): string[] {
  const found = new Set<string>()
  for (const match of content.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*\}/g)) {
    const name = match[1]
    if (name !== undefined) found.add(name)
  }
  return [...found]
}

export type FollowUpTemplateValidation =
  | { ok: true; placeholders: FollowUpPlaceholder[] }
  | { ok: false; message: string; unknown?: string[] }

export function validateFollowUpTemplate(content: string): FollowUpTemplateValidation {
  const text = content.trim()
  if (text === '') return { ok: false, message: 'Isi template wajib diisi.' }
  if (text.length > FOLLOW_UP_TEMPLATE_MAX_LENGTH) {
    return { ok: false, message: `Isi template maksimal ${FOLLOW_UP_TEMPLATE_MAX_LENGTH} karakter.` }
  }

  const known = new Set<string>(FOLLOW_UP_TEMPLATE_PLACEHOLDERS)
  const used = listFollowUpPlaceholders(text)
  const unknown = used.filter((name) => !known.has(name))
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Placeholder tidak dikenal: ${unknown.map((name) => `{${name}}`).join(', ')}.`,
      unknown,
    }
  }

  // Kurung kurawal yang tidak membentuk placeholder sah juga ditolak: teks itu
  // akan terkirim apa adanya dan terlihat seperti kesalahan sistem.
  const withoutPlaceholders = text.replace(/\{\s*[a-zA-Z0-9_]+\s*\}/g, '')
  if (withoutPlaceholders.includes('{') || withoutPlaceholders.includes('}')) {
    return { ok: false, message: 'Ada kurung kurawal yang tidak membentuk placeholder yang sah.' }
  }

  return { ok: true, placeholders: used as FollowUpPlaceholder[] }
}

/**
 * Ganti seluruh placeholder yang dikenal. Nilai kosong/hilang menjadi string
 * kosong — dipakai untuk `{link}` pada order OTS yang memang tidak punya tiket.
 */
export function renderFollowUpTemplate(content: string, values: FollowUpTemplateValues): string {
  const known = new Set<string>(FOLLOW_UP_TEMPLATE_PLACEHOLDERS)
  return content.replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (whole, name: string) => {
    if (!known.has(name)) return whole
    const value = values[name as FollowUpPlaceholder]
    return value === undefined || value === null ? '' : String(value)
  })
}

/**
 * Nomor WhatsApp Indonesia ke format internasional tanpa `+`.
 *
 * Menerima `0812…`, `812…`, `62812…`, `+62 812-…`, dengan spasi/tanda hubung.
 * Mengembalikan null bila hasilnya bukan nomor Indonesia yang wajar, supaya UI
 * bisa menonaktifkan tombol alih-alih membuka chat yang salah.
 */
export function toWhatsAppNumber(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  let digits = value.replace(/\D/g, '')
  if (digits === '') return null

  // Awalan internasional `00` (mis. 0062…) diperlakukan sama seperti `62`.
  if (digits.startsWith('00')) digits = digits.slice(2)

  if (digits.startsWith('62')) {
    // sudah internasional
  } else if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`
  } else if (digits.startsWith('8')) {
    digits = `62${digits}`
  } else {
    return null
  }

  return /^62\d{8,13}$/.test(digits) ? digits : null
}

/** URL chat baru WhatsApp; pesan belum terkirim dan masih bisa diedit di WhatsApp. */
export function whatsAppSendUrl(phone: string, message: string): string {
  const base = `${WHATSAPP_SEND_BASE}?phone=${encodeURIComponent(phone)}`
  // Slot tanpa template tetap membuka chat kosong (tanpa parameter text).
  return message.trim() === '' ? base : `${base}&text=${encodeURIComponent(message)}`
}
