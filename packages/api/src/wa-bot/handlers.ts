import {
  isWaEventType,
  normalizeCode,
  validateWaTemplate,
  WA_GROUP_ID_MAX_LENGTH,
  WA_TEMPLATE_NAME_MAX_LENGTH,
  WA_TOKEN_MAX_LENGTH,
} from '@dvflow/shared'
import { decrypt, encrypt } from '../integrations/crypto'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import { requirePermission } from '../permissions'
import type { RouteContext } from '../router'
import { checkFonnteDevice, sendWhatsAppMessage } from './fonnte'

/**
 * WA Admin Bot — seluruh akses lewat backend.
 *
 * Konfigurasi grup berada di level PRODUK (`wa_product_groups`). Penerima
 * diturunkan dari `product_advertisers`; satu pesan per grup menyebut nama
 * seluruh pengiklan yang beraktivitas. Tabel `wa_reminder_*` sengaja tidak punya grant SELECT
 * untuk browser: baris log memuat daftar nama/isi pesan, dan `wa_bot_settings` memuat
 * token Fonnte. Backend memakai service key (K11), dengan permission
 * `config.wa_bot` sebagai gerbang tindakan pengguna.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/
const LOG_STATUSES = ['queued', 'sent', 'failed'] as const

type ProductRow = {
  id: string
  code: string
  name: string
  active: boolean
}
type AdvertiserRow = {
  id: string
  code: string
  name: string
  active: boolean
}
type ProductGroupRow = {
  id: string
  product_id: string
  fonnte_group_id: string
  is_active: boolean
  created_at: string
  updated_at: string
}
type LinkRow = { product_id: string; advertiser_id: string }
type TemplateRow = {
  id: string
  name: string
  message_content: string
  is_active: boolean
  created_at: string
  updated_at: string
}
type ScheduleRow = {
  id: string
  execution_time: string
  template_id: string
  days: number[]
  only_if_missing_report: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}
type SettingsRow = { id: number; fonnte_token_encrypted: string | null; updated_at: string }
type LogRow = {
  id: string
  schedule_id: string | null
  advertiser_id: string | null
  advertiser_name: string
  product_code: string
  product_name: string | null
  reminder_date: string
  group_id: string
  template_id: string | null
  event_type: string | null
  message: string
  status: 'queued' | 'sent' | 'failed'
  attempts: number
  fonnte_message_id: string | null
  error: string | null
  claimed_at: string | null
  sent_at: string | null
  created_at: string
}
type ClaimTask = {
  log_id: string
  group_id: string
  message: string
  advertiser_id: string | null
  advertiser_name: string
  product_code: string
  product_name: string | null
  event_type: string | null
}
type PreviewResult =
  | { found: false; reason: string }
  | {
      found: true
      group_id: string
      message: string
      leads: number
      paid: number
      advertisers: Array<{ code: string; name: string }>
      product_code: string
      product_name: string
      event_type: string
      reminder_date: string
    }

const PRODUCT_COLUMNS = 'id,code,name,active'
const ADVERTISER_COLUMNS = 'id,code,name,active'
const PRODUCT_GROUP_COLUMNS = 'id,product_id,fonnte_group_id,is_active,created_at,updated_at'
const TEMPLATE_COLUMNS = 'id,name,message_content,is_active,created_at,updated_at'
const SCHEDULE_COLUMNS = 'id,execution_time,template_id,days,only_if_missing_report,is_active,created_at,updated_at'
const LOG_COLUMNS =
  'id,schedule_id,advertiser_id,advertiser_name,product_code,product_name,reminder_date,group_id,template_id,event_type,message,status,attempts,fonnte_message_id,error,claimed_at,sent_at,created_at'

// ---------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------

/** GET /api/wa-bot — seluruh konfigurasi + status token (token tidak dikirim). */
export async function waBotOverview(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')

  const [settings] = await context.db.selectRows<SettingsRow>(
    'wa_bot_settings',
    { id: 'eq.1' },
    'id,fonnte_token_encrypted,updated_at',
  )
  const [products, advertisers, groups, links, templates, schedules] = await Promise.all([
    context.db.selectRows<ProductRow>('products', {}, PRODUCT_COLUMNS),
    context.db.selectRows<AdvertiserRow>('advertisers', {}, ADVERTISER_COLUMNS),
    context.db.selectRows<ProductGroupRow>('wa_product_groups', {}, PRODUCT_GROUP_COLUMNS),
    context.db.selectRows<LinkRow>('product_advertisers', {}, 'product_id,advertiser_id'),
    context.db.selectRows<TemplateRow>('wa_reminder_templates', {}, TEMPLATE_COLUMNS),
    context.db.selectRows<ScheduleRow>('wa_reminder_schedules', {}, SCHEDULE_COLUMNS),
  ])

  const advertiserById = new Map(advertisers.map((row) => [row.id, row]))
  const productById = new Map(products.map((row) => [row.id, row]))
  const groupByProduct = new Map(groups.map((row) => [row.product_id, row]))
  const templateById = new Map(templates.map((row) => [row.id, row]))

  const advertisersByProduct = new Map<string, AdvertiserRow[]>()
  const productsByAdvertiser = new Map<string, ProductRow[]>()
  for (const link of links) {
    const advertiser = advertiserById.get(link.advertiser_id)
    const product = productById.get(link.product_id)
    if (advertiser !== undefined) {
      const list = advertisersByProduct.get(link.product_id) ?? []
      if (!list.some((row) => row.id === advertiser.id)) list.push(advertiser)
      advertisersByProduct.set(link.product_id, list)
    }
    if (product !== undefined) {
      const list = productsByAdvertiser.get(link.advertiser_id) ?? []
      if (!list.some((row) => row.id === product.id)) list.push(product)
      productsByAdvertiser.set(link.advertiser_id, list)
    }
  }

  return ok({
    settings: {
      has_token: Boolean(settings?.fonnte_token_encrypted),
      updated_at: settings?.updated_at ?? null,
    },
    products: products
      .map((row) => ({
        ...row,
        group: groupByProduct.get(row.id) ?? null,
        advertisers: (advertisersByProduct.get(row.id) ?? [])
          .map((advertiser) => ({
            id: advertiser.id,
            code: advertiser.code,
            name: advertiser.name,
            active: advertiser.active,
          }))
          .sort((left, right) => left.code.localeCompare(right.code, 'id')),
      }))
      .sort((left, right) => left.code.localeCompare(right.code, 'id')),
    advertisers: advertisers
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        active: row.active,
        products: (productsByAdvertiser.get(row.id) ?? [])
          .map((product) => ({ code: product.code, name: product.name }))
          .sort((left, right) => left.code.localeCompare(right.code, 'id')),
      }))
      .sort((left, right) => left.code.localeCompare(right.code, 'id')),
    templates: templates.sort((left, right) => left.name.localeCompare(right.name, 'id')),
    schedules: schedules
      .map((row) => ({
        ...row,
        days: Array.isArray(row.days) ? row.days.map(Number) : [],
        template_name: templateById.get(row.template_id)?.name ?? null,
      }))
      .sort((left, right) => String(left.execution_time).localeCompare(String(right.execution_time))),
  })
}

