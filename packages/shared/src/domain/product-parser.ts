/**
 * Parser product_raw (PRD §67, 01-IMPLEMENTATION-DECISIONS §9 dan §10).
 *
 * Dua pola kanonik yang SAMA-SAMA diterima (A75):
 *
 *   Berbasis kode — 3 segmen:
 *   [PRODUCT_CODE][ADVERTISER_CODE][TYPE_CODE][BATCH] - [SESSION_CODE] - [CITY]
 *   contoh: KM01SO392 - S1 - Solo
 *
 *   Berbasis nama produk — 5 segmen:
 *   [ADVERTISER_CODE] - [TYPE_CODE][BATCH] - [PRODUCT_NAME] - [SESSION_CODE] - [CITY]
 *   contoh: 01 - SO392 - Kuliner Masteri - S1 - Solo
 *
 * Segmen pertama format lama TIDAK punya pemisah internal, jadi ia harus dipecah
 * dengan mencocokkan kode konfigurasi. Algoritma ini deterministik dan tidak
 * pernah menebak:
 *
 *   1. trim, pecah pada pemisah persis " - " (3 segmen => format lama, 5 => format baru)
 *   2. segmen sesi harus cocok dengan TEPAT SATU baris sessions_config
 *   3. format lama: segmen kode harus cocok dengan TEPAT SATU kombinasi
 *      (product, advertiser, event_type); sisanya menjadi batch
 *      format baru: pengiklan, tipe+batch, dan nama produk masing-masing harus
 *      cocok dengan TEPAT SATU baris konfigurasi
 *
 * Nol kandidat atau lebih dari satu kandidat => invalid. Ambiguitas tidak pernah
 * diselesaikan dengan tebakan.
 *
 * Pencocokan memakai SELURUH baris konfigurasi (aktif maupun nonaktif). Menonaktifkan
 * sebuah produk tidak boleh membuat order lama yang sudah Paid kehilangan akses event.
 * Kolom `active` hanya menggerbangi selector/generator dan rule tax baru.
 */

import {
  EVENT_TYPE_NAME_BY_KIND,
  type AdvertiserConfigRow,
  type EventTypeConfigRow,
  type EventKind,
  type EventTypeName,
  type ProductConfigRow,
  type ProductConfigSet,
  type ProductParseStatus,
  type SessionConfigRow,
} from '../types'
import { PRODUCT_SEGMENT_SEPARATOR } from './product-name'
import { normalizeBatch, normalizeCode, normalizeProductName } from './text'

export type ProductParseFailureReason =
  | 'EMPTY_PRODUCT_RAW'
  | 'WRONG_SEGMENT_COUNT'
  | 'EMPTY_SEGMENT'
  | 'INVALID_CODE_BLOCK'
  | 'UNKNOWN_SESSION'
  | 'AMBIGUOUS_SESSION'
  | 'UNKNOWN_CODE_COMBINATION'
  | 'AMBIGUOUS_CODE_COMBINATION'
  // A75: kegagalan khusus format berbasis nama produk.
  | 'UNKNOWN_ADVERTISER'
  | 'AMBIGUOUS_ADVERTISER'
  | 'UNKNOWN_TYPE_CODE'
  | 'AMBIGUOUS_TYPE_CODE'
  | 'UNKNOWN_PRODUCT_NAME'
  | 'AMBIGUOUS_PRODUCT_NAME'

export type ProductParseCandidate = string

export type ParsedProductValid = {
  product_parse_status: Extract<ProductParseStatus, 'valid'>
  product_code: string
  product_name: string
  advertiser_code: string
  advertiser_name: string
  event_type: EventTypeName
  /** Kode event type dari konfigurasi (SO/WO/WS). Dipakai template Follow Up. */
  event_type_code: string
  /** Turunan dari konfigurasi; tidak disimpan sebagai kolom orders. */
  event_kind: EventKind
  /** Selalu string supaya leading zero seperti "001" tidak hilang. */
  batch: string
  session: string
  city: string
  failure_reason: null
  candidates: readonly ProductParseCandidate[]
}

export type ParsedProductInvalid = {
  product_parse_status: Extract<ProductParseStatus, 'invalid'>
  product_code: null
  product_name: null
  advertiser_code: null
  advertiser_name: null
  event_type: null
  event_type_code: null
  event_kind: null
  batch: null
  session: null
  city: null
  failure_reason: ProductParseFailureReason
  /** Kandidat yang saling menaungi, untuk diagnosa di webhook_logs. */
  candidates: readonly ProductParseCandidate[]
}

