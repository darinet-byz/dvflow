/**
 * Penyusun filter PostgREST.
 *
 * PostgREST punya bahasa filter (`or=(a.ilike.*x*,b.ilike.*x*)`). Teks pengguna
 * tidak boleh masuk ke sana apa adanya: karakter struktural akan mengubah arti
 * filter — kelas masalah yang sama dengan injeksi SQL, tetapi pada lapisan
 * PostgREST (L06).
 *
 * Solusinya dua lapis:
 *   1. `sanitizeSearchTerm` membuang karakter yang bermakna khusus bagi bahasa
 *      itu, sehingga yang tersisa selalu diperlakukan sebagai teks biasa;
 *   2. seluruh nilai tetap di-URL-encode oleh `buildQuery` di `db/postgrest.ts`.
 *
 * Yang dibuang sengaja hanya karakter yang tidak pernah diperlukan untuk
 * mencari Order ID, nama, nomor WA, atau kode konfigurasi.
 */

/** Karakter yang bermakna khusus di dalam ekspresi filter PostgREST. */
const RESERVED_CHARACTERS = /[,()"'\\*%:]/g

export function sanitizeSearchTerm(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(RESERVED_CHARACTERS, '').trim()
  return cleaned === '' ? null : cleaned
}

/**
 * Filter `or` untuk pencarian teks pada beberapa kolom sekaligus.
 *
 * Mengembalikan `null` bila tidak ada kolom yang dicari atau istilahnya kosong
 * setelah dibersihkan — pemanggil memperlakukannya sebagai "tanpa filter",
 * bukan sebagai filter yang cocok dengan segalanya.
 */
export function buildIlikeOrFilter(columns: readonly string[], term: string): string {
  const pattern = `*${term}*`
  return `(${columns.map((column) => `${column}.ilike.${pattern}`).join(',')})`
}

/** Apakah sebuah nilai berbentuk UUID (untuk path parameter `:id`). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
