import { AI_CITTA_PERMISSION, CITTA_AI_USER_ID } from '@dvflow/shared'
import { DbError } from '../db/types'
import { decrypt, encrypt } from '../integrations/crypto'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import { requirePermission } from '../permissions'
import type { RouteContext } from '../router'
import { sendWhatsAppMessage } from '../wa-bot/fonnte'
import { extractScheduleJson, stripFence, testAiConnection, type AiClientConfig } from './deepseek'
import {
  MAX_DELETE_CANDIDATES,
  MAX_INPUT_CHARS,
  buildAddPrompt,
  buildDeletePrompt,
  formatDateId,
  normalizeAdd,
  normalizeDelete,
  shortTime,
  todayWib,
  type NormalizedAddItem,
} from './parser'

/**
 * Citta - DVFLOW AI (A82).
 *
 * Hanya `/add` dan `/delete` di grup produk yang memanggil AI. Pesan lain
 * berhenti sebelum menyentuh database. Produk selalu diambil dari
 * `wa_product_groups`, bukan dari teks, sehingga tidak perlu mengenali pengirim.
 *
 * Semua penulisan tetap dua langkah: draft preview -> `YA` -> RPC atomik.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ADD_COMMAND = /^\s*\/add\b([\s\S]*)$/i
const DELETE_COMMAND = /^\s*\/delete\b([\s\S]*)$/i
const CONFIRM_COMMAND = /^\s*(ya|batal)\b\s*(\d+)?\s*$/i
const DRAFT_TTL_MS = 60 * 60 * 1000
const MAX_DRAFTS_PER_DAY = 10
const MAX_MESSAGES_PER_HOUR = 30
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-flash'
const DRAFT_COLUMNS =
  'id,wa_group_id,member,command,product_id,product_code,raw_text,payload,issues,status,code,revision,created_ids,deleted_ids,deleted_snapshot,model,error,expires_at,confirmed_at,created_at'

type AiSettingsRow = {
  id: number
  enabled: boolean
  provider_base_url: string
  model: string
  api_key_encrypted: string | null
  updated_at: string
}

type GroupRow = {
  id: string
  product_id: string
  fonnte_group_id: string
  is_active: boolean
  ai_enabled: boolean
}

type ProductRow = { id: string; code: string; name: string; active: boolean }

type DraftRow = {
  id: string
  wa_group_id: string
  member: string | null
  command: 'add' | 'delete'
  product_id: string
  product_code: string
  raw_text: string
  payload: { items?: NormalizedAddItem[]; candidates?: CandidateRow[] }
  issues: unknown
  status: string
  code: string
  revision: number
  created_ids: string[]
  deleted_ids: string[]
  deleted_snapshot: unknown
  model: string | null
  error: string | null
  expires_at: string
  confirmed_at: string | null
  created_at: string
}

type CandidateRow = {
  id: string
  category: string
  event_date: string
  start_time: string
  location: string
  city: string | null
  /** A82: event yang punya deadline iklan tidak boleh dihapus dari chat. */
  blocked?: boolean
}

type ConfirmResult = {
  status: string
  saved?: number
  skipped?: number
  created_ids?: string[]
  deleted_ids?: string[]
  reason?: string
}

// ---------------------------------------------------------------------------
// Pengaturan
// ---------------------------------------------------------------------------

/** GET /api/ai/settings */
export async function getAiSettings(context: RouteContext): Promise<Response> {
  await requirePermission(context, AI_CITTA_PERMISSION)
  const row = await loadSettings(context)
  return ok(settingsView(row))
}

/** PUT /api/ai/settings */
export async function saveAiSettings(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, AI_CITTA_PERMISSION)
  const body = await readJsonObject(context.request)
  const current = await loadSettings(context)

  const enabled = typeof body['enabled'] === 'boolean' ? body['enabled'] : (current?.enabled ?? false)
  const baseUrl = (readString(body, 'base_url') ?? current?.provider_base_url ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  const model = (readString(body, 'model') ?? current?.model ?? DEFAULT_MODEL).trim()
  const apiKey = (readString(body, 'api_key') ?? '').trim()

  if (!/^https:\/\/[^\s]+$/i.test(baseUrl) || baseUrl.length > 200) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Base URL wajib HTTPS dan maksimal 200 karakter.')
  }
  if (model === '' || model.length > 80) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Model wajib diisi (maks 80 karakter).')
  }
  if (apiKey !== '' && (apiKey.length < 8 || apiKey.length > 400)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'API key wajib 8–400 karakter.')
  }

  const encrypted = apiKey === ''
    ? (current?.api_key_encrypted ?? null)
    : await encrypt(apiKey, context.env.INTEGRATION_ENCRYPTION_KEY)

  if (current === null) {
    await context.db.insertRow('ai_settings', {
      id: 1,
      enabled,
      provider_base_url: baseUrl,
      model,
      api_key_encrypted: encrypted,
      updated_by: actor.id,
      updated_at: context.now.toISOString(),
    }, 'id')
  } else {
    await context.db.updateRows('ai_settings', { id: 'eq.1' }, {
      enabled,
      provider_base_url: baseUrl,
      model,
      api_key_encrypted: encrypted,
      updated_by: actor.id,
      updated_at: context.now.toISOString(),
    })
  }

  return ok(settingsView(await loadSettings(context)))
}

