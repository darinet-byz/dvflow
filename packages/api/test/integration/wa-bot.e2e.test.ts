import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createPostgrestDb } from '../../src/index'

/**
 * WA Admin Bot terhadap PostgREST/PostgreSQL nyata.
 *
 * Unit test memakai tiruan, pgTAP menguji SQL langsung. Berkas ini menutup celah
 * terakhir: nama argumen RPC yang dikirim `Db` harus cocok dengan fungsi yang
 * diekspos PostgREST, dan klaim kedua benar-benar kosong di database sungguhan.
 */

const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
const envVars = processLike?.env ?? {}
const SUPABASE_URL = envVars['SUPABASE_URL']
const SUPABASE_SECRET_KEY = envVars['SUPABASE_SECRET_KEY']
const SUPABASE_DB_URL = envVars['SUPABASE_DB_URL']
const configured = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY && SUPABASE_DB_URL)

if (!configured) {
  console.warn('\n[integrasi] WA bot dilewati: SUPABASE_URL / SUPABASE_SECRET_KEY / SUPABASE_DB_URL tidak diset.\n')
}

const ADVERTISER = 'e7000000-0000-4000-8000-000000000001'
const PRODUCT_A = 'e7000000-0000-4000-8000-000000000011'
const PRODUCT_B = 'e7000000-0000-4000-8000-000000000012'
const GROUP_A = 'e7000000-0000-4000-8000-000000000021'
const GROUP_B = 'e7000000-0000-4000-8000-000000000022'
const TEMPLATE = 'e7000000-0000-4000-8000-000000000031'
const SCHEDULE = 'e7000000-0000-4000-8000-000000000041'
const NOW = '2026-11-11T02:00:00Z'

type Task = { log_id: string; group_id: string; message: string; product_code: string }

describe.skipIf(!configured)('WA Admin Bot end-to-end', () => {
  let client: Client
  const db = createPostgrestDb({
    SUPABASE_URL: SUPABASE_URL as string,
    SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY as string,
    APP_JWT_PRIVATE_KEY: '',
    APP_JWT_KEY_ID: '',
  })

  beforeAll(async () => {
    client = new Client({ connectionString: SUPABASE_DB_URL })
    await client.connect()
    await cleanup()

    await client.query("insert into public.advertisers (id, name, code) values ($1, 'E2E WA', '97')", [ADVERTISER])
    await client.query("insert into public.products (id, name, code) values ($1, 'E2E WA A', 'ZZWA'), ($2, 'E2E WA B', 'ZZWB')", [PRODUCT_A, PRODUCT_B])
    await client.query(
      "insert into public.product_advertisers (product_id, advertiser_id) values ($1, $3), ($2, $3)",
      [PRODUCT_A, PRODUCT_B, ADVERTISER],
    )
    await client.query(
      "insert into public.wa_product_groups (id, product_id, fonnte_group_id) values ($1, $2, '999@g.us'), ($3, $4, '998@g.us')",
      [GROUP_A, PRODUCT_A, GROUP_B, PRODUCT_B],
    )
    await client.query(
      "insert into public.wa_reminder_templates (id, name, message_content) values ($1, 'E2E Template', 'Halo {{mention}} {{advertiser_name}} {{product_name}} {{event_type}} {{leads}}/{{paid}} {{report_url}}')",
      [TEMPLATE],
    )
    await client.query(
      "insert into public.wa_reminder_schedules (id, execution_time, template_id, days) values ($1, '09:00', $2, '{0,1,2,3,4,5,6}')",
      [SCHEDULE, TEMPLATE],
    )
    await client.query(`
      insert into public.orders (order_id, source, name, product_code, product_name, advertiser_code, advertiser_name,
        product_parse_status, event_type, batch, session, city, app_status, gross_amount, source_created_at, created_at) values
        ('WA-E2E-1', 'orderonline', 'A', 'ZZWA', 'E2E WA A', '97', 'E2E WA', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
         '2026-11-10 10:00:00+07', '2026-11-10 10:00:00+07'),
        ('WA-E2E-2', 'orderonline', 'B', 'ZZWA', 'E2E WA A', '97', 'E2E WA', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Pending', 100000,
         '2026-11-10 11:00:00+07', '2026-11-10 11:00:00+07'),
        ('WA-E2E-3', 'orderonline', 'C', 'ZZWB', 'E2E WA B', '97', 'E2E WA', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
         '2026-11-10 12:00:00+07', '2026-11-10 12:00:00+07')
    `)
    await client.query(
      "insert into public.ad_spend_reports (advertiser_id, product_id, batch, event_type, date_from, date_to, spend, tax_percent) values ($1, $2, '100', 'Seminar Offline', '2026-11-10', '2026-11-10', 10000, 0)",
      [ADVERTISER, PRODUCT_B],
    )
  })

  afterAll(async () => {
    if (!configured) return
    await cleanup()
    await client.end()
  })

  async function cleanup(): Promise<void> {
    await client.query('delete from public.wa_reminder_logs where advertiser_id = $1', [ADVERTISER])
    await client.query('delete from public.wa_reminder_schedules where id = $1', [SCHEDULE])
    await client.query('delete from public.wa_reminder_templates where id = $1', [TEMPLATE])
    await client.query('delete from public.wa_product_groups where product_id in ($1, $2)', [PRODUCT_A, PRODUCT_B])
    await client.query('delete from public.product_advertisers where advertiser_id = $1', [ADVERTISER])
    await client.query('delete from public.ad_spend_reports where advertiser_id = $1', [ADVERTISER])
    await client.query("delete from public.orders where order_id like 'WA-E2E-%'")
    await client.query('delete from public.advertisers where id = $1', [ADVERTISER])
    await client.query('delete from public.products where id in ($1, $2)', [PRODUCT_A, PRODUCT_B])
  }

  it('klaim hanya produk yang belum lapor, lalu idempoten dan bisa ditandai', async () => {
    const first = await db.rpc<Task[]>('wa_reminder_claim', {
      p_now: NOW,
      p_base_url: 'https://app.example.com',
      p_limit: 10,
    })
    expect(first).toHaveLength(1)
    expect(first[0]?.product_code).toBe('ZZWA')
    expect(first[0]?.group_id).toBe('999@g.us')
    expect(first[0]?.message).toContain('Halo @E2E WA E2E WA E2E WA A Seminar Offline 2/1')
    expect(first[0]?.message).toContain('report-spend?productCode=ZZWA&eventType=Seminar%20Offline')

    const second = await db.rpc<Task[]>('wa_reminder_claim', {
      p_now: NOW,
      p_base_url: 'https://app.example.com',
      p_limit: 10,
    })
    expect(second).toHaveLength(0)

    const marked = await db.rpc<{ updated: boolean }>('wa_reminder_mark', {
      p_id: first[0]?.log_id,
      p_status: 'sent',
      p_fonnte_message_id: 'e2e-message',
      p_error: null,
    })
    expect(marked.updated).toBe(true)
  })

  it('preview menghitung leads/paid kemarin untuk uji kirim', async () => {
    const preview = await db.rpc<{ found: boolean; leads: number; paid: number; message: string }>('wa_reminder_preview', {
      p_now: NOW,
      p_product_code: 'ZZWA',
      p_template_id: TEMPLATE,
      p_event_type: 'Seminar Offline',
      p_base_url: 'https://app.example.com',
    })
    expect(preview.found).toBe(true)
    expect(preview.leads).toBe(2)
    expect(preview.paid).toBe(1)
    expect(preview.message).toContain('@E2E WA')
  })
})
