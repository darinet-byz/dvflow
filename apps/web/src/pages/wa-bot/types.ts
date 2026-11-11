/** Bentuk data WA Admin Bot dari `GET /api/wa-bot` (Fitur 3.0). */
export type WaAdvertiser = { id: string; code: string; name: string; active: boolean }

export type WaGroup = {
  id: string
  advertiser_id: string
  advertiser_code: string | null
  advertiser_name: string | null
  advertiser_active: boolean
  fonnte_group_id: string
  pic_phone: string
  pic_name: string | null
  is_active: boolean
  created_at: string
  updated_at: string
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
  is_active: boolean
  created_at: string
  updated_at: string
}

export type WaOverview = {
  settings: { has_token: boolean; updated_at: string | null }
  advertisers: WaAdvertiser[]
  groups: WaGroup[]
  templates: WaTemplate[]
  schedules: WaSchedule[]
}

export type WaLog = {
  id: string
  schedule_id: string | null
  advertiser_id: string
  advertiser_name: string
  product_code: string
  product_name: string | null
  reminder_date: string
  group_id: string
  template_id: string | null
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

export const WA_STATUS_LABEL: Record<WaLog['status'], string> = {
  queued: 'Menunggu',
  sent: 'Terkirim',
  failed: 'Gagal',
}