/** GET /api/wa-bot/logs — riwayat pengiriman (server-side filter + pagination). */
export async function waBotLogs(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')

  const params = context.url.searchParams
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get('pageSize') ?? '50', 10) || 50))
  const status = (params.get('status') ?? '').trim()
  const productCode = (params.get('product') ?? '').trim()
  const eventType = (params.get('event_type') ?? '').trim()
  const dateFrom = parseDate(params.get('date_from'))
  const dateTo = parseDate(params.get('date_to'))

  if (status !== '' && !(LOG_STATUSES as readonly string[]).includes(status)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Status pengiriman tidak valid.')
  }
  if (eventType !== '' && !isWaEventType(eventType)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Jenis acara tidak valid.')
  }
  if (params.get('date_from') && dateFrom === null) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal awal tidak valid.')
  if (params.get('date_to') && dateTo === null) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tanggal akhir tidak valid.')
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Rentang tanggal tidak valid.')
  }

  const filters: Record<string, string> = {}
  if (status !== '') filters['status'] = `eq.${status}`
  if (eventType !== '') filters['event_type'] = `eq.${eventType}`
  if (productCode !== '') {
    const [product] = await context.db.selectRows<{ code: string }>(
      'products',
      { code_normalized: `eq.${normalizeCode(productCode)}` },
      'code',
    )
    filters['product_code'] = product ? `eq.${product.code}` : 'eq.__NONE__'
  }
  if (dateFrom !== null && dateTo !== null) {
    filters['and'] = `(reminder_date.gte.${dateFrom},reminder_date.lte.${dateTo})`
  } else if (dateFrom !== null) {
    filters['reminder_date'] = `gte.${dateFrom}`
  } else if (dateTo !== null) {
    filters['reminder_date'] = `lte.${dateTo}`
  }

  const [rows, total] = await Promise.all([
    context.db.selectRows<LogRow>('wa_reminder_logs', {
      ...filters,
      order: 'created_at.desc',
      offset: String((page - 1) * pageSize),
      limit: String(pageSize),
    }, LOG_COLUMNS),
    context.db.countRows('wa_reminder_logs', filters),
  ])

  return ok({ rows, total, page, pageSize })
}

