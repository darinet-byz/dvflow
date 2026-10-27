-- 0056_performance_analytics — A46/A47 (permintaan pengguna 27 Okt 2026).
-- Dua hal baru, keduanya baca-saja dan aditif:
--   1) Report Spend Iklan mendapat kunci `comparison`: roll-up per produk + batch + pengiklan,
--      memakai report dan order yang sama dengan summary di atasnya.
--   2) Halaman "Performa / Analitik" mendapat RPC `advertiser_performance`:
--      - tanpa p_advertiser_code: daftar semua pengiklan pada periode (mode dashboard);
--      - dengan p_advertiser_code: track record satu pengiklan per hari/bulan/tahun (mode detail).
-- Spend dialokasikan prorata harian: report 28 Agu–3 Sep dibagi 7 hari, porsi 1–3 Sep masuk September.
-- Tiket/omzet hanya order Paid. Tidak ada tabel/kolom baru; tidak ada data yang diubah.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 56 $$;

-- Izin baru. Default Manajer + Admin; role lain dapat dicentang sendiri lewat Konfigurasi Role.
insert into public.app_permissions (key, name, module, description, sort_order)
values ('operasional.analytics', 'Performa / Analitik', 'operasional',
        'Melihat performa iklan per pengiklan: spend, omzet, profit, closing rate, tiket, dan ROAS', 9)
on conflict (key) do nothing;

insert into public.app_role_permissions (role_id, permission_key)
select r, 'operasional.analytics' from unnest(array['manajer', 'admin']) r
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- Halaman Performa memakai dropdown produk/pengiklan dari tabel konfigurasi.
create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'action.ots','operasional.report_spend','operasional.resume_batch','operasional.analytics',
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;

-- Catatan performa (sengaja TIDAK membuat index baru di migrasi ini):
-- `orders` adalah tabel produksi yang aktif ditulis. `CREATE INDEX` biasa di dalam transaksi
-- migrasi menahan write selama pembuatan. Query analitik sudah memakai `orders_advertiser_code_idx`
-- dan `orders_report_spend_idx`; bila volume data menuntut index khusus, buat terpisah dengan
-- `CREATE INDEX CONCURRENTLY` di luar jam sibuk. Keputusan ini menjaga migrasi tetap singkat.