export type ProductParseResult = ParsedProductValid | ParsedProductInvalid

const NULL_FIELDS = {
  product_code: null,
  product_name: null,
  advertiser_code: null,
  advertiser_name: null,
  event_type: null,
  event_type_code: null,
  event_kind: null,
  batch: null,
  session: null,
  city: null,
} as const

function invalidProduct(
  failure_reason: ProductParseFailureReason,
  candidates: readonly ProductParseCandidate[] = [],
): ParsedProductInvalid {
  return {
    product_parse_status: 'invalid',
    ...NULL_FIELDS,
    failure_reason,
    candidates,
  }
}

export type CodeCombination = {
  product: ProductConfigRow
  advertiser: AdvertiserConfigRow
  eventType: EventTypeConfigRow
  /** Prefix kode yang sudah dinormalisasi. */
  prefix: string
}

export function describeCodeCombination(combination: CodeCombination): string {
  return `${combination.product.code}+${combination.advertiser.code}+${combination.eventType.code}`
}

/**
 * Semua kombinasi kode konfigurasi yang merupakan prefix dari codeBlock.
 * Dipakai parser sekaligus oleh guard penulisan konfigurasi.
 */
export function listCodeCombinations(
  codeBlock: string,
  config: Pick<ProductConfigSet, 'products' | 'advertisers' | 'eventTypes'>,
): CodeCombination[] {
  const blockKey = normalizeCode(codeBlock)
  const combinations: CodeCombination[] = []

  for (const product of config.products) {
    const productKey = normalizeCode(product.code)
    for (const advertiser of config.advertisers) {
      const advertiserKey = normalizeCode(advertiser.code)
      for (const eventType of config.eventTypes) {
        const prefix = `${productKey}${advertiserKey}${normalizeCode(eventType.code)}`
        // Batch wajib non-kosong, jadi prefix harus lebih pendek dari blok kode.
        if (blockKey.length <= prefix.length) continue
        if (!blockKey.startsWith(prefix)) continue
        combinations.push({ product, advertiser, eventType, prefix })
      }
    }
  }

  return combinations
}

export type AmbiguousCodePair = {
  prefix: string
  first: string
  second: string
}

/**
 * Deteksi kombinasi kode yang saling menaungi pada satu set konfigurasi.
 *
 * Dipakai sebagai guard saat menulis konfigurasi: kode yang menimbulkan
 * ambiguitas ditolak, supaya order tidak pernah ternormalisasi salah diam-diam.
 */
export function findAmbiguousCodeCombinations(
  config: Pick<ProductConfigSet, 'products' | 'advertisers' | 'eventTypes'>,
): AmbiguousCodePair[] {
  const seen = new Map<string, string>()
  const conflicts: AmbiguousCodePair[] = []

  for (const product of config.products) {
    for (const advertiser of config.advertisers) {
      for (const eventType of config.eventTypes) {
        const prefix = `${normalizeCode(product.code)}${normalizeCode(advertiser.code)}${normalizeCode(eventType.code)}`
        const label = `${product.code}+${advertiser.code}+${eventType.code}`
        const existing = seen.get(prefix)
        if (existing !== undefined && existing !== label) {
          conflicts.push({ prefix, first: existing, second: label })
          continue
        }
        seen.set(prefix, label)
      }
    }
  }

  return conflicts
}

type SessionMatch =
  | { ok: true; session: SessionConfigRow }
  | { ok: false; result: ParsedProductInvalid }

/** Sesi harus cocok dengan TEPAT SATU baris konfigurasi. */
function resolveSession(sessionText: string, config: ProductConfigSet): SessionMatch {
  const sessionKey = normalizeCode(sessionText)
  const sessionMatches = config.sessions.filter(
    (session: SessionConfigRow) => normalizeCode(session.code) === sessionKey,
  )
  if (sessionMatches.length === 0) return { ok: false, result: invalidProduct('UNKNOWN_SESSION') }
  if (sessionMatches.length > 1) {
    return {
      ok: false,
      result: invalidProduct('AMBIGUOUS_SESSION', sessionMatches.map((session) => session.code)),
    }
  }
  const session = sessionMatches[0]
  if (session === undefined) return { ok: false, result: invalidProduct('UNKNOWN_SESSION') }
  return { ok: true, session }
}

