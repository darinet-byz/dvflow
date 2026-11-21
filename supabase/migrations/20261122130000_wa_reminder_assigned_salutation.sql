-- 20261122130000_wa_reminder_assigned_salutation — A90 (permintaan pengguna 22 Nov 2026).
--
-- 1) Sapaan per pengiklan: `advertisers.salutation` (mis. Mas/Mbak/Kak).
--    `{{mention}}` menjadi "Mas Zul, Mas Andre" tanpa tanda @.
-- 2) Cakupan sebutan baru `assigned`: sebut SEMUA pengiklan aktif yang
--    ditugaskan ke produk grup, bukan hanya yang punya order kemarin.
-- Pilihan lama `all` (yang beraktivitas) dan `missing` (yang belum lapor) tetap.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 91 $$;

-- ---------------------------------------------------------------------------
-- 1. Sapaan pengiklan
-- ---------------------------------------------------------------------------
alter table public.advertisers
  add column if not exists salutation text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'advertisers_salutation_length') then
    alter table public.advertisers
      add constraint advertisers_salutation_length
      check (salutation is null or length(btrim(salutation)) <= 20);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Cakupan sebutan: tambah 'assigned'
-- ---------------------------------------------------------------------------
alter table public.wa_reminder_schedules
  drop constraint if exists wa_reminder_schedules_mention_scope_check;
alter table public.wa_reminder_schedules
  add constraint wa_reminder_schedules_mention_scope_check
  check (mention_scope in ('all', 'missing', 'assigned'));

