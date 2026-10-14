import { describe, expect, it, vi } from 'vitest'
import { getDataSummary, resetData, purgeExpiredUnmapped } from '../src/developer/handlers'
import { listUnmappedOrders } from '../src/aliases/handlers'
import type { RouteContext } from '../src/router'
import type { Db } from '../src/db/types'

describe('Developer Reset Data & 90-Day Unmapped Retention', () => {
  it('menolak akses developer tools bila role bukan developer', async () => {
    const user = { id: 'admin-1', role: 'admin', active: true }
    const db = {
      selectRows: vi.fn(async (table: string) => (table === 'users' ? [user] : [])),
      rpc: vi.fn(),
    } as unknown as Db

    const context = {
      db,
      claims: { sub: 'admin-1', app_role: 'admin' },
      url: new URL('https://dvflow.test/api/developer/data-summary'),
      now: new Date(),
    } as unknown as RouteContext

    await expect(getDataSummary(context)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    const resetContext = {
      db,
      claims: { sub: 'admin-1', app_role: 'admin' },
      request: new Request('https://dvflow.test/api/developer/reset-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopes: ['orders_all'], confirmationText: 'Ya, Aku yakin', password: 'pass' }),
      }),
      now: new Date(),
    } as unknown as RouteContext

    await expect(resetData(resetContext)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('mengembalikan ringkasan data jika role adalah developer', async () => {
    const devUser = { id: 'dev-1', role: 'developer', active: true }
    const db = {
      selectRows: vi.fn(async (table: string) => {
        if (table === 'users') return [devUser]
        if (table === 'orders') return [{ id: '1' }, { id: '2' }]
        if (table === 'webhook_logs') return [{ id: 'l1' }]
        return []
      }),
    } as unknown as Db

    const context = {
      db,
      claims: { sub: 'dev-1', app_role: 'developer' },
      url: new URL('https://dvflow.test/api/developer/data-summary'),
      now: new Date(),
    } as unknown as RouteContext

    const res = await getDataSummary(context)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: Record<string, number> }
    expect(body.ok).toBe(true)
    expect(body.data.orders_count).toBe(2)
    expect(body.data.webhook_logs_count).toBe(1)
  })

  it('validasi 2x verifikasi pada reset data: teks konfirmasi dan password developer', async () => {
    const devUser = { id: 'dev-1', role: 'developer', active: true }
    const rpcMock = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'verify_developer_password') {
        return args['p_password'] === 'rahasiaDev123'
      }
      if (name === 'developer_reset_data') {
        return { success: true, deleted: { orders: 5 } }
      }
      return null
    })

    const db = {
      selectRows: vi.fn(async () => [devUser]),
      rpc: rpcMock,
    } as unknown as Db

    // 1. Teks konfirmasi salah -> ditolak
    const invalidTextCtx = {
      db,
      claims: { sub: 'dev-1', app_role: 'developer' },
      request: new Request('https://dvflow.test/api/developer/reset-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopes: ['orders_all'], confirmationText: 'ya yakin', password: 'rahasiaDev123' }),
      }),
      now: new Date(),
    } as unknown as RouteContext

    await expect(resetData(invalidTextCtx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })

    // 2. Password developer salah -> ditolak
    const wrongPassCtx = {
      db,
      claims: { sub: 'dev-1', app_role: 'developer' },
      request: new Request('https://dvflow.test/api/developer/reset-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopes: ['orders_all'], confirmationText: 'Ya, Aku yakin', password: 'passwordsalah' }),
      }),
      now: new Date(),
    } as unknown as RouteContext

    await expect(resetData(wrongPassCtx)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })

    // 3. Teks persis "Ya, Aku yakin" dan password benar -> sukses eksekusi reset
    const validCtx = {
      db,
      claims: { sub: 'dev-1', app_role: 'developer' },
      request: new Request('https://dvflow.test/api/developer/reset-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopes: ['orders_all'], confirmationText: 'Ya, Aku yakin', password: 'rahasiaDev123' }),
      }),
      now: new Date(),
    } as unknown as RouteContext

    const validRes = await resetData(validCtx)
    expect(validRes.status).toBe(200)
    const validBody = await validRes.json() as { ok: boolean; data: { success: boolean; deleted: Record<string, number> } }
    expect(validBody.ok).toBe(true)
    expect(validBody.data.deleted.orders).toBe(5)
  })

  it('memfilter order unmapped dengan batas retensi 90 hari evergreen', async () => {
    const adminUser = { id: 'admin-1', role: 'developer', active: true }
    const now = new Date('2026-10-14T10:00:00Z')
    let capturedQuery: Record<string, string> = {}

    const db = {
      selectRows: vi.fn(async (table: string, query: Record<string, string>) => {
        if (table === 'users') return [adminUser]
        if (table === 'orders') {
          capturedQuery = query
          return []
        }
        return []
      }),
    } as unknown as Db

    const context = {
      db,
      claims: { sub: 'admin-1', app_role: 'admin' },
      url: new URL('https://dvflow.test/api/orders/unmapped'),
      now,
    } as unknown as RouteContext

    const res = await listUnmappedOrders(context)
    expect(res.status).toBe(200)
    expect(capturedQuery.product_parse_status).toBe('eq.invalid')
    // Memastikan terdapat filter gte pada created_at
    expect(capturedQuery.created_at).toMatch(/^gte\.2026-07-16/)
  })

  it('mengeksekusi purgeExpiredUnmapped jika role adalah developer', async () => {
    const devUser = { id: 'dev-1', role: 'developer', active: true }
    const rpcMock = vi.fn(async () => ({ deleted_orders: 12 }))
    const db = {
      selectRows: vi.fn(async () => [devUser]),
      rpc: rpcMock,
    } as unknown as Db

    const context = {
      db,
      claims: { sub: 'dev-1', app_role: 'developer' },
      url: new URL('https://dvflow.test/api/developer/purge-unmapped'),
      now: new Date(),
    } as unknown as RouteContext

    const res = await purgeExpiredUnmapped(context)
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('purge_expired_unmapped_orders', { p_retention_days: 90 })
  })
})

