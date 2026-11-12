-- A70 (permintaan pengguna 12 November 2026)
--
-- API Fonnte tidak punya parameter mention/tag: `@628xxx` hanya terkirim
-- sebagai teks biasa, bukan mention WhatsApp. Placeholder {{mention}} sekarang
-- dirender sebagai `@Nama Pengiklan`, bukan nomor HP, supaya pesan tetap
-- terbaca sebagai sapaan dan nomor pribadi tidak tampil di grup.
--
-- Signature `wa_render_reminder` sengaja TIDAK berubah. `p_mention` tetap ada
-- agar `wa_reminder_claim` dan `wa_reminder_preview` tidak perlu dibuat ulang,
-- tetapi nilainya tidak lagi dipakai.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 73 $$;

create or replace function public.wa_render_reminder(
  p_template text,
  p_mention text,
  p_advertiser_name text,
  p_advertiser_code text,
  p_product_name text,
  p_product_code text,
  p_event_type text,
  p_date text,
  p_report_url text,
  p_leads text,
  p_paid text
)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(coalesce(p_template, ''), '{{mention}}',
                        '@' || coalesce(p_advertiser_name, '')),
                      '{{advertiser_name}}', coalesce(p_advertiser_name, '')),
                    '{{store_name}}', coalesce(p_advertiser_name, '')),
                  '{{advertiser_code}}', coalesce(p_advertiser_code, '')),
                '{{product_name}}', coalesce(p_product_name, '')),
              '{{product_code}}', coalesce(p_product_code, '')),
            '{{event_type}}', coalesce(p_event_type, '')),
          '{{date}}', coalesce(p_date, '')),
        '{{report_url}}', coalesce(p_report_url, '')),
      '{{leads}}', coalesce(p_leads, '')),
    '{{paid}}', coalesce(p_paid, ''))
$$;

revoke all on function public.wa_render_reminder(text,text,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.wa_render_reminder(text,text,text,text,text,text,text,text,text,text,text)
  to service_role;
