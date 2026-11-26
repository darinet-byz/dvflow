/**
 * Cache singkat konfigurasi (A100).
 *
 * Modul ini sengaja tidak mengimpor apa pun supaya `session.ts` dapat
 * membersihkan cache saat user berganti tanpa membuat siklus
 * `session -> queries -> supabase-rest -> session`.
 */
export const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000

export type TimedCache<T> = { at: number; value: T }

type CacheController<T> = {
  read: () => TimedCache<T> | null
  write: (value: T) => void
  readInFlight: () => Promise<T> | null
  writeInFlight: (promise: Promise<T> | null) => void
  nextVersion: () => number
  currentVersion: () => number
}

const invalidators = new Set<() => void>()

export function createConfigCache<T>(): CacheController<T> {
  let cache: TimedCache<T> | null = null
  let inFlight: Promise<T> | null = null
  let version = 0

  invalidators.add(() => {
    cache = null
    inFlight = null
    version += 1
  })

  return {
    read: () => cache,
    write: (value) => {
      cache = { at: Date.now(), value }
    },
    readInFlight: () => inFlight,
    writeInFlight: (promise) => {
      inFlight = promise
    },
    nextVersion: () => {
      version += 1
      return version
    },
    currentVersion: () => version,
  }
}

export function cacheIsFresh<T>(cache: TimedCache<T> | null): cache is TimedCache<T> {
  return cache !== null && Date.now() - cache.at < CONFIG_CACHE_TTL_MS
}

/** Dipanggil setelah konfigurasi berubah atau saat sesi/user berganti. */
export function invalidateConfigCaches(): void {
  for (const invalidate of invalidators) invalidate()
}