/** POST /api/ai/settings/test */
export async function testAiSettings(context: RouteContext): Promise<Response> {
  await requirePermission(context, AI_CITTA_PERMISSION)
  const body = await readJsonObject(context.request)
  const current = await loadSettings(context)

  const baseUrl = (readString(body, 'base_url') ?? current?.provider_base_url ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  const model = (readString(body, 'model') ?? current?.model ?? DEFAULT_MODEL).trim()
  const providedKey = (readString(body, 'api_key') ?? '').trim()

  let apiKey = providedKey
  if (apiKey === '' && current?.api_key_encrypted) {
    try {
      apiKey = await decrypt(current.api_key_encrypted, context.env.INTEGRATION_ENCRYPTION_KEY)
    } catch {
      return ok({ ok: false, reachable: false, model, error: 'TOKEN_UNREADABLE', detail: null, reply: null })
    }
  }
  if (apiKey === '') {
    return ok({ ok: false, reachable: false, model, error: 'NO_KEY', detail: null, reply: null })
  }
  if (!/^https:\/\/[^\s]+$/i.test(baseUrl)) {
    return ok({ ok: false, reachable: false, model, error: 'INVALID_BASE_URL', detail: null, reply: null })
  }

  const result = await testAiConnection({ baseUrl, model, apiKey })
  if (!result.ok) {
    return ok({
      ok: false,
      reachable: result.error !== 'NETWORK',
      model,
      error: result.error,
      detail: result.detail,
      reply: null,
    })
  }

  return ok({
    ok: true,
    reachable: true,
    model: result.model,
    error: null,
    detail: null,
    reply: result.content.slice(0, 120),
  })
}

/** GET /api/ai/drafts */
export async function listAiDrafts(context: RouteContext): Promise<Response> {
  await requirePermission(context, AI_CITTA_PERMISSION)
  const rows = await context.db.selectRows<Record<string, unknown>>(
    'ai_drafts',
    { order: 'created_at.desc', limit: '50' },
    'id,wa_group_id,command,product_code,status,code,created_ids,deleted_ids,error,expires_at,confirmed_at,created_at',
  )
  return ok({ drafts: rows })
}

/** POST /api/ai/drafts/:id/cancel */
export async function cancelAiDraft(context: RouteContext): Promise<Response> {
  await requirePermission(context, AI_CITTA_PERMISSION)
  const id = (context.params['id'] ?? '').trim()
  if (!UUID_PATTERN.test(id)) throw new ApiFailure('RESOURCE_NOT_FOUND')

  const [draft] = await context.db.selectRows<{ id: string; status: string }>(
    'ai_drafts',
    { id: `eq.${id}` },
    'id,status',
  )
  if (draft === undefined) throw new ApiFailure('RESOURCE_NOT_FOUND')
  if (draft.status !== 'pending') {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Draft ini sudah tidak menunggu konfirmasi.')
  }
  await context.db.updateRows('ai_drafts', { id: `eq.${id}`, status: 'eq.pending' }, { status: 'cancelled' })
  return ok({ cancelled: id })
}

/** GET /api/ai/runs */
export async function listAiRuns(context: RouteContext): Promise<Response> {
  await requirePermission(context, AI_CITTA_PERMISSION)
  const rows = await context.db.selectRows<Record<string, unknown>>(
    'ai_runs',
    { order: 'created_at.desc', limit: '50' },
    'id,wa_group_id,command,model,input_tokens,output_tokens,status,error,created_at',
  )
  return ok({ runs: rows })
}

// ---------------------------------------------------------------------------
// Webhook Fonnte
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/fonnte/:webhookSecret
 *
 * Gagal-tertutup: tanpa secret yang cocok, 404. Pesan tanpa `/add`/`/delete`
 * (dan tanpa `YA`/`BATAL` untuk draft yang benar-benar ada) berhenti sebelum
 * database disentuh.
 */
export async function fonnteWebhook(context: RouteContext): Promise<Response> {
  assertFonnteSecret(context)

  const body = await readJsonObject(context.request)
  const message = (readString(body, 'message') ?? '').trim()
  const sender = (readString(body, 'sender') ?? '').trim()
  const member = (readString(body, 'member') ?? '').trim()
  const inboxId = (readString(body, 'inboxid') ?? '').trim()
  const timestamp = (readString(body, 'timestamp') ?? '').trim()

  const addMatch = ADD_COMMAND.exec(message)
  const deleteMatch = DELETE_COMMAND.exec(message)
  const confirmMatch = addMatch === null && deleteMatch === null ? CONFIRM_COMMAND.exec(message) : null

  // Gerbang biaya: tanpa perintah, tidak ada query database dan tidak ada AI.
  if (addMatch === null && deleteMatch === null && confirmMatch === null) {
    return ok({ ignored: true })
  }

  const group = await resolveGroup(context, sender, member)
  if (group === null) return ok({ ignored: true })
  if (group.error !== null) {
    await reply(context, group.target, group.error, null)
    return ok({ ignored: true, reason: 'AMBIGUOUS_GROUP' })
  }

  const settings = await loadSettings(context)
  if (settings === null || !settings.enabled) {
    await reply(context, group.target, 'Citta AI sedang dimatikan oleh administrator.', null)
    return ok({ ignored: true, reason: 'DISABLED' })
  }

  const token = await loadFonnteToken(context)
  if (token === null) {
    console.error('[ai] webhook diterima tetapi token Fonnte belum diatur')
    return ok({ ignored: true, reason: 'NO_TOKEN' })
  }

  const rate = await checkRate(context, group.group.fonnte_group_id, addMatch !== null || deleteMatch !== null)
  if (rate !== null) {
    await reply(context, group.target, rate, null)
    return ok({ ignored: true, reason: 'RATE_LIMIT' })
  }

  const dedupeKey = inboxId !== ''
    ? inboxId
    : await sha256Hex(`${group.group.fonnte_group_id}|${member}|${message}|${timestamp}`)
  const duplicate = await context.db.selectRows<{ id: string }>('wa_ai_inbox', { inbox_id: `eq.${dedupeKey}` }, 'id')
  if (duplicate.length > 0) return ok({ duplicate: true })

  const command = addMatch !== null ? 'add' : deleteMatch !== null ? 'delete' : (confirmMatch?.[1]?.toLowerCase() === 'batal' ? 'cancel' : 'confirm')
  await context.db.insertRow('wa_ai_inbox', {
    inbox_id: dedupeKey,
    group_id: group.group.fonnte_group_id,
    member: member === '' ? null : member,
    command,
    received_at: context.now.toISOString(),
  }, 'id')

  if (addMatch !== null || deleteMatch !== null) {
    const product = await loadProduct(context, group.group.product_id)
    if (product === null || !product.active) {
      await reply(context, group.target, 'Produk grup ini tidak aktif. Citta tidak bisa menambah jadwal.', null)
      return ok({ ignored: true, reason: 'PRODUCT_INACTIVE' })
    }

    const text = (addMatch?.[1] ?? deleteMatch?.[1] ?? '').trim()
    if (text.length > MAX_INPUT_CHARS) {
      await reply(context, group.target, `Teks terlalu panjang (maks ${MAX_INPUT_CHARS} karakter).`, null)
      return ok({ ignored: true, reason: 'TOO_LONG' })
    }

    // Perintah baru membatalkan draft lama di grup yang sama.
    await context.db.updateRows(
      'ai_drafts',
      { wa_group_id: `eq.${group.group.fonnte_group_id}`, status: 'eq.pending' },
      { status: 'cancelled' },
    )

    return addMatch !== null
      ? handleAdd(context, group, product, settings, text, member)
      : handleDelete(context, group, product, settings, text, member)
  }

  return handleConfirmation(context, group, confirmMatch as RegExpExecArray)
}

// ---------------------------------------------------------------------------
// /add
// ---------------------------------------------------------------------------

async function handleAdd(
  context: RouteContext,
  group: ResolvedGroup,
  product: ProductRow,
  settings: AiSettingsRow,
  text: string,
  member: string,
): Promise<Response> {
  const today = todayWib(context.now)
  const config = await readAiConfig(context, settings)
  if (config === null) {
    await reply(context, group.target, 'Citta belum dikonfigurasi. Isi API key di WA Admin Bot > Citta AI.', null)
    return ok({ error: 'NO_KEY' })
  }

  const result = await extractScheduleJson(
    config,
    buildAddPrompt(product.code, product.name, today),
    text,
  )
  await logRun(context, group, 'add', settings.model, result)

  if (!result.ok) {
    await reply(context, group.target, `⚠ Citta gagal membaca jadwal: ${friendlyAiError(result.error)}. Coba lagi.`, null)
    return ok({ error: result.error })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(result.content))
  } catch {
    await reply(context, group.target, '⚠ Jawaban AI bukan JSON yang sah. Coba kirim ulang perintahnya.', null)
    return ok({ error: 'INVALID_JSON' })
  }

  const normalized = normalizeAdd(parsed, today)
  await markDuplicates(context, product.code, normalized.items)

  const valid = normalized.items.filter((item) => item.valid)
  if (valid.length === 0) {
    await reply(context, group.target, renderNoValidItems(product, normalized.items, normalized.issues), null)
    return ok({ error: 'NO_VALID_ITEM' })
  }

  const draft = await createDraft(context, group, product, 'add', text, member, {
    items: normalized.items,
  }, normalized.issues, settings.model)

  await reply(context, group.target, renderAddPreview(product, normalized.items, normalized.issues), null)
  return ok({ draft_id: draft.id, code: draft.code })
}

