import { normalizeCode, parseProductRaw } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requirePermission, requirePermissions, productAccess, assertProductAccess, allowsProduct, type ProductAccess } from '../permissions'
import { loadProductConfig } from '../webhooks/handlers'

export const WEBINAR_PREFIX = 'webinar_destination::'
export const TICKET_PREFIX = 'seminar_ticket::'
export const SCOPE_PREFIX = '__scope__::'

export type ScopeParts = {
  mode: 'scope' | 'exact'
  product_code: string
  batch: string
  session_code: string
}

export function parseScopeKey(rawKey: string): ScopeParts {
  if (rawKey.startsWith(SCOPE_PREFIX)) {
    const parts = rawKey.slice(SCOPE_PREFIX.length).split(':')
    return {
      mode: 'scope',
      product_code: parts[0] || '*',
      batch: parts[1] || '*',
      session_code: parts[2] || '*',
    }
  }
  return {
    mode: 'exact',
    product_code: '',
    batch: '',
    session_code: '',
  }
}

export function buildScopeKey(productCode: string, batch: string, sessionCode: string): string {
  return `${SCOPE_PREFIX}${productCode}:${batch}:${sessionCode}`
}

/**
 * Daftar key kandidat dari paling spesifik ke paling umum (global `*:*:*`).
 */
export function candidateSettingKeys(
  order: {
    product_raw: string | null
    product_code?: string | null
    batch: string | null
    session: string | null
    /** Nama kanonik dari alias: order beralias/remap tetap cocok dengan rule exact. */
    alias_target?: string | null
  },
  prefix: string,
): string[] {
  const keys: string[] = []
  if (order.product_raw !== null && order.product_raw !== '') {
    keys.push(`${prefix}${order.product_raw}`)
  }
  if (order.alias_target) keys.push(`${prefix}${order.alias_target}`)

  const p = order.product_code ? normalizeCode(order.product_code) : null
  const b = order.batch ? order.batch.trim() : null
  const s = order.session ? normalizeCode(order.session) : null

  if (p && b && s) keys.push(`${prefix}${buildScopeKey(p, b, s)}`)
  if (p && b) keys.push(`${prefix}${buildScopeKey(p, b, '*')}`)
  if (p && s) keys.push(`${prefix}${buildScopeKey(p, '*', s)}`)
  if (p) keys.push(`${prefix}${buildScopeKey(p, '*', '*')}`)
  if (b && s) keys.push(`${prefix}${buildScopeKey('*', b, s)}`)
  if (b) keys.push(`${prefix}${buildScopeKey('*', b, '*')}`)
  if (s) keys.push(`${prefix}${buildScopeKey('*', '*', s)}`)
  keys.push(`${prefix}${buildScopeKey('*', '*', '*')}`)

  return keys
}

/**
 * Edit yang mengganti scope/nama: rule baru sudah tersimpan, lalu key lama dibuang
 * supaya tidak tertinggal rule ganda. Urutan simpan-dulu tidak pernah membuat celah
 * tanpa rule. Key lama tetap diperiksa terhadap cakupan produk aktor.
 */
async function removeReplacedKey(
  context: RouteContext,
  access: ProductAccess,
  prefix: string,
  body: Record<string, unknown>,
  newKey: string,
): Promise<void> {
  const original = readString(body, 'original_key')?.trim() ?? ''
  if (original === '' || original === newKey) return
  const code = original.startsWith(SCOPE_PREFIX)
    ? parseScopeKey(original).product_code
    : parseProductRaw(original, await loadProductConfig(context.db)).product_code
  assertProductAccess(access, code)
  await context.db.deleteRows('app_settings', { key: `eq.${prefix}${original}` })
}

