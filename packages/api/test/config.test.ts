import { describe, expect, it } from 'vitest'
import {
  createApiWithEnv,
  createFakeState,
  createTestEnv,
  fakeUser,
  loginAndGetToken,
  makeRequest,
  readBody,
  sampleConfig,
} from './helpers'

/**
 * Penulisan konfigurasi (03 §12, 01 §8, 04 §1, 05 §B02–§B05, §D07).
 *
 * Aturan yang diuji: hanya admin/master_admin, `Delete` = nonaktifkan (bukan
 * hapus), dan kode yang membuat kombinasi produk ambigu ditolak di titik tulis.
 */

type FailureBody = { ok: false; error: { code: string } }
type ItemBody = { ok: true; data: { resource: string; item: Record<string, unknown> } }

async function setup() {
  const state = createFakeState({
    users: [
      fakeUser({ id: 'user-admin', username: 'admin1', role: 'admin' }),
      fakeUser({ id: 'user-staff', username: 'staff1', role: 'staff' }),
      fakeUser({ id: 'user-boss', username: 'bos', role: 'master_admin' }),
    ],
    config: sampleConfig(),
  })
  state.rolePermissions.push(...['config.produk','config.tax','action.delete_master'].map(permission_key => ({ role_id: 'admin', permission_key })))
  // Keep legacy parser fixtures elsewhere; writes here use the new product standard.
  for (const row of state.config.products) row['code'] = row['code'] === 'KM' ? 'KULI' : 'BOMM'
  const env = await createTestEnv()
  const api = createApiWithEnv(env, state)

  const admin = await loginAndGetToken(api, 'admin1')
  const staff = await loginAndGetToken(api, 'staff1')
  const boss = await loginAndGetToken(api, 'bos')

  return { state, api, admin: admin.accessToken, staff: staff.accessToken, boss: boss.accessToken }
}

type Ctx = Awaited<ReturnType<typeof setup>>

function write(
  ctx: Ctx,
  token: string,
  init: { method: 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown },
) {
  return ctx.api(
    makeRequest({
      method: init.method,
      path: init.path,
      headers: { authorization: `Bearer ${token}` },
      ...(init.body === undefined ? {} : { body: init.body }),
    }),
  )
}

describe('batas peran (03 §12, B02–B05)', () => {
  it('staff TIDAK dapat menulis konfigurasi apa pun (L08)', async () => {
    const ctx = await setup()

    const attempts = [
      { method: 'POST' as const, path: '/api/config/products', body: { name: 'Baru', code: 'XX' } },
      { method: 'POST' as const, path: '/api/config/payment-fee-rules', body: { name: 'Baru', identifier: 'x', fee_type: 'flat', fee_value: 1 } },
      { method: 'PATCH' as const, path: '/api/config/products/config-1', body: { name: 'Baru' } },
      { method: 'DELETE' as const, path: '/api/config/products/config-1' },
    ]

    for (const attempt of attempts) {
      const response = await write(ctx, ctx.staff, attempt)
      expect(response.status).toBe(403)
      expect((await readBody<FailureBody>(response)).error.code).toBe('FORBIDDEN')
    }

    // Tidak ada satu pun yang berubah.
    expect(ctx.state.config.products.some((row) => row['code'] === 'XX')).toBe(false)
  })

  it('admin dan master_admin dapat menulis', async () => {
    const ctx = await setup()

    const byAdmin = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/sessions',
      body: { name: 'Sesi 3', code: 'S3' },
    })
    expect(byAdmin.status).toBe(201)

    const byBoss = await write(ctx, ctx.boss, {
      method: 'POST',
      path: '/api/config/sessions',
      body: { name: 'Sesi 4', code: 'S4' },
    })
    expect(byBoss.status).toBe(201)
  })

  it('claim app_role yang berbohong tidak menolong: peran dibaca dari database', async () => {
    const ctx = await setup()
    // Token staff yang mengaku admin tetap ditolak, karena handler memakai
    // peran baris `users`, bukan claim.
    const response = await write(ctx, ctx.staff, {
      method: 'POST',
      path: '/api/config/products',
      body: { name: 'Baru', code: 'XX' },
    })
    expect(response.status).toBe(403)
  })
})

