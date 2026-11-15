import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requirePermission } from '../permissions'

/**
 * Chat Internal (A79).
 *
 * Satu thread selalu 1:1. Pengirim memilih role lalu "Semua [Role]" atau satu
 * penerima. Kiriman ke "Semua" dipecah server menjadi satu pesan per penerima
 * (fan-out), sehingga tiap penerima melihat percakapan dengan namanya sendiri.
 *
 * Semua baca/tulis lewat RPC service_role; tabel chat tertutup untuk browser.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY = 2000

/** GET /api/chat/recipients — role + user aktif yang boleh dihubungi. */
export async function listChatRecipients(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.chat')
  const result = await context.db.rpc<Record<string, unknown>>('chat_recipients', { p_actor: actor.id })
  return ok(result)
}

/** GET /api/chat/threads — daftar percakapan + jumlah belum dibaca. */
export async function listChatThreads(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.chat')
  const result = await context.db.rpc<Record<string, unknown>>('chat_threads_page', { p_actor: actor.id })
  return ok(result)
}

/** GET /api/chat/threads/:id/messages — isi thread; pesan lawan ditandai dibaca. */
export async function listChatMessages(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.chat')
  const result = await context.db.rpc<Record<string, unknown>>('chat_messages_page', {
    p_actor: actor.id,
    p_thread_id: threadId(context),
  })
  return ok(result)
}

/** POST /api/chat/messages — kirim ke satu penerima atau semua anggota role. */
export async function sendChatMessage(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'action.send_chat')
  const body = await readJsonObject(context.request)
  const roleId = (readString(body, 'role_id') ?? '').trim()
  const message = (readString(body, 'body') ?? '').trim()
  const all = body['all'] === true
  const recipientRaw = (readString(body, 'recipient_id') ?? '').trim()

  if (roleId === '') throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih role penerima.')
  if (message === '' || message.length > MAX_BODY) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pesan wajib diisi (maks 2.000 karakter).')
  }

  let recipientId: string | null = null
  if (!all) {
    if (!UUID_PATTERN.test(recipientRaw)) {
      throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Pilih penerima pesan.')
    }
    recipientId = recipientRaw
  }

  const result = await context.db.rpc<Record<string, unknown>>('send_chat_message', {
    p_actor: actor.id,
    p_role_id: roleId,
    p_recipient_id: recipientId,
    p_all: all,
    p_body: message,
  })
  return ok(result, { status: 201 })
}

function threadId(context: RouteContext): string {
  const id = (context.params['id'] ?? '').trim()
  if (!UUID_PATTERN.test(id)) throw new ApiFailure('RESOURCE_NOT_FOUND')
  return id
}