// ---------------------------------------------------------------------------
// /delete
// ---------------------------------------------------------------------------

async function handleDelete(
  context: RouteContext,
  group: ResolvedGroup,
  product: ProductRow,
  settings: AiSettingsRow,
  text: string,
  member: string,
): Promise<Response> {
  const today = todayWib(context.now)
  const config = await readAiConfig(context, settings)
  if (config === null) {
    await reply(context, group.target, 'Citta belum dikonfigurasi. Isi API key di WA Admin Bot > Citta AI.', null)
    return ok({ error: 'NO_KEY' })
  }

  const result = await extractScheduleJson(config, buildDeletePrompt(product.code, product.name, today), text)
  await logRun(context, group, 'delete', settings.model, result)

  if (!result.ok) {
    await reply(context, group.target, `⚠ Citta gagal membaca perintah: ${friendlyAiError(result.error)}. Coba lagi.`, null)
    return ok({ error: result.error })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(result.content))
  } catch {
    await reply(context, group.target, '⚠ Jawaban AI bukan JSON yang sah. Coba kirim ulang perintahnya.', null)
    return ok({ error: 'INVALID_JSON' })
  }

  const normalized = normalizeDelete(parsed, today)
  if (normalized.issues.length > 0 || normalized.match.event_date === null) {
    await reply(
      context,
      group.target,
      `⚠ ${normalized.issues[0] ?? 'Tanggal tidak ditemukan.'}\nContoh: /delete 30 Nov 2026 Pekalongan`,
      null,
    )
    return ok({ error: 'INVALID_MATCH' })
  }

  const rows = await context.db.selectRows<CandidateRow>(
    'event_calendar',
    { product_code: `eq.${product.code}`, event_date: `eq.${normalized.match.event_date}` },
    'id,category,event_date,start_time,location,city',
  )

  const candidates = rows
    .filter((row) => normalized.match.start_time === null || shortTime(row.start_time) === normalized.match.start_time)
    .filter((row) => normalized.match.city === null || (row.city ?? '').toLowerCase() === normalized.match.city.toLowerCase())
    .filter((row) => normalized.match.location === null || row.location.toLowerCase().includes(normalized.match.location.toLowerCase()))
    .sort((left, right) => left.start_time.localeCompare(right.start_time))
    .slice(0, MAX_DELETE_CANDIDATES)

  if (candidates.length === 0) {
    await reply(context, group.target, `Tidak ada jadwal ${product.code} pada ${formatDateId(normalized.match.event_date)}${normalized.match.city ? ` di ${normalized.match.city}` : ''}.`, null)
    return ok({ ignored: true, reason: 'NO_CANDIDATE' })
  }

  const linkedAds = await context.db.selectRows<{ event_id: string | null }>(
    'ad_calendar',
    { event_id: inFilter(candidates.map((row) => row.id)) },
    'event_id',
  )
  const blockedIds = new Set(linkedAds.map((row) => row.event_id).filter((id): id is string => id !== null))
  const enriched = candidates.map((row) => ({ ...row, blocked: blockedIds.has(row.id) }))

  if (enriched.every((row) => row.blocked === true)) {
    await reply(
      context,
      group.target,
      `Semua jadwal ${product.code} pada ${formatDateId(normalized.match.event_date)} punya deadline iklan. Hapus dulu di Kalender Iklan.`,
      null,
    )
    return ok({ ignored: true, reason: 'BLOCKED_BY_AD_CALENDAR' })
  }

  const draft = await createDraft(context, group, product, 'delete', text, member, {
    candidates: enriched.map((row) => ({
      id: row.id,
      category: row.category,
      event_date: row.event_date,
      start_time: shortTime(row.start_time),
      location: row.location,
      city: row.city,
      blocked: row.blocked,
    })),
  }, [], settings.model)

  await reply(context, group.target, renderDeletePreview(product, draft.payload.candidates ?? []), null)
  return ok({ draft_id: draft.id, code: draft.code })
}