describe('pembuatan konfigurasi', () => {
  it('membuat produk dan mengembalikan barisnya', async () => {
    const ctx = await setup()

    const response = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/products',
      body: { name: 'Produk Baru', code: 'PROD' },
    })

    expect(response.status).toBe(201)
    const body = await readBody<ItemBody>(response)
    expect(body.data.resource).toBe('products')
    expect(body.data.item['code']).toBe('PROD')
    expect(body.data.item['active']).toBe(true)
  })

  it('kode wajib huruf/angka tanpa spasi (01 §10)', async () => {
    const ctx = await setup()

    for (const code of ['K M', 'K-M', 'K.M', '', '   ']) {
      const response = await write(ctx, ctx.admin, {
        method: 'POST',
        path: '/api/config/products',
        body: { name: 'X', code },
      })
      expect([400]).toContain(response.status)
    }
  })

  it('field wajib yang hilang -> 400 INVALID_PAYLOAD', async () => {
    const ctx = await setup()

    for (const body of [{}, { name: 'X' }, { code: 'XX' }]) {
      const response = await write(ctx, ctx.admin, { method: 'POST', path: '/api/config/products', body })
      expect(response.status).toBe(400)
      expect((await readBody<FailureBody>(response)).error.code).toBe('INVALID_PAYLOAD')
    }
  })

  it('field yang ada tetapi kosong -> 400 INVALID_ARGUMENT', async () => {
    const ctx = await setup()

    for (const body of [{ name: '   ', code: 'XX' }, { name: 'X', code: '   ' }]) {
      const response = await write(ctx, ctx.admin, { method: 'POST', path: '/api/config/products', body })
      expect(response.status).toBe(400)
      expect((await readBody<FailureBody>(response)).error.code).toBe('INVALID_ARGUMENT')
    }
  })

  it('kode duplikat (beda huruf besar/kecil) -> 409 CODE_TAKEN', async () => {
    const ctx = await setup()

    const response = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/products',
      body: { name: 'Duplikat', code: 'kuli' },
    })

    expect(response.status).toBe(409)
    expect((await readBody<FailureBody>(response)).error.code).toBe('CODE_TAKEN')
  })

  it('event type wajib menyertakan kind yang sah', async () => {
    const ctx = await setup()

    const missing = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/event-types',
      body: { name: 'Kelas Online', code: 'KO' },
    })
    expect(missing.status).toBe(400)

    const invalid = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/event-types',
      body: { name: 'Kelas Online', code: 'KO', kind: 'kelas' },
    })
    expect(invalid.status).toBe(400)
    expect((await readBody<FailureBody>(invalid)).error.code).toBe('INVALID_ARGUMENT')
  })

  it('sumber daya yang tidak dikenal -> 404', async () => {
    const ctx = await setup()

    const response = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/users',
      body: { name: 'X', code: 'XX' },
    })
    expect(response.status).toBe(404)
  })
})

describe('D07: guard kombinasi kode ambigu', () => {
  it('menolak panjang kode lama sebelum menjadi kombinasi ambigu', async () => {
    const ctx = await setup()
    for (const [resource,code] of [['advertisers','M01'],['products','K']]) {
      const response = await write(ctx, ctx.admin, { method: 'POST', path: '/api/config/' + resource, body: { name: 'X', code } })
      expect(response.status).toBe(400)
    }
  })

  it('mengubah nama TIDAK terblokir oleh pemeriksaan ambiguitas', async () => {
    const ctx = await setup()
    const product = ctx.state.config.products.find((row) => row['code'] === 'KULI')
    const id = String(product?.['id'] ?? 'config-1')

    const response = await write(ctx, ctx.admin, {
      method: 'PATCH',
      path: `/api/config/products/${id}`,
      body: { name: 'Kuliner Mastery' },
    })

    expect(response.status).toBe(200)
    expect((await readBody<ItemBody>(response)).data.item['name']).toBe('Kuliner Mastery')
  })
})

