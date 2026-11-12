-- A71 (permintaan pengguna 12 November 2026)
--
-- 1. Nomor HP pengiklan tidak dipakai lagi: Fonnte tidak bisa men-tag nomor,
--    dan pesan kini menyapa nama. Kolom `advertisers.wa_phone` dihapus.
-- 2. Pengingat dikirim SATU PESAN PER GRUP (per produk + jenis acara), menyebut
--    seluruh pengiklan yang punya aktivitas kemarin untuk jenis acara itu:
--    "Pagi Mas @A, @B, @C. Jangan lupa report kemarin ya."
--
-- Idempotensi pindah dari per pengiklan ke per grup:
-- (schedule_id, product_code, event_type, reminder_date). Baris log gabungan
-- ditandai `advertiser_id is null`; nama pengiklan disimpan sebagai daftar.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 74 $$;

-- ---------------------------------------------------------------------------
-- 1. Hapus nomor HP pengiklan
-- ---------------------------------------------------------------------------
alter table public.advertisers drop column if exists wa_phone;

-- ---------------------------------------------------------------------------
-- 2. Log per grup
-- ---------------------------------------------------------------------------
alter table public.wa_reminder_logs alter column advertiser_id drop not null;

drop index if exists public.wa_reminder_logs_once_idx;
create unique index wa_reminder_logs_once_idx
  on public.wa_reminder_logs (schedule_id, product_code, event_type, reminder_date)
  where schedule_id is not null and status in ('queued', 'sent') and advertiser_id is null;

-- ---------------------------------------------------------------------------
-- 3. Render: {{mention}} menerima daftar "@A, @B" yang sudah dirakit klaim
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