/**
 * Format baru (A75): 01 - SO392 - Kuliner Masteri - S1 - Solo
 *
 * Setiap bagian dicocokkan ke konfigurasi; tidak ada pencocokan teks bebas.
 * Nama produk dibandingkan setelah besar-kecil huruf dan rangkaian spasi
 * dinormalisasi (`normalizeProductName`), karena nama itu ditulis manusia di
 * OrderOnline — tetapi tetap harus menunjuk TEPAT SATU produk.
 */
function parseDetailedProduct(
  segments: readonly string[],
  config: ProductConfigSet,
): ProductParseResult {
  const advertiserText = (segments[0] ?? '').trim()
  const typeBatchText = (segments[1] ?? '').trim()
  const productNameText = (segments[2] ?? '').trim()
  const sessionText = (segments[3] ?? '').trim()
  const city = (segments[4] ?? '').trim()

  if (
    advertiserText.length === 0 ||
    typeBatchText.length === 0 ||
    productNameText.length === 0 ||
    sessionText.length === 0 ||
    city.length === 0
  ) {
    return invalidProduct('EMPTY_SEGMENT')
  }

  const advertiserKey = normalizeCode(advertiserText)
  const advertiserMatches = config.advertisers.filter(
    (advertiser: AdvertiserConfigRow) => normalizeCode(advertiser.code) === advertiserKey,
  )
  if (advertiserMatches.length === 0) return invalidProduct('UNKNOWN_ADVERTISER')
  if (advertiserMatches.length > 1) {
    return invalidProduct('AMBIGUOUS_ADVERTISER', advertiserMatches.map((advertiser) => advertiser.code))
  }
  const advertiser = advertiserMatches[0]
  if (advertiser === undefined) return invalidProduct('UNKNOWN_ADVERTISER')

  // Tipe + batch menempel: "SO392" = tipe SO, batch 392. Tipe dicocokkan dari
  // konfigurasi (bukan memotong 2 huruf), lalu sisanya batch.
  const typeBatchKey = normalizeCode(typeBatchText)
  // Slice batch memakai indeks dari teks asli, jadi panjangnya harus sama.
  if (typeBatchKey.length !== typeBatchText.length) return invalidProduct('INVALID_CODE_BLOCK')

  const typeMatches: Array<{ eventType: EventTypeConfigRow; batchRaw: string }> = []
  for (const eventType of config.eventTypes) {
    const typeKey = normalizeCode(eventType.code)
    if (typeKey.length === 0 || typeBatchKey.length <= typeKey.length) continue
    if (!typeBatchKey.startsWith(typeKey)) continue
    const batchRaw = typeBatchText.slice(typeKey.length)
    if (batchRaw.length === 0) continue
    typeMatches.push({ eventType, batchRaw })
  }
  if (typeMatches.length === 0) return invalidProduct('UNKNOWN_TYPE_CODE')
  if (typeMatches.length > 1) {
    return invalidProduct('AMBIGUOUS_TYPE_CODE', typeMatches.map((match) => match.eventType.code))
  }
  const typeMatch = typeMatches[0]
  if (typeMatch === undefined) return invalidProduct('UNKNOWN_TYPE_CODE')

  const productKey = normalizeProductName(productNameText)
  const productMatches = config.products.filter(
    (product: ProductConfigRow) => normalizeProductName(product.name) === productKey,
  )
  if (productMatches.length === 0) return invalidProduct('UNKNOWN_PRODUCT_NAME')
  if (productMatches.length > 1) {
    return invalidProduct('AMBIGUOUS_PRODUCT_NAME', productMatches.map((product) => product.code))
  }
  const product = productMatches[0]
  if (product === undefined) return invalidProduct('UNKNOWN_PRODUCT_NAME')

  const sessionMatch = resolveSession(sessionText, config)
  if (!sessionMatch.ok) return sessionMatch.result

  return {
    product_parse_status: 'valid',
    product_code: product.code,
    product_name: product.name,
    advertiser_code: advertiser.code,
    advertiser_name: advertiser.name,
    event_type: EVENT_TYPE_NAME_BY_KIND[typeMatch.eventType.kind],
    event_type_code: typeMatch.eventType.code,
    event_kind: typeMatch.eventType.kind,
    batch: normalizeBatch(typeMatch.batchRaw),
    session: sessionMatch.session.code,
    city,
    failure_reason: null,
    candidates: [],
  }
}

