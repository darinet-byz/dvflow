-- 20261123120000_ad_spend_resume_finished_at — A92 (permintaan pengguna 23 Nov 2026).
--
-- Laporan Selesai adalah arsip: daftar resume tidak lagi mengikuti filter tanggal
-- halaman. Filter tanggal tetap berlaku untuk Laporan Berjalan dan KPI/summary.
-- Resume juga membawa finished_at supaya UI bisa menampilkan kapan card ditandai
-- Selesai, terpisah dari kolom "Periode" (date_from..date_to report).
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 93 $$;

create or replace function public.ad_spend_report(
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_batch text default null,
  p_event_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_own_advertiser uuid;
  v_can_manage boolean;
  v_result jsonb;
begin
  if not public.has_permission('operasional.report_spend') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select advertiser_id into v_own_advertiser from public.users where id = v_actor;
  v_can_manage := public.has_permission('action.manage_spend');

  with card_base as (
    select c.id, c.name, c.status, c.batch, c.event_type,
           c.advertiser_id, c.product_id,
           p.code as product_code, p.name as product_name,
           a.code as advertiser_code, a.name as advertiser_name
      from public.ad_spend_cards c
      join public.products p on p.id = c.product_id
      join public.advertisers a on a.id = c.advertiser_id
     where c.status = 'berjalan'
       and public.actor_can_product(v_actor, p.code)
       and (p_product_code is null or p.code_normalized = public.normalize_code(p_product_code))
       and (p_advertiser_code is null or a.code_normalized = public.normalize_code(p_advertiser_code))
       and (p_batch is null or btrim(p_batch) = '' or c.batch = public.normalize_batch(btrim(p_batch)))
       and (p_event_type is null or btrim(p_event_type) = '' or c.event_type = btrim(p_event_type))
  ),
  -- A89: hanya card milik akun Advertiser sendiri. Akun staff (tanpa
  -- advertiser_id) tetap melihat semua card dalam scope produk.
  visible_cards as (
    select cb.*
      from card_base cb
     where v_own_advertiser is null
        or cb.advertiser_id = v_own_advertiser
  ),
  entry_base as (
    select e.id, e.card_id, e.date_from, e.date_to,
           cb.name as card_name, cb.product_code, cb.product_name,
           cb.advertiser_id, cb.advertiser_code, cb.advertiser_name,
           cb.batch, cb.event_type,
           coalesce(sum(l.spend), 0)::numeric(18,2) as spend,
           coalesce(sum(round(l.spend * l.tax_percent / 100, 2)), 0)::numeric(18,2) as tax_amount
      from public.ad_spend_report_entries e
      join card_base cb on cb.id = e.card_id
      left join public.ad_spend_reports l on l.entry_id = e.id
     where (p_date_from is null or e.date_to >= p_date_from)
       and (p_date_to is null or e.date_from <= p_date_to)
     group by e.id, e.card_id, e.date_from, e.date_to,
              cb.name, cb.product_code, cb.product_name,
              cb.advertiser_id, cb.advertiser_code, cb.advertiser_name,
              cb.batch, cb.event_type
  ),
  entry_matched as (
    select eb.id as entry_id, o.order_id, o.app_status, o.quantity, o.gross_amount,
           o.session, o.city, o.event_type,
           eb.product_code, eb.product_name, eb.batch, eb.event_type as report_event_type,
           eb.advertiser_id, eb.advertiser_code, eb.advertiser_name
      from entry_base eb
      join public.orders o
        on public.normalize_code(o.product_code) = public.normalize_code(eb.product_code)
       and public.normalize_code(o.advertiser_code) = public.normalize_code(eb.advertiser_code)
       and public.normalize_batch(o.batch) = eb.batch
       and coalesce(o.source_created_at, o.created_at) >= (eb.date_from::timestamp at time zone 'Asia/Jakarta')
       and coalesce(o.source_created_at, o.created_at) < ((eb.date_to + 1)::timestamp at time zone 'Asia/Jakarta')
       and (eb.event_type is null or o.event_type = eb.event_type)
  ),
  entry_per as (
    select d.entry_id,
           count(*)::int as leads,
           count(*) filter (where d.app_status = 'Paid')::int as paid,
           coalesce(sum(d.quantity) filter (where d.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(d.gross_amount) filter (where d.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from (
        select distinct on (entry_id, order_id)
               entry_id, order_id, app_status, quantity, gross_amount
          from entry_matched
         order by entry_id, order_id
      ) d
     group by d.entry_id
  ),
  entry_rows as (
    select eb.*,
           coalesce(ep.leads, 0) as leads,
           coalesce(ep.paid, 0) as paid,
           coalesce(ep.tickets, 0) as tickets,
           coalesce(ep.omzet, 0)::numeric(18,2) as omzet
      from entry_base eb
      left join entry_per ep on ep.entry_id = eb.id
  ),
  active_distinct_orders as (
    select distinct on (order_id)
           order_id, app_status, quantity, gross_amount, session, city, event_type,
           product_code, product_name, batch, report_event_type,
           advertiser_code, advertiser_name
      from entry_matched
     order by order_id
  ),
  active_order_totals as (
    select count(*)::int as leads,
           count(*) filter (where app_status = 'Paid')::int as paid,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from active_distinct_orders
  ),
  entry_totals as (
    select coalesce(sum(spend), 0)::numeric(18,2) as spend,
           coalesce(sum(tax_amount), 0)::numeric(18,2) as tax_amount
      from entry_rows
  ),
  resume_base as (
    select r.*,
           (r.frozen_at is null) as is_draft,
           (r.finished_at + interval '3 months')::date as retention_until
      from public.ad_spend_resumes r
     where public.actor_can_product(v_actor, r.product_code)
       and (p_date_from is null or r.date_to >= p_date_from)
       and (p_date_to is null or r.date_from <= p_date_to)
       and (p_product_code is null or public.normalize_code(r.product_code) = public.normalize_code(p_product_code))
       and (p_advertiser_code is null or public.normalize_code(r.advertiser_code) = public.normalize_code(p_advertiser_code))
       and (p_batch is null or btrim(p_batch) = '' or r.batch = public.normalize_batch(btrim(p_batch)))
       and (p_event_type is null or btrim(p_event_type) = '' or r.event_type = btrim(p_event_type))
  ),
  -- A92: daftar Laporan Selesai tidak memakai filter tanggal. Resume adalah arsip
  -- jangka panjang; tanggal Selesai ditampilkan dari finished_at. Filter tanggal
  -- tetap dipakai resume_base di atas untuk KPI/summary.
  resume_list as (
    select r.*,
           (r.frozen_at is null) as is_draft,
           (r.finished_at + interval '3 months')::date as retention_until
      from public.ad_spend_resumes r
     where public.actor_can_product(v_actor, r.product_code)
       and (p_product_code is null or public.normalize_code(r.product_code) = public.normalize_code(p_product_code))
       and (p_advertiser_code is null or public.normalize_code(r.advertiser_code) = public.normalize_code(p_advertiser_code))
       and (p_batch is null or btrim(p_batch) = '' or r.batch = public.normalize_batch(btrim(p_batch)))
       and (p_event_type is null or btrim(p_event_type) = '' or r.event_type = btrim(p_event_type))
  ),
  resume_totals as (
    select coalesce(sum(spend), 0)::numeric(18,2) as spend,
           coalesce(sum(tax_amount), 0)::numeric(18,2) as tax_amount,
           coalesce(sum(total_spend), 0)::numeric(18,2) as total_spend,
           coalesce(sum(leads), 0)::int as leads,
           coalesce(sum(paid), 0)::int as paid,
           coalesce(sum(tickets), 0)::int as tickets,
           coalesce(sum(omzet), 0)::numeric(18,2) as omzet
      from resume_base
  ),
  session_cells as (
    select upper(btrim(session)) as session_key, lower(btrim(city)) as city_key, event_type,
           public.normalize_code(advertiser_code) as advertiser_key,
           max(session) as session, max(city) as city,
           max(advertiser_code) as advertiser_code, max(advertiser_name) as advertiser_name,
           sum(quantity)::int as tickets
      from active_distinct_orders
     where app_status = 'Paid'
     group by upper(btrim(session)), lower(btrim(city)), event_type, public.normalize_code(advertiser_code)
  ),
  session_rows as (
    select session_key, city_key, event_type, max(session) as session, max(city) as city,
           sum(tickets)::int as tickets
      from session_cells
     group by session_key, city_key, event_type
  ),
  session_advertisers as (
    select advertiser_key, max(advertiser_code) as advertiser_code,
           max(advertiser_name) as advertiser_name, sum(tickets)::int as tickets
      from session_cells
     group by advertiser_key
  ),
  comparison_spend as (
    select public.normalize_code(er.product_code) as product_key,
           max(er.product_code) as product_code,
           max(er.product_name) as product_name,
           er.batch,
           er.event_type,
           public.normalize_code(er.advertiser_code) as advertiser_key,
           max(er.advertiser_code) as advertiser_code,
           max(er.advertiser_name) as advertiser_name,
           sum(er.spend)::numeric(18,2) as spend,
           sum(er.tax_amount)::numeric(18,2) as tax_amount
      from entry_rows er
     group by public.normalize_code(er.product_code), er.batch, er.event_type, public.normalize_code(er.advertiser_code)
  ),
  comparison_orders as (
    select public.normalize_code(d.product_code) as product_key,
           d.batch,
           d.report_event_type as event_type,
           public.normalize_code(d.advertiser_code) as advertiser_key,
           count(d.order_id)::int as leads,
           count(d.order_id) filter (where d.app_status = 'Paid')::int as paid,
           coalesce(sum(d.quantity) filter (where d.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(d.gross_amount) filter (where d.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from active_distinct_orders d
     group by public.normalize_code(d.product_code), d.batch, d.report_event_type, public.normalize_code(d.advertiser_code)
  ),
  comparison as (
    select s.product_code, s.product_name, s.batch, s.event_type,
           s.advertiser_code, s.advertiser_name,
           s.spend, s.tax_amount, (s.spend + s.tax_amount)::numeric(18,2) as total_spend,
           coalesce(o.leads, 0) as leads,
           coalesce(o.paid, 0) as paid,
           coalesce(o.tickets, 0) as tickets,
           coalesce(o.omzet, 0)::numeric(18,2) as omzet
      from comparison_spend s
      left join comparison_orders o
        on o.product_key = s.product_key
       and o.batch = s.batch
       and o.event_type is not distinct from s.event_type
       and o.advertiser_key = s.advertiser_key
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'reports', (select count(*) from entry_rows) + (select count(*) from resume_base),
      'spend', (select spend from entry_totals) + (select spend from resume_totals),
      'tax_amount', (select tax_amount from entry_totals) + (select tax_amount from resume_totals),
      'total_spend', (select spend + tax_amount from entry_totals) + (select total_spend from resume_totals),
      'leads', (select leads from active_order_totals) + (select leads from resume_totals),
      'paid', (select paid from active_order_totals) + (select paid from resume_totals),
      'tickets', (select tickets from active_order_totals) + (select tickets from resume_totals),
      'omzet', (select omzet from active_order_totals) + (select omzet from resume_totals)
    ),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cb.id,
        'name', cb.name,
        'status', cb.status,
        'product_code', cb.product_code,
        'product_name', cb.product_name,
        'advertiser_code', cb.advertiser_code,
        'advertiser_name', cb.advertiser_name,
        'batch', cb.batch,
        'event_type', cb.event_type,
        'own', v_own_advertiser is not null and cb.advertiser_id = v_own_advertiser,
        'can_edit', v_can_manage or (v_own_advertiser is not null and cb.advertiser_id = v_own_advertiser)
      ) order by cb.name, cb.product_name, cb.batch)
      from visible_cards cb
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', er.id,
        'card_id', er.card_id,
        'card_name', er.card_name,
        'date_from', er.date_from,
        'date_to', er.date_to,
        'product_code', er.product_code,
        'product_name', er.product_name,
        'advertiser_code', er.advertiser_code,
        'advertiser_name', er.advertiser_name,
        'batch', er.batch,
        'event_type', er.event_type,
        'spend', er.spend,
        'tax_amount', er.tax_amount,
        'tax_percent', case when er.spend > 0 then round(er.tax_amount / er.spend * 100, 2) else 0 end,
        'total_spend', er.spend + er.tax_amount,
        'leads', er.leads,
        'paid', er.paid,
        'tickets', er.tickets,
        'omzet', er.omzet,
        'own', v_own_advertiser is not null and er.advertiser_id = v_own_advertiser,
        'can_edit', v_can_manage or (v_own_advertiser is not null and er.advertiser_id = v_own_advertiser),
        'spends', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id,
            'date_from', l.date_from,
            'date_to', l.date_to,
            'spend', l.spend,
            'tax_percent', l.tax_percent,
            'tax_amount', round(l.spend * l.tax_percent / 100, 2)
          ) order by l.created_at, l.id)
            from public.ad_spend_reports l
           where l.entry_id = er.id
        ), '[]'::jsonb)
      ) order by er.date_to desc, er.date_from desc, er.card_name)
      from entry_rows er
    ), '[]'::jsonb),
    'resumes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rb.id,
        'card_id', rb.card_id,
        'name', rb.name,
        'status', case when rb.frozen_at is null then 'draft' else 'final' end,
        'frozen', rb.frozen_at is not null,
        'date_from', rb.date_from,
        'date_to', rb.date_to,
        'finished_at', rb.finished_at,
        'retention_until', rb.retention_until,
        'product_code', rb.product_code,
        'product_name', rb.product_name,
        'advertiser_code', rb.advertiser_code,
        'advertiser_name', rb.advertiser_name,
        'batch', rb.batch,
        'event_type', rb.event_type,
        'spend', rb.spend,
        'tax_amount', rb.tax_amount,
        'tax_percent', case when rb.spend > 0 then round(rb.tax_amount / rb.spend * 100, 2) else 0 end,
        'total_spend', rb.total_spend,
        'leads', rb.leads,
        'paid', rb.paid,
        'tickets', rb.tickets,
        'omzet', rb.omzet,
        'own', v_own_advertiser is not null and rb.advertiser_id = v_own_advertiser,
        'can_edit', rb.frozen_at is null and (
          v_can_manage or (v_own_advertiser is not null and rb.advertiser_id = v_own_advertiser)
        ),
        'can_activate', rb.frozen_at is null and rb.card_id is not null and (
          v_can_manage or (v_own_advertiser is not null and rb.advertiser_id = v_own_advertiser)
        ),
        'entries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id,
            'date_from', e.date_from,
            'date_to', e.date_to,
            'spend', coalesce((select sum(l.spend) from public.ad_spend_reports l where l.entry_id = e.id), 0),
            'tax_amount', coalesce((
              select sum(round(l.spend * l.tax_percent / 100, 2))
                from public.ad_spend_reports l where l.entry_id = e.id
            ), 0)
          ) order by e.date_from, e.id)
            from public.ad_spend_report_entries e
           where e.card_id = rb.card_id
        ), '[]'::jsonb)
      ) order by rb.finished_at desc, rb.date_to desc, rb.date_from desc, rb.name)
      from resume_list rb
    ), '[]'::jsonb),
    'sessions', jsonb_build_object(
      'tickets', (select coalesce(sum(tickets), 0) from session_rows),
      'advertisers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'advertiser_code', sa.advertiser_code,
          'advertiser_name', sa.advertiser_name,
          'tickets', sa.tickets
        ) order by sa.advertiser_key)
        from session_advertisers sa
      ), '[]'::jsonb),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'session', s.session,
          'city', s.city,
          'event_type', s.event_type,
          'tickets', s.tickets,
          'advertisers', (
            select jsonb_agg(jsonb_build_object('advertiser_code', c.advertiser_code, 'tickets', c.tickets) order by c.advertiser_key)
              from session_cells c
             where c.session_key is not distinct from s.session_key
               and c.city_key is not distinct from s.city_key
               and c.event_type is not distinct from s.event_type
          )
        ) order by s.city_key nulls last, nullif(regexp_replace(s.session_key, '\D', '', 'g'), '')::bigint nulls last, s.session_key nulls last)
        from session_rows s
      ), '[]'::jsonb)
    ),
    'comparison', jsonb_build_object(
      'totals', jsonb_build_object(
        'spend', (select coalesce(sum(spend), 0) from comparison),
        'tax_amount', (select coalesce(sum(tax_amount), 0) from comparison),
        'total_spend', (select coalesce(sum(total_spend), 0) from comparison),
        'leads', (select coalesce(sum(leads), 0) from comparison),
        'paid', (select coalesce(sum(paid), 0) from comparison),
        'tickets', (select coalesce(sum(tickets), 0) from comparison),
        'omzet', (select coalesce(sum(omzet), 0) from comparison)
      ),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_code', c.product_code,
          'product_name', c.product_name,
          'batch', c.batch,
          'event_type', c.event_type,
          'advertiser_code', c.advertiser_code,
          'advertiser_name', c.advertiser_name,
          'spend', c.spend,
          'tax_amount', c.tax_amount,
          'total_spend', c.total_spend,
          'leads', c.leads,
          'paid', c.paid,
          'tickets', c.tickets,
          'omzet', c.omzet
        ) order by c.tickets desc, c.omzet desc, c.advertiser_name)
        from comparison c
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.ad_spend_report(date, date, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ad_spend_report(date, date, text, text, text, text) to authenticated;
