/**
 * Cron Worker WA Admin Bot.
 *
 * Kontraknya sengaja sangat kecil: panggil satu endpoint backend, bawa secret,
 * selesai. Tidak ada token Fonnte, template, atau jadwal di sini — semuanya
 * dikelola dashboard dan dibaca backend (Fitur 3.0).
 */
export type WaCronEnv = {
  APP_BASE_URL: string
  WA_CRON_SECRET: string
}

export type ScheduledResult = { status: number; body: string }

const RUN_PATH = '/api/internal/wa-reminders/run'
const TIMEOUT_MS = 25_000

export async function runScheduled(
  env: WaCronEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<ScheduledResult> {
  const base = (env.APP_BASE_URL ?? '').trim().replace(/\/$/, '')
  if (base === '') throw new Error('APP_BASE_URL belum diatur.')
  if (!env.WA_CRON_SECRET) throw new Error('WA_CRON_SECRET belum diatur.')

  // Cloudflare Workers menolak `redirect: 'error'`; pakai default `follow`.
  const response = await fetchImpl(`${base}${RUN_PATH}`, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'x-wa-cron-secret': env.WA_CRON_SECRET,
      accept: 'application/json',
    },
  })

  const body = (await response.text()).slice(0, 1000)
  return { status: response.status, body }
}

export default {
  async scheduled(
    _event: unknown,
    env: WaCronEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    ctx.waitUntil(
      runScheduled(env)
        .then((result) => {
          // Hanya status yang dicatat: body dapat memuat nama pengiklan.
          console.log(`[wa-cron] run status=${result.status}`)
        })
        .catch((error: unknown) => {
          console.error(`[wa-cron] run gagal: ${error instanceof Error ? error.message : 'unknown'}`)
        }),
    )
  },
}
