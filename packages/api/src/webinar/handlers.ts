import { normalizeCode, parseProductRaw } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requireActiveUser } from '../users'
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
  },
  prefix: string,
): string[] {
  const keys: string[] = []
  if (order.product_raw !== null && order.product_raw !== '') {
    keys.push(`${prefix}${order.product_raw}`)
  }

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
    throw new ApiFailure('INVALID_ARGUMENT', 'Kode produk tidak valid')
  }
  if (productCode !== '*' && !config.products.some((item) => normalizeCode(item.code) === productCode)) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Kode produk tidak terdaftar')
  }

  const trimmedBatch = (rawBatch ?? '').trim()
  const batch = trimmedBatch === '' || trimmedBatch === '*' ? '*' : trimmedBatch
  if (batch !== '*' && !/^\d{1,10}$/.test(batch)) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Batch harus berupa angka (mis. 392 atau 001) atau * untuk semua batch')
  }

  const trimmedSession = (rawSessionCode ?? '').trim()
  const sessionCode = trimmedSession === '' || trimmedSession === '*' ? '*' : (normalizeCode(trimmedSession) ?? '')
  if (sessionCode === '') {
    throw new ApiFailure('INVALID_ARGUMENT', 'Kode sesi tidak valid')
  }
  if (sessionCode !== '*' && !config.sessions.some((item) => normalizeCode(item.code) === sessionCode)) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Kode sesi tidak terdaftar')
  }

  return {
    productCode,
    batch,
    sessionCode,
    scopeKey: buildScopeKey(productCode, batch, sessionCode),
  }
}

export async function listWebinars(context: RouteContext): Promise<Response> {
  await requireActiveUser(context)
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
    rows: rows.map((row) => {
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
    products: config.products.map((item) => ({ code: item.code, name: item.name, active: item.active })),
    sessions: config.sessions.map((item) => ({ code: item.code, name: item.name, active: item.active })),
  })
}

export async function saveWebinar(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  const body = await readJsonObject(context.request)
  const destination = readString(body, 'destination')?.trim()
  if (!destination || destination.length > 4096) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Produk dan link Zoom wajib diisi')
  }

  let url: URL
  try {
    url = new URL(destination)
  } catch {
    throw new ApiFailure('INVALID_ARGUMENT', 'URL tidak valid')
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
    throw new ApiFailure('INVALID_ARGUMENT', 'Gunakan link HTTPS Zoom')
  }

  const productRaw = readString(body, 'product_raw')?.trim() ?? ''
  const hasScopeFields =
    'product_code' in body || 'batch' in body || 'session_code' in body || productRaw.startsWith(SCOPE_PREFIX)

  if (productRaw !== '' && !productRaw.startsWith(SCOPE_PREFIX)) {
    if (productRaw.length > 1000) {
      throw new ApiFailure('INVALID_ARGUMENT', 'Produk dan link Zoom wajib diisi')
    }
    const parsed = parseProductRaw(productRaw, await loadProductConfig(context.db))
    if (parsed.product_parse_status !== 'valid' || parsed.event_kind !== 'webinar') {
      throw new ApiFailure('INVALID_ARGUMENT', 'Nama produk harus webinar dengan kode yang terdaftar')
    }
    await context.db.rpc('save_webinar_destination', {
      p_actor: actor.id,
      p_product_raw: productRaw,
      p_destination: destination,
    })
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
    throw new ApiFailure('INVALID_ARGUMENT', 'Produk dan link Zoom wajib diisi')
  }

  const fromScopeKey = productRaw.startsWith(SCOPE_PREFIX) ? parseScopeKey(productRaw) : null
  const { productCode, batch, sessionCode, scopeKey } = await validateScopeParts(
    context,
    fromScopeKey ? fromScopeKey.product_code : readString(body, 'product_code'),
    fromScopeKey ? fromScopeKey.batch : readString(body, 'batch'),
    fromScopeKey ? fromScopeKey.session_code : readString(body, 'session_code'),
  )

  await context.db.rpc('save_webinar_destination', {
    p_actor: actor.id,
    p_product_raw: scopeKey,
    p_destination: destination,
  })

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
  await requireActiveUser(context)
  let targetKey = context.url.searchParams.get('key')?.trim() ?? ''
  if (targetKey === '') {
    const body = await readJsonObject(context.request)
    targetKey = (readString(body, 'key') ?? readString(body, 'product_raw') ?? '').trim()
  }
  if (targetKey === '' || targetKey.length > 1000) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Key konfigurasi Zoom wajib diisi')
  }
  await context.db.deleteRows('app_settings', { key: `eq.${WEBINAR_PREFIX}${targetKey}` })
  return ok({ deleted: targetKey })
}

