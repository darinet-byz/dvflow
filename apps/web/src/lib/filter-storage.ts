import type { CommonFilters } from './filters'

/**
 * Penyimpanan filter antarhalaman selama tab masih terbuka.
 *
 * `sessionStorage` dipilih, bukan `localStorage`: filter adalah keadaan kerja
 * sementara satu sesi tab, dan tidak boleh diwarisi tab/user lain di perangkat
 * yang sama. Saat tab ditutup, filter kembali ke default Hari Ini.
 */
const FILTER_STORAGE_PREFIX = 'dvflow.filters.'

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // Mode privat / kebijakan browser dapat melempar saat properti diakses.
    return null
  }
}

/**
 * Baca filter tersimpan. Hanya kunci yang dikenal yang dipakai, dan nilainya
 * harus string; bentuk lama/rusak diabaikan tanpa mengganggu halaman.
 */
export function readPersistedFilters<T extends CommonFilters>(key: string, fallback: T): T {
  const store = storage()
  if (store === null) return fallback

  try {
    const raw = store.getItem(`${FILTER_STORAGE_PREFIX}${key}`)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback

    const saved = parsed as Record<string, unknown>
    const merged = { ...fallback }
    for (const field of Object.keys(fallback) as Array<keyof T>) {
      const value = saved[field as string]
      if (typeof value === 'string') merged[field] = value as T[keyof T]
    }
    if (!['', 'ots', 'orderonline'].includes(merged.source)) merged.source = fallback.source
    return merged
  } catch {
    return fallback
  }
}

export function persistFilters<T extends CommonFilters>(key: string, filters: T): void {
  const store = storage()
  if (store === null) return
  try {
    store.setItem(`${FILTER_STORAGE_PREFIX}${key}`, JSON.stringify(filters))
  } catch {
    // Kuota penuh / penyimpanan diblokir: filter tetap bekerja di memori.
  }
}

/** Hapus filter semua halaman; dipakai saat logout agar tab tidak mewarisi keadaan user sebelumnya. */
export function clearPersistedFilters(): void {
  const store = storage()
  if (store === null) return
  try {
    const keys: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key !== null && key.startsWith(FILTER_STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch {
    // Penyimpanan diblokir: tidak ada yang perlu dibersihkan.
  }
}
