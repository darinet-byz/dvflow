/**
 * Product scope global di UI (A97/A98).
 *
 * Produk dipilih di layar penuh sebelum shell dibuka, lalu dipakai seluruh
 * halaman data. Pilihan disimpan per user di `localStorage` selama 24 jam;
 * setelah itu pengguna harus memilih lagi. Logout menghapus pilihan.
 *
 * Ini BUKAN batas keamanan: RLS/RPC tetap menolak produk di luar akses user.
 * Nilai di localStorage hanya menentukan filter tampilan.
 */

export const PRODUCT_SCOPE_TTL_MS = 24 * 60 * 60 * 1000

/** Toleransi clock skew kecil agar timestamp "sedikit di masa depan" tidak langsung dibuang. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

export const PRODUCT_SCOPE_STORAGE_PREFIX = 'dvflow.productScope'

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

/**
 * Baca pilihan tersimpan. Kunci yang rusak atau sudah lewat 24 jam langsung
 * dihapus; `null` berarti layar pilih produk harus muncul.
 */
export function readStoredProductScope(userId?: string | null): StoredProductScope | null {
  const store = storage()
  if (store === null) return null

  const key = productScopeStorageKey(userId)
  try {
    const raw = store.getItem(key)
    if (raw === null) return null

    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      store.removeItem(key)
      return null
    }

    const value = parsed as { code?: unknown; chosenAt?: unknown }
    if (typeof value.code !== 'string' || typeof value.chosenAt !== 'number' || !isValidTimestamp(value.chosenAt, Date.now())) {
      store.removeItem(key)
      return null
    }

    if (Date.now() - value.chosenAt >= PRODUCT_SCOPE_TTL_MS) {
      store.removeItem(key)
      return null
    }

    return { code: value.code, chosenAt: value.chosenAt }
  } catch {
    try {
      store.removeItem(key)
    } catch {
      // Penyimpanan diblokir: tidak ada yang bisa dibersihkan.
    }
    return null
  }
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

/** Hapus pilihan satu user; layar pilih produk akan muncul lagi. */
export function clearStoredProductScope(userId?: string | null): void {
  const store = storage()
  if (store === null) return
  try {
    store.removeItem(productScopeStorageKey(userId))
  } catch {
    // Penyimpanan diblokir: tidak ada yang perlu dibersihkan.
  }
}

/**
 * Hapus pilihan semua user; dipakai saat logout agar perangkat tidak mewarisi
 * pilihan dan login berikutnya selalu membuka layar pilih produk.
 */
export function clearAllStoredProductScopes(): void {
  const store = storage()
  if (store === null) return

  try {
    const keys: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key !== null && key.startsWith(PRODUCT_SCOPE_STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch {
    // Penyimpanan diblokir: tidak ada yang perlu dibersihkan.
  }
}

export function productScopeExpiresAt(scope: StoredProductScope): number {
  return scope.chosenAt + PRODUCT_SCOPE_TTL_MS
}