// ---------------------------------------------------------------------------
// Token Fonnte
// ---------------------------------------------------------------------------

/** PUT /api/wa-bot/settings — simpan token terenkripsi; nilai tidak pernah dikembalikan. */
export async function saveWaBotSettings(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'config.wa_bot')
  const body = await readJsonObject(context.request)
  const token = (readString(body, 'fonnte_token') ?? '').trim()

  if (token.length < 8 || token.length > WA_TOKEN_MAX_LENGTH) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, `Token Fonnte wajib 8–${WA_TOKEN_MAX_LENGTH} karakter.`)
  }

  const encrypted = await encrypt(token, context.env.INTEGRATION_ENCRYPTION_KEY)
  const [existing] = await context.db.selectRows<{ id: number }>('wa_bot_settings', { id: 'eq.1' }, 'id')
  if (existing) {
    await context.db.updateRows('wa_bot_settings', { id: 'eq.1' }, { fonnte_token_encrypted: encrypted, updated_by: actor.id, updated_at: new Date().toISOString() })
  } else {
    await context.db.insertRow('wa_bot_settings', { id: 1, fonnte_token_encrypted: encrypted, updated_by: actor.id }, 'id')
  }

  return ok({ has_token: true })
}

/**
 * POST /api/wa-bot/settings/verify — tanya Fonnte apakah device benar-benar
 * terhubung. Token disimpan terenkripsi, jadi tidak pernah dikirim ke browser;
 * yang dikembalikan hanya ringkasan device + alasan bila ditolak.
 */
export async function verifyWaBotSettings(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')

  const [settings] = await context.db.selectRows<SettingsRow>(
    'wa_bot_settings',
    { id: 'eq.1' },
    'id,fonnte_token_encrypted,updated_at',
  )
  if (!settings?.fonnte_token_encrypted) {
    return ok({ has_token: false, reachable: false, connected: false, status: null, device: null, error: null, detail: null })
  }

  let token: string
  try {
    token = await decrypt(settings.fonnte_token_encrypted, context.env.INTEGRATION_ENCRYPTION_KEY)
  } catch {
    return ok({ has_token: true, reachable: true, connected: false, status: null, device: null, error: 'TOKEN_UNREADABLE', detail: null })
  }

  const result = await checkFonnteDevice(context.env, token)
  const deviceStatus = result.device?.status ?? null

  return ok({
    has_token: true,
    reachable: result.reachable,
    connected: deviceStatus !== null && deviceStatus.toLowerCase() === 'connect',
    status: deviceStatus,
    device: result.device,
    error: result.error,
    detail: result.detail,
  })
}

// ---------------------------------------------------------------------------
// Grup per produk
// ---------------------------------------------------------------------------

