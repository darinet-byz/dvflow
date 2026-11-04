-- 0067_ad_spend_event_type — Report Spend Iklan: pisahkan Seminar dan Webinar.
--
-- Satu batch dapat dipakai oleh acara online dan offline. Tanpa jenis acara,
-- report dengan produk + batch + pengiklan yang sama mencampur order kedua
-- jenis dan angka spend/leads/omzet menjadi salah. Kolom `event_type` disimpan
-- per report, wajib dipilih saat input, dan ikut menjadi filter laporan.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 67 $$;

alter table public.ad_spend_reports add column event_type text;

alter table public.ad_spend_reports
  add constraint ad_spend_reports_event_type_check
  check (event_type is null or event_type in ('Seminar Offline', 'Webinar Online', 'Hybrid'));

-- Backfill best-effort: hanya report yang seluruh ordernya satu jenis acara.
-- Report campuran dibiarkan NULL agar tidak menebak; UI meminta input ulang
-- saat report itu diedit.
with matched as (
  select r.id, o.event_type
    from public.ad_spend_reports r
    join public.products p on p.id = r.product_id
    join public.advertisers a on a.id = r.advertiser_id
    join public.orders o
      on public.normalize_code(o.product_code) = p.code_normalized
     and public.normalize_code(o.advertiser_code) = a.code_normalized
     and public.normalize_batch(o.batch) = r.batch
     and coalesce(o.source_created_at, o.created_at) >= (r.date_from::timestamp at time zone 'Asia/Jakarta')
     and coalesce(o.source_created_at, o.created_at) < ((r.date_to + 1)::timestamp at time zone 'Asia/Jakarta')
   where o.event_type is not null
),
unambiguous as (
  select id, min(event_type) as event_type
    from matched
   group by id
  having count(distinct event_type) = 1
)
update public.ad_spend_reports r
   set event_type = u.event_type
  from unambiguous u
 where u.id = r.id;

create index ad_spend_reports_event_idx
  on public.ad_spend_reports (advertiser_id, product_id, batch, event_type, date_from, date_to);

-- Signature lama diganti; drop eksplisit supaya tidak ada overload ambigu.
drop function if exists public.save_ad_spend_report(uuid, uuid, text, text, date, date, numeric, numeric, boolean);
drop function if exists public.ad_spend_report(date, date, text, text, text);