revoke all on function public.wa_render_reminder(text,text,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.wa_render_reminder(text,text,text,text,text,text,text,text,text,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Klaim: satu task per (jadwal, produk, jenis acara)
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
  v_start := ((v_today - 1)::timestamp at time zone 'Asia/Jakarta');
  v_end := (v_today::timestamp at time zone 'Asia/Jakarta');
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 50);

  perform public.wa_reminder_purge(p_now, 3);

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
       and v_local >= (v_today + s.execution_time)
       and v_local < (v_today + s.execution_time + interval '60 minutes')
  ),
  activity as (
    -- Satu baris per pengiklan per jenis acara; penerima = pengiklan aktif
    -- yang ditugaskan ke produk dan punya order kemarin.
    select g.id as product_group_id, g.fonnte_group_id,
           a.id as advertiser_id, a.code as advertiser_code, a.name as advertiser_name,
           p.code as product_code, p.name as product_name,
           o.event_type,
           count(*)::int as leads,
           (count(*) filter (where o.app_status = 'Paid'))::int as paid,
           not exists (
             select 1
               from public.ad_spend_reports r
               join public.products rp on rp.id = r.product_id
              where r.advertiser_id = a.id
                and rp.code_normalized = public.normalize_code(p.code)
                and r.event_type = o.event_type
                and r.date_from <= v_today - 1
                and r.date_to >= v_today - 1
           ) as has_missing
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
     group by g.id, g.fonnte_group_id, a.id, a.code, a.name,
              p.code, p.name, o.event_type
  ),
  grouped as (
    select ac.product_group_id, ac.fonnte_group_id,
           ac.product_code, ac.product_name, ac.event_type,
           array_agg(ac.advertiser_name order by ac.advertiser_name, ac.advertiser_code) as names,
           array_agg(ac.advertiser_code order by ac.advertiser_name, ac.advertiser_code) as codes,
           sum(ac.leads)::int as leads,
           sum(ac.paid)::int as paid,
           bool_or(ac.has_missing) as has_missing
      from activity ac
     group by ac.product_group_id, ac.fonnte_group_id,
              ac.product_code, ac.product_name, ac.event_type
  ),
  candidates as (
    select d.schedule_id, d.template_id, d.execution_time, d.only_if_missing_report,
           d.message_content, g.*
      from due d
      cross join grouped g
     where g.leads > 0
       and (not d.only_if_missing_report or g.has_missing)
       and (select count(*)
              from public.wa_reminder_logs l
             where l.schedule_id = d.schedule_id
               and l.product_code = g.product_code
               and l.event_type = g.event_type
               and l.reminder_date = v_today
               and l.status = 'failed') < 3
  ),
  prepared as (
    select c.*,
           public.wa_render_reminder(
             c.message_content,
             '@' || array_to_string(c.names, ', @'),
             array_to_string(c.names, ', '),
             array_to_string(c.codes, ', '),
             c.product_name,
             c.product_code,
             c.event_type,
             to_char(v_today - 1, 'YYYY-MM-DD'),
             coalesce(p_base_url, '') || '/report-spend?productCode=' || c.product_code
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
    select schedule_id, null, array_to_string(names, ', '), product_code, product_name,
           v_today, fonnte_group_id, template_id, event_type, message, 'queued', 1, p_now
      from prepared
     order by execution_time, product_name, event_type, product_code
     limit v_limit
    on conflict (schedule_id, product_code, event_type, reminder_date)
      where schedule_id is not null and advertiser_id is null and status in ('queued', 'sent')
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
-- 5. Preview: tanpa pengiklan; menyebut seluruh pengiklan beraktivitas
-- ---------------------------------------------------------------------------
drop function if exists public.wa_reminder_preview(timestamptz, text, text, uuid, text, text);

create or replace function public.wa_reminder_preview(
  p_now timestamptz,
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
  v_product public.products;
  v_template public.wa_reminder_templates;
  v_event_type text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_advertisers jsonb;
  v_names text[];
  v_codes text[];
  v_leads int;
  v_paid int;
  v_message text;
begin
  if p_now is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_template from public.wa_reminder_templates where id = p_template_id;
  if not found then return jsonb_build_object('found', false, 'reason', 'TEMPLATE_NOT_FOUND'); end if;

  select * into v_product from public.products
   where code_normalized = public.normalize_code(p_product_code);
  if not found then return jsonb_build_object('found', false, 'reason', 'PRODUCT_NOT_FOUND'); end if;

  select * into v_group from public.wa_product_groups
   where product_id = v_product.id and is_active;
  if not found then return jsonb_build_object('found', false, 'reason', 'GROUP_NOT_FOUND'); end if;

  if v_event_type is null then
    select o.event_type into v_event_type
      from public.orders o
     where o.source = 'orderonline'
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

  select jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name) order by x.name, x.code),
         array_agg(x.name order by x.name, x.code),
         array_agg(x.code order by x.name, x.code),
         sum(x.leads)::int,
         sum(x.paid)::int
    into v_advertisers, v_names, v_codes, v_leads, v_paid
    from (
      select a.code, a.name,
             count(*)::int as leads,
             (count(*) filter (where o.app_status = 'Paid'))::int as paid
        from public.product_advertisers pa
        join public.advertisers a on a.id = pa.advertiser_id and a.active
        join public.orders o
          on o.source = 'orderonline'
         and public.normalize_code(o.advertiser_code) = a.code_normalized
         and public.normalize_code(o.product_code) = v_product.code_normalized
         and o.event_type = v_event_type
         and coalesce(o.source_created_at, o.created_at) >= v_start
         and coalesce(o.source_created_at, o.created_at) < v_end
       where pa.product_id = v_product.id
       group by a.code, a.name
    ) x;

  if v_names is null then
    return jsonb_build_object('found', false, 'reason', 'EVENT_TYPE_NOT_FOUND');
  end if;

  v_message := public.wa_render_reminder(
    v_template.message_content,
    '@' || array_to_string(v_names, ', @'),
    array_to_string(v_names, ', '),
    array_to_string(v_codes, ', '),
    v_product.name,
    v_product.code,
    v_event_type,
    to_char(v_today - 1, 'YYYY-MM-DD'),
    coalesce(p_base_url, '') || '/report-spend?productCode=' || v_product.code
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
    'advertisers', v_advertisers,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'event_type', v_event_type,
    'reminder_date', v_today
  );
end $$;

revoke all on function public.wa_reminder_preview(timestamptz, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.wa_reminder_preview(timestamptz, text, uuid, text, text)
  to service_role;
