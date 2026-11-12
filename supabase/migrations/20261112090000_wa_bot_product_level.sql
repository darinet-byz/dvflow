-- Fitur 3.0.1 — WA Admin Bot: konfigurasi di level PRODUK.
--
-- Perubahan dari 20261111120000_wa_admin_bot.sql:
--   * grup WhatsApp melekat pada produk, bukan pengiklan;
--   * penerima = pengiklan yang ditugaskan ke produk (product_advertisers);
--   * nomor WA pengiklan disimpan di master advertisers;
--   * pengingat dicek per (pengiklan, produk, jenis acara) supaya seminar dan
--     webinar tidak saling menutupi;
--   * isi pesan tidak lagi wajib memuat leads/paid (tetap didukung untuk
--     template lama);
--   * log disimpan 3 hari.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 71 $$;

-- ---------------------------------------------------------------------------
-- 1. Nomor WA pengiklan
-- ---------------------------------------------------------------------------
alter table public.advertisers add column if not exists wa_phone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'advertisers_wa_phone_format'
  ) then
    alter table public.advertisers
      add constraint advertisers_wa_phone_format
      check (wa_phone is null or wa_phone ~ '^62[0-9]{8,13}$');
  end if;
end $$;

-- Nomor lama yang sudah diisi di mapping per pengiklan tidak hilang.
update public.advertisers a
   set wa_phone = g.pic_phone
  from public.wa_reminder_groups g
 where g.advertiser_id = a.id
   and a.wa_phone is null;

-- Tabel lama dibiarkan apa adanya agar deploy baru tidak membuat backend lama
-- 500 selama masa transisi. Kode baru tidak membacanya.
comment on table public.wa_reminder_groups is
  'Legacy mapping grup per pengiklan; tidak dibaca kode sejak migrasi 71 (A67).';

-- ---------------------------------------------------------------------------
-- 2. Mapping grup WhatsApp per produk
-- ---------------------------------------------------------------------------
create table public.wa_product_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products (id) on delete cascade,
  fonnte_group_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_product_groups_group_not_blank check (btrim(fonnte_group_id) <> ''),
  constraint wa_product_groups_group_length check (length(fonnte_group_id) <= 100)
);
create trigger wa_product_groups_set_updated_at
  before update on public.wa_product_groups
  for each row execute function public.set_updated_at();

alter table public.wa_product_groups enable row level security;
revoke all on table public.wa_product_groups from public, anon, authenticated;
grant all on table public.wa_product_groups to service_role;

-- ---------------------------------------------------------------------------
-- 3. Log: jenis acara + idempotensi per jenis acara
-- ---------------------------------------------------------------------------
alter table public.wa_reminder_logs add column if not exists event_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wa_reminder_logs_event_type_check'
  ) then
    alter table public.wa_reminder_logs
      add constraint wa_reminder_logs_event_type_check
      check (event_type is null or event_type in ('Seminar Offline', 'Webinar Online', 'Hybrid'));
  end if;
end $$;

drop index if exists public.wa_reminder_logs_once_idx;
create unique index wa_reminder_logs_once_idx
  on public.wa_reminder_logs (schedule_id, advertiser_id, product_code, event_type, reminder_date)
  where schedule_id is not null and status in ('queued', 'sent');

-- ---------------------------------------------------------------------------
-- 4. Render pesan (dipakai klaim & preview, satu sumber)
-- ---------------------------------------------------------------------------
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
                      replace(coalesce(p_template, ''), '{{mention}}', coalesce(p_mention, '')),
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

-- ---------------------------------------------------------------------------
-- 5. Retensi log: 3 hari
-- ---------------------------------------------------------------------------
create or replace function public.wa_reminder_purge(
  p_now timestamptz default now(),
  p_keep_days integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_keep_days, 3), 1), 30);
  v_deleted integer;
begin
  if p_now is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  delete from public.wa_reminder_logs
   where created_at < p_now - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted, 'keep_days', v_days);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Klaim atomik: jadwal due -> produk yang punya grup -> pengiklan terkait
