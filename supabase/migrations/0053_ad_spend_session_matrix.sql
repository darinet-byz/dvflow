-- 0053_ad_spend_session_matrix — A43 (permintaan pengguna 26 Okt 2026): Report Spend Iklan menampilkan tiket Paid
-- per sesi × pengiklan di bawah card. Cakupan order sama persis dengan card (report spend sesuai filter, tiap order
-- dihitung sekali); metrik tiket = sum(quantity) order Paid (A25). `summary` dan `rows` tidak berubah.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 53 $$;

create or replace function public.ad_spend_report(
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_batch text default null
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
  v_result jsonb;
begin
  if not public.has_permission('operasional.report_spend') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select advertiser_id into v_own_advertiser from public.users where id = v_actor;

  with reports as (
    select r.id, r.batch, r.date_from, r.date_to, r.spend, r.created_at, r.tax_percent,
           -- PPN iklan per report; Total Spend = spend + PPN (dasar profit/boncos di halaman).
           round(r.spend * r.tax_percent / 100, 2) as tax_amount,
           r.advertiser_id, p.code as product_code, p.name as product_name,
           a.code as advertiser_code, a.name as advertiser_name,
           -- Batas hari WIB, sama dengan filter tanggal order di seluruh aplikasi (A24).
           (r.date_from::timestamp at time zone 'Asia/Jakarta') as starts_at,
           ((r.date_to + 1)::timestamp at time zone 'Asia/Jakarta') as ends_at
      from public.ad_spend_reports r
      join public.products p on p.id = r.product_id
      join public.advertisers a on a.id = r.advertiser_id
     where public.actor_can_product(v_actor, p.code)
       and (v_own_advertiser is null or r.advertiser_id = v_own_advertiser)
       and (p_date_from is null or r.date_to >= p_date_from)
       and (p_date_to is null or r.date_from <= p_date_to)
       and (p_product_code is null or p.code_normalized = public.normalize_code(p_product_code))
       and (p_advertiser_code is null or a.code_normalized = public.normalize_code(p_advertiser_code))
       and (p_batch is null or btrim(p_batch) = '' or r.batch = public.normalize_batch(btrim(p_batch)))
  ),
  matched as (
    -- Satu baris per (report, order). Order yang tercakup beberapa report muncul beberapa kali di sini,
    -- tetapi total di bawah menghitungnya sekali (distinct order_id).
    select r.id as report_id, o.order_id, o.app_status, o.gross_amount,
           o.quantity, o.session, o.city, o.event_type, r.advertiser_code, r.advertiser_name
      from reports r
      join public.orders o
        on public.normalize_code(o.product_code) = public.normalize_code(r.product_code)
       and public.normalize_code(o.advertiser_code) = public.normalize_code(r.advertiser_code)
       and public.normalize_batch(o.batch) = r.batch
       and coalesce(o.source_created_at, o.created_at) >= r.starts_at
       and coalesce(o.source_created_at, o.created_at) < r.ends_at
  ),
  per_report as (
    select r.*,
           count(m.order_id)::int as leads,
           count(m.order_id) filter (where m.app_status = 'Paid')::int as paid,
           coalesce(sum(m.gross_amount) filter (where m.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from reports r left join matched m on m.report_id = r.id
     group by r.id, r.batch, r.date_from, r.date_to, r.spend, r.created_at, r.tax_percent, r.tax_amount, r.advertiser_id, r.product_code,
              r.product_name, r.advertiser_code, r.advertiser_name, r.starts_at, r.ends_at
  ),
  distinct_orders as (
    select distinct on (order_id) order_id, app_status, gross_amount,
           quantity, session, city, event_type, advertiser_code, advertiser_name
      from matched
  ),
  session_cells as (
    -- Satu sel = (sesi, kota, jenis acara, pengiklan). Kota tidak membedakan huruf (A31).
    select upper(btrim(session)) as session_key, lower(btrim(city)) as city_key, event_type,
           public.normalize_code(advertiser_code) as advertiser_key,
           max(session) as session, max(city) as city,
           max(advertiser_code) as advertiser_code, max(advertiser_name) as advertiser_name,
           sum(quantity)::int as tickets
      from distinct_orders
     where app_status = 'Paid'
     group by upper(btrim(session)), lower(btrim(city)), event_type, public.normalize_code(advertiser_code)
  ),
  session_rows as (
    select session_key, city_key, event_type, max(session) as session, max(city) as city, sum(tickets)::int as tickets
      from session_cells
     group by session_key, city_key, event_type
  ),
  session_advertisers as (
    select advertiser_key, max(advertiser_code) as advertiser_code, max(advertiser_name) as advertiser_name,
           sum(tickets)::int as tickets
      from session_cells
     group by advertiser_key
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'reports', (select count(*) from reports),
      'spend', (select coalesce(sum(spend), 0) from reports),
      'tax_amount', (select coalesce(sum(tax_amount), 0) from reports),
      'total_spend', (select coalesce(sum(spend + tax_amount), 0) from reports),
      'leads', (select count(*) from distinct_orders),
      'paid', (select count(*) from distinct_orders where app_status = 'Paid'),
      'omzet', (select coalesce(sum(gross_amount), 0) from distinct_orders where app_status = 'Paid')
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'date_from', pr.date_from,
        'date_to', pr.date_to,
        'product_code', pr.product_code,
        'product_name', pr.product_name,
        'advertiser_code', pr.advertiser_code,
        'advertiser_name', pr.advertiser_name,
        'batch', pr.batch,
        'spend', pr.spend,
        'tax_percent', pr.tax_percent,
        'tax_amount', pr.tax_amount,
        'total_spend', pr.spend + pr.tax_amount,
        'leads', pr.leads,
        'paid', pr.paid,
        'omzet', pr.omzet,
        'own', v_own_advertiser is not null and pr.advertiser_id = v_own_advertiser
      ) order by pr.date_to desc, pr.date_from desc, pr.product_name, pr.batch, pr.created_at desc)
      from per_report pr
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
        -- Per kota (abjad), lalu S1, S2, …, S10 — sama dengan Resume Batch (0050).
        ) order by s.city_key nulls last, nullif(regexp_replace(s.session_key, '\D', '', 'g'), '')::bigint nulls last, s.session_key nulls last)
        from session_rows s
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.ad_spend_report(date,date,text,text,text) from public, anon, authenticated;
grant execute on function public.ad_spend_report(date,date,text,text,text) to authenticated;
