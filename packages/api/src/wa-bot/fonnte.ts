import type { Env } from '../env'

/**
 * Klien pengiriman Fonnte.
 *
 * Token dikirim apa adanya di header `Authorization` (dokumentasi Fonnte tidak
 * memakai skema Bearer). Body memakai form-urlencoded seperti contoh resmi.
 * Semua kegagalan dikembalikan sebagai nilai, bukan exception: satu grup yang
 * gagal tidak boleh menghentikan pengiriman grup lain.
 */
export type FonnteSendResult =
  | { sent: true; messageId: string | null }
  | { sent: false; error: string }

/**
 * Ringkasan device dari `POST /device`.
 *
 * `status` di sini adalah `device_status` milik Fonnte: `connect` atau
 * `disconnect`. Menyimpan token BUKAN berarti device terhubung — device bisa
 * terputus dari WhatsApp, dan hanya panggilan ini yang dapat membedakannya.
 */
export type FonnteDeviceInfo = {
  number: string | null
  name: string | null
  status: string | null
  quota: string | null
  package: string | null
  expired: string | null
}

export type FonnteDeviceCheck =
  | { reachable: true; error: null; detail: null; device: FonnteDeviceInfo }
  | { reachable: true; error: string; detail: null; device: null }
  | { reachable: false; error: 'NETWORK'; detail: string; device: null }

/**
 * Fonnte tidak mengalihkan (redirect) endpoint ini; jangan memakai
 * `redirect: 'error'` — runtime Cloudflare Workers menolak nilai itu
 * ("Invalid redirect value") sehingga setiap fetch gagal sebelum koneksi.
 */
const SEND_TIMEOUT_MS = 15_000

export async function sendWhatsAppMessage(
  env: Pick<Env, 'WA_FONNTE_BASE_URL'>,
  token: string,
  target: string,
  message: string,
): Promise<FonnteSendResult> {
  const base = (env.WA_FONNTE_BASE_URL ?? 'https://api.fonnte.com').replace(/\/$/, '')
  const body = new URLSearchParams({ target, message, countryCode: '62' })

  let response: Response
  try {
    response = await fetch(`${base}/send`, {
      method: 'POST',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        authorization: token,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    })
  } catch (error) {
    return { sent: false, error: `NETWORK: ${networkReason(error)}` }
  }

  const parsed = await readJson(response)
  const status = parsed?.['status'] ?? parsed?.['Status']
  if (response.ok && status === true) {
    const ids = parsed?.['id']
    const first = Array.isArray(ids) ? ids[0] : undefined
    return { sent: true, messageId: typeof first === 'string' ? first : null }
  }

  const reason = parsed?.['reason'] ?? parsed?.['detail']
  return {
    sent: false,
    error: typeof reason === 'string' && reason.trim() !== '' ? reason.trim().slice(0, 300) : `HTTP_${response.status}`,
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await response.json()) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Status device lewat `POST /device` (API Device Profile Fonnte).
 *
 * Hasil dibedakan tiga tingkat supaya UI tidak menebak:
 *   * `reachable: false` — Fonnte tidak menjawab (jaringan/timeout);
 *   * `reachable: true, error` — Fonnte menjawab tetapi menolak token;
 *   * `reachable: true, error: null` — token diterima; `device.status` yang
 *     menentukan `connect`/`disconnect`.
 */
export async function checkFonnteDevice(
  env: Pick<Env, 'WA_FONNTE_BASE_URL'>,
  token: string,
): Promise<FonnteDeviceCheck> {
  const base = (env.WA_FONNTE_BASE_URL ?? 'https://api.fonnte.com').replace(/\/$/, '')

  let response: Response
  try {
    response = await fetch(`${base}/device`, {
      method: 'POST',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: { authorization: token, accept: 'application/json' },
    })
  } catch (error) {
    return { reachable: false, error: 'NETWORK', detail: networkReason(error), device: null }
  }

  const parsed = await readJson(response)
  const status = parsed?.['status'] ?? parsed?.['Status']
  if (!response.ok || status !== true) {
    return { reachable: true, error: providerReason(parsed, response.status), detail: null, device: null }
  }

  return {
    reachable: true,
    error: null,
    detail: null,
    device: {
      number: asText(parsed?.['device']),
      name: asText(parsed?.['name']),
      status: asText(parsed?.['device_status']),
      quota: asText(parsed?.['quota']),
      package: asText(parsed?.['package']),
      expired: asText(parsed?.['expired']),
    },
  }
}

function providerReason(parsed: Record<string, unknown> | null, status: number): string {
  const reason = parsed?.['reason'] ?? parsed?.['detail']
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim().slice(0, 300) : `HTTP_${status}`
}

/**
 * Alasan kegagalan jaringan apa adanya (dipotong).
 *
 * Tanpa ini, "NETWORK" saja tidak dapat dibedakan antara DNS gagal, koneksi
 * ditolak, atau TLS ditolak — dan ketiganya berujung pada perbaikan berbeda.
 */
function networkReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown network error'
  const cause = error instanceof Error && error.cause instanceof Error ? ` / ${error.cause.message}` : ''
  return `${message}${cause}`.slice(0, 200)
}

function asText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