// ---------------------------------------------------------------------------
// YA / BATAL
// ---------------------------------------------------------------------------

async function handleConfirmation(
  context: RouteContext,
  group: ResolvedGroup,
  match: RegExpExecArray,
): Promise<Response> {
  const drafts = await context.db.selectRows<DraftRow>(
    'ai_drafts',
    { wa_group_id: `eq.${group.group.fonnte_group_id}`, status: 'eq.pending' },
    DRAFT_COLUMNS,
  )
  const draft = drafts[0]
  if (draft === undefined) {
    await reply(context, group.target, 'Tidak ada draft yang menunggu konfirmasi. Kirim /add atau /delete dulu.', null)
    return ok({ ignored: true, reason: 'NO_DRAFT' })
  }

  if (Date.parse(draft.expires_at) <= context.now.getTime()) {
    await context.db.updateRows('ai_drafts', { id: `eq.${draft.id}`, status: 'eq.pending' }, { status: 'expired' })
    await reply(context, group.target, 'Draft sudah kedaluwarsa. Kirim ulang perintah /add atau /delete.', null)
    return ok({ ignored: true, reason: 'EXPIRED' })
  }

  const action = (match[1] ?? '').toLowerCase()
  if (action === 'batal') {
    const result = (await context.db.rpc<{ status?: string } | null>('ai_cancel_draft', {
      p_draft_id: draft.id,
      p_group_id: group.group.fonnte_group_id,
    })) ?? { status: 'NOT_PENDING' }
    await reply(context, group.target, result.status === 'CANCELLED' ? 'Dibatalkan. Tidak ada yang disimpan.' : 'Draft sudah tidak aktif.', null)
    return ok({ cancelled: true })
  }

  const number = match[2] === undefined ? null : Number(match[2])
  if (number !== null && (!Number.isInteger(number) || number < 1)) {
    await reply(context, group.target, 'Nomor tidak valid. Balas *YA* atau *YA 2*.', null)
    return ok({ ignored: true, reason: 'INVALID_SELECTION' })
  }
  const total = draft.command === 'add'
    ? (draft.payload.items?.length ?? 0)
    : (draft.payload.candidates?.length ?? 0)
  if (number !== null && number > total) {
    await reply(context, group.target, `Nomor ${number} tidak ada. Draft ini hanya berisi ${total} baris.`, null)
    return ok({ ignored: true, reason: 'INVALID_SELECTION' })
  }

  const result = (await context.db.rpc<ConfirmResult | null>('ai_confirm_draft', {
    p_actor: CITTA_AI_USER_ID,
    p_draft_id: draft.id,
    p_group_id: group.group.fonnte_group_id,
    p_selection: number === null ? null : [number],
  })) ?? { status: 'NOT_FOUND' }

  await reply(context, group.target, renderConfirmResult(draft, result, number), null)
  return ok({ status: result.status, saved: result.saved ?? 0 })
}

