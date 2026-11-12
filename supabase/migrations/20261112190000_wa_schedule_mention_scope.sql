-- A72 (permintaan pengguna 12 November 2026)
--
-- Satu hari boleh punya beberapa jadwal dengan audiens berbeda:
--   * 09:00 -> sebut SEMUA pengiklan yang beraktivitas kemarin;
--   * 13:00/17:00 -> sebut HANYA pengiklan yang belum lapor.
--
-- Pengaturan ini melekat pada JADWAL (`wa_reminder_schedules.mention_scope`),
-- bukan pada template: satu template boleh dipakai beberapa jadwal dengan
-- audiens berbeda.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 75 $$;

alter table public.wa_reminder_schedules
  add column if not exists mention_scope text not null default 'all';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wa_reminder_schedules_mention_scope_check') then
    alter table public.wa_reminder_schedules
      add constraint wa_reminder_schedules_mention_scope_check
      check (mention_scope in ('all', 'missing'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Klaim: audiens mengikuti mention_scope jadwal
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
           s.mention_scope, s.template_id, t.message_content
      from public.wa_reminder_schedules s
      join public.wa_reminder_templates t on t.id = s.template_id
     where s.is_active
       and t.is_active
       and s.days @> array[extract(dow from v_today)::smallint]
       and v_local >= (v_today + s.execution_time)
       and v_local < (v_today + s.execution_time + interval '60 minutes')
  ),
  activity as (
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
           array_agg(ac.advertiser_name order by ac.advertiser_name, ac.advertiser_code) as all_names,
           array_agg(ac.advertiser_code order by ac.advertiser_name, ac.advertiser_code) as all_codes,
           array_agg(ac.advertiser_name order by ac.advertiser_name, ac.advertiser_code)
             filter (where ac.has_missing) as missing_names,
           array_agg(ac.advertiser_code order by ac.advertiser_name, ac.advertiser_code)
             filter (where ac.has_missing) as missing_codes,
           sum(ac.leads)::int as leads_all,
           sum(ac.paid)::int as paid_all,
           (sum(ac.leads) filter (where ac.has_missing))::int as leads_missing,
           (sum(ac.paid) filter (where ac.has_missing))::int as paid_missing,
           bool_or(ac.has_missing) as has_missing
      from activity ac
     group by ac.product_group_id, ac.fonnte_group_id,
              ac.product_code, ac.product_name, ac.event_type
  ),
  candidates as (
    select d.schedule_id, d.template_id, d.execution_time, d.only_if_missing_report,
           d.mention_scope, d.message_content, g.*
      from due d
      cross join grouped g
     where (
             (d.mention_scope = 'missing' and coalesce(array_length(g.missing_names, 1), 0) > 0)
             or (d.mention_scope <> 'missing' and g.leads_all > 0
                 and (not d.only_if_missing_report or g.has_missing))
           )
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
             '@' || array_to_string(
               case when c.mention_scope = 'missing' then c.missing_names else c.all_names end,
               ', @'
             ),
             array_to_string(
               case when c.mention_scope = 'missing' then c.missing_names else c.all_names end,
               ', '
             ),
             array_to_string(
               case when c.mention_scope = 'missing' then c.missing_codes else c.all_codes end,
               ', '
             ),
             c.product_name,
             c.product_code,
             c.event_type,
             to_char(v_today - 1, 'YYYY-MM-DD'),
             coalesce(p_base_url, '') || '/report-spend?productCode=' || c.product_code
               || '&eventType=' || replace(coalesce(c.event_type, ''), ' ', '%20'),
             (case when c.mention_scope = 'missing' then c.leads_missing else c.leads_all end)::text,
             (case when c.mention_scope = 'missing' then c.paid_missing else c.paid_all end)::text
           ) as message
      from candidates c
  ),
  inserted as (
    insert into public.wa_reminder_logs (
      schedule_id, advertiser_id, advertiser_name, product_code, product_name,
      reminder_date, group_id, template_id, event_type, message, status, attempts, claimed_at
    )
    select schedule_id, null,
           array_to_string(
             case when mention_scope = 'missing' then missing_names else all_names end,
             ', '
           ),
           product_code, product_name,
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
-- 2. Preview: audiens mengikuti mode yang dipilih di modal Kirim Tes
-- ---------------------------------------------------------------------------
drop function if exists public.wa_reminder_preview(timestamptz, text, uuid, text, text);

create or replace function public.wa_reminder_preview(
  p_now timestamptz,
  p_product_code text,
  p_template_id uuid,
  p_event_type text default null,
  p_base_url text default '',
  p_mention_scope text default 'all'
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
  v_scope text := case when p_mention_scope = 'missing' then 'missing' else 'all' end;
  v_total int := 0;
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

  select count(*)::int,
         jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name) order by x.name, x.code)
           filter (where v_scope <> 'missing' or x.has_missing),
         array_agg(x.name order by x.name, x.code)
           filter (where v_scope <> 'missing' or x.has_missing),
         array_agg(x.code order by x.name, x.code)
           filter (where v_scope <> 'missing' or x.has_missing),
         (sum(x.leads) filter (where v_scope <> 'missing' or x.has_missing))::int,
         (sum(x.paid) filter (where v_scope <> 'missing' or x.has_missing))::int
    into v_total, v_advertisers, v_names, v_codes, v_leads, v_paid
    from (
      select a.code, a.name,
             count(*)::int as leads,
             (count(*) filter (where o.app_status = 'Paid'))::int as paid,
             not exists (
               select 1
                 from public.ad_spend_reports r
                 join public.products rp on rp.id = r.product_id
                where r.advertiser_id = a.id
                  and rp.code_normalized = v_product.code_normalized
                  and r.event_type = v_event_type
                  and r.date_from <= v_today - 1
                  and r.date_to >= v_today - 1
             ) as has_missing
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
       group by a.id, a.code, a.name
    ) x;

  if v_total = 0 then
    return jsonb_build_object('found', false, 'reason', 'EVENT_TYPE_NOT_FOUND');
  end if;
  if v_names is null then
    return jsonb_build_object('found', false, 'reason', 'NO_MISSING_REPORT');
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
    'mention_scope', v_scope,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'event_type', v_event_type,
    'reminder_date', v_today
  );
end $$;

revoke all on function public.wa_reminder_preview(timestamptz, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.wa_reminder_preview(timestamptz, text, uuid, text, text, text)
  to service_role;
