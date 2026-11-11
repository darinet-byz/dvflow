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
      redirect: 'error',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        authorization: token,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    })
  } catch {
    return { sent: false, error: 'NETWORK' }
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