export async function saveWaBotProductGroup(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')
  const body = await readJsonObject(context.request)
  const id = context.params['id'] ?? null
  if (id !== null && !UUID_PATTERN.test(id)) throw new ApiFailure('RESOURCE_NOT_FOUND')

  const existing = id === null ? null : await loadRow<ProductGroupRow>(context, 'wa_product_groups', PRODUCT_GROUP_COLUMNS, id)
  if (id !== null && existing === null) throw new ApiFailure('RESOURCE_NOT_FOUND')

  const productId = (readString(body, 'product_id') ?? existing?.product_id ?? '').trim()
  if (!UUID_PATTERN.test(productId)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih produk terlebih dahulu.')
  const [product] = await context.db.selectRows<{ id: string }>('products', { id: `eq.${productId}` }, 'id')
  if (!product) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Produk tidak ditemukan.')

  const duplicate = (await context.db.selectRows<{ id: string }>('wa_product_groups', { product_id: `eq.${productId}` }, 'id'))
    .find((row) => row.id !== id)
  if (duplicate) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Produk ini sudah punya grup WhatsApp.')

  const groupId = (readString(body, 'fonnte_group_id') ?? existing?.fonnte_group_id ?? '').trim()
  if (groupId === '' || groupId.length > WA_GROUP_ID_MAX_LENGTH) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, `ID grup Fonnte wajib diisi (maks. ${WA_GROUP_ID_MAX_LENGTH} karakter).`)
  }

  const isActive = readBoolean(body, 'is_active', existing?.is_active ?? true)

  const row = {
    product_id: productId,
    fonnte_group_id: groupId,
    is_active: isActive,
  }

  if (id === null) {
    const created = await context.db.insertRow<{ id: string }>('wa_product_groups', row, 'id')
    return ok({ id: created.id }, { status: 201 })
  }
  await context.db.updateRows('wa_product_groups', { id: `eq.${id}` }, row)
  return ok({ id })
}

export async function deleteWaBotProductGroup(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')
  const id = requireUuid(context)
  const existing = await loadRow<ProductGroupRow>(context, 'wa_product_groups', 'id', id)
  if (existing === null) throw new ApiFailure('RESOURCE_NOT_FOUND')
  await context.db.deleteRows('wa_product_groups', { id: `eq.${id}` })
  return ok({ deleted: id })
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export async function saveWaBotTemplate(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')
  const body = await readJsonObject(context.request)
  const id = context.params['id'] ?? null
  if (id !== null && !UUID_PATTERN.test(id)) throw new ApiFailure('RESOURCE_NOT_FOUND')

  const existing = id === null ? null : await loadRow<TemplateRow>(context, 'wa_reminder_templates', TEMPLATE_COLUMNS, id)
  if (id !== null && existing === null) throw new ApiFailure('RESOURCE_NOT_FOUND')

  const name = (readString(body, 'name') ?? existing?.name ?? '').trim()
  if (name === '' || name.length > WA_TEMPLATE_NAME_MAX_LENGTH) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, `Nama template wajib diisi (maks. ${WA_TEMPLATE_NAME_MAX_LENGTH} karakter).`)
  }

  const content = (readString(body, 'message_content') ?? existing?.message_content ?? '').trim()
  const validation = validateWaTemplate(content)
  if (!validation.ok) throw new ApiFailure('INVALID_ARGUMENT', undefined, validation.message)

  const duplicate = (await context.db.selectRows<{ id: string; name: string }>('wa_reminder_templates', {}, 'id,name'))
    .find((row) => row.id !== id && row.name.trim().toLowerCase() === name.toLowerCase())
  if (duplicate) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama template sudah dipakai.')

  const row = {
    name,
    message_content: content,
    is_active: readBoolean(body, 'is_active', existing?.is_active ?? true),
  }

  if (id === null) {
    const created = await context.db.insertRow<{ id: string }>('wa_reminder_templates', row, 'id')
    return ok({ id: created.id }, { status: 201 })
  }
  await context.db.updateRows('wa_reminder_templates', { id: `eq.${id}` }, row)
  return ok({ id })
}