// ---------------------------------------------------------------------------
// Bantuan
// ---------------------------------------------------------------------------

type ResolvedGroup =
  | { target: string; group: GroupRow; member: string; error: null }
  | { target: string; group: GroupRow; member: string; error: string }

async function resolveGroup(context: RouteContext, sender: string, member: string): Promise<ResolvedGroup | null> {
  const candidates = [sender, member].filter((value) => value !== '')
  if (candidates.length === 0) return null

  const rows = await context.db.selectRows<GroupRow>(
    'wa_product_groups',
    { fonnte_group_id: inFilter(candidates) },
    'id,product_id,fonnte_group_id,is_active,ai_enabled',
  )
  const active = rows.filter((row) => row.is_active && row.ai_enabled)
  if (active.length === 0) return null

  if (active.length > 1) {
    const target = active[0]?.fonnte_group_id ?? candidates[0] ?? ''
    return {
      target,
      group: active[0] as GroupRow,
      member,
      error: 'Grup ini terhubung ke lebih dari satu produk. Perbaiki mapping di WA Admin Bot.',
    }
  }

  const group = active[0] as GroupRow
  // Fonnte mengirim `sender` sebagai id grup untuk pesan grup; `member` adalah
  // pengirim. Bila ternyata terbalik, pencarian di atas tetap menemukan grup
  // yang benar dan balasan tetap diarahkan ke id grup.
  const target = sender === group.fonnte_group_id ? sender : member === group.fonnte_group_id ? member : group.fonnte_group_id
  return { target, group, member, error: null }
}