-- ---------------------------------------------------------------------------
create or replace function public.wa_reminder_claim(
  p_now timestamptz,
  p_base_url text default '',
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_local timestamp;
  v_today date;
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer;
  v_result jsonb;
begin
  if p_now is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  v_local := p_now at time zone 'Asia/Jakarta';
  v_today := v_local::date;
  -- Batas hari WIB yang sama dengan laporan lain (A24).
  v_start := ((v_today - 1)::timestamp at time zone 'Asia/Jakarta');
  v_end := (v_today::timestamp at time zone 'Asia/Jakarta');
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 50);

  -- Retensi defensif: tetap berlaku walau pg_cron tidak tersedia.
  perform public.wa_reminder_purge(p_now, 3);

  -- Worker yang mati setelah klaim tidak boleh memblokir selamanya.
  update public.wa_reminder_logs
     set status = 'failed', error = 'CLAIM_TIMEOUT'
   where status = 'queued'
     and claimed_at is not null
     and claimed_at < p_now - interval '10 minutes';

  with due as (
    select s.id as schedule_id, s.execution_time, s.only_if_missing_report,
           s.template_id, t.message_content
      from public.wa_reminder_schedules s
      join public.wa_reminder_templates t on t.id = s.template_id
     where s.is_active
       and t.is_active
       and s.days @> array[extract(dow from v_today)::smallint]
       -- Toleransi 60 menit: cron boleh datang terlambat tanpa kehilangan jadwal,
       -- dan pengiriman tetap satu kali berkat unique index di bawah.
       and v_local >= (v_today + s.execution_time)
       and v_local < (v_today + s.execution_time + interval '60 minutes')
  ),
  activity as (
    -- Pengiklan dianggap penerima bila ditugaskan ke produk DAN punya nomor.
    -- Jenis acara ikut menjadi kunci supaya seminar dan webinar tidak saling
    -- menutupi saat pengiklan menjalankan keduanya.
    select g.id as product_group_id, g.fonnte_group_id,
           a.id as advertiser_id, a.code as advertiser_code, a.name as advertiser_name,
           a.wa_phone,
           p.code as product_code, p.name as product_name,
           o.event_type,
           count(*)::int as leads,
           (count(*) filter (where o.app_status = 'Paid'))::int as paid
      from public.wa_product_groups g
      join public.products p on p.id = g.product_id
      join public.product_advertisers pa on pa.product_id = p.id
      join public.advertisers a on a.id = pa.advertiser_id
      join public.orders o
        on o.source = 'orderonline'
       and public.normalize_code(o.advertiser_code) = a.code_normalized
       and public.normalize_code(o.product_code) = p.code_normalized
       and o.event_type is not null
       and coalesce(o.source_created_at, o.created_at) >= v_start
       and coalesce(o.source_created_at, o.created_at) < v_end
     where g.is_active
       and a.active
       and a.wa_phone is not null
     group by g.id, g.fonnte_group_id, a.id, a.code, a.name, a.wa_phone,
              p.code, p.name, o.event_type
  ),
  candidates as (
    select d.schedule_id, d.template_id, d.execution_time, d.only_if_missing_report,
           d.message_content, ac.*
      from due d
      cross join activity ac
     where ac.leads > 0
       -- Report dianggap menutup HANYA jenis acara yang sama.
       and (not d.only_if_missing_report or not exists (
             select 1
               from public.ad_spend_reports r
               join public.products rp on rp.id = r.product_id
              where r.advertiser_id = ac.advertiser_id
                and rp.code_normalized = public.normalize_code(ac.product_code)
                and r.event_type = ac.event_type
                and r.date_from <= v_today - 1
                and r.date_to >= v_today - 1
           ))
       and (select count(*)
              from public.wa_reminder_logs l
             where l.schedule_id = d.schedule_id
               and l.advertiser_id = ac.advertiser_id
               and l.product_code = ac.product_code
               and l.event_type = ac.event_type
               and l.reminder_date = v_today
               and l.status = 'failed') < 3
  ),
  prepared as (
    select c.*,
           public.wa_render_reminder(
             c.message_content,
             '@' || c.wa_phone,
             c.advertiser_name,
             c.advertiser_code,
             c.product_name,
             c.product_code,
             c.event_type,
             to_char(v_today - 1, 'YYYY-MM-DD'),
             coalesce(p_base_url, '') || '/report-spend?advertiserCode=' || c.advertiser_code
               || '&productCode=' || c.product_code
               || '&eventType=' || replace(coalesce(c.event_type, ''), ' ', '%20'),
             c.leads::text,
             c.paid::text
           ) as message
      from candidates c
  ),
  inserted as (
    insert into public.wa_reminder_logs (
      schedule_id, advertiser_id, advertiser_name, product_code, product_name,
      reminder_date, group_id, template_id, event_type, message, status, attempts, claimed_at
    )
    select schedule_id, advertiser_id, advertiser_name, product_code, product_name,
           v_today, fonnte_group_id, template_id, event_type, message, 'queued', 1, p_now
      from prepared
     order by execution_time, advertiser_name, product_name, event_type, product_code
     limit v_limit
    on conflict (schedule_id, advertiser_id, product_code, event_type, reminder_date)
      where schedule_id is not null and status in ('queued', 'sent')
      do nothing
    returning id, group_id, message, advertiser_id, advertiser_name,
              product_code, product_name, event_type
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'log_id', i.id,
    'group_id', i.group_id,
    'message', i.message,
    'advertiser_id', i.advertiser_id,
    'advertiser_name', i.advertiser_name,
    'product_code', i.product_code,
    'product_name', i.product_name,
    'event_type', i.event_type
  )), '[]'::jsonb)
  into v_result
  from inserted i;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Tandai hasil pengiriman
