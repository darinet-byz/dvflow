import { describe, expect, it } from 'vitest'
import {
  createFakeState,
  createTestApi,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
} from './helpers'

describe('Fitur 2.0: Roles & Permissions API', () => {
  it('GET /api/roles mengembalikan daftar role untuk master admin dan menolak non-master admin', async () => {
    const state = createFakeState({
      users: [
        fakeUser({ id: 'user-dev', username: 'dev', role: 'developer' }),
        fakeUser({ id: 'user-staff', username: 'staff1', role: 'staff' }),
      ],
    })
    const { api } = await createTestApi(state)

    // Master admin (developer)
    const { accessToken: tokenDev } = await loginAndGetToken(api, 'dev')

    const resDev = await api(
      makeRequest({
        method: 'GET',
        path: '/api/roles',
        headers: { authorization: `Bearer ${tokenDev}` },
      }),
    )
    expect(resDev.status).toBe(200)
    const bodyDev = await readBody<{ ok: true; data: { roles: Array<{ id: string; name: string; is_system: boolean }> } }>(resDev)
    expect(bodyDev.ok).toBe(true)
    expect(bodyDev.data.roles.length).toBeGreaterThanOrEqual(6)
    expect(bodyDev.data.roles.some((r) => r.id === 'developer')).toBe(true)
    expect(bodyDev.data.roles.some((r) => r.id === 'pimpro')).toBe(true)

    // Non master admin (staff)
    const { accessToken: tokenStaff } = await loginAndGetToken(api, 'staff1')

    const resStaff = await api(
      makeRequest({
        method: 'GET',
        path: '/api/roles',
        headers: { authorization: `Bearer ${tokenStaff}` },
      }),
    )
    expect(resStaff.status).toBe(403)
  })

  it('CRUD role kustom: create, get, update permissions, delete', async () => {
    const state = createFakeState({
      users: [fakeUser({ id: 'user-owner', username: 'owner', role: 'owner' })],
    })
    const { api } = await createTestApi(state)
    const { accessToken: token } = await loginAndGetToken(api, 'owner')
    const headers = { authorization: `Bearer ${token}` }

    // 1. Create Role
    const createRes = await api(
      makeRequest({
        method: 'POST',
        path: '/api/roles',
        headers,
        body: {
          id: 'koordinator_gate',
          name: 'Koordinator Gate',
          description: 'Penjaga gate presensi',
          permissions: ['operasional.scan_qr', 'operasional.presensi'],
        },
      }),
    )
    expect(createRes.status).toBe(201)
    const createBody = await readBody<{ ok: true; data: { id: string; permission_count: number } }>(createRes)
    expect(createBody.data.id).toBe('koordinator_gate')
    expect(createBody.data.permission_count).toBe(2)

    // 2. Get Role
    const getRes = await api(makeRequest({ method: 'GET', path: '/api/roles/koordinator_gate', headers }))
    expect(getRes.status).toBe(200)
    const getBody = await readBody<{ ok: true; data: { id: string; permissions: string[] } }>(getRes)
    expect(getBody.data.permissions).toEqual(['operasional.scan_qr', 'operasional.presensi'])

    // 3. Update Permissions
    const updateRes = await api(
      makeRequest({
        method: 'PUT',
        path: '/api/roles/koordinator_gate/permissions',
        headers,
        body: {
          permissions: ['operasional.scan_qr', 'operasional.presensi', 'action.manual_checkin'],
        },
      }),
    )
    expect(updateRes.status).toBe(200)
    const updateBody = await readBody<{ ok: true; data: { permission_count: number } }>(updateRes)
    expect(updateBody.data.permission_count).toBe(3)

    // 4. Delete Role
    const delRes = await api(makeRequest({ method: 'DELETE', path: '/api/roles/koordinator_gate', headers }))
    expect(delRes.status).toBe(200)
    const delBody = await readBody<{ ok: true; data: { success: boolean; deleted_id: string } }>(delRes)
    expect(delBody.data.deleted_id).toBe('koordinator_gate')
  })

  it('DELETE /api/roles/:id menolak menghapus role sistem', async () => {
    const state = createFakeState({
      users: [fakeUser({ id: 'user-dev', username: 'dev', role: 'developer' })],
    })
    const { api } = await createTestApi(state)
    const { accessToken: token } = await loginAndGetToken(api, 'dev')

    const delRes = await api(
      makeRequest({
        method: 'DELETE',
        path: '/api/roles/admin',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(delRes.status).toBe(403)
  })

  it('GET /api/permissions mengembalikan kelompok modul', async () => {
    const state = createFakeState({
      users: [fakeUser({ id: 'user-admin', username: 'admin1', role: 'admin' })],
    })
    const { api } = await createTestApi(state)
    const { accessToken: token } = await loginAndGetToken(api, 'admin1')

    const res = await api(
      makeRequest({
        method: 'GET',
        path: '/api/permissions',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = await readBody<{ ok: true; data: { modules: Array<{ module: string; permissions: Array<{ key: string }> }> } }>(res)
    expect(body.data.modules.length).toBeGreaterThan(0)
    const operasionalMod = body.data.modules.find((m) => m.module === 'operasional')
    expect(operasionalMod).toBeDefined()
    expect(operasionalMod?.permissions.some((p) => p.key === 'operasional.scan_qr')).toBe(true)
  })

  it('Validasi produk saat check-in: operator dibatasi produk ditolak jika tiket produk lain', async () => {
    const state = createFakeState({
      users: [
        fakeUser({
          id: 'user-pimpro',
          username: 'pimpro1',
          role: 'pimpro',
          active: true,
          has_all_product_access: false,
        }),
      ],
      userProductAccess: [
        { user_id: 'user-pimpro', product_code: 'KM' },
      ],
      orders: [
        {
          order_id: 'ORD-KM-12345',
          name: 'Peserta KM',
          app_status: 'Paid',
          product_code: 'KM',
          product_name: 'Kuliner Masteri',
          event_type: 'Seminar Offline',
        },
        {
          order_id: 'ORD-MT-99999',
          name: 'Peserta MT',
          app_status: 'Paid',
          product_code: 'MT',
          product_name: 'Media Training',
          event_type: 'Seminar Offline',
        },
      ],
    })
    const { api } = await createTestApi(state)
    const { accessToken: token } = await loginAndGetToken(api, 'pimpro1')
    const headers = { authorization: `Bearer ${token}` }

    // Checkin tiket produk yang diizinkan (KM) -> lolos validasi produk
    const checkinKm = await api(
      makeRequest({
        method: 'POST',
        path: '/checkin/ORD-KM-12345',
        headers,
      }),
    )
    expect(checkinKm.status).toBe(200)

    // Checkin tiket produk lain (MT) -> ditolak 403 FORBIDDEN
    const checkinMt = await api(
      makeRequest({
        method: 'POST',
        path: '/checkin/ORD-MT-99999',
        headers,
      }),
    )
    expect(checkinMt.status).toBe(403)
    const errBody = await readBody<{ ok: false; error: { code: string; message: string } }>(checkinMt)
    expect(errBody.error.code).toBe('FORBIDDEN')
  })
})