export type SeminarTicketRuleValue = {
  venue: string | null
  schedule: string | null
  notes: string | null
  active: boolean
}

export function parseSeminarTicketValue(raw: string | null): SeminarTicketRuleValue {
  if (!raw) return { venue: null, schedule: null, notes: null, active: true }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      venue: typeof parsed['venue'] === 'string' && parsed['venue'].trim() !== '' ? parsed['venue'].trim() : null,
      schedule:
        typeof parsed['schedule'] === 'string' && parsed['schedule'].trim() !== '' ? parsed['schedule'].trim() : null,
      notes: typeof parsed['notes'] === 'string' && parsed['notes'].trim() !== '' ? parsed['notes'].trim() : null,
      active: parsed['active'] !== false,
    }
  } catch {
    return { venue: null, schedule: null, notes: null, active: true }
  }
}

export async function listSeminarTickets(context: RouteContext): Promise<Response> {
  await requireActiveUser(context)
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
    rows: rows.map((row) => {
      const rawKey = row.key.slice(TICKET_PREFIX.length)
      const scope = parseScopeKey(rawKey)
      const val = parseSeminarTicketValue(row.value_text)
      return {
        key: rawKey,
        mode: scope.mode,
        product_code: scope.product_code,
        batch: scope.batch,
        session_code: scope.session_code,
        venue: val.venue ?? '',
        schedule: val.schedule ?? '',
        notes: val.notes ?? '',
        active: val.active,
        updated_at: row.updated_at,
      }
    }),
    products: config.products.map((item) => ({ code: item.code, name: item.name, active: item.active })),
    sessions: config.sessions.map((item) => ({ code: item.code, name: item.name, active: item.active })),
  })
}

export async function saveSeminarTicket(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  const body = await readJsonObject(context.request)

  const { productCode, batch, sessionCode, scopeKey } = await validateScopeParts(
    context,
    readString(body, 'product_code'),
    readString(body, 'batch'),
    readString(body, 'session_code'),
  )

  const venue = (readString(body, 'venue') ?? '').trim()
  const schedule = (readString(body, 'schedule') ?? '').trim()
  const notes = (readString(body, 'notes') ?? '').trim()
  const active = body['active'] !== false

  if (venue.length > 300 || schedule.length > 200 || notes.length > 500) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Panjang teks info tiket melebihi batas')
  }

  const valueJson = JSON.stringify({
    venue: venue === '' ? null : venue,
    schedule: schedule === '' ? null : schedule,
    notes: notes === '' ? null : notes,
    active,
  })

  await context.db.rpc('save_seminar_ticket', {
    p_actor: actor.id,
    p_scope_key: scopeKey,
    p_value_json: valueJson,
  })

  return ok({
    key: scopeKey,
    product_code: productCode,
    batch,
    session_code: sessionCode,
    venue,
    schedule,
    notes,
    active,
  })
}

export async function deleteSeminarTicket(context: RouteContext): Promise<Response> {
  await requireActiveUser(context)
  let targetKey = context.url.searchParams.get('key')?.trim() ?? ''
  if (targetKey === '') {
    const body = await readJsonObject(context.request)
    targetKey = (readString(body, 'key') ?? '').trim()
  }
  if (targetKey === '' || targetKey.length > 1000) {
    throw new ApiFailure('INVALID_ARGUMENT', 'Key konfigurasi tiket wajib diisi')
  }
  await context.db.deleteRows('app_settings', { key: `eq.${TICKET_PREFIX}${targetKey}` })
  return ok({ deleted: targetKey })
}
