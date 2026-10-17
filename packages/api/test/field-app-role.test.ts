import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeUser, loginAndGetToken, makeRequest } from './helpers'

/** A30: izin Tampilan Apps Lapangan hanya untuk pimpro/staff/member. */
describe('izin ui.field_app', () => {
  it.each([['admin', 400], ['manajer', 400], ['staff', 200], ['member', 200], ['pimpro', 200]])('role %s -> %i', async (role, status) => {
    const state = createFakeState({ users: [fakeUser({ role: 'developer' })] })
    const { api } = await createTestApi(state)
    const { accessToken } = await loginAndGetToken(api, 'admin1')
    const response = await api(makeRequest({ method: 'PUT', path: `/api/roles/${role}/permissions`, headers: { authorization: `Bearer ${accessToken}` },
      body: { permissions: ['operasional.scan_qr', 'ui.field_app'] } }))
    expect(response.status).toBe(status)
  })
})