async function validateScopeParts(
  context: RouteContext,
  rawProductCode: string | null | undefined,
  rawBatch: string | null | undefined,
  rawSessionCode: string | null | undefined,
): Promise<{ productCode: string; batch: string; sessionCode: string; scopeKey: string }> {
  const config = await loadProductConfig(context.db)

  const trimmedProduct = (rawProductCode ?? '').trim()
  const productCode = trimmedProduct === '' || trimmedProduct === '*' ? '*' : (normalizeCode(trimmedProduct) ?? '')
  if (productCode === '') {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Kode produk tidak valid')
  }
  if (productCode !== '*' && !config.products.some((item) => normalizeCode(item.code) === productCode)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Kode produk tidak terdaftar')
  }

  const trimmedBatch = (rawBatch ?? '').trim()
  const batch = trimmedBatch === '' || trimmedBatch === '*' ? '*' : trimmedBatch
  if (batch !== '*' && !/^\d{1,10}$/.test(batch)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Batch harus berupa angka (mis. 392 atau 001) atau * untuk semua batch')
  }

  const trimmedSession = (rawSessionCode ?? '').trim()
  const sessionCode = trimmedSession === '' || trimmedSession === '*' ? '*' : (normalizeCode(trimmedSession) ?? '')
  if (sessionCode === '') {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Kode sesi tidak valid')
  }
  if (sessionCode !== '*' && !config.sessions.some((item) => normalizeCode(item.code) === sessionCode)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Kode sesi tidak terdaftar')
  }

  return {
    productCode,
    batch,
    sessionCode,
    scopeKey: buildScopeKey(productCode, batch, sessionCode),
  }
}

export async function listWebinars(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'config.zoom')
  const access = await productAccess(context, actor)
  const [config, rows] = await Promise.all([
    loadProductConfig(context.db),
    (async () => {
      const all: { key: string; value_text: string | null; updated_at: string }[] = []
      for (let offset = 0; ; offset += 500) {
        const page = await context.db.selectRows<(typeof all)[number]>(
          'app_settings',
          { key: `like.${WEBINAR_PREFIX}*`, order: 'key.asc', limit: '500', offset: String(offset) },
          'key,value_text,updated_at',
        )
        all.push(...page)
        if (page.length < 500) break
      }
      return all
    })(),
  ])
  return ok({
    rows: rows.filter((row) => {
      const key = row.key.slice(WEBINAR_PREFIX.length)
      return allowsProduct(access, key.startsWith(SCOPE_PREFIX) ? parseScopeKey(key).product_code : parseProductRaw(key, config).product_code)
    }).map((row) => {
      const rawKey = row.key.slice(WEBINAR_PREFIX.length)
      const parsed = parseScopeKey(rawKey)
      return {
        key: rawKey,
        product_raw: rawKey,
        mode: parsed.mode,
        product_code: parsed.product_code,
        batch: parsed.batch,
        session_code: parsed.session_code,
        destination: row.value_text ?? '',
        updated_at: row.updated_at,
      }
    }),
    products: config.products.filter((item) => allowsProduct(access, item.code)).map((item) => ({ code: item.code, name: item.name, active: item.active })),
    sessions: config.sessions.map((item) => ({ code: item.code, name: item.name, active: item.active })),
    stores: await loadStoreCodes(context),
  })
}