export async function deleteWaBotTemplate(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')
  const id = requireUuid(context)
  const existing = await loadRow<TemplateRow>(context, 'wa_reminder_templates', 'id', id)
  if (existing === null) throw new ApiFailure('RESOURCE_NOT_FOUND')
  const used = await context.db.countRows('wa_reminder_schedules', { template_id: `eq.${id}` })
  if (used > 0) throw new ApiFailure('MASTER_IN_USE', undefined, 'Template masih dipakai jadwal. Hapus/nonaktifkan jadwalnya lebih dulu.')
  await context.db.deleteRows('wa_reminder_templates', { id: `eq.${id}` })
  return ok({ deleted: id })
}

// ---------------------------------------------------------------------------
// Jadwal
// ---------------------------------------------------------------------------

export async function saveWaBotSchedule(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')
  const body = await readJsonObject(context.request)
  const id = context.params['id'] ?? null
  if (id !== null && !UUID_PATTERN.test(id)) throw new ApiFailure('RESOURCE_NOT_FOUND')

  const existing = id === null ? null : await loadRow<ScheduleRow>(context, 'wa_reminder_schedules', SCHEDULE_COLUMNS, id)
  if (id !== null && existing === null) throw new ApiFailure('RESOURCE_NOT_FOUND')

  const rawTime = (readString(body, 'execution_time') ?? existing?.execution_time ?? '').trim()
  const executionTime = normalizeTime(rawTime)
  if (executionTime === null) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Jam eksekusi harus format HH:MM (WIB).')

  const templateId = (readString(body, 'template_id') ?? existing?.template_id ?? '').trim()
  if (!UUID_PATTERN.test(templateId)) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih template pesan terlebih dahulu.')
  const [template] = await context.db.selectRows<{ id: string }>('wa_reminder_templates', { id: `eq.${templateId}` }, 'id')
  if (!template) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Template pesan tidak ditemukan.')

  const days = readDays(body['days'], existing?.days ?? [0, 1, 2, 3, 4, 5, 6])

  const row = {
    execution_time: executionTime,
    template_id: templateId,
    days,
    only_if_missing_report: readBoolean(body, 'only_if_missing_report', existing?.only_if_missing_report ?? true),
    is_active: readBoolean(body, 'is_active', existing?.is_active ?? true),
  }

  if (id === null) {
    const created = await context.db.insertRow<{ id: string }>('wa_reminder_schedules', row, 'id')
    return ok({ id: created.id }, { status: 201 })
  }
  await context.db.updateRows('wa_reminder_schedules', { id: `eq.${id}` }, row)
  return ok({ id })
}

export async function deleteWaBotSchedule(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'config.wa_bot')
  const id = requireUuid(context)
  const existing = await loadRow<ScheduleRow>(context, 'wa_reminder_schedules', 'id', id)
  if (existing === null) throw new ApiFailure('RESOURCE_NOT_FOUND')
  await context.db.deleteRows('wa_reminder_schedules', { id: `eq.${id}` })
  return ok({ deleted: id })
}

// ---------------------------------------------------------------------------
// Uji kirim & kirim ulang
// ---------------------------------------------------------------------------

type TestTarget = {
  productCode: string
  templateId: string
  eventType: string | null
}

/** POST /api/wa-bot/test-preview — render pesan tanpa mengirim apa pun. */
export async function waBotTestPreview(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'action.wa_bot_send')
  const body = await readJsonObject(context.request)
  return ok(await readTestPreview(context, readTestTarget(body)))
}

/** POST /api/wa-bot/test-send — kirim satu pesan uji memakai data kemarin. */
export async function waBotTestSend(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'action.wa_bot_send')
  const body = await readJsonObject(context.request)
  const target = readTestTarget(body)
  const preview = await readTestPreview(context, target)
  const token = await readFonnteToken(context)

  const result = await sendWhatsAppMessage(context.env, token, preview.group_id, preview.message)
  const log = await context.db.insertRow<{ id: string }>('wa_reminder_logs', {
    schedule_id: null,
    advertiser_id: null,
    advertiser_name: preview.advertisers.map((row) => row.name).join(', '),
    product_code: preview.product_code,
    product_name: preview.product_name,
    reminder_date: preview.reminder_date,
    group_id: preview.group_id,
    template_id: target.templateId,
    event_type: preview.event_type,
    message: preview.message,
    status: result.sent ? 'sent' : 'failed',
    attempts: 1,
    fonnte_message_id: result.sent ? result.messageId : null,
    error: result.sent ? null : result.error,
    claimed_at: context.now.toISOString(),
    sent_at: result.sent ? context.now.toISOString() : null,
  }, 'id')

  return ok({
    log_id: log.id,
    sent: result.sent,
    error: result.sent ? null : result.error,
    message: preview.message,
    group_id: preview.group_id,
    event_type: preview.event_type,
  })
}