-- ---------------------------------------------------------------------------
-- Tulis report: event_type wajib dan menjadi bagian kunci overlap.
-- ---------------------------------------------------------------------------
create or replace function public.save_ad_spend_report(
  p_actor uuid,
  p_id uuid,
  p_product_code text,
  p_batch text,
  p_date_from date,
  p_date_to date,
  p_spend numeric,
  p_tax_percent numeric,
  p_event_type text default null,
  p_confirm_overlap boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_advertiser uuid := public.ad_spend_actor_advertiser(p_actor);
  v_batch text := public.normalize_batch(nullif(btrim(coalesce(p_batch, '')), ''));
  v_event_type text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_product public.products;
  v_existing public.ad_spend_reports;
  v_row public.ad_spend_reports;
begin
  if v_batch is null or length(v_batch) > 32 or p_date_from is null or p_date_to is null or p_date_to < p_date_from
     or p_spend is null or p_spend < 0 or p_spend > 9999999999
     or p_tax_percent is null or p_tax_percent < 0 or p_tax_percent > 100
     or v_event_type is null
     or v_event_type not in ('Seminar Offline', 'Webinar Online', 'Hybrid') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  select * into v_product from public.products
   where code_normalized = public.normalize_code(p_product_code) and active;
  if not found then raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT'; end if;
  if not public.actor_can_product(p_actor, v_product.code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if p_id is not null then
    select * into v_existing from public.ad_spend_reports where id = p_id for update;
    -- Report pengiklan lain diperlakukan sama dengan tidak ada: tidak membocorkan keberadaannya.
    if not found or v_existing.advertiser_id <> v_advertiser then
      raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND';
    end if;
  end if;

  -- Dua input bersamaan untuk kombinasi yang sama tidak boleh sama-sama lolos cek tumpang tindih.
  perform pg_advisory_xact_lock(
    hashtextextended('ad_spend:' || v_advertiser || ':' || v_product.id || ':' || v_batch || ':' || v_event_type, 0)
  );
  if not coalesce(p_confirm_overlap, false) and exists (
    select 1 from public.ad_spend_reports r
     where r.advertiser_id = v_advertiser and r.product_id = v_product.id and r.batch = v_batch
       -- Report lama tanpa jenis acara dianggap bertumpuk dengan jenis apa pun:
       -- lebih aman meminta operator mengeditnya daripada menghitung ganda.
       and (r.event_type is null or r.event_type = v_event_type)
       and (p_id is null or r.id <> p_id)
       and daterange(r.date_from, r.date_to, '[]') && daterange(p_date_from, p_date_to, '[]')
  ) then
    raise exception using errcode = 'DF016', message = 'AD_SPEND_OVERLAP';
  end if;

  if p_id is null then
    insert into public.ad_spend_reports (advertiser_id, product_id, batch, event_type, date_from, date_to, spend, tax_percent, created_by, updated_by)
    values (v_advertiser, v_product.id, v_batch, v_event_type, p_date_from, p_date_to, round(p_spend, 2), round(p_tax_percent, 2), p_actor, p_actor)
    returning * into v_row;
  else
    update public.ad_spend_reports
       set product_id = v_product.id, batch = v_batch, event_type = v_event_type,
           date_from = p_date_from, date_to = p_date_to,
           spend = round(p_spend, 2), tax_percent = round(p_tax_percent, 2), updated_by = p_actor
     where id = p_id
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'action', case when p_id is null then 'created' else 'updated' end,
    'product_code', v_product.code,
    'batch', v_row.batch,
    'event_type', v_row.event_type,
    'date_from', v_row.date_from,
    'date_to', v_row.date_to,
    'spend', v_row.spend,
    'tax_percent', v_row.tax_percent
  );
end $$;

-- ---------------------------------------------------------------------------
-- Baca report: filter + pencocokan order memakai event_type.
-- ---------------------------------------------------------------------------
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
  v_result jsonb;
begin
  if not public.has_permission('operasional.report_spend') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select advertiser_id into v_own_advertiser from public.users where id = v_actor;

  with reports as (
    select r.id, r.batch, r.event_type, r.date_from, r.date_to, r.spend, r.created_at, r.tax_percent,
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
       and (p_date_from is null or r.date_to >= p_date_from)
       and (p_date_to is null or r.date_from <= p_date_to)
       and (p_product_code is null or p.code_normalized = public.normalize_code(p_product_code))
       and (p_advertiser_code is null or a.code_normalized = public.normalize_code(p_advertiser_code))
       and (p_batch is null or btrim(p_batch) = '' or r.batch = public.normalize_batch(btrim(p_batch)))
       and (p_event_type is null or btrim(p_event_type) = '' or r.event_type = btrim(p_event_type))
  ),
  matched as (
    -- Satu baris per (report, order). Order yang tercakup beberapa report muncul beberapa kali di sini,
    -- tetapi total di bawah menghitungnya sekali (distinct order_id).
    select r.id as report_id, o.order_id, o.app_status, o.gross_amount,
           o.quantity, o.session, o.city, o.event_type,
           r.advertiser_code, r.advertiser_name,
           r.product_code, r.product_name, r.batch
      from reports r
      join public.orders o
        on public.normalize_code(o.product_code) = public.normalize_code(r.product_code)
       and public.normalize_code(o.advertiser_code) = public.normalize_code(r.advertiser_code)
       and public.normalize_batch(o.batch) = r.batch
       and coalesce(o.source_created_at, o.created_at) >= r.starts_at
       and coalesce(o.source_created_at, o.created_at) < r.ends_at
       and (r.event_type is null or o.event_type = r.event_type)
  ),
  per_report as (
    select r.*,
           count(m.order_id)::int as leads,
           count(m.order_id) filter (where m.app_status = 'Paid')::int as paid,
           -- Tiket Paid per report = sum(quantity), metrik yang sama dengan tabel sesi (A25/A43).
           coalesce(sum(m.quantity) filter (where m.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(m.gross_amount) filter (where m.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from reports r left join matched m on m.report_id = r.id
     group by r.id, r.batch, r.event_type, r.date_from, r.date_to, r.spend, r.created_at, r.tax_percent, r.tax_amount, r.advertiser_id, r.product_code,
              r.product_name, r.advertiser_code, r.advertiser_name, r.starts_at, r.ends_at
  ),
  distinct_orders as (
    select distinct on (order_id) order_id, app_status, gross_amount,
           quantity, session, city, event_type, advertiser_code, advertiser_name,
           product_code, product_name, batch
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
  ),
  comparison_spend as (
    -- Spend per (produk, batch, jenis acara, pengiklan).
    select public.normalize_code(pr.product_code) as product_key,
           max(pr.product_code) as product_code,
           max(pr.product_name) as product_name,
           pr.batch,
           pr.event_type,
           public.normalize_code(pr.advertiser_code) as advertiser_key,
           max(pr.advertiser_code) as advertiser_code,
           max(pr.advertiser_name) as advertiser_name,
           sum(pr.spend)::numeric(18,2) as spend,
           sum(pr.tax_amount)::numeric(18,2) as tax_amount
      from per_report pr
     group by public.normalize_code(pr.product_code), pr.batch, pr.event_type, public.normalize_code(pr.advertiser_code)
  ),
  comparison_orders as (
    -- Order dihitung sekali per (produk, batch, jenis acara report, pengiklan).
    -- Memakai jenis acara REPORT, bukan order, supaya report lama tanpa jenis
    -- acara tetap menggabungkan semua ordernya di bawah satu kelompok.
    select public.normalize_code(d.product_code) as product_key,
           d.batch,
           d.event_type,
           public.normalize_code(d.advertiser_code) as advertiser_key,
           count(d.order_id)::int as leads,
           count(d.order_id) filter (where d.app_status = 'Paid')::int as paid,
           coalesce(sum(d.quantity) filter (where d.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(d.gross_amount) filter (where d.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from (
        select distinct on (m.order_id)
               m.order_id, m.app_status, m.gross_amount, m.quantity,
               pr.product_code, pr.batch, pr.event_type, pr.advertiser_code
          from per_report pr
          join matched m on m.report_id = pr.id
         order by m.order_id
      ) d
     group by public.normalize_code(d.product_code), d.batch, d.event_type, public.normalize_code(d.advertiser_code)
  ),
  comparison as (
    select s.product_code, s.product_name, s.batch, s.event_type, s.advertiser_code, s.advertiser_name,
           s.spend, s.tax_amount,
           (s.spend + s.tax_amount)::numeric(18,2) as total_spend,
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
        'event_type', pr.event_type,
        'spend', pr.spend,
        'tax_percent', pr.tax_percent,
        'tax_amount', pr.tax_amount,
        'total_spend', pr.spend + pr.tax_amount,
        'leads', pr.leads,
        'paid', pr.paid,
        'tickets', pr.tickets,
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

revoke all on function public.save_ad_spend_report(uuid, uuid, text, text, date, date, numeric, numeric, text, boolean) from public, anon, authenticated;
grant execute on function public.save_ad_spend_report(uuid, uuid, text, text, date, date, numeric, numeric, text, boolean) to service_role;

revoke all on function public.ad_spend_report(date, date, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ad_spend_report(date, date, text, text, text, text) to authenticated;
