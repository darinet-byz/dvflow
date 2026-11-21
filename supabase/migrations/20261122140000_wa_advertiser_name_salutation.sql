-- 20261122140000_wa_advertiser_name_salutation — A91 (permintaan pengguna 22 Nov 2026).
--
-- Satu variabel untuk menyebut pengiklan: `{{advertiser_name}}`.
-- Nilainya sudah memakai sapaan (mis. "Mas Zul, Mas Andre"), sama seperti
-- `{{mention}}`. `{{mention}}` tetap dikenali sebagai alias lama agar template
-- yang sudah tersimpan tidak terkirim sebagai teks mentah, tetapi tidak lagi
-- ditawarkan di UI.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 92 $$;

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
                        coalesce(nullif(p_mention, ''), p_advertiser_name, '')),
                      '{{advertiser_name}}',
                        coalesce(nullif(p_mention, ''), p_advertiser_name, '')),
                    '{{store_name}}',
                      coalesce(nullif(p_mention, ''), p_advertiser_name, '')),
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

notify pgrst, 'reload schema';
