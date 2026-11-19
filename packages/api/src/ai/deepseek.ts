/**
 * Klien LLM Citta (A82).
 *
 * Citta sengaja tidak memakai SDK: yang dibutuhkan hanya satu endpoint
 * chat-completions yang kompatibel OpenAI. Base URL dan model dapat diganti
 * dari dashboard, sehingga provider lain yang kompatibel bisa dipakai tanpa
 * mengubah kode.
 *
 * Key TIDAK pernah dikirim ke browser dan TIDAK pernah dicatat di log.
 */
const TIMEOUT_MS = 20_000

export type AiClientConfig = {
  baseUrl: string
  model: string
  apiKey: string
}

export type AiUsage = { input: number; output: number }

export type AiCallResult =
  | { ok: true; content: string; usage: AiUsage; model: string }
  | { ok: false; error: string; detail: string | null }

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

function endpoint(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
}

function isDeepSeek(config: AiClientConfig): boolean {
  return /deepseek/i.test(config.baseUrl) || /deepseek/i.test(config.model)
}

async function postChat(
  config: AiClientConfig,
  messages: ChatMessage[],
  options: { json: boolean; maxTokens: number },
): Promise<AiCallResult> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: 0.1,
    max_tokens: options.maxTokens,
    stream: false,
  }
  if (options.json) body['response_format'] = { type: 'json_object' }
  // DeepSeek V4: thinking mode menagih token reasoning dan bisa 3-10x lipat.
  if (isDeepSeek(config)) body['thinking'] = { type: 'disabled' }

  let response: Response
  try {
    response = await fetch(endpoint(config.baseUrl), {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    return { ok: false, error: 'NETWORK', detail: networkReason(error) }
  }

  const text = await response.text()
  if (!response.ok) {
    return {
      ok: false,
      error: `HTTP_${response.status}`,
      detail: providerDetail(text),
    }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { ok: false, error: 'INVALID_RESPONSE', detail: text.slice(0, 300) }
  }

  const choices = parsed['choices']
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined
  const message = first?.['message'] as Record<string, unknown> | undefined
  const content = typeof message?.['content'] === 'string' ? message['content'] : ''
  if (content.trim() === '') {
    return { ok: false, error: 'EMPTY_RESPONSE', detail: null }
  }

  const usage = parsed['usage'] as Record<string, unknown> | undefined
  return {
    ok: true,
    content,
    model: typeof parsed['model'] === 'string' ? parsed['model'] : config.model,
    usage: {
      input: numberOrZero(usage?.['prompt_tokens']),
      output: numberOrZero(usage?.['completion_tokens']),
    },
  }
}

/** Ekstraksi jadwal. Output wajib JSON; retry satu kali bila JSON rusak. */
export async function extractScheduleJson(
  config: AiClientConfig,
  systemPrompt: string,
  userText: string,
): Promise<AiCallResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ]
  const first = await postChat(config, messages, { json: true, maxTokens: 1200 })
  if (!first.ok) return first
  if (isJsonObject(first.content)) return first

  // Sebagian model membungkus JSON dengan pagar kode. Coba bersihkan dulu.
  if (isJsonObject(stripFence(first.content))) {
    return { ...first, content: stripFence(first.content) }
  }

  const retry = await postChat(
    config,
    [
      ...messages,
      { role: 'assistant', content: first.content.slice(0, 2000) },
      { role: 'user', content: 'Jawaban sebelumnya bukan JSON yang sah. Balas HANYA objek JSON sesuai skema.' },
    ],
    { json: true, maxTokens: 1200 },
  )
  if (!retry.ok) return retry
  return { ...retry, content: stripFence(retry.content) }
}

/** Tes koneksi: panggilan kecil yang membuktikan key + model diterima. */
export async function testAiConnection(config: AiClientConfig): Promise<AiCallResult> {
  return postChat(
    config,
    [
      {
        role: 'system',
        content: 'Anda adalah pemeriksa koneksi. Balas satu kata: OK.',
      },
      { role: 'user', content: 'Balas OK.' },
    ],
    { json: false, maxTokens: 8 },
  )
}

export function stripFence(text: string): string {
  const trimmed = text.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match?.[1]?.trim() ?? trimmed
}

function isJsonObject(text: string): boolean {
  const value = text.trim()
  if (!value.startsWith('{') || !value.endsWith('}')) return false
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function providerDetail(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const error = parsed['error']
    if (typeof error === 'object' && error !== null) {
      const message = (error as Record<string, unknown>)['message']
      if (typeof message === 'string' && message.trim() !== '') return message.trim().slice(0, 300)
    }
    if (typeof parsed['message'] === 'string' && parsed['message'].trim() !== '') {
      return parsed['message'].trim().slice(0, 300)
    }
  } catch {
    // Bukan JSON; pakai potongan teks.
  }
  return text.trim() === '' ? null : text.trim().slice(0, 300)
}

function networkReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown network error'
  const cause = error instanceof Error && error.cause instanceof Error ? ` / ${error.cause.message}` : ''
  return `${message}${cause}`.slice(0, 200)
}
