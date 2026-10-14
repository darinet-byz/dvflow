import { normalizeMasterCode, MASTER_CODE_RULES } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'

/**
 * Deskripsi sumber daya konfigurasi (03 §12).
 *
 * Satu tabel deskriptor dipakai untuk kelima sumber daya supaya polanya benar-
 * benar konsisten — 03 §12 memintanya ("use one consistent protected pattern"),
 * dan lima salinan aturan validasi adalah tempat bug bersembunyi.
 *
 * Yang tidak ada di sini: endpoint GET daftar. Browser membaca konfigurasi
 * LANGSUNG dari Supabase lewat RLS (`02 §14`, `K11`: baca langsung, tulis lewat
 * backend), sehingga menambah GET di sini hanya akan menduplikasi permukaan
 * akses yang sudah ada.
 */

export type ConfigResourceName = 'products' | 'advertisers' | 'event-types' | 'sessions' | 'payment-fee-rules'

export type ConfigResource = {
  /** Nama pada URL (03 §12 memakai bentuk bertanda hubung). */
  urlName: ConfigResourceName
  table: string
  /** Kolom aman yang boleh dibaca-kembali dan dikirim ke klien. */
  columns: readonly string[]
  /** Kolom identitas yang unik — dipakai untuk pesan duplikat yang tepat. */
  identityColumn: 'code' | 'identifier'
  /** Sumber daya yang ikut menentukan kombinasi kode produk. */
  participatesInCodeCombinations: boolean
  /** Kolom yang boleh ditulis, berurutan. */
  writableColumns: readonly string[]
}

export const CONFIG_RESOURCES: Record<ConfigResourceName, ConfigResource> = {
  products: {
    urlName: 'products',
    table: 'products',
    columns: ['id', 'name', 'code', 'active', 'created_at', 'updated_at'],
    identityColumn: 'code',
    participatesInCodeCombinations: true,
    writableColumns: ['name', 'code', 'active'],
  },
  advertisers: {
    urlName: 'advertisers',
    table: 'advertisers',
    columns: ['id', 'name', 'code', 'active', 'created_at', 'updated_at'],
    identityColumn: 'code',
    participatesInCodeCombinations: true,
    writableColumns: ['name', 'code', 'active'],
  },
  'event-types': {
    urlName: 'event-types',
    table: 'event_types',
    columns: ['id', 'name', 'code', 'kind', 'active', 'created_at', 'updated_at'],
    identityColumn: 'code',
    // `kind` menentukan `orders.event_type` (K7), jadi kode event type ikut
    // membentuk kombinasi kode produk.
    participatesInCodeCombinations: true,
    writableColumns: ['name', 'code', 'kind', 'active'],
  },
  sessions: {
    urlName: 'sessions',
    table: 'sessions_config',
    columns: ['id', 'name', 'code', 'active', 'created_at', 'updated_at'],
    identityColumn: 'code',
    // Sesi dipisah oleh " - " pada product_raw, bukan bagian dari blok kode.
    participatesInCodeCombinations: false,
    writableColumns: ['name', 'code', 'active'],
  },
  'payment-fee-rules': {
    urlName: 'payment-fee-rules',
    table: 'payment_fee_rules',
    columns: ['id', 'name', 'identifier', 'fee_type', 'fee_value', 'active', 'created_at', 'updated_at'],
    identityColumn: 'identifier',
    participatesInCodeCombinations: false,
    writableColumns: ['name', 'identifier', 'fee_type', 'fee_value', 'active'],
  },
}

export function findConfigResource(value: string | undefined): ConfigResource | null {
  if (value === undefined) return null
  return (CONFIG_RESOURCES as Record<string, ConfigResource | undefined>)[value] ?? null
}

const NAME_MAX_LENGTH = 200
const IDENTIFIER_MAX_LENGTH = 200
/** Batas kewajaran nilai fee; jauh di atas fee nyata, di bawah batas NUMERIC(18,4). */
const FEE_VALUE_MAX = 1_000_000_000

const FEE_TYPES = ['flat', 'percentage'] as const
const EVENT_KINDS = ['seminar', 'webinar'] as const

/**
 * Validasi isi konfigurasi.
 *
 * `partial` dipakai untuk PATCH: hanya field yang dikirim yang divalidasi.
 * Field yang tidak dikirim tidak pernah ditulis — jadi PATCH tidak dapat
 * mengosongkan kolom secara tidak sengaja.
 */
export function validateConfigBody(
  resource: ConfigResource,
  body: Record<string, unknown>,
  options: { partial: boolean },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const has = (key: string): boolean => Object.hasOwn(body, key)

  const requiredFields = requiredFieldsFor(resource)
  if (!options.partial) {
    for (const field of requiredFields) {
      if (!has(field)) throw new ApiFailure('INVALID_PAYLOAD', `field ${field} wajib diisi`)
    }
  } else if (!Object.keys(body).some((key) => resource.writableColumns.includes(key))) {
    throw new ApiFailure('INVALID_PAYLOAD', 'tidak ada field konfigurasi yang dikirim')
  }

  if (has('name')) {
    const name = readText(body['name'])
    if (name === null || name.length > NAME_MAX_LENGTH) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama wajib diisi, maksimal 200 karakter.')
    }
    patch['name'] = name
  }

  if (has(resource.identityColumn)) {
    const raw = readText(body[resource.identityColumn])
    if (resource.identityColumn === 'code' && resource.urlName !== 'payment-fee-rules') {
      const normalized = normalizeMasterCode(resource.urlName, raw ?? '')
      if (normalized === null) throw new ApiFailure('INVALID_ARGUMENT', undefined, MASTER_CODE_RULES[resource.urlName].message)
      patch[resource.identityColumn] = normalized
    } else {
      if (raw === null || raw.length > IDENTIFIER_MAX_LENGTH) throw new ApiFailure('INVALID_ARGUMENT', 'identifier kosong atau terlalu panjang')
      patch[resource.identityColumn] = raw
    }
  }

  if (resource.writableColumns.includes('kind') && has('kind')) {
    const kind = readText(body['kind'])
    if (kind === null || !EVENT_KINDS.includes(kind as (typeof EVENT_KINDS)[number])) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Jenis acara wajib seminar atau webinar.')
    }
    patch['kind'] = kind
  }

  if (resource.writableColumns.includes('fee_type') && has('fee_type')) {
    const feeType = readText(body['fee_type'])
    if (feeType === null || !FEE_TYPES.includes(feeType as (typeof FEE_TYPES)[number])) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tipe biaya harus flat atau percentage.')
    }
    patch['fee_type'] = feeType
  }

  if (resource.writableColumns.includes('fee_value') && has('fee_value')) {
    const feeValue = body['fee_value']
    if (typeof feeValue !== 'number' || !Number.isFinite(feeValue)) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nilai biaya wajib diisi dengan angka.')
    }
    if (feeValue < 0 || feeValue > FEE_VALUE_MAX) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nilai biaya di luar rentang yang wajar.')
    }
    patch['fee_value'] = feeValue
  }

  if (has('active')) {
    if (typeof body['active'] !== 'boolean') {
      throw new ApiFailure('INVALID_ARGUMENT', 'active harus boolean')
    }
    patch['active'] = body['active']
  }

  return patch
}

function requiredFieldsFor(resource: ConfigResource): string[] {
  const base = ['name', resource.identityColumn]
  if (resource.urlName === 'event-types') base.push('kind')
  if (resource.urlName === 'payment-fee-rules') base.push('fee_type', 'fee_value')
  return base
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