async function loadProduct(context: RouteContext, productId: string): Promise<ProductRow | null> {
  const [product] = await context.db.selectRows<ProductRow>('products', { id: `eq.${productId}` }, 'id,code,name,active')
  return product ?? null
}

async function checkRate(context: RouteContext, groupId: string, command: boolean): Promise<string | null> {
  const hourAgo = new Date(context.now.getTime() - 60 * 60 * 1000).toISOString()
  const messages = await context.db.countRows('wa_ai_inbox', { group_id: `eq.${groupId}`, received_at: `gte.${hourAgo}` })
  if (messages >= MAX_MESSAGES_PER_HOUR) {
    return `Terlalu banyak pesan ke Citta (maks ${MAX_MESSAGES_PER_HOUR}/jam). Coba lagi nanti.`
  }
  if (command) {
    const dayAgo = new Date(context.now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const drafts = await context.db.countRows('ai_drafts', { wa_group_id: `eq.${groupId}`, created_at: `gte.${dayAgo}` })
    if (drafts >= MAX_DRAFTS_PER_DAY) {
      return `Batas ${MAX_DRAFTS_PER_DAY} draft per hari untuk grup ini sudah tercapai.`
    }
  }
  return null
}

async function createDraft(
  context: RouteContext,
  group: ResolvedGroup,
  product: ProductRow,
  command: 'add' | 'delete',
  rawText: string,
  member: string,
  payload: DraftRow['payload'],
  issues: string[],
  model: string,
): Promise<DraftRow> {
  const row = {
    wa_group_id: group.group.fonnte_group_id,
    member: member === '' ? null : member,
    command,
    product_id: product.id,
    product_code: product.code,
    raw_text: rawText,
    payload,
    issues,
    status: 'pending',
    code: randomCode(),
    revision: 1,
    model,
    expires_at: new Date(context.now.getTime() + DRAFT_TTL_MS).toISOString(),
    created_at: context.now.toISOString(),
  }

  try {
    return await context.db.insertRow<DraftRow>('ai_drafts', row, DRAFT_COLUMNS)
  } catch (error) {
    // Dua perintah bersamaan dari grup yang sama: index unik pending menolak
    // yang kedua. Batalkan draft lama lalu coba sekali lagi.
    if (!(error instanceof DbError) || error.sqlState !== '23505') throw error
    await context.db.updateRows(
      'ai_drafts',
      { wa_group_id: `eq.${group.group.fonnte_group_id}`, status: 'eq.pending' },
      { status: 'cancelled' },
    )
    return context.db.insertRow<DraftRow>('ai_drafts', { ...row, code: randomCode() }, DRAFT_COLUMNS)
  }
}

async function markDuplicates(context: RouteContext, productCode: string, items: NormalizedAddItem[]): Promise<void> {
  for (const item of items) {
    if (!item.valid || item.event_date === '') continue
    const existing = await context.db.selectRows<{ start_time: string; location: string }>(
      'event_calendar',
      { product_code: `eq.${productCode}`, event_date: `eq.${item.event_date}` },
      'start_time,location',
    )
    const duplicate = existing.some((row) =>
      shortTime(row.start_time) === item.start_time
      && row.location.trim().toLowerCase() === item.location.trim().toLowerCase(),
    )
    if (duplicate) {
      item.valid = false
      item.issues.push('Jadwal yang sama sudah ada.')
    }
  }
}

async function logRun(
  context: RouteContext,
  group: ResolvedGroup,
  command: 'add' | 'delete',
  model: string,
  result: Awaited<ReturnType<typeof extractScheduleJson>>,
): Promise<void> {
  await context.db.insertRow('ai_runs', {
    wa_group_id: group.group.fonnte_group_id,
    member: group.member === '' ? null : group.member,
    command,
    model,
    input_tokens: result.ok ? result.usage.input : null,
    output_tokens: result.ok ? result.usage.output : null,
    status: result.ok ? 'ok' : 'failed',
    error: result.ok ? null : `${result.error}${result.detail ? `: ${result.detail}` : ''}`.slice(0, 500),
    created_at: context.now.toISOString(),
  }, 'id')
}

async function loadSettings(context: RouteContext): Promise<AiSettingsRow | null> {
  const [row] = await context.db.selectRows<AiSettingsRow>(
    'ai_settings',
    { id: 'eq.1' },
    'id,enabled,provider_base_url,model,api_key_encrypted,updated_at',
  )
  return row ?? null
}

async function readAiConfig(context: RouteContext, settings: AiSettingsRow): Promise<AiClientConfig | null> {
  if (!settings.api_key_encrypted) return null
  try {
    return {
      baseUrl: settings.provider_base_url,
      model: settings.model,
      apiKey: await decrypt(settings.api_key_encrypted, context.env.INTEGRATION_ENCRYPTION_KEY),
    }
  } catch {
    return null
  }
}

async function loadFonnteToken(context: RouteContext): Promise<string | null> {
  const [row] = await context.db.selectRows<{ fonnte_token_encrypted: string | null }>(
    'wa_bot_settings',
    { id: 'eq.1' },
    'id,fonnte_token_encrypted',
  )
  if (!row?.fonnte_token_encrypted) return null
  try {
    return await decrypt(row.fonnte_token_encrypted, context.env.INTEGRATION_ENCRYPTION_KEY)
  } catch {
    return null
  }
}

async function reply(context: RouteContext, target: string, message: string, inboxId: string | null): Promise<void> {
  const token = await loadFonnteToken(context)
  if (token === null) return
  const result = await sendWhatsAppMessage(context.env, token, target, message, {
    inboxId: inboxId ?? undefined,
  })
  if (!result.sent) console.error(`[ai] balasan gagal: ${result.error}`)
}

function settingsView(row: AiSettingsRow | null): Record<string, unknown> {
  return {
    enabled: row?.enabled ?? false,
    base_url: row?.provider_base_url ?? DEFAULT_BASE_URL,
    model: row?.model ?? DEFAULT_MODEL,
    has_key: Boolean(row?.api_key_encrypted),
    updated_at: row?.updated_at ?? null,
  }
}

// ---------------------------------------------------------------------------
// Render pesan (dari draft, bukan dari model)
// ---------------------------------------------------------------------------

function renderAddPreview(
  product: ProductRow,
  items: NormalizedAddItem[],
  issues: string[],
): string {
  const lines: string[] = ['*Cek dulu - belum disimpan*', '', `Produk: ${product.code} - ${product.name}`, '']
  items.forEach((item, index) => {
    if (!item.valid) {
      lines.push(`${index + 1}. ⚠ ${item.issues.join(' ') || 'Baris tidak valid.'}`)
      lines.push('')
      return
    }
    lines.push(`${index + 1}. ${item.category}${item.category_source === 'location' ? ' (dari lokasi)' : ''}`)
    lines.push(`   ${formatDateId(item.event_date)}, ${item.start_time} WIB`)
    if (item.city !== null) lines.push(`   Kota: ${item.city}`)
    lines.push(`   Lokasi: ${item.location}`)
    lines.push('')
  })
  if (issues.length > 0) lines.push(...issues, '')
  if (items.filter((item) => item.valid).length > 1) {
    lines.push('Balas *YA 2* untuk hanya menyimpan nomor 2.')
  }
  lines.push('Balas *YA* untuk simpan.')
  lines.push('Balas *BATAL* untuk batal.')
  lines.push('Berlaku 60 menit.')
  return clampMessage(lines.join('\n'))
}

function renderNoValidItems(
  product: ProductRow,
  items: NormalizedAddItem[],
  issues: string[],
): string {
  const lines: string[] = [`⚠ Tidak ada jadwal yang bisa disimpan untuk ${product.code} - ${product.name}.`, '']
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.issues.join(' ') || 'Baris tidak valid.'}`)
  })
  if (issues.length > 0) lines.push('', ...issues)
  lines.push('', 'Perbaiki teks lalu kirim ulang /add.')
  return clampMessage(lines.join('\n'))
}

function renderDeletePreview(product: ProductRow, candidates: CandidateRow[]): string {
  const lines: string[] = [
    '*Hapus jadwal ini?*',
    '',
    `Produk: ${product.code} - ${product.name}`,
    '',
  ]
  candidates.forEach((candidate, index) => {
    lines.push(`${index + 1}. ${candidate.category} • ${formatDateId(candidate.event_date)}, ${shortTime(candidate.start_time)} WIB`)
    if (candidate.city) lines.push(`   Kota: ${candidate.city}`)
    lines.push(`   Lokasi: ${candidate.location}`)
    if (candidate.blocked === true) lines.push('   ⚠ Punya deadline iklan - tidak bisa dihapus dari sini.')
    lines.push('')
  })
  lines.push(candidates.length > 1 ? 'Balas *YA 2* untuk memilih nomor 2.' : 'Balas *YA* untuk hapus.')
  lines.push('Balas *BATAL* untuk batal.')
  lines.push('Berlaku 60 menit.')
  return clampMessage(lines.join('\n'))
}

function renderConfirmResult(draft: DraftRow, result: ConfirmResult, number: number | null): string {
  if (result.status === 'EXPIRED') return 'Draft sudah kedaluwarsa. Kirim ulang perintah /add atau /delete.'
  if (result.status === 'NOT_PENDING') return 'Draft ini sudah diproses sebelumnya.'
  if (result.status === 'WRONG_GROUP') return 'Draft ini bukan milik grup ini.'
  if (result.status === 'NOT_FOUND') return 'Draft tidak ditemukan.'
  if (result.status === 'FAILED') {
    return '⚠ Tidak ada baris yang tersimpan. Data mungkin sudah berubah atau baris bermasalah. Kirim ulang perintahnya.'
  }

  const saved = result.saved ?? 0
  const skipped = result.skipped ?? 0
  const lines: string[] = []

  if (draft.command === 'add') {
    const items = draft.payload.items ?? []
    const chosen = number === null
      ? items.filter((item) => item.valid)
      : items[number - 1] !== undefined && (items[number - 1] as NormalizedAddItem).valid
        ? [items[number - 1] as NormalizedAddItem]
        : []
    lines.push(`✅ ${saved} jadwal disimpan.`)
    for (const item of chosen.slice(0, saved)) {
      lines.push(`${formatDateId(item.event_date)}, ${item.start_time} • ${item.location}`)
    }
  } else {
    const candidates = draft.payload.candidates ?? []
    const chosen = number === null
      ? candidates.filter((candidate) => candidate.blocked !== true)
      : candidates[number - 1] !== undefined && (candidates[number - 1] as CandidateRow).blocked !== true
        ? [candidates[number - 1] as CandidateRow]
        : []
    lines.push(`✅ ${saved} jadwal dihapus.`)
    for (const candidate of chosen.slice(0, saved)) {
      lines.push(`${formatDateId(candidate.event_date)}, ${shortTime(candidate.start_time)} • ${candidate.location}`)
    }
  }

  if (skipped > 0) {
    lines.push(`⚠ ${skipped} baris dilewati (duplikat / data sudah berubah).`)
  }
  return clampMessage(lines.join('\n'))
}

function clampMessage(message: string): string {
  return message.length <= 3500 ? message : `${message.slice(0, 3400)}\n… pesan dipotong.`
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function assertFonnteSecret(context: RouteContext): void {
  const expected = context.env.FONNTE_WEBHOOK_SECRET
  if (expected === undefined || expected === '') throw new ApiFailure('NOT_FOUND')
  const provided = context.params['webhookSecret'] ?? ''
  if (!constantTimeEqual(provided, expected)) throw new ApiFailure('NOT_FOUND')
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return diff === 0
}

function inFilter(values: string[]): string {
  const quoted = values.map((value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
  return `in.(${quoted.join(',')})`
}

function randomCode(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function friendlyAiError(error: string): string {
  if (error === 'NETWORK') return 'jaringan ke penyedia AI gagal'
  if (error === 'HTTP_401' || error === 'HTTP_403') return 'API key ditolak'
  if (error === 'HTTP_404') return 'model/endpoint tidak ditemukan'
  if (error === 'HTTP_429') return 'kuota/rate limit penyedia AI'
  if (error === 'INVALID_RESPONSE' || error === 'EMPTY_RESPONSE') return 'jawaban AI tidak valid'
  return 'layanan AI gagal'
}
