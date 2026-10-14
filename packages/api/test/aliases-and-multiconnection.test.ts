import { describe, expect, it, vi } from 'vitest'
import { createApiWithEnv, createFakeState, createTestEnv, fakeOrder, makeRequest } from './helpers'
import { saveConnection } from '../src/integrations/handlers'
import { resolveProductAlias } from '../src/webhooks/handlers'
import { listAliases, saveAlias, deleteAlias, batchRemapOrders } from '../src/aliases/handlers'
import type { RouteContext } from '../src/router'
import type { Db } from '../src/db/types'

describe('Multi-Webhook & Alias Produk (Masa Transisi)', () => {
  it('mendukung pencarian tiket peserta via rute seirama /access/:kodeToko/:orderId', async () => {
    const state = createFakeState({
      orders: [
        fakeOrder({
          order_id: 'SOLO-2819381',
          name: 'Ahmad Fauzi',
          product_code: 'KM',
          product_name: 'Kuliner Masteri',
          advertiser_name: 'Zul',
          event_type: 'Seminar Offline',
          app_status: 'Paid',
          product_parse_status: 'valid',
        }),
      ],
    })
    const env = await createTestEnv()
    const api = createApiWithEnv(env, state)

    const response = await api(makeRequest({
      method: 'GET',
      path: '/access/SOLO/2819381',
      origin: null,
    }))

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Ahmad Fauzi')
    expect(html).toContain('SOLO-2819381')
  })

  it('validasi kode toko maks. 4 karakter alfanumerik kapital pada integrasi', async () => {
    const rows: Record<string, unknown>[] = []
    const user = { id: 'admin-1', role: 'admin', active: true }
    const db = {
      selectRows: vi.fn(async (table: string, _query: Record<string, string>) => table === 'users' ? [user] : rows),
      insertRow: vi.fn(async (_: string, row: Record<string, unknown>) => { const val = { id: crypto.randomUUID(), ...row }; rows.push(val); return val }),
      updateRows: vi.fn(),
      deleteRows: vi.fn(),
      rpc: vi.fn(),
    } as unknown as Db

    const context = {
      db,
      env: { INTEGRATION_ENCRYPTION_KEY: btoa('x'.repeat(32)) },
      claims: { sub: 'admin-1' },
      url: new URL('https://dvflow.test'),
      params: {},
      now: new Date(),
    } as unknown as RouteContext

    // 1. Sukses dengan slug 4 karakter (misal SOLO)
    context.request = new Request('https://dvflow.test', {
      method: 'POST',
      body: JSON.stringify({ name: 'Toko Solo', slug: 'SOLO', active: true }),
    })
    const res1 = await saveConnection(context)
    expect(res1.status).toBe(201)
    expect(rows[0]!.slug).toBe('SOLO')

    // 2. Gagal jika slug lebih dari 4 karakter (misal JAKARTA)
    context.request = new Request('https://dvflow.test', {
      method: 'POST',
      body: JSON.stringify({ name: 'Toko Jkt', slug: 'JAKARTA', active: true }),
    })
    await expect(saveConnection(context)).rejects.toThrow()
  })

  it('resolveProductAlias mencocokkan nama mentah OrderOnline ke target kanonik DVFLOW', async () => {
    const aliases = [
      {
        id: 'alias-1',
        alias_name: 'Workshop Kuliner Solo VIP',
        alias_name_normalized: 'workshop kuliner solo vip',
        canonical_target: 'KM01SO392 - S1 - Solo',
      },
    ]

    const db = {
      selectRows: vi.fn(async (table: string, query: Record<string, string>) => {
        if (table === 'product_aliases') {
          return aliases.filter((a) => query.alias_name_normalized === `eq.${a.alias_name_normalized}`)
        }
        return []
      }),
    } as unknown as Db

    const matched = await resolveProductAlias(db, '  Workshop Kuliner Solo VIP  ')
    expect(matched).toBe('KM01SO392 - S1 - Solo')

    const notFound = await resolveProductAlias(db, 'Produk Tak Dikenal')
    expect(notFound).toBeNull()
  })

  it('CRUD Product Aliases berjalan aman dengan otorisasi', async () => {
    const aliasRows: Record<string, unknown>[] = []
    const user = { id: 'admin-1', role: 'admin', active: true }
    const configSets = {
      products: [{ code: 'KM', name: 'Kuliner Masteri', active: true }],
      advertisers: [{ code: '01', name: 'Zul', active: true }],
      eventTypes: [{ code: 'SO', name: 'Seminar Offline', kind: 'seminar', active: true }],
      sessions: [{ code: 'S1', name: 'Sesi 1', active: true }],
    }

    const db = {
      selectRows: vi.fn(async (table: string, query: Record<string, string>) => {
        if (table === 'users') return [user]
        if (table === 'products') return configSets.products
        if (table === 'advertisers') return configSets.advertisers
        if (table === 'event_types') return configSets.eventTypes
        if (table === 'sessions_config') return configSets.sessions
        if (table === 'product_aliases') {
          return aliasRows.filter((row) => !query.alias_name_normalized || `eq.${row.alias_name_normalized}` === query.alias_name_normalized)
        }
        return []
      }),
      insertRow: vi.fn(async (_: string, row: Record<string, unknown>) => {
        const val = { id: crypto.randomUUID(), ...row }
        aliasRows.push(val)
        return val
      }),
      updateRows: vi.fn(),
      deleteRows: vi.fn(async (_: string, query: Record<string, string>) => {
        const idx = aliasRows.findIndex((row) => `eq.${row.id}` === query.id)
        if (idx !== -1) aliasRows.splice(idx, 1)
      }),
    } as unknown as Db

    const context = {
      db,
      claims: { sub: 'admin-1' },
      url: new URL('https://dvflow.test/api/product-aliases'),
      params: {},
      now: new Date(),
    } as unknown as RouteContext

    // 1. Simpan alias baru
    context.request = new Request('https://dvflow.test/api/product-aliases', {
      method: 'POST',
      body: JSON.stringify({
        alias_name: 'Seminar Kuliner Solo Eksklusif',
        canonical_target: 'KM01SO392 - S1 - Solo',
      }),
    })
    const saveRes = await saveAlias(context)
    expect(saveRes.status).toBe(201)
    expect(aliasRows).toHaveLength(1)
    expect(aliasRows[0]!.alias_name).toBe('Seminar Kuliner Solo Eksklusif')

    // 2. Ambil daftar alias
    const listRes = await listAliases(context)
    const listJson = await listRes.json()
    expect(listJson.data.rows).toHaveLength(1)

    // 3. Hapus alias
    const aliasId = String(aliasRows[0]!.id)
    context.params = { id: aliasId }
    const delRes = await deleteAlias(context)
    expect(delRes.status).toBe(200)
    expect(aliasRows).toHaveLength(0)
  })

  it('batchRemapOrders memvalidasi format target dan memanggil RPC batch_remap_orders', async () => {
    const user = { id: 'admin-1', role: 'admin', active: true }
    const configSets = {
      products: [{ code: 'KM', name: 'Kuliner Masteri', active: true }],
      advertisers: [{ code: '01', name: 'Zul', active: true }],
      eventTypes: [{ code: 'SO', name: 'Seminar Offline', kind: 'seminar', active: true }],
      sessions: [{ code: 'S1', name: 'Sesi 1', active: true }],
    }
    const rpcMock = vi.fn().mockResolvedValue({ success: true, updated_count: 5, alias_saved: true })

    const db = {
      selectRows: vi.fn(async (table: string) => {
        if (table === 'users') return [user]
        if (table === 'products') return configSets.products
        if (table === 'advertisers') return configSets.advertisers
        if (table === 'event_types') return configSets.eventTypes
        if (table === 'sessions_config') return configSets.sessions
        return []
      }),
      rpc: rpcMock,
    } as unknown as Db

    const context = {
      db,
      claims: { sub: 'admin-1' },
      url: new URL('https://dvflow.test/api/orders/batch-remap'),
      params: {},
      now: new Date(),
    } as unknown as RouteContext

    context.request = new Request('https://dvflow.test/api/orders/batch-remap', {
      method: 'POST',
      body: JSON.stringify({
        orderIds: ['SOLO-1', 'SOLO-2', 'SOLO-3', 'SOLO-4', 'SOLO-5'],
        canonicalTarget: 'KM01SO392 - S1 - Solo',
        saveAlias: true,
        aliasName: 'Workshop Kuliner Solo VIP',
      }),
    })

    const res = await batchRemapOrders(context)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.updated_count).toBe(5)
    expect(rpcMock).toHaveBeenCalledWith('batch_remap_orders', expect.objectContaining({
      p_canonical_target: 'KM01SO392 - S1 - Solo',
      p_save_alias: true,
      p_alias_name: 'Workshop Kuliner Solo VIP',
    }))
  })
})

