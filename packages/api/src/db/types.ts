/**
 * Port database.
 *
 * Handler hanya berbicara dengan antarmuka ini, tidak dengan PostgREST. Itu
 * yang membuat handler dapat diuji tanpa infrastruktur, dan yang membuat
 * perpindahan Worker/Pages Functions tidak menyentuh logika.
 *
 * Perhatikan: browser TIDAK pernah memakai port ini. Seluruh penulisan lewat
 * backend (STATE.md K11) dan service key hanya ada di sini (04 §5).
 */
export type Db = {
  /** Panggil RPC. Melempar `DbError` bila Postgres menolak. */
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>
  /** SELECT baris. `query` memakai sintaks PostgREST, mis. `{ active: 'is.true' }`. */
  selectRows<T>(table: string, query: Record<string, string>, columns: string): Promise<T[]>
  /** INSERT dan kembalikan baris yang dibuat. */
  insertRow<T>(table: string, row: Record<string, unknown>, columns?: string): Promise<T>
  /** UPDATE baris yang cocok dengan `query`. */
  updateRows(table: string, query: Record<string, string>, patch: Record<string, unknown>): Promise<void>
  /** DELETE baris yang cocok dengan `query`. */
  deleteRows(table: string, query: Record<string, string>): Promise<void>
}

/**
 * Kegagalan dari database.
 *
 * `sqlState` adalah kode SQLSTATE asli; untuk RPC kita, nilainya `DF0xx`
 * (lihat `0017_write_rpcs.sql`). Pesannya tidak pernah diteruskan ke klien.
 */
export class DbError extends Error {
  constructor(
    readonly sqlState: string,
    readonly detail: string,
  ) {
    super(`${sqlState}: ${detail}`)
    this.name = 'DbError'
  }
}
