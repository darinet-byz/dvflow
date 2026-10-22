import { describe, expect, it } from 'vitest'
import { createFakeState, createTestApi, fakeUser, loginAndGetToken, makeRequest } from './helpers'

/** A30/A36: izin Tampilan Apps Lapangan hanya untuk pimpro/member. */
describe('izin ui.field_app', () => {
  it.each([['admin', 400], ['manajer', 400], ['member', 200], ['pimpro', 200]])('role %s -> %i', async (role, status) => {
    const state = createFakeState({ users: [fakeUser({ role: 'developer' })] })
    const { api } = await createTestApi(state)
    const { accessToken } = await loginAndGetToken(api, 'admin1')
    const response = await api(makeRequest({ method: 'PUT', path: `/api/roles/${role}/permissions`, headers: { authorization: `Bearer ${accessToken}` },
      body: { permissions: ['operasional.scan_qr', 'ui.field_app'] } }))
    expect(response.status).toBe(status)
  })
})

describe('profil role master', () => {
  it('developer tidak membawa ui.field_app walau punya semua izin', async () => {
    const state = createFakeState({ users: [fakeUser({ role: 'developer' })] })
    const { api } = await createTestApi(state)
    const { accessToken } = await loginAndGetToken(api, 'admin1')
    const body = (await (await api(makeRequest({ method: 'GET', path: '/api/profile', headers: { authorization: `Bearer ${accessToken}` } }))).json()) as { data: { profile: { permissions: string[] } } }
    expect(body.data.profile.permissions).toContain('operasional.scan_qr')
    expect(body.data.profile.permissions).not.toContain('ui.field_app')
  })
})