-- ---------------------------------------------------------------------------
create or replace function public.wa_reminder_mark(
  p_id uuid,
  p_status text,
  p_fonnte_message_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  update public.wa_reminder_logs
     set status = p_status,
         fonnte_message_id = nullif(btrim(coalesce(p_fonnte_message_id, '')), ''),
         error = case
           when p_status = 'failed' then left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'SEND_FAILED'), 500)
           else null
         end,
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id
     and status = 'queued';

  if not found then
    return jsonb_build_object('updated', false);
  end if;

  return jsonb_build_object('updated', true);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Preview/uji kirim untuk satu (pengiklan, produk, jenis acara)
-- ---------------------------------------------------------------------------
drop function if exists public.wa_reminder_preview(timestamptz, text, text, uuid, text);

create or replace function public.wa_reminder_preview(
  p_now timestamptz,
  p_advertiser_code text,
  p_product_code text,
  p_template_id uuid,
  p_event_type text default null,
  p_base_url text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_today date := (p_now at time zone 'Asia/Jakarta')::date;
  v_start timestamptz := (((p_now at time zone 'Asia/Jakarta')::date - 1)::timestamp at time zone 'Asia/Jakarta');
  v_end timestamptz := ((p_now at time zone 'Asia/Jakarta')::date::timestamp at time zone 'Asia/Jakarta');
  v_group public.wa_product_groups;
  v_advertiser public.advertisers;
  v_product public.products;
  v_template public.wa_reminder_templates;
  v_event_type text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_leads int := 0;
  v_paid int := 0;
  v_message text;
begin
  if p_now is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_template from public.wa_reminder_templates where id = p_template_id;
  if not found then return jsonb_build_object('found', false, 'reason', 'TEMPLATE_NOT_FOUND'); end if;

  select * into v_advertiser from public.advertisers
   where code_normalized = public.normalize_code(p_advertiser_code)
     and active;
  if not found then return jsonb_build_object('found', false, 'reason', 'ADVERTISER_NOT_FOUND'); end if;

  select * into v_product from public.products
   where code_normalized = public.normalize_code(p_product_code);
  if not found then return jsonb_build_object('found', false, 'reason', 'PRODUCT_NOT_FOUND'); end if;

  -- Penerima harus benar-benar ditugaskan ke produk tersebut.
  if not exists (
    select 1 from public.product_advertisers pa
     where pa.product_id = v_product.id and pa.advertiser_id = v_advertiser.id
  ) then
    return jsonb_build_object('found', false, 'reason', 'ADVERTISER_NOT_ASSIGNED');
  end if;

  if v_advertiser.wa_phone is null then
    return jsonb_build_object('found', false, 'reason', 'ADVERTISER_PHONE_MISSING');
  end if;

  select * into v_group from public.wa_product_groups
   where product_id = v_product.id and is_active;
  if not found then return jsonb_build_object('found', false, 'reason', 'GROUP_NOT_FOUND'); end if;

  -- Bila jenis acara tidak dipilih, pakai aktivitas kemarin yang terbaru.
  if v_event_type is null then
    select o.event_type into v_event_type
      from public.orders o
     where o.source = 'orderonline'
       and public.normalize_code(o.advertiser_code) = v_advertiser.code_normalized
       and public.normalize_code(o.product_code) = v_product.code_normalized
       and o.event_type is not null
       and coalesce(o.source_created_at, o.created_at) >= v_start
       and coalesce(o.source_created_at, o.created_at) < v_end
     order by coalesce(o.source_created_at, o.created_at) desc
     limit 1;
  end if;

  if v_event_type is null or v_event_type not in ('Seminar Offline', 'Webinar Online', 'Hybrid') then
    return jsonb_build_object('found', false, 'reason', 'EVENT_TYPE_NOT_FOUND');
  end if;

  select count(*)::int,
         (count(*) filter (where o.app_status = 'Paid'))::int
    into v_leads, v_paid
    from public.orders o
   where o.source = 'orderonline'
     and public.normalize_code(o.advertiser_code) = v_advertiser.code_normalized
     and public.normalize_code(o.product_code) = v_product.code_normalized
     and o.event_type = v_event_type
     and coalesce(o.source_created_at, o.created_at) >= v_start
     and coalesce(o.source_created_at, o.created_at) < v_end;

  v_message := public.wa_render_reminder(
    v_template.message_content,
    '@' || v_advertiser.wa_phone,
    v_advertiser.name,
    v_advertiser.code,
    v_product.name,
    v_product.code,
    v_event_type,
    to_char(v_today - 1, 'YYYY-MM-DD'),
    coalesce(p_base_url, '') || '/report-spend?advertiserCode=' || v_advertiser.code
      || '&productCode=' || v_product.code
      || '&eventType=' || replace(v_event_type, ' ', '%20'),
    v_leads::text,
    v_paid::text
  );

  return jsonb_build_object(
    'found', true,
    'group_id', v_group.fonnte_group_id,
    'message', v_message,
    'leads', v_leads,
    'paid', v_paid,
    'advertiser_id', v_advertiser.id,
    'advertiser_name', v_advertiser.name,
    'advertiser_code', v_advertiser.code,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'event_type', v_event_type,
    'reminder_date', v_today
  );
end $$;

-- ---------------------------------------------------------------------------
-- 9. Index pendukung aktivitas (fungsi normalisasi membuat index kolom mentah
--    tidak terpakai).
-- ---------------------------------------------------------------------------
create index if not exists orders_wa_reminder_activity_idx
  on public.orders (
    public.normalize_code(advertiser_code),
    public.normalize_code(product_code),
    (coalesce(source_created_at, created_at))
  )
  where source = 'orderonline' and event_type is not null;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.wa_render_reminder(text,text,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.wa_render_reminder(text,text,text,text,text,text,text,text,text,text,text)
  to service_role;

revoke all on function public.wa_reminder_purge(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.wa_reminder_purge(timestamptz, integer) to service_role;

revoke all on function public.wa_reminder_claim(timestamptz, text, integer),
  public.wa_reminder_mark(uuid, text, text, text),
  public.wa_reminder_preview(timestamptz, text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.wa_reminder_claim(timestamptz, text, integer),
  public.wa_reminder_mark(uuid, text, text, text),
  public.wa_reminder_preview(timestamptz, text, text, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 11. Retensi 3 hari (log lebih lama dihapus; WhatsApp tetap menyimpan chat).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'pg_cron tidak tersedia: retensi wa_reminder_logs TIDAK dijadwalkan.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'dvflow_wa_reminder_logs_retention') then
    perform cron.unschedule('dvflow_wa_reminder_logs_retention');
  end if;
  perform cron.schedule(
    'dvflow_wa_reminder_logs_retention',
    '43 3 * * *',
    $cron$delete from public.wa_reminder_logs where created_at < now() - interval '3 days'$cron$
  );
end
$$;

-- Bersihkan baris lama saat migrasi, tanpa menunggu jadwal berikutnya.
delete from public.wa_reminder_logs where created_at < now() - interval '3 days';

notify pgrst, 'reload schema';
