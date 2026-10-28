-- 0057_analytics_advertiser_scope — A48 (permintaan pengguna 28 Okt 2026).
-- Halaman Performa / Analitik mendapat aturan tampilan tambahan:
--   * akun Advertiser hanya melihat pengiklannya sendiri;
--   * Pimpro tetap melihat semua pengiklan di produk yang dicentang;
--   * Admin/Manajer/Owner/Developer melihat seluruh pengiklan sesuai akses produknya.
-- Aturan ini HANYA untuk halaman Performa. A44 (Advertiser boleh membaca order semua
-- pengiklan di produk yang sama) tetap berlaku di Order, Presensi, Dashboard, Report Spend,
-- export, dan check-in. Report Spend tidak diubah oleh migrasi ini.
-- Tidak ada tabel/kolom/index baru dan tidak ada data yang diubah.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 57 $$;

-- Izin Performa untuk Advertiser + Pimpro. Default Manajer/Admin sudah ada di 0056.
-- Owner/Developer otomatis. Role lain tetap harus dicentang manual di Konfigurasi Role.
insert into public.app_role_permissions (role_id, permission_key)
select r, 'operasional.analytics' from unnest(array['advertiser', 'pimpro']) r
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- ============================================================================
-- Performa / Analitik: daftar pengiklan + track record satu pengiklan (A46/A48).
-- ============================================================================
-- Perbedaan dari 0056 hanya pada scope pengiklan:
--   * mode dashboard (p_advertiser_code kosong): akun yang memegang pengiklan
--     (users.advertiser_id) hanya menghasilkan baris pengiklannya sendiri;
--   * mode detail (p_advertiser_code diisi): kode yang bukan milik akun ditolak DF006.
-- Scope produk tetap lewat actor_can_product (A44).
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
  v_own_advertiser_key text;
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

  -- Akun Advertiser = akun yang memegang satu pengiklan (users.advertiser_id).
  select a.code_normalized into v_own_advertiser_key
    from public.users u
    join public.advertisers a on a.id = u.advertiser_id
   where u.id = v_actor;

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

  -- A48: akun Advertiser tidak boleh membuka detail pengiklan lain.
  if v_own_advertiser_key is not null
     and v_advertiser_key is not null
     and v_advertiser_key <> v_own_advertiser_key then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if v_advertiser_key is null then
    -- ------------------------------------------------------------------------
    -- Mode dashboard: semua pengiklan pada periode (kecuali akun Advertiser).
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
         and (v_own_advertiser_key is null or public.normalize_code(o.advertiser_code) = v_own_advertiser_key)
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
         and (v_own_advertiser_key is null or a.code_normalized = v_own_advertiser_key)
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
  -- Mode detail: satu pengiklan (akun Advertiser hanya kodenya sendiri).
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