export async function saveWebinar(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'config.zoom')
  const access = await productAccess(context, actor)
  const body = await readJsonObject(context.request)
  const destination = readString(body, 'destination')?.trim()
  if (!destination || destination.length > 4096) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Produk dan link Zoom wajib diisi')
  }

  let url: URL
  try {
    url = new URL(destination)
  } catch {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'URL tidak valid')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(
      url.hostname === 'zoom.us' ||
      url.hostname.endsWith('.zoom.us') ||
      url.hostname === 'zoom.com' ||
      url.hostname.endsWith('.zoom.com')
    )
  ) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Gunakan link HTTPS Zoom')
  }

  const productRaw = readString(body, 'product_raw')?.trim() ?? ''
  const hasScopeFields =
    'product_code' in body || 'batch' in body || 'session_code' in body || productRaw.startsWith(SCOPE_PREFIX)

  if (productRaw !== '' && !productRaw.startsWith(SCOPE_PREFIX)) {
    if (productRaw.length > 1000) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Produk dan link Zoom wajib diisi')
    }
    const parsed = parseProductRaw(productRaw, await loadProductConfig(context.db))
    if (parsed.product_parse_status !== 'valid' || (parsed.event_kind !== 'webinar' && parsed.event_kind !== 'hybrid')) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama produk harus bertipe Online atau Hybrid dengan kode yang terdaftar')
    }
    assertProductAccess(access, parsed.product_code)
    await context.db.rpc('save_webinar_destination', {
      p_actor: actor.id,
      p_product_raw: productRaw,
      p_destination: destination,
    })
    await removeReplacedKey(context, access, WEBINAR_PREFIX, body, productRaw)
    return ok({
      key: productRaw,
      product_raw: productRaw,
      mode: 'exact',
      product_code: parsed.product_code ?? '',
      batch: parsed.batch ?? '',
      session_code: parsed.session ?? '',
      destination,
    })
  }

  if (!hasScopeFields) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Produk dan link Zoom wajib diisi')
  }

  const fromScopeKey = productRaw.startsWith(SCOPE_PREFIX) ? parseScopeKey(productRaw) : null
  const { productCode, batch, sessionCode, scopeKey } = await validateScopeParts(
    context,
    fromScopeKey ? fromScopeKey.product_code : readString(body, 'product_code'),
    fromScopeKey ? fromScopeKey.batch : readString(body, 'batch'),
    fromScopeKey ? fromScopeKey.session_code : readString(body, 'session_code'),
  )

  assertProductAccess(access, productCode)
  await context.db.rpc('save_webinar_destination', {
    p_actor: actor.id,
    p_product_raw: scopeKey,
    p_destination: destination,
  })
  await removeReplacedKey(context, access, WEBINAR_PREFIX, body, scopeKey)

  return ok({
    key: scopeKey,
    product_raw: scopeKey,
    mode: 'scope',
    product_code: productCode,
    batch,
    session_code: sessionCode,
    destination,
  })
}

export async function deleteWebinar(context: RouteContext): Promise<Response> {
  const actor = await requirePermissions(context, ['action.delete_master', 'config.zoom'])
  const access = await productAccess(context, actor)
  let targetKey = context.url.searchParams.get('key')?.trim() ?? ''
  if (targetKey === '') {
    const body = await readJsonObject(context.request)
    targetKey = (readString(body, 'key') ?? readString(body, 'product_raw') ?? '').trim()
  }
  if (targetKey === '' || targetKey.length > 1000) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Key konfigurasi Zoom wajib diisi')
  }
  const code = targetKey.startsWith(SCOPE_PREFIX) ? parseScopeKey(targetKey).product_code : parseProductRaw(targetKey, await loadProductConfig(context.db)).product_code
  assertProductAccess(access, code)
  await context.db.deleteRows('app_settings', { key: `eq.${WEBINAR_PREFIX}${targetKey}` })
  return ok({ deleted: targetKey })
}

/**
 * Aturan tiket (A19): hanya catatan opsional. Nilai lama `venue`/`schedule`/`active`
 * dari versi sebelumnya dibiarkan tersimpan tetapi diabaikan.
 */
/**
 * Kode toko koneksi OrderOnline aktif, untuk link peserta `/access/{KODE}/{{order_id}}`
 * (Fitur 2.0 dok 07: Order ID disimpan `KODE-nomor`, jadi kode toko mencegah tabrakan antar toko).
 * Hanya nama + kode — token/secret koneksi tidak pernah ikut.
 */
async function loadStoreCodes(context: RouteContext): Promise<{ name: string; slug: string }[]> {
  const rows = await context.db.selectRows<{ name: string; slug: string | null }>(
    'orderonline_connections', { active: 'is.true', order: 'slug.asc' }, 'name,slug',
  )
  return rows.filter((row) => row.slug).map((row) => ({ name: row.name, slug: row.slug as string }))
}