/** POST /api/wa-bot/logs/:id/resend — kirim ulang pesan yang sudah tercatat. */
export async function waBotResend(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'action.wa_bot_send')
  const id = requireUuid(context)
  const [row] = await context.db.selectRows<LogRow>('wa_reminder_logs', { id: `eq.${id}` }, LOG_COLUMNS)
  if (!row) throw new ApiFailure('WA_LOG_NOT_FOUND')

  const token = await readFonnteToken(context)
  const result = await sendWhatsAppMessage(context.env, token, row.group_id, row.message)
  await context.db.updateRows('wa_reminder_logs', { id: `eq.${id}` }, {
    status: result.sent ? 'sent' : 'failed',
    attempts: Math.min(Number(row.attempts) + 1, 10),
    fonnte_message_id: result.sent ? result.messageId : row.fonnte_message_id,
    error: result.sent ? null : result.error,
    sent_at: result.sent ? context.now.toISOString() : row.sent_at,
  })

  return ok({ log_id: id, sent: result.sent, error: result.sent ? null : result.error })
}

// ---------------------------------------------------------------------------
// Endpoint internal (cron Worker)
// ---------------------------------------------------------------------------

/**
 * POST /api/internal/wa-reminders/run
 *
 * Autentikasi memakai secret header, bukan JWT: cron Worker tidak punya sesi
 * pengguna. Bila `WA_CRON_SECRET` kosong, seluruh permintaan ditolak 404 —
 * kegagalan harus tertutup, bukan terbuka.
 */
export async function runWaReminders(context: RouteContext): Promise<Response> {
  assertCronSecret(context)

  const [settings] = await context.db.selectRows<SettingsRow>('wa_bot_settings', { id: 'eq.1' }, 'id,fonnte_token_encrypted,updated_at')
  if (!settings?.fonnte_token_encrypted) {
    return ok({ skipped: 'NO_TOKEN', claimed: 0, sent: 0, failed: 0 })
  }

  let token: string
  try {
    token = await decrypt(settings.fonnte_token_encrypted, context.env.INTEGRATION_ENCRYPTION_KEY)
  } catch {
    return ok({ skipped: 'TOKEN_UNREADABLE', claimed: 0, sent: 0, failed: 0 })
  }

  const configuredLimit = clampInt(context.env.WA_BATCH_LIMIT, 10, 1, 25)
  const delayMs = clampInt(context.env.WA_SEND_DELAY_MS, 1500, 0, 5000)
  // Cron berinterval < 1 jam dibatasi ±30 detik. Sisakan ruang untuk latensi
  // jaringan: jumlah pesan dikurangi bila jeda yang dikonfigurasi besar.
  const limit = Math.max(1, Math.min(configuredLimit, Math.floor(20_000 / Math.max(delayMs, 1))))

  const tasks = await context.db.rpc<ClaimTask[]>('wa_reminder_claim', {
    p_now: context.now.toISOString(),
    p_base_url: context.url.origin,
    p_limit: limit,
  })

  let sent = 0
  let failed = 0
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index] as ClaimTask
    const result = await sendWhatsAppMessage(context.env, token, task.group_id, task.message)
    if (result.sent) sent += 1
    else failed += 1

    await context.db.rpc('wa_reminder_mark', {
      p_id: task.log_id,
      p_status: result.sent ? 'sent' : 'failed',
      p_fonnte_message_id: result.sent ? result.messageId : null,
      p_error: result.sent ? null : result.error,
    })

    if (index < tasks.length - 1 && delayMs > 0) await sleep(delayMs)
  }

  return ok({ skipped: null, claimed: tasks.length, sent, failed })
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function requireUuid(context: RouteContext): string {
  const id = context.params['id'] ?? ''
  if (!UUID_PATTERN.test(id)) throw new ApiFailure('RESOURCE_NOT_FOUND')
  return id
}