-- ============================================================================
-- Report Spend Iklan (A37/A43/A45) + perbandingan pengiklan (A46).
-- ============================================================================
-- Sama dengan 0055, dengan tambahan:
--   * `matched`/`distinct_orders` membawa product_code/product_name/batch;
--   * kunci `comparison`: satu baris per produk + batch + pengiklan, berisi spend/PPN dari report
--     dan leads/paid/tickets/omzet dari order yang sama (distinct per order_id).
-- `summary`, `rows`, dan `sessions` tidak berubah.
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
  ),
  per_report as (
    select r.*,
           count(m.order_id)::int as leads,
           count(m.order_id) filter (where m.app_status = 'Paid')::int as paid,
           -- Tiket Paid per report = sum(quantity), metrik yang sama dengan tabel sesi (A25/A43).
           coalesce(sum(m.quantity) filter (where m.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(m.gross_amount) filter (where m.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from reports r left join matched m on m.report_id = r.id
     group by r.id, r.batch, r.date_from, r.date_to, r.spend, r.created_at, r.tax_percent, r.tax_amount, r.advertiser_id, r.product_code,
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
    -- Spend per (produk, batch, pengiklan). Laporan yang bertumpuk tetap dijumlahkan seperti summary.
    select public.normalize_code(pr.product_code) as product_key,
           max(pr.product_code) as product_code,
           max(pr.product_name) as product_name,
           pr.batch,
           public.normalize_code(pr.advertiser_code) as advertiser_key,
           max(pr.advertiser_code) as advertiser_code,
           max(pr.advertiser_name) as advertiser_name,
           sum(pr.spend)::numeric(18,2) as spend,
           sum(pr.tax_amount)::numeric(18,2) as tax_amount
      from per_report pr
     group by public.normalize_code(pr.product_code), pr.batch, public.normalize_code(pr.advertiser_code)
  ),
  comparison_orders as (
    -- Order dihitung sekali per (produk, batch, pengiklan) walau tercakup beberapa report.
    select public.normalize_code(d.product_code) as product_key,
           d.batch,
           public.normalize_code(d.advertiser_code) as advertiser_key,
           count(d.order_id)::int as leads,
           count(d.order_id) filter (where d.app_status = 'Paid')::int as paid,
           coalesce(sum(d.quantity) filter (where d.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(d.gross_amount) filter (where d.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from distinct_orders d
     group by public.normalize_code(d.product_code), d.batch, public.normalize_code(d.advertiser_code)
  ),
  comparison as (
    select s.product_code, s.product_name, s.batch, s.advertiser_code, s.advertiser_name,
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
revoke all on function public.ad_spend_report(date,date,text,text,text) from public, anon, authenticated;
grant execute on function public.ad_spend_report(date,date,text,text,text) to authenticated;

-- ============================================================================
-- Performa / Analitik: daftar pengiklan + track record satu pengiklan (A46).
-- ============================================================================
-- Mode dashboard (p_advertiser_code kosong):
--   advertisers[] = semua pengiklan yang punya order/report pada periode, dengan metrik periode.
-- Mode detail (p_advertiser_code diisi):
--   summary, rows[] (per hari/bulan/tahun + prev + yoy), products[], batches[], top_products[].
-- Semua order difilter product_parse_status = 'valid' dan scope produk lewat actor_can_product (A44).
create or replace function public.advertiser_performance(
  p_advertiser_code text default null,
  p_product_code text default null,
  p_batch text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_granularity text default 'month'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_date_from date;
  v_date_to date;
  v_granularity text := coalesce(nullif(btrim(p_granularity), ''), 'month');
  v_advertiser_key text;
  v_product_key text;
  v_batch_key text;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_bucket interval;
  v_series_from date;
  v_series_to date;
  v_first_period date;
  v_last_period date;
  v_result jsonb;
begin
  if not public.has_permission('operasional.analytics') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_granularity not in ('day', 'month', 'year') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  v_date_from := coalesce(p_date_from, date_trunc('month', v_today)::date);
  v_date_to := coalesce(p_date_to, v_today);
  if v_date_to < v_date_from then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  v_advertiser_key := case when nullif(btrim(coalesce(p_advertiser_code, '')), '') is null
    then null else public.normalize_code(btrim(p_advertiser_code)) end;
  v_product_key := case when nullif(btrim(coalesce(p_product_code, '')), '') is null
    then null else public.normalize_code(btrim(p_product_code)) end;
  v_batch_key := case when nullif(btrim(coalesce(p_batch, '')), '') is null
    then null else public.normalize_batch(btrim(p_batch)) end;

  if v_advertiser_key is null then
    -- ------------------------------------------------------------------------
    -- Mode dashboard: semua pengiklan pada periode.
    -- ------------------------------------------------------------------------
    with orders_raw as (
      select public.normalize_code(o.advertiser_code) as advertiser_key,
             o.advertiser_code,
             o.advertiser_name,
             public.normalize_code(o.product_code) as product_key,
             o.product_code,
             o.product_name,
             public.normalize_batch(o.batch) as batch_key,
             o.batch,
             o.app_status,
             o.quantity,
             o.gross_amount,
             (coalesce(o.source_created_at, o.created_at) at time zone 'Asia/Jakarta')::date as order_date
        from public.orders o
       where o.product_parse_status = 'valid'
         and o.advertiser_code is not null
         and (v_product_key is null or public.normalize_code(o.product_code) = v_product_key)
         and (v_batch_key is null or public.normalize_batch(o.batch) = v_batch_key)
         and public.actor_can_product(v_actor, o.product_code)
         and coalesce(o.source_created_at, o.created_at) >= (v_date_from::timestamp at time zone 'Asia/Jakarta')
         and coalesce(o.source_created_at, o.created_at) < ((v_date_to + 1)::timestamp at time zone 'Asia/Jakarta')
    ),
    orders_base as (
      select * from orders_raw
       where order_date between v_date_from and v_date_to
    ),
    reports_base as (
      select r.id, r.batch, public.normalize_batch(r.batch) as batch_key,
             r.date_from, r.date_to, r.spend,
             round(r.spend * r.tax_percent / 100, 2) as tax_amount,
             p.code_normalized as product_key, p.code as product_code, p.name as product_name,
             a.code_normalized as advertiser_key, a.code as advertiser_code, a.name as advertiser_name
        from public.ad_spend_reports r
        join public.products p on p.id = r.product_id
        join public.advertisers a on a.id = r.advertiser_id
       where public.actor_can_product(v_actor, p.code)
         and (v_product_key is null or p.code_normalized = v_product_key)
         and (v_batch_key is null or r.batch = v_batch_key)
         and r.date_from <= v_date_to
         and r.date_to >= v_date_from
    ),
    advertiser_dim as (
      select advertiser_key,
             max(advertiser_code) as advertiser_code,
             max(advertiser_name) as advertiser_name
        from (
          select advertiser_key, advertiser_code, advertiser_name from orders_base
          union all
          select advertiser_key, advertiser_code, advertiser_name from reports_base
        ) u
       group by advertiser_key
    ),
    order_totals as (
      select advertiser_key,
             count(*)::int as leads,
             count(*) filter (where app_status = 'Paid')::int as paid,
             coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
             coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as omzet
        from orders_base
       group by advertiser_key
    ),
    spend_totals as (
      -- Hanya porsi report yang berada di dalam rentang yang dipilih.
      select advertiser_key,
             sum(spend * (least(date_to, v_date_to) - greatest(date_from, v_date_from) + 1)::numeric
                 / (date_to - date_from + 1))::numeric(18,2) as spend,
             sum(tax_amount * (least(date_to, v_date_to) - greatest(date_from, v_date_from) + 1)::numeric
                 / (date_to - date_from + 1))::numeric(18,2) as tax_amount
        from reports_base
       group by advertiser_key
    ),
    covered_tickets as (
      select o.advertiser_key, coalesce(sum(o.quantity), 0)::int as tickets
        from orders_base o
       where o.app_status = 'Paid'
         and exists (
           select 1 from reports_base r
            where r.advertiser_key = o.advertiser_key
              and r.product_key = o.product_key
              and r.batch_key = o.batch_key
              and o.order_date between r.date_from and r.date_to
         )
       group by o.advertiser_key
    ),
    product_totals as (
      select advertiser_key, product_key,
             max(product_code) as product_code,
             max(product_name) as product_name,
             coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
             coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as omzet
        from orders_base
       group by advertiser_key, product_key
      having coalesce(sum(quantity) filter (where app_status = 'Paid'), 0) > 0
    ),
    top_products as (
      select *, row_number() over (
        partition by advertiser_key
        order by tickets desc, omzet desc, product_name
      ) as rn
        from product_totals
    )
    select jsonb_build_object(
      'advertisers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'advertiser_code', d.advertiser_code,
          'advertiser_name', d.advertiser_name,
          'spend', coalesce(s.spend, 0),
          'tax_amount', coalesce(s.tax_amount, 0),
          'total_spend', coalesce(s.spend, 0) + coalesce(s.tax_amount, 0),
          'leads', coalesce(o.leads, 0),
          'paid', coalesce(o.paid, 0),
          'tickets', coalesce(o.tickets, 0),
          'omzet', coalesce(o.omzet, 0),
          'profit', coalesce(o.omzet, 0) - (coalesce(s.spend, 0) + coalesce(s.tax_amount, 0)),
          'closing_rate', case when coalesce(o.leads, 0) > 0
            then coalesce(o.tickets, 0)::numeric / o.leads else null end,
          'roas', case when coalesce(s.spend, 0) + coalesce(s.tax_amount, 0) > 0
            then coalesce(o.omzet, 0) / (coalesce(s.spend, 0) + coalesce(s.tax_amount, 0)) else null end,
          'coverage', case when coalesce(o.tickets, 0) > 0
            then coalesce(c.tickets, 0)::numeric / o.tickets else null end,
          'top_products', coalesce((
            select jsonb_agg(jsonb_build_object(
              'product_code', tp.product_code,
              'product_name', tp.product_name,
              'tickets', tp.tickets,
              'omzet', tp.omzet
            ) order by tp.rn)
              from top_products tp
             where tp.advertiser_key = d.advertiser_key and tp.rn <= 2
          ), '[]'::jsonb)
        ) order by coalesce(o.omzet, 0) desc, coalesce(o.tickets, 0) desc, d.advertiser_name)
          from advertiser_dim d
          left join order_totals o on o.advertiser_key = d.advertiser_key
          left join spend_totals s on s.advertiser_key = d.advertiser_key
          left join covered_tickets c on c.advertiser_key = d.advertiser_key
      ), '[]'::jsonb)
    ) into v_result;

    return v_result;
  end if;

  -- --------------------------------------------------------------------------
  -- Mode detail: satu pengiklan.
  -- --------------------------------------------------------------------------
  v_bucket := case v_granularity when 'day' then interval '1 day'
                                 when 'month' then interval '1 month'
                                 else interval '1 year' end;
  v_series_to := v_date_to;
  v_series_from := (date_trunc(v_granularity, v_date_from) - interval '1 year')::date;
  v_first_period := date_trunc(v_granularity, v_date_from)::date;
  v_last_period := date_trunc(v_granularity, v_date_to)::date;

  with orders_ext as (
    select o.order_id,
           public.normalize_code(o.product_code) as product_key,
           o.product_code, o.product_name,
           public.normalize_batch(o.batch) as batch_key, o.batch,
           o.app_status, o.quantity, o.gross_amount,
           (coalesce(o.source_created_at, o.created_at) at time zone 'Asia/Jakarta')::date as order_date
      from public.orders o
     where o.product_parse_status = 'valid'
       and public.normalize_code(o.advertiser_code) = v_advertiser_key
       and (v_product_key is null or public.normalize_code(o.product_code) = v_product_key)
       and (v_batch_key is null or public.normalize_batch(o.batch) = v_batch_key)
       and public.actor_can_product(v_actor, o.product_code)
       and coalesce(o.source_created_at, o.created_at) >= (v_series_from::timestamp at time zone 'Asia/Jakarta')
       and coalesce(o.source_created_at, o.created_at) < ((v_series_to + 1)::timestamp at time zone 'Asia/Jakarta')
  ),
  orders_base as (
    select * from orders_ext
     where order_date between v_date_from and v_date_to
  ),
  reports_ext as (
    select r.id, r.batch, public.normalize_batch(r.batch) as batch_key,
           r.date_from, r.date_to, r.spend,
           round(r.spend * r.tax_percent / 100, 2) as tax_amount,
           p.code_normalized as product_key, p.code as product_code, p.name as product_name
      from public.ad_spend_reports r
      join public.products p on p.id = r.product_id
      join public.advertisers a on a.id = r.advertiser_id
     where a.code_normalized = v_advertiser_key
       and public.actor_can_product(v_actor, p.code)
       and (v_product_key is null or p.code_normalized = v_product_key)
       and (v_batch_key is null or r.batch = v_batch_key)
       and r.date_from <= v_series_to
       and r.date_to >= v_series_from
  ),
  reports_base as (
    select * from reports_ext
     where date_from <= v_date_to and date_to >= v_date_from
  ),
  periods as (
    select gs::date as period_start,
           least((gs + v_bucket - interval '1 day')::date, v_series_to) as period_end
      from generate_series(v_series_from::timestamp, v_series_to::timestamp, v_bucket) gs
  ),
  -- Metrik "ext" dipakai HANYA untuk prev/YoY: bucket penuh di luar rentang terpilih.
  order_periods_ext as (
    select date_trunc(v_granularity, order_date)::date as period_start,
           count(*)::int as leads,
           count(*) filter (where app_status = 'Paid')::int as paid,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from orders_ext
     group by date_trunc(v_granularity, order_date)::date
  ),
  spend_periods_ext as (
    select p.period_start,
           sum(r.spend * (least(r.date_to, p.period_end) - greatest(r.date_from, p.period_start) + 1)::numeric
               / (r.date_to - r.date_from + 1))::numeric(18,2) as spend,
           sum(r.tax_amount * (least(r.date_to, p.period_end) - greatest(r.date_from, p.period_start) + 1)::numeric
               / (r.date_to - r.date_from + 1))::numeric(18,2) as tax_amount
      from periods p
      join reports_ext r
        on r.date_from <= p.period_end
       and r.date_to >= p.period_start
     group by p.period_start
  ),
  metrics_ext as (
    select p.period_start, p.period_end,
           coalesce(sp.spend, 0)::numeric(18,2) as spend,
           coalesce(sp.tax_amount, 0)::numeric(18,2) as tax_amount,
           (coalesce(sp.spend, 0) + coalesce(sp.tax_amount, 0))::numeric(18,2) as total_spend,
           coalesce(op.leads, 0) as leads,
           coalesce(op.paid, 0) as paid,
           coalesce(op.tickets, 0) as tickets,
           coalesce(op.omzet, 0)::numeric(18,2) as omzet,
           (coalesce(op.omzet, 0) - (coalesce(sp.spend, 0) + coalesce(sp.tax_amount, 0)))::numeric(18,2) as profit,
           case when coalesce(op.leads, 0) > 0
             then coalesce(op.tickets, 0)::numeric / op.leads else null end as closing_rate,
           case when coalesce(sp.spend, 0) + coalesce(sp.tax_amount, 0) > 0
             then coalesce(op.omzet, 0) / (coalesce(sp.spend, 0) + coalesce(sp.tax_amount, 0)) else null end as roas
      from periods p
      left join order_periods_ext op on op.period_start = p.period_start
      left join spend_periods_ext sp on sp.period_start = p.period_start
  ),
  metrics_ext_with_prev as (
    select m.*,
           lag(m.spend) over w as prev_spend,
           lag(m.tax_amount) over w as prev_tax_amount,
           lag(m.leads) over w as prev_leads,
           lag(m.paid) over w as prev_paid,
           lag(m.tickets) over w as prev_tickets,
           lag(m.omzet) over w as prev_omzet,
           lag(m.profit) over w as prev_profit,
           lag(m.closing_rate) over w as prev_closing_rate,
           lag(m.roas) over w as prev_roas,
           y.spend as yoy_spend,
           y.tax_amount as yoy_tax_amount,
           y.leads as yoy_leads,
           y.paid as yoy_paid,
           y.tickets as yoy_tickets,
           y.omzet as yoy_omzet,
           y.profit as yoy_profit,
           y.closing_rate as yoy_closing_rate,
           y.roas as yoy_roas
      from metrics_ext m
      left join metrics_ext y on y.period_start = (m.period_start - interval '1 year')::date
      window w as (order by m.period_start)
  ),
  -- Metrik tampilan: order dan report dipotong ke rentang yang benar-benar dipilih.
  -- Bucket pertama/terakhir yang tidak penuh tidak boleh memasukkan hari di luar filter.
  reports_selected_clipped as (
    select r.*,
           greatest(r.date_from, v_date_from) as alloc_from,
           least(r.date_to, v_date_to) as alloc_to
      from reports_base r
  ),
  order_periods_selected as (
    select date_trunc(v_granularity, order_date)::date as period_start,
           count(*)::int as leads,
           count(*) filter (where app_status = 'Paid')::int as paid,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from orders_base
     group by date_trunc(v_granularity, order_date)::date
  ),
  spend_periods_selected as (
    select p.period_start,
           sum(r.spend * (least(r.alloc_to, p.period_end) - greatest(r.alloc_from, p.period_start) + 1)::numeric
               / (r.date_to - r.date_from + 1))::numeric(18,2) as spend,
           sum(r.tax_amount * (least(r.alloc_to, p.period_end) - greatest(r.alloc_from, p.period_start) + 1)::numeric
               / (r.date_to - r.date_from + 1))::numeric(18,2) as tax_amount
      from periods p
      join reports_selected_clipped r
        on r.alloc_from <= p.period_end
       and r.alloc_to >= p.period_start
     group by p.period_start
  ),
  metrics_selected as (
    select p.period_start, p.period_end,
           coalesce(sp.spend, 0)::numeric(18,2) as spend,
           coalesce(sp.tax_amount, 0)::numeric(18,2) as tax_amount,
           (coalesce(sp.spend, 0) + coalesce(sp.tax_amount, 0))::numeric(18,2) as total_spend,
           coalesce(op.leads, 0) as leads,
           coalesce(op.paid, 0) as paid,
           coalesce(op.tickets, 0) as tickets,
           coalesce(op.omzet, 0)::numeric(18,2) as omzet,
           (coalesce(op.omzet, 0) - (coalesce(sp.spend, 0) + coalesce(sp.tax_amount, 0)))::numeric(18,2) as profit,
           case when coalesce(op.leads, 0) > 0
             then coalesce(op.tickets, 0)::numeric / op.leads else null end as closing_rate,
           case when coalesce(sp.spend, 0) + coalesce(sp.tax_amount, 0) > 0
             then coalesce(op.omzet, 0) / (coalesce(sp.spend, 0) + coalesce(sp.tax_amount, 0)) else null end as roas
      from periods p
      left join order_periods_selected op on op.period_start = p.period_start
      left join spend_periods_selected sp on sp.period_start = p.period_start
  ),
  selected_rows as (
    select ms.period_start, ms.period_end,
           ms.spend, ms.tax_amount, ms.total_spend, ms.leads, ms.paid, ms.tickets,
           ms.omzet, ms.profit, ms.closing_rate, ms.roas,
           (ms.period_start < v_date_from
            or ms.period_end < (ms.period_start + v_bucket - interval '1 day')::date) as is_partial,
           me.prev_spend, me.prev_tax_amount, me.prev_leads, me.prev_paid, me.prev_tickets,
           me.prev_omzet, me.prev_profit, me.prev_closing_rate, me.prev_roas,
           me.yoy_spend, me.yoy_tax_amount, me.yoy_leads, me.yoy_paid, me.yoy_tickets,
           me.yoy_omzet, me.yoy_profit, me.yoy_closing_rate, me.yoy_roas
      from metrics_selected ms
      left join metrics_ext_with_prev me on me.period_start = ms.period_start
     where ms.period_start between v_first_period and v_last_period
  ),
  coverage_total as (
    select coalesce(sum(o.quantity), 0)::int as tickets
      from orders_base o
     where o.app_status = 'Paid'
       and exists (
         select 1 from reports_base r
          where r.product_key = o.product_key
            and r.batch_key = o.batch_key
            and o.order_date between r.date_from and r.date_to
       )
  ),
  product_totals as (
    select product_key,
           max(product_code) as product_code,
           max(product_name) as product_name,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from orders_base
     group by product_key
    having coalesce(sum(quantity) filter (where app_status = 'Paid'), 0) > 0
  ),
  batch_totals as (
    select batch_key, max(batch) as batch,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from orders_base
     group by batch_key
    having coalesce(sum(quantity) filter (where app_status = 'Paid'), 0) > 0
  ),
  batch_spend as (
    select batch_key,
           sum(spend * (least(date_to, v_date_to) - greatest(date_from, v_date_from) + 1)::numeric
               / (date_to - date_from + 1))::numeric(18,2) as spend,
           sum(tax_amount * (least(date_to, v_date_to) - greatest(date_from, v_date_from) + 1)::numeric
               / (date_to - date_from + 1))::numeric(18,2) as tax_amount
      from reports_base
     group by batch_key
  ),
  summary as (
    select coalesce(sum(spend), 0)::numeric(18,2) as spend,
           coalesce(sum(tax_amount), 0)::numeric(18,2) as tax_amount,
           coalesce(sum(total_spend), 0)::numeric(18,2) as total_spend,
           coalesce(sum(leads), 0)::int as leads,
           coalesce(sum(paid), 0)::int as paid,
           coalesce(sum(tickets), 0)::int as tickets,
           coalesce(sum(omzet), 0)::numeric(18,2) as omzet,
           coalesce(sum(profit), 0)::numeric(18,2) as profit,
           case when coalesce(sum(leads), 0) > 0
             then coalesce(sum(tickets), 0)::numeric / sum(leads) else null end as closing_rate,
           case when coalesce(sum(total_spend), 0) > 0
             then coalesce(sum(omzet), 0) / sum(total_spend) else null end as roas,
           case when coalesce(sum(tickets), 0) > 0
             then (select tickets from coverage_total)::numeric / sum(tickets) else null end as coverage
      from metrics_selected
     where period_start between v_first_period and v_last_period
  )
  select jsonb_build_object(
    'summary', (select to_jsonb(s) from summary s),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period_start', r.period_start,
        'period_end', r.period_end,
        'is_partial', r.is_partial,
        'spend', r.spend,
        'tax_amount', r.tax_amount,
        'total_spend', r.total_spend,
        'leads', r.leads,
        'paid', r.paid,
        'tickets', r.tickets,
        'omzet', r.omzet,
        'profit', r.profit,
        'closing_rate', r.closing_rate,
        'roas', r.roas,
        'prev', case when r.is_partial then null else jsonb_build_object(
          'spend', r.prev_spend, 'tax_amount', r.prev_tax_amount,
          'leads', r.prev_leads, 'paid', r.prev_paid, 'tickets', r.prev_tickets,
          'omzet', r.prev_omzet, 'profit', r.prev_profit,
          'closing_rate', r.prev_closing_rate, 'roas', r.prev_roas
        ) end,
        'yoy', case when r.is_partial then null else jsonb_build_object(
          'spend', r.yoy_spend, 'tax_amount', r.yoy_tax_amount,
          'leads', r.yoy_leads, 'paid', r.yoy_paid, 'tickets', r.yoy_tickets,
          'omzet', r.yoy_omzet, 'profit', r.yoy_profit,
          'closing_rate', r.yoy_closing_rate, 'roas', r.yoy_roas
        ) end
      ) order by r.period_start)
        from selected_rows r
    ), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code', p.product_code,
        'product_name', p.product_name,
        'tickets', p.tickets,
        'omzet', p.omzet
      ) order by p.tickets desc, p.omzet desc, p.product_name)
        from (select * from product_totals order by tickets desc, omzet desc, product_name limit 2) p
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code', p.product_code,
        'product_name', p.product_name,
        'tickets', p.tickets,
        'omzet', p.omzet
      ) order by p.tickets desc, p.omzet desc, p.product_name)
        from product_totals p
    ), '[]'::jsonb),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch', b.batch,
        'spend', coalesce(bs.spend, 0),
        'tax_amount', coalesce(bs.tax_amount, 0),
        'total_spend', coalesce(bs.spend, 0) + coalesce(bs.tax_amount, 0),
        'tickets', b.tickets,
        'omzet', b.omzet,
        'profit', b.omzet - (coalesce(bs.spend, 0) + coalesce(bs.tax_amount, 0)),
        'roas', case when coalesce(bs.spend, 0) + coalesce(bs.tax_amount, 0) > 0
          then b.omzet / (coalesce(bs.spend, 0) + coalesce(bs.tax_amount, 0)) else null end
      ) order by b.tickets desc, b.omzet desc, b.batch)
        from batch_totals b
        left join batch_spend bs on bs.batch_key = b.batch_key
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.advertiser_performance(text,text,text,date,date,text) from public, anon, authenticated;
grant execute on function public.advertiser_performance(text,text,text,date,date,text) to authenticated;