export function parseProductRaw(
  productRaw: string | null | undefined,
  config: ProductConfigSet,
): ProductParseResult {
  const raw = typeof productRaw === 'string' ? productRaw : ''
  if (raw.trim().length === 0) return invalidProduct('EMPTY_PRODUCT_RAW')

  // Sengaja TIDAK trim seluruh string sebelum split. 01 §10 meminta trim "di sekitar
  // segmen", dan memangkas tepi lebih dulu akan menghapus spasi milik pemisah
  // sehingga `KM01SO392 - S1 - ` terbaca sebagai 2 segmen, bukan 3 segmen dengan
  // segmen kota kosong. Akibatnya alasan kegagalan yang tercatat jadi kurang tepat.
  const segments = raw.split(PRODUCT_SEGMENT_SEPARATOR)
  if (segments.length === 5) return parseDetailedProduct(segments, config)

  let codeBlockRaw: string | undefined
  let sessionRaw: string | undefined
  let cityRaw: string | undefined

  if (segments.length === 3) {
    codeBlockRaw = segments[0]
    sessionRaw = segments[1]
    cityRaw = segments[2]
  } else if (segments.length > 3) {
    return invalidProduct('WRONG_SEGMENT_COUNT')
  } else {
    // segments.length < 3: toleransi untuk penulisan tanpa spasi seperti MTI01SO58-S1-Solo
    const match = raw.match(/^\s*([A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)\s*-\s*(.+?)\s*$/)
    if (match && match[1] && match[2] && match[3]) {
      if (match[3].includes(PRODUCT_SEGMENT_SEPARATOR)) {
        return invalidProduct('WRONG_SEGMENT_COUNT')
      }
      codeBlockRaw = match[1]
      sessionRaw = match[2]
      cityRaw = match[3]
    } else {
      return invalidProduct('WRONG_SEGMENT_COUNT')
    }
  }

  if (codeBlockRaw === undefined || sessionRaw === undefined || cityRaw === undefined) {
    return invalidProduct('WRONG_SEGMENT_COUNT')
  }

  const codeBlock = codeBlockRaw.trim()
  const sessionText = sessionRaw.trim()
  const city = cityRaw.trim()
  if (codeBlock.length === 0 || sessionText.length === 0 || city.length === 0) {
    return invalidProduct('EMPTY_SEGMENT')
  }

  const blockKey = normalizeCode(codeBlock)
  // Slice batch memakai indeks dari codeBlock asli, jadi panjangnya harus sama.
  // Bisa berbeda pada karakter Unicode tertentu (mis. "ß" -> "SS"), dan dalam
  // kasus itu indeks tidak lagi dapat dipercaya.
  if (blockKey.length !== codeBlock.length) return invalidProduct('INVALID_CODE_BLOCK')

  const sessionKey = normalizeCode(sessionText)
  const sessionMatches = config.sessions.filter(
    (session: SessionConfigRow) => normalizeCode(session.code) === sessionKey,
  )
  if (sessionMatches.length === 0) return invalidProduct('UNKNOWN_SESSION')
  if (sessionMatches.length > 1) {
    return invalidProduct(
      'AMBIGUOUS_SESSION',
      sessionMatches.map((session) => session.code),
    )
  }
  const session = sessionMatches[0]
  if (session === undefined) return invalidProduct('UNKNOWN_SESSION')

  const combinations = listCodeCombinations(codeBlock, config)
  if (combinations.length === 0) return invalidProduct('UNKNOWN_CODE_COMBINATION')
  if (combinations.length > 1) {
    return invalidProduct('AMBIGUOUS_CODE_COMBINATION', combinations.map(describeCodeCombination))
  }
  const combination = combinations[0]
  if (combination === undefined) return invalidProduct('UNKNOWN_CODE_COMBINATION')

  // Batch = sisa SESUDAH awalan berlebar tetap (produk + pengiklan + tipe). Normalisasi nol di depan
  // (A33) hanya menyentuh sisa ini, jadi kode pengiklan seperti `01` tidak pernah berubah.
  const batchRaw = codeBlock.slice(combination.prefix.length)
  if (batchRaw.length === 0) return invalidProduct('UNKNOWN_CODE_COMBINATION')
  const batch = normalizeBatch(batchRaw)

  return {
    product_parse_status: 'valid',
    product_code: combination.product.code,
    product_name: combination.product.name,
    advertiser_code: combination.advertiser.code,
    advertiser_name: combination.advertiser.name,
    event_type: EVENT_TYPE_NAME_BY_KIND[combination.eventType.kind],
    event_type_code: combination.eventType.code,
    event_kind: combination.eventType.kind,
    batch,
    session: session.code,
    city,
    failure_reason: null,
    candidates: [],
  }
}
