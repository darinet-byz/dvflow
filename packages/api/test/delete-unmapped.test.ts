import { describe, expect, it, vi } from 'vitest'
import { deleteUnmappedOrders } from '../src/aliases/handlers'
import type { RouteContext } from '../src/router'
import type { Db } from '../src/db/types'

/** A40: hapus massal Order Unmapped — butuh izin halaman + hapus + akses semua produk. */
function makeContext(user: Record<string, unknown>, permissions: string[], body: unknown) {
  const rpc = vi.fn().mockResolvedValue({ deleted_count: 2, skipped_count: 0 })
  const db = {
    selectRows: vi.fn(async (table: string) => {
      if (table === 'users') return [user]
      if (table === 'app_role_permissions') return permissions.map((permission_key) => ({ permission_key }))
      return []
    }),
    rpc,
  } as unknown as Db
  const context = {
    db,
    claims: { sub: String(user['id']) },
    url: new URL('https://dvflow.test/api/orders/unmapped/delete'),
    params: {},
    now: new Date(),
    request: new Request('https://dvflow.test/api/orders/unmapped/delete', { method: 'POST', body: JSON.stringify(body) }),
  } as unknown as RouteContext
  return { context, rpc }
}

const manajer = { id: 'm-1', role: 'manajer', active: true, has_all_product_access: true }
const both = ['operasional.order_unmapped', 'action.delete_master']

describe('deleteUnmappedOrders (A40)', () => {
  it('memanggil RPC delete_unmapped_orders dengan aktor dan daftar order', async () => {
    const { context, rpc } = makeContext(manajer, both, { orderIds: ['SOLO-1', 'SOLO-2'] })
    const res = await deleteUnmappedOrders(context)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ deleted_count: 2, skipped_count: 0 })
    expect(rpc).toHaveBeenCalledWith('delete_unmapped_orders', { p_actor_id: 'm-1', p_order_ids: ['SOLO-1', 'SOLO-2'] })
  })

  it('daftar kosong atau lebih dari 1000 ditolak', async () => {
    for (const orderIds of [[], Array.from({ length: 1001 }, (_, i) => `X-${i}`)]) {
      const { context, rpc } = makeContext(manajer, both, { orderIds })
      await expect(deleteUnmappedOrders(context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('tanpa izin hapus ditolak', async () => {
    const { context, rpc } = makeContext(manajer, ['operasional.order_unmapped'], { orderIds: ['SOLO-1'] })
    await expect(deleteUnmappedOrders(context)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('tanpa akses semua produk ditolak', async () => {
    const { context, rpc } = makeContext({ ...manajer, has_all_product_access: false }, both, { orderIds: ['SOLO-1'] })
    await expect(deleteUnmappedOrders(context)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