async function loadRow<T>(context: RouteContext, table: string, columns: string, id: string): Promise<T | null> {
  const [row] = await context.db.selectRows<T>(table, { id: `eq.${id}` }, columns)
  return row ?? null
}

function readBoolean(body: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = body[key]
  return typeof value === 'boolean' ? value : fallback
}

function readTestTarget(body: Record<string, unknown>): TestTarget {
  const productCode = (readString(body, 'product_code') ?? '').trim()
  const templateId = (readString(body, 'template_id') ?? '').trim()
  const rawEventType = (readString(body, 'event_type') ?? '').trim()

  if (productCode === '' || !UUID_PATTERN.test(templateId)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih produk dan template untuk kirim tes.')
  }
  if (rawEventType !== '' && !isWaEventType(rawEventType)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Jenis acara tidak valid.')
  }

  return {
    productCode,
    templateId,
    eventType: rawEventType === '' ? null : rawEventType,
  }
}

async function readTestPreview(context: RouteContext, target: TestTarget): Promise<Extract<PreviewResult, { found: true }>> {
  const preview = await context.db.rpc<PreviewResult>('wa_reminder_preview', {
    p_now: context.now.toISOString(),
    p_product_code: target.productCode,
    p_template_id: target.templateId,
    p_event_type: target.eventType,
    p_base_url: context.url.origin,
  })

  if (!preview.found) throw new ApiFailure('INVALID_ARGUMENT', undefined, previewMessage(preview.reason))
  return preview
}

function normalizeTime(value: string): string | null {
  const match = TIME_PATTERN.exec(value.trim())
  if (match === null) return null
  const hour = (match[1] ?? '').padStart(2, '0')
  const minute = match[2] ?? ''
  return `${hour}:${minute}:00`
}

function readDays(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback
  const days = [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
  if (days.length === 0) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih minimal satu hari pengiriman.')
  return days.sort((left, right) => left - right)
}

function parseDate(value: string | null): string | null {
  const text = (value ?? '').trim()
  if (text === '') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const parsed = new Date(`${text}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : text
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

async function readFonnteToken(context: RouteContext): Promise<string> {
  const [settings] = await context.db.selectRows<SettingsRow>('wa_bot_settings', { id: 'eq.1' }, 'id,fonnte_token_encrypted,updated_at')
  if (!settings?.fonnte_token_encrypted) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Token Fonnte belum diatur. Simpan token terlebih dahulu.')
  }
  try {
    return await decrypt(settings.fonnte_token_encrypted, context.env.INTEGRATION_ENCRYPTION_KEY)
  } catch {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Token Fonnte tidak dapat dibaca. Simpan ulang token.')
  }
}

function previewMessage(reason: string): string {
  switch (reason) {
    case 'TEMPLATE_NOT_FOUND':
      return 'Template pesan tidak ditemukan.'
    case 'PRODUCT_NOT_FOUND':
      return 'Produk tidak ditemukan.'
    case 'EVENT_TYPE_NOT_FOUND':
      return 'Belum ada order kemarin untuk produk dan jenis acara tersebut.'
    case 'GROUP_NOT_FOUND':
      return 'Produk ini belum punya grup WhatsApp yang aktif.'
    default:
      return 'Data uji kirim tidak lengkap.'
  }
}

function assertCronSecret(context: RouteContext): void {
  const expected = context.env.WA_CRON_SECRET
  if (expected === undefined || expected === '') throw new ApiFailure('NOT_FOUND')
  const provided = context.request.headers.get('x-wa-cron-secret') ?? ''
  if (!constantTimeEqual(provided, expected)) throw new ApiFailure('NOT_FOUND')
}

/** Perbandingan waktu tetap: jangan membocorkan panjang/awalan secret lewat waktu. */
function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return diff === 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
