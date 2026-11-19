/** Bentuk data WA Admin Bot dari `GET /api/wa-bot` (Fitur 3.0). */
export type WaAdvertiser = {
  id: string
  code: string
  name: string
  active: boolean
}

export type WaProductRef = { code: string; name: string }

export type WaAdvertiserWithProducts = WaAdvertiser & { products: WaProductRef[] }

export type WaProductGroup = {
  id: string
  product_id: string
  fonnte_group_id: string
  is_active: boolean
  /** A82: grup ini boleh memerintah Citta lewat /add dan /delete. */
  ai_enabled: boolean
  created_at: string
  updated_at: string
}

export type WaProduct = {
  id: string
  code: string
  name: string
  active: boolean
  group: WaProductGroup | null
  advertisers: WaAdvertiser[]
}

export type WaTemplate = {
  id: string
  name: string
  message_content: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type WaSchedule = {
  id: string
  execution_time: string
  template_id: string
  template_name: string | null
  days: number[]
  only_if_missing_report: boolean
  mention_scope: 'all' | 'missing'
  is_active: boolean
  created_at: string
  updated_at: string
}

export type WaOverview = {
  settings: { has_token: boolean; updated_at: string | null }
  products: WaProduct[]
  advertisers: WaAdvertiserWithProducts[]
  templates: WaTemplate[]
  schedules: WaSchedule[]
}

/** Ringkasan device dari `POST /api/wa-bot/settings/verify` (token tidak ikut). */
export type WaDeviceInfo = {
  number: string | null
  name: string | null
  status: string | null
  quota: string | null
  package: string | null
  expired: string | null
}

export type WaDeviceCheck = {
  has_token: boolean
  reachable: boolean
  connected: boolean
  status: string | null
  device: WaDeviceInfo | null
  error: string | null
  /** Alasan teknis saat `error: "NETWORK"` (DNS/koneksi/TLS). */
  detail: string | null
}

export type WaLog = {
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

export type WaLogsPage = { rows: WaLog[]; total: number; page: number; pageSize: number }

export type WaPreview = {
  found: true
  group_id: string
  message: string
  leads: number
  paid: number
  advertisers: Array<{ code: string; name: string }>
  mention_scope: 'all' | 'missing'
  product_code: string
  product_name: string
  event_type: string
  reminder_date: string
}

export const WA_STATUS_LABEL: Record<WaLog['status'], string> = {
  queued: 'Menunggu',
  sent: 'Terkirim',
  failed: 'Gagal',
}

/** A82: pengaturan Citta (key tidak pernah dikirim; hanya `has_key`). */
export type AiSettings = {
  enabled: boolean
  base_url: string
  model: string
  has_key: boolean
  updated_at: string | null
}

export type AiTestResult = {
  ok: boolean
  reachable: boolean
  model: string
  error: string | null
  detail: string | null
  reply: string | null
}

export type AiDraft = {
  id: string
  wa_group_id: string
  command: 'add' | 'delete'
  product_code: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'failed'
  code: string
  created_ids: string[]
  deleted_ids: string[]
  error: string | null
  expires_at: string
  confirmed_at: string | null
  created_at: string
}

export type AiRun = {
  id: string
  wa_group_id: string
  command: 'add' | 'delete'
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  status: 'ok' | 'invalid_json' | 'failed'
  error: string | null
  created_at: string
}
