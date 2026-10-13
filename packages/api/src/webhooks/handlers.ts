import {
  UnsupportedOrderStatusError,
  WEBHOOK_MAX_BODY_BYTES,
  normalizeAppStatus,
  parseProductRaw,
  validateCanonicalOrderWebhook,
  type AdvertiserConfigRow,
  type AppStatus,
  type CanonicalOrderWebhook,
  type EventTypeConfigRow,
  type ProductConfigRow,
  type ProductConfigSet,
  type ProductParseResult,
  type SessionConfigRow,
} from '@dvflow/shared'
import type { Db } from '../db/types'
import { DbError } from '../db/types'
import { fail, ok } from '../http/response'
import type { RouteContext } from '../router'
import { adaptOrderOnlineWebhook } from './adapter'

/**
 * POST /api/webhooks/orderonline/:webhookSecret (03 §3, 01 §20, 01 §21).
 *
 * Urutannya sengaja persis seperti kontrak: cek secret → baca body → adapter →
 * validasi kanonik → normalisasi status → parse produk → upsert → balas cepat.
 *
 * Tiga sifat yang dijaga:
 *   * **Tidak pernah menebak.** Status tak dikenal ditolak 422; produk yang
 *     tidak terbaca membuat order tetap tersimpan dengan parse `invalid`.
 *   * **Aman pada retry.** Seluruh idempotensi ada di `upsert_order_webhook`
 *     (UNIQUE `order_id`), bukan di handler ini.
 *   * **Terlihat.** Setiap hasil ditulis ke `webhook_logs` (best-effort) supaya
 *     ingestion dapat didiagnosa tanpa membocorkan data pelanggan.
 */
export async function orderOnlineWebhook(context: RouteContext): Promise<Response> {
  if (!isWebhookSecretValid(context)) return fail('NOT_FOUND')

  const body = await readJsonWithinLimit(context.request, WEBHOOK_MAX_BODY_BYTES)
  if (!body.ok) {
    await logWebhook(context, {
      outcome: 'rejected',
      errorCode: 'INVALID_PAYLOAD',
      orderId: null,
      summary: { reason: body.reason },
    })
    return fail('INVALID_PAYLOAD')
  }

  const adapted = adaptOrderOnlineWebhook(body.value)
  if (!adapted.ok) {
    await logWebhook(context, {
      outcome: 'rejected',
      errorCode: 'INVALID_PAYLOAD',
      orderId: null,
      summary: { reason: adapted.reason, detail: adapted.detail },
    })
    return fail('INVALID_PAYLOAD')
  }

  const validated = validateCanonicalOrderWebhook(adapted.value)
  if (!validated.ok) {
    await logWebhook(context, {
      outcome: 'rejected',
      errorCode: 'INVALID_PAYLOAD',
      orderId: adapted.value.orderId,
      summary: { reason: 'CANONICAL_VALIDATION_FAILED', detail: validated.message },
    })
    return fail('INVALID_PAYLOAD')
  }

  const canonical = validated.value

  let appStatus: AppStatus
  try {
    appStatus = normalizeAppStatus(canonical.rawStatus)
  } catch (error) {
    if (!(error instanceof UnsupportedOrderStatusError)) throw error

    // 03 §3: status tak dikenal TIDAK dipetakan diam-diam.
    await logWebhook(context, {
      outcome: 'rejected',
      errorCode: 'UNSUPPORTED_ORDER_STATUS',
      orderId: canonical.orderId,
      summary: { raw_status: canonical.rawStatus, shape: adapted.shape },
    })
    return fail('UNSUPPORTED_ORDER_STATUS')
  }

  const config = await loadProductConfig(context.db)
  const parse = parseProductRaw(canonical.productRaw, config)

  let result: { order_id: string; action: string }
  try {
    result = await context.db.rpc<{ order_id: string; action: string }>('upsert_order_webhook', {
      p_payload: buildRpcPayload(canonical, appStatus, parse),
    })
  } catch (error) {
    // Kegagalan database tetap dicatat supaya tidak ada webhook yang hilang diam-diam.
    await logWebhook(context, {
      outcome: 'failed',
      errorCode: error instanceof DbError ? error.sqlState : 'INTERNAL_ERROR',
      orderId: canonical.orderId,
      summary: { raw_status: canonical.rawStatus, shape: adapted.shape },
    })
    throw error
  }

  await logWebhook(context, {
    outcome: 'accepted',
    errorCode: null,
    orderId: canonical.orderId,
    summary: {
      shape: adapted.shape,
      action: result.action,
      raw_status: canonical.rawStatus,
      app_status: appStatus,
      product_raw: canonical.productRaw,
      product_parse_status: parse.product_parse_status,
      // K9: alasan dan kandidat ambiguitas dicatat untuk diagnosa operator.
      parse_failure_reason: parse.failure_reason,
      parse_candidates: parse.candidates,
      payment_method: canonical.paymentMethod,
      payment_provider: canonical.paymentProvider,
      payment_identifier: canonical.paymentIdentifier,
      gross_amount: canonical.grossAmount,
      warnings: adapted.warnings,
    },
  })

  return ok({ order_id: result.order_id, action: result.action })
}