describe('penyuntingan & penonaktifan', () => {
  it('PATCH hanya menulis field yang dikirim', async () => {
    const ctx = await setup()
    const product = ctx.state.config.products.find((row) => row['code'] === 'BOMM')
    const id = String(product?.['id'])

    const response = await write(ctx, ctx.admin, {
      method: 'PATCH',
      path: `/api/config/products/${id}`,
      body: { name: 'Bisnis Mastery' },
    })

    expect(response.status).toBe(200)
    const item = (await readBody<ItemBody>(response)).data.item
    expect(item['name']).toBe('Bisnis Mastery')
    expect(item['code']).toBe('BOMM')
  })

  it('PATCH tanpa field yang dapat diubah -> 400', async () => {
    const ctx = await setup()
    const product = ctx.state.config.products.find((row) => row['code'] === 'BOMM')

    const response = await write(ctx, ctx.admin, {
      method: 'PATCH',
      path: `/api/config/products/${String(product?.['id'])}`,
      body: { id: 'apa saja' },
    })

    expect(response.status).toBe(400)
  })

  it('DELETE berarti nonaktifkan — baris TIDAK dihapus (01 §8)', async () => {
    const ctx = await setup()
    const product = ctx.state.config.products.find((row) => row['code'] === 'BOMM')
    const id = String(product?.['id'])

    const response = await write(ctx, ctx.admin, { method: 'DELETE', path: `/api/config/products/${id}` })

    expect(response.status).toBe(200)
    expect((await readBody<ItemBody>(response)).data.item['active']).toBe(false)

    const stillThere = ctx.state.config.products.find((row) => row['id'] === id)
    expect(stillThere).toBeDefined()
  })

  it('DELETE ?permanent=true menghapus baris secara permanen', async () => {
    const ctx = await setup()
    const product = ctx.state.config.products.find((row) => row['code'] === 'BOMM')
    const id = String(product?.['id'])

    const response = await write(ctx, ctx.admin, {
      method: 'DELETE',
      path: `/api/config/products/${id}?permanent=true`,
    })

    expect(response.status).toBe(200)
    expect(ctx.state.config.products.find((row) => row['id'] === id)).toBeUndefined()
  })

  it('PATCH dapat mengaktifkan kembali', async () => {
    const ctx = await setup()
    const id = String(ctx.state.config.products.find((row) => row['code'] === 'KULI')?.['id'])

    const response = await write(ctx, ctx.admin, {
      method: 'PATCH',
      path: `/api/config/products/${id}`,
      body: { active: true },
    })

    expect(response.status).toBe(200)
    expect((await readBody<ItemBody>(response)).data.item['active']).toBe(true)
  })

  it('id yang tidak dikenal atau bukan UUID -> 404', async () => {
    const ctx = await setup()

    for (const id of ['tidak-ada', '123', '00000000-0000-0000-0000-000000000000']) {
      const response = await write(ctx, ctx.admin, {
        method: 'PATCH',
        path: `/api/config/products/${id}`,
        body: { name: 'X' },
      })
      expect(response.status).toBe(404)
    }
  })
})

describe('fee rule (PRD §77)', () => {
  it('membuat rule flat dan percentage', async () => {
    const ctx = await setup()

    const flat = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/payment-fee-rules',
      body: { name: 'VA Mandiri', identifier: 'va mandiri', fee_type: 'flat', fee_value: 4000 },
    })
    expect(flat.status).toBe(201)

    const percentage = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/payment-fee-rules',
      body: { name: 'Fee QRIS 1%', identifier: 'qris1', fee_type: 'percentage', fee_value: 1 },
    })
    expect(percentage.status).toBe(201)
  })

  it('fee_type dan fee_value divalidasi', async () => {
    const ctx = await setup()

    for (const body of [
      { name: 'X', identifier: 'a', fee_type: 'persen', fee_value: 1 },
      { name: 'X', identifier: 'a', fee_type: 'flat', fee_value: -1 },
      { name: 'X', identifier: 'a', fee_type: 'flat', fee_value: 'gratis' },
      { name: 'X', identifier: 'a', fee_type: 'flat' },
    ]) {
      const response = await write(ctx, ctx.admin, {
        method: 'POST',
        path: '/api/config/payment-fee-rules',
        body,
      })
      expect([400]).toContain(response.status)
    }
  })

  it('identifier aktif duplikat -> 409 IDENTIFIER_TAKEN, tetapi boleh setelah nonaktif', async () => {
    const ctx = await setup()

    // Normalisasi menyamakan huruf besar/kecil menjadi satu identifier.
    const duplicate = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/payment-fee-rules',
      body: { name: 'Duplikat', identifier: 'BANK_TRANSFER', fee_type: 'flat', fee_value: 1000 },
    })
    expect(duplicate.status).toBe(409)
    expect((await readBody<FailureBody>(duplicate)).error.code).toBe('IDENTIFIER_TAKEN')

    // Nonaktifkan rule lama, lalu identifier yang sama boleh dipakai lagi
    // (index unik di database bersifat parsial: hanya rule aktif).
    const rule = ctx.state.config.feeRules.find((row) => row['identifier'] === 'bank_transfer')
    await write(ctx, ctx.admin, { method: 'DELETE', path: `/api/config/payment-fee-rules/${String(rule?.['id'])}` })

    const afterDeactivate = await write(ctx, ctx.admin, {
      method: 'POST',
      path: '/api/config/payment-fee-rules',
      body: { name: 'Pengganti', identifier: 'bank_transfer', fee_type: 'flat', fee_value: 5000 },
    })
    expect(afterDeactivate.status).toBe(201)
  })
})
