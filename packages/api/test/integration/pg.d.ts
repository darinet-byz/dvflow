/**
 * Deklarasi tipe minimal untuk `pg`.
 *
 * `pg` sudah ada di devDependencies root (dipakai `scripts/create-master-admin.mjs`),
 * tetapi tidak membawa tipe. Test integrasi hanya memerlukan sebagian kecil
 * permukaannya, jadi deklarasi ini sengaja sempit — lebih baik daripada menarik
 * `@types/pg` yang akan bentrok dengan `lib: ["WebWorker"]` di paket ini.
 */
declare module 'pg' {
  export type QueryResult<T> = { rows: T[] }

  export class Client {
    constructor(config?: { connectionString?: string; ssl?: { rejectUnauthorized: boolean } })
    connect(): Promise<void>
    query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>>
    end(): Promise<void>
  }

  const pg: { Client: typeof Client }
  export default pg
}