-- ---------------------------------------------------------------------------
-- 3. Klaim: audiens per pengiklan, dengan sapaan
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
  -- Event type tetap berasal dari order kemarin. Satu pesan per produk + jenis acara.
  event_types as (
    select g.id as product_group_id, g.fonnte_group_id,
           p.id as product_id, p.code as product_code, p.name as product_name,
           o.event_type
      from public.wa_product_groups g
      join public.products p on p.id = g.product_id
      join public.orders o
        on o.source = 'orderonline'
       and public.normalize_code(o.product_code) = p.code_normalized
       and o.event_type is not null
       and coalesce(o.source_created_at, o.created_at) >= v_start
       and coalesce(o.source_created_at, o.created_at) < v_end
     where g.is_active
     group by g.id, g.fonnte_group_id, p.id, p.code, p.name, o.event_type
  ),
  activity as (
    select et.product_group_id, et.fonnte_group_id,
           et.product_code, et.product_name, et.event_type,
           a.id as advertiser_id, a.code as advertiser_code, a.name as advertiser_name,
           trim(coalesce(nullif(btrim(a.salutation), ''), '') || ' ' || a.name) as advertiser_label,
           coalesce(ord.leads, 0) as leads,
           coalesce(ord.paid, 0) as paid,
           not exists (
             select 1
               from public.ad_spend_reports r
               join public.products rp on rp.id = r.product_id
              where r.advertiser_id = a.id
                and rp.code_normalized = public.normalize_code(et.product_code)
                and r.event_type = et.event_type
                and r.date_from <= v_today - 1
                and r.date_to >= v_today - 1
           ) as has_missing
      from event_types et
      join public.product_advertisers pa on pa.product_id = et.product_id
      join public.advertisers a on a.id = pa.advertiser_id and a.active
      left join lateral (
        select count(*)::int as leads,
               (count(*) filter (where o.app_status = 'Paid'))::int as paid
          from public.orders o
         where o.source = 'orderonline'
           and public.normalize_code(o.advertiser_code) = a.code_normalized
           and public.normalize_code(o.product_code) = et.product_code
           and o.event_type = et.event_type
           and coalesce(o.source_created_at, o.created_at) >= v_start
           and coalesce(o.source_created_at, o.created_at) < v_end
      ) ord on true
  ),
  grouped as (
    select ac.product_group_id, ac.fonnte_group_id,
           ac.product_code, ac.product_name, ac.event_type,
           array_agg(ac.advertiser_name order by ac.advertiser_name, ac.advertiser_code) as all_names,
           array_agg(ac.advertiser_label order by ac.advertiser_name, ac.advertiser_code) as all_labels,
           array_agg(ac.advertiser_code order by ac.advertiser_name, ac.advertiser_code) as all_codes,
           array_agg(ac.advertiser_name order by ac.advertiser_name, ac.advertiser_code)
             filter (where ac.leads > 0) as active_names,
           array_agg(ac.advertiser_label order by ac.advertiser_name, ac.advertiser_code)
             filter (where ac.leads > 0) as active_labels,
           array_agg(ac.advertiser_code order by ac.advertiser_name, ac.advertiser_code)
             filter (where ac.leads > 0) as active_codes,
           array_agg(ac.advertiser_name order by ac.advertiser_name, ac.advertiser_code)
             filter (where ac.leads > 0 and ac.has_missing) as missing_names,
           array_agg(ac.advertiser_label order by ac.advertiser_name, ac.advertiser_code)
             filter (where ac.leads > 0 and ac.has_missing) as missing_labels,
           array_agg(ac.advertiser_code order by ac.advertiser_name, ac.advertiser_code)
             filter (where ac.leads > 0 and ac.has_missing) as missing_codes,
           sum(ac.leads)::int as leads_all,
           sum(ac.paid)::int as paid_all,
           (sum(ac.leads) filter (where ac.leads > 0 and ac.has_missing))::int as leads_missing,
           (sum(ac.paid) filter (where ac.leads > 0 and ac.has_missing))::int as paid_missing,
           bool_or(ac.leads > 0) as has_activity,
           bool_or(ac.leads > 0 and ac.has_missing) as has_missing_active,
           bool_or(ac.has_missing) as has_missing_all,
           count(*)::int as assigned_count
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
             or (d.mention_scope = 'all' and g.has_activity
                 and (not d.only_if_missing_report or g.has_missing_active))
             or (d.mention_scope = 'assigned' and g.assigned_count > 0
                 and (not d.only_if_missing_report or g.has_missing_all))
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
             case
               when c.mention_scope = 'missing' then array_to_string(c.missing_labels, ', ')
               when c.mention_scope = 'assigned' then array_to_string(c.all_labels, ', ')
               else array_to_string(c.active_labels, ', ')
             end,
             case
               when c.mention_scope = 'missing' then array_to_string(c.missing_names, ', ')
               when c.mention_scope = 'assigned' then array_to_string(c.all_names, ', ')
               else array_to_string(c.active_names, ', ')
             end,
             case
               when c.mention_scope = 'missing' then array_to_string(c.missing_codes, ', ')
               when c.mention_scope = 'assigned' then array_to_string(c.all_codes, ', ')
               else array_to_string(c.active_codes, ', ')
             end,
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
           case
             when mention_scope = 'missing' then array_to_string(missing_names, ', ')
             when mention_scope = 'assigned' then array_to_string(all_names, ', ')
             else array_to_string(active_names, ', ')
           end,
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
-- 4. Preview: audiens dan sapaan mengikuti mode yang dipilih di Kirim Tes
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
  v_scope text := case when p_mention_scope in ('missing', 'assigned') then p_mention_scope else 'all' end;
  v_total int := 0;
  v_advertisers jsonb;
  v_names text[];
  v_labels text[];
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
         jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'label', x.label) order by x.name, x.code)
           filter (where case
             when v_scope = 'assigned' then true
             when v_scope = 'missing' then x.leads > 0 and x.has_missing
             else x.leads > 0
           end),
         array_agg(x.label order by x.name, x.code)
           filter (where case
             when v_scope = 'assigned' then true
             when v_scope = 'missing' then x.leads > 0 and x.has_missing
             else x.leads > 0
           end),
         array_agg(x.name order by x.name, x.code)
           filter (where case
             when v_scope = 'assigned' then true
             when v_scope = 'missing' then x.leads > 0 and x.has_missing
             else x.leads > 0
           end),
         array_agg(x.code order by x.name, x.code)
           filter (where case
             when v_scope = 'assigned' then true
             when v_scope = 'missing' then x.leads > 0 and x.has_missing
             else x.leads > 0
           end),
         (sum(x.leads) filter (where case
             when v_scope = 'assigned' then true
             when v_scope = 'missing' then x.leads > 0 and x.has_missing
             else x.leads > 0
           end))::int,
         (sum(x.paid) filter (where case
             when v_scope = 'assigned' then true
             when v_scope = 'missing' then x.leads > 0 and x.has_missing
             else x.leads > 0
           end))::int
    into v_total, v_advertisers, v_labels, v_names, v_codes, v_leads, v_paid
    from (
      select a.code, a.name,
             trim(coalesce(nullif(btrim(a.salutation), ''), '') || ' ' || a.name) as label,
             coalesce(ord.leads, 0) as leads,
             coalesce(ord.paid, 0) as paid,
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
        left join lateral (
          select count(*)::int as leads,
                 (count(*) filter (where o.app_status = 'Paid'))::int as paid
            from public.orders o
           where o.source = 'orderonline'
             and public.normalize_code(o.advertiser_code) = a.code_normalized
             and public.normalize_code(o.product_code) = v_product.code_normalized
             and o.event_type = v_event_type
             and coalesce(o.source_created_at, o.created_at) >= v_start
             and coalesce(o.source_created_at, o.created_at) < v_end
        ) ord on true
       where pa.product_id = v_product.id
    ) x;

  if v_total = 0 then
    return jsonb_build_object('found', false, 'reason', 'EVENT_TYPE_NOT_FOUND');
  end if;
  if v_names is null then
    return jsonb_build_object(
      'found', false,
      'reason', case when v_scope = 'missing' then 'NO_MISSING_REPORT' else 'EVENT_TYPE_NOT_FOUND' end
    );
  end if;

  v_message := public.wa_render_reminder(
    v_template.message_content,
    array_to_string(v_labels, ', '),
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
