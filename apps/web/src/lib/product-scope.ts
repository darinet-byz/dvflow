/**
 * Product scope global di UI (A97).
 *
 * Produk dipilih sekali di bar atas dan dipakai seluruh halaman data. Pilihan
 * disimpan per user di `localStorage` selama 24 jam; setelah itu pengguna harus
 * memilih lagi. Logout menghapus pilihan sepenuhnya.
 *
 * Ini BUKAN batas keamanan: RLS/RPC tetap menolak produk di luar akses user.
 * Nilai di localStorage hanya menentukan filter tampilan.
 */

export const PRODUCT_SCOPE_TTL_MS = 24 * 60 * 60 * 1000

/** Toleransi clock skew kecil agar timestamp "sedikit di masa depan" tidak langsung dibuang. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

export const PRODUCT_SCOPE_STORAGE_PREFIX = 'dvflow.productScope'

/** Nilai sentinel untuk select: kode produk tervalidasi huruf/angka, jadi tidak mungkin bentrok. */
export const ALL_PRODUCTS = '__all__'

/** Halaman data yang mengikuti produk terpilih. */
export const PRODUCT_SCOPED_PATHS = new Set([
  '/',
  '/order',
  '/order-refund',
  '/presensi',
  '/kalender',
  '/report-spend',
  '/report-tax',
  '/performa',
])

export function isProductScopedPath(pathname: string): boolean {
  const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return PRODUCT_SCOPED_PATHS.has(normalized)
}

export type StoredProductScope = {
  /** `''` berarti "Semua Produk". */
  code: string
  /** Epoch ms saat produk dipilih/diganti. */
  chosenAt: number
}

/**
 * Hasil baca penyimpanan.
 *
 * `expired` dibedakan dari `none` agar provider tidak mengaktifkan auto-select
 * satu produk setelah pilihan lama kedaluwarsa; pengguna harus memilih lagi.
 */
export type StoredProductScopeState =
  | { status: 'none' }
  | { status: 'expired' }
  | { status: 'valid'; scope: StoredProductScope }

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Mode privat / kebijakan browser dapat melempar saat properti diakses.
    return null
  }
}

export function productScopeStorageKey(userId?: string | null): string {
  return userId === undefined || userId === null || userId === ''
    ? PRODUCT_SCOPE_STORAGE_PREFIX
    : `${PRODUCT_SCOPE_STORAGE_PREFIX}.${userId}`
}

function isValidTimestamp(chosenAt: number, now: number): boolean {
  return Number.isFinite(chosenAt) && chosenAt <= now + FUTURE_TOLERANCE_MS
}

type StoredProductScopeRecord = {
  code?: unknown
  chosenAt?: unknown
  expired?: unknown
}

function writeExpiredMarker(store: Storage, key: string): void {
  try {
    // Marker tanpa kode produk: pilihan lama dihapus, tetapi pengguna tetap
    // diminta memilih lagi (termasuk setelah logout dan untuk user satu produk).
    store.setItem(key, JSON.stringify({ expired: true }))
  } catch {
    // Penyimpanan diblokir: state di memori tetap memaksa gate pada sesi ini.
  }
}

/**
 * Baca pilihan tersimpan.
 *
 * Marker `{ expired: true }` sengaja dipertahankan agar auto-select satu produk
 * tidak aktif lagi setelah expiry/logout. Kode produk lama tidak disimpan.
 */
export function readStoredProductScopeState(userId?: string | null): StoredProductScopeState {
  const store = storage()
  if (store === null) return { status: 'none' }

  const key = productScopeStorageKey(userId)
  try {
    const raw = store.getItem(key)
    if (raw === null) return { status: 'none' }

    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      writeExpiredMarker(store, key)
      return { status: 'expired' }
    }

    const value = parsed as StoredProductScopeRecord
    if (value.expired === true) return { status: 'expired' }

    if (typeof value.code !== 'string' || typeof value.chosenAt !== 'number' || !isValidTimestamp(value.chosenAt, Date.now())) {
      writeExpiredMarker(store, key)
      return { status: 'expired' }
    }

    if (Date.now() - value.chosenAt >= PRODUCT_SCOPE_TTL_MS) {
      writeExpiredMarker(store, key)
      return { status: 'expired' }
    }

    return { status: 'valid', scope: { code: value.code, chosenAt: value.chosenAt } }
  } catch {
    writeExpiredMarker(store, key)
    return { status: 'expired' }
  }
}

export function readStoredProductScope(userId?: string | null): StoredProductScope | null {
  const state = readStoredProductScopeState(userId)
  return state.status === 'valid' ? state.scope : null
}

/**
 * Simpan pilihan dan kembalikan nilai yang benar-benar tersimpan.
 * `chosenAt` boleh diberikan agar state React dan storage memakai waktu yang sama.
 */
export function persistProductScope(
  userId: string | null | undefined,
  code: string,
  chosenAt: number = Date.now(),
): StoredProductScope {
  const value: StoredProductScope = { code, chosenAt }
  const store = storage()
  if (store === null) return value

  try {
    store.setItem(productScopeStorageKey(userId), JSON.stringify(value))
  } catch {
    // Kuota penuh / penyimpanan diblokir: pilihan tetap bekerja di memori.
  }
  return value
}

/** Hapus pilihan satu user sepenuhnya (tanpa marker). */
export function clearStoredProductScope(userId?: string | null): void {
  const store = storage()
  if (store === null) return
  try {
    store.removeItem(productScopeStorageKey(userId))
  } catch {
    // Penyimpanan diblokir: tidak ada yang perlu dibersihkan.
  }
}

/** Tandai pilihan satu user kedaluwarsa; kode produk lama dihapus dari perangkat. */
export function markProductScopeExpired(userId?: string | null): void {
  const store = storage()
  if (store === null) return
  writeExpiredMarker(store, productScopeStorageKey(userId))
}

/**
 * Tandai pilihan semua user kedaluwarsa; dipakai saat logout.
 *
 * Marker tidak memuat kode produk, tetapi tetap memaksa gate pada login
 * berikutnya — termasuk untuk user yang hanya punya satu produk.
 */
export function expireAllStoredProductScopes(): void {
  const store = storage()
  if (store === null) return

  try {
    const keys: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key !== null && key.startsWith(PRODUCT_SCOPE_STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) writeExpiredMarker(store, key)
  } catch {
    // Penyimpanan diblokir: tidak ada yang perlu ditandai.
  }
}

export function productScopeExpiresAt(scope: StoredProductScope): number {
  return scope.chosenAt + PRODUCT_SCOPE_TTL_MS
}