export type SeminarTicketRuleValue = {
  notes: string | null
}

export function parseSeminarTicketValue(raw: string | null): SeminarTicketRuleValue {
  if (!raw) return { notes: null }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return { notes: typeof parsed['notes'] === 'string' && parsed['notes'].trim() !== '' ? parsed['notes'].trim() : null }
  } catch {
    return { notes: null }
  }
}

export async function listSeminarTickets(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'config.tiket')
  const access = await productAccess(context, actor)
  const [config, rows] = await Promise.all([
    loadProductConfig(context.db),
    (async () => {
      const all: { key: string; value_text: string | null; updated_at: string }[] = []
      for (let offset = 0; ; offset += 500) {
        const page = await context.db.selectRows<(typeof all)[number]>(
          'app_settings',
          { key: `like.${TICKET_PREFIX}*`, order: 'key.asc', limit: '500', offset: String(offset) },
          'key,value_text,updated_at',
        )
        all.push(...page)
        if (page.length < 500) break
      }
      return all
    })(),
  ])

  return ok({
    rows: rows.filter((row) => {
      const key = row.key.slice(TICKET_PREFIX.length)
      return allowsProduct(access, key.startsWith(SCOPE_PREFIX) ? parseScopeKey(key).product_code : parseProductRaw(key, config).product_code)
    }).map((row) => {
      const rawKey = row.key.slice(TICKET_PREFIX.length)
      const scope = parseScopeKey(rawKey)
      const val = parseSeminarTicketValue(row.value_text)
      return {
        key: rawKey,
        mode: scope.mode,
        product_code: scope.product_code,
        batch: scope.batch,
        session_code: scope.session_code,
        notes: val.notes ?? '',
        updated_at: row.updated_at,
      }
    }),
    products: config.products.filter((item) => allowsProduct(access, item.code)).map((item) => ({ code: item.code, name: item.name, active: item.active })),
    sessions: config.sessions.map((item) => ({ code: item.code, name: item.name, active: item.active })),
    stores: await loadStoreCodes(context),
  })
}

export async function saveSeminarTicket(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'config.tiket')
  const access = await productAccess(context, actor)
  const body = await readJsonObject(context.request)

  const { productCode, batch, sessionCode, scopeKey } = await validateScopeParts(
    context,
    readString(body, 'product_code'),
    readString(body, 'batch'),
    readString(body, 'session_code'),
  )

  const notes = (readString(body, 'notes') ?? '').trim()
  if (notes.length > 500) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Catatan tiket maksimal 500 karakter')
  }

  const valueJson = JSON.stringify({ notes: notes === '' ? null : notes })

  assertProductAccess(access, productCode)
  await context.db.rpc('save_seminar_ticket', {
    p_actor: actor.id,
    p_scope_key: scopeKey,
    p_value_json: valueJson,
  })
  await removeReplacedKey(context, access, TICKET_PREFIX, body, scopeKey)

  return ok({
    key: scopeKey,
    product_code: productCode,
    batch,
    session_code: sessionCode,
    notes,
  })
}

export async function deleteSeminarTicket(context: RouteContext): Promise<Response> {
  const actor = await requirePermissions(context, ['action.delete_master', 'config.tiket'])
  const access = await productAccess(context, actor)
  let targetKey = context.url.searchParams.get('key')?.trim() ?? ''
  if (targetKey === '') {
    const body = await readJsonObject(context.request)
    targetKey = (readString(body, 'key') ?? '').trim()
  }
  if (targetKey === '' || targetKey.length > 1000) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Key konfigurasi tiket wajib diisi')
  }
  const code = targetKey.startsWith(SCOPE_PREFIX) ? parseScopeKey(targetKey).product_code : parseProductRaw(targetKey, await loadProductConfig(context.db)).product_code
  assertProductAccess(access, code)
  await context.db.deleteRows('app_settings', { key: `eq.${TICKET_PREFIX}${targetKey}` })
  return ok({ deleted: targetKey })
}