/**
 * Perbandingan secret.
 *
 * Secret yang salah dibalas 404 (bukan 401) supaya endpoint tidak mudah
 * ditebak (01 §20). Perbandingannya tidak keluar lebih awal saat byte berbeda.
 * Bila environment TIDAK menyetel secret, semuanya ditolak — gagal-tertutup,
 * bukan gagal-terbuka.
 */
function isWebhookSecretValid(context: RouteContext): boolean {
  const expected = context.env.ORDERONLINE_WEBHOOK_SECRET
  if (typeof expected !== 'string' || expected.length === 0) return false

  const provided = context.params['webhookSecret'] ?? ''
  const left = new TextEncoder().encode(provided)
  const right = new TextEncoder().encode(expected)
  if (left.length !== right.length) return false

  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] as number) ^ (right[index] as number)
  }
  return diff === 0
}

type BodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'EMPTY_BODY' | 'TOO_LARGE' | 'INVALID_JSON' }

/**
 * Baca body JSON dengan batas ukuran (04 §10).
 *
 * `content-length` diperiksa lebih dulu supaya body raksasa tidak perlu dibaca;
 * bila header itu tidak ada (chunked), ukuran sebenarnya diperiksa setelah baca.
 */
async function readJsonWithinLimit(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const declared = Number(declaredLength)
    if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'TOO_LARGE' }
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, reason: 'INVALID_JSON' }
  }

  if (text.trim() === '') return { ok: false, reason: 'EMPTY_BODY' }
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, reason: 'TOO_LARGE' }

  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'INVALID_JSON' }
  }
}

/**
 * Konfigurasi untuk parser.
 *
 * Sengaja TIDAK difilter `active` (STATE.md K8): menonaktifkan produk tidak
 * boleh membuat order lama yang sudah Paid kehilangan akses acara.
 */
export async function loadProductConfig(db: Db): Promise<ProductConfigSet> {
  const [products, advertisers, eventTypes, sessions] = await Promise.all([
    db.selectRows<ProductConfigRow>('products', {}, 'name,code,active'),
    db.selectRows<AdvertiserConfigRow>('advertisers', {}, 'name,code,active'),
    db.selectRows<EventTypeConfigRow>('event_types', {}, 'name,code,kind,active'),
    db.selectRows<SessionConfigRow>('sessions_config', {}, 'name,code,active'),
  ])
  return { products, advertisers, eventTypes, sessions }
}

/** Susun objek yang diterima RPC `upsert_order_webhook` (lihat 0017). */
function buildRpcPayload(
  canonical: CanonicalOrderWebhook,
  appStatus: AppStatus,
  parse: ProductParseResult,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    orderId: canonical.orderId,
    customerName: canonical.customerName ?? null,
    phone: canonical.phone ?? null,
    email: canonical.email ?? null,
    productRaw: canonical.productRaw ?? null,
    rawStatus: canonical.rawStatus,
    paymentMethod: canonical.paymentMethod ?? null,
    paymentProvider: canonical.paymentProvider ?? null,
    paymentIdentifier: canonical.paymentIdentifier ?? null,
    grossAmount: canonical.grossAmount,
    sourceCreatedAt: canonical.sourceCreatedAt ?? null,
    sourceUpdatedAt: canonical.sourceUpdatedAt ?? null,
    appStatus,
  }

  // Blok `parse` hanya boleh ada bila productRaw dikirim — RPC menolak
  // kombinasi lain (kontrak 0017).
  if (canonical.productRaw !== null && canonical.productRaw !== undefined) {
    payload['parse'] =
      parse.product_parse_status === 'valid'
        ? {
            status: 'valid',
            productCode: parse.product_code,
            productName: parse.product_name,
            advertiserCode: parse.advertiser_code,
            advertiserName: parse.advertiser_name,
            eventType: parse.event_type,
            batch: parse.batch,
            session: parse.session,
            city: parse.city,
          }
        : { status: 'invalid' }
  }

  return payload
}

type WebhookLogInput = {
  outcome: string
  errorCode: string | null
  orderId: string | null
  summary: Record<string, unknown>
}

/**
 * Tulis `webhook_logs` (02 §12, 01 §19).
 *
 * Best-effort: kegagalan menulis log TIDAK boleh mengubah hasil webhook.
 *
 * Isinya sengaja **tanpa PII**: hanya Order ID, status, produk, dan pembayaran.
 * Nama, nomor WA, dan email pelanggan tidak disimpan di sini — log bukan tempat
 * menyimpan data pribadi, dan 04 §14 meminta konteks seperlunya saja.
 */
async function logWebhook(context: RouteContext, input: WebhookLogInput): Promise<void> {
  try {
    await context.db.insertRow('webhook_logs', {
      provider: 'orderonline',
      order_id: input.orderId,
      outcome: input.outcome,
      error_code: input.errorCode,
      payload_sanitized: input.summary,
    })
  } catch {
    // Diabaikan dengan sengaja; lihat komentar di atas.
  }
}
