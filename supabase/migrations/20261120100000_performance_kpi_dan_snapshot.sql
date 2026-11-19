-- 20261120100000_performance_kpi_dan_snapshot — A83 (permintaan pengguna 20 Nov 2026).
--
-- Tiga hal:
--   1) KPI tiket global per bulan (`performance_kpi_targets`) untuk badge di kartu
--      Performa. Satu angka untuk semua pengiklan, disimpan per bulan.
--   2) Resume bulanan per pengiklan x produk (`performance_monthly`) untuk bulan
--      yang lebih lama dari 3 bulan. Bulan berjalan + 2 bulan sebelumnya tetap live.
--   3) RPC detail tahun kalender berjalan yang menggabungkan snapshot beku dan
--      hitungan live, dengan KPI per bulan.
--
-- Tidak ada data lama yang diubah. Tabel KPI dapat dibaca browser lewat RLS
-- (izin operasional.analytics); penulisan lewat backend. Tabel snapshot hanya
-- service_role.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 83 $$;

-- ---------------------------------------------------------------------------
-- 1. KPI global per bulan
-- ---------------------------------------------------------------------------
create table if not exists public.performance_kpi_targets (
  period_month date primary key,
  target_tickets integer not null,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint performance_kpi_month_first check (period_month = date_trunc('month', period_month)::date),
  constraint performance_kpi_target_range check (target_tickets between 1 and 1000000)
);

create trigger performance_kpi_set_updated_at
  before update on public.performance_kpi_targets
  for each row execute function public.set_updated_at();

alter table public.performance_kpi_targets enable row level security;
revoke all on table public.performance_kpi_targets from public, anon, authenticated;
grant select on table public.performance_kpi_targets to authenticated;
grant all on table public.performance_kpi_targets to service_role;

drop policy if exists performance_kpi_select on public.performance_kpi_targets;
create policy performance_kpi_select on public.performance_kpi_targets
  for select to authenticated
  using (public.has_permission('operasional.analytics'));

-- ---------------------------------------------------------------------------
-- 2. Snapshot bulanan (per pengiklan x produk)
-- ---------------------------------------------------------------------------
create table if not exists public.performance_monthly (
  period_month date not null,
  advertiser_code text not null,
  advertiser_name text,
  product_code text not null,
  product_name text,
  leads integer not null default 0,
  paid integer not null default 0,
  tickets integer not null default 0,
  omzet numeric(18,2) not null default 0,
  spend numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  total_spend numeric(18,2) not null default 0,
  profit numeric(18,2) not null default 0,
  closing_rate numeric,
  roas numeric,
  frozen_at timestamptz not null default now(),
  primary key (period_month, advertiser_code, product_code),
  constraint performance_monthly_month_first check (period_month = date_trunc('month', period_month)::date)
);

create index if not exists performance_monthly_advertiser_idx
  on public.performance_monthly (advertiser_code, period_month);
create index if not exists performance_monthly_product_idx
  on public.performance_monthly (product_code, period_month);

alter table public.performance_monthly enable row level security;
revoke all on table public.performance_monthly from public, anon, authenticated;
grant all on table public.performance_monthly to service_role;

create table if not exists public.performance_frozen_months (
  period_month date primary key,
  frozen_at timestamptz not null default now(),
  constraint performance_frozen_month_first check (period_month = date_trunc('month', period_month)::date)
);

alter table public.performance_frozen_months enable row level security;
revoke all on table public.performance_frozen_months from public, anon, authenticated;
grant all on table public.performance_frozen_months to service_role;

-- ---------------------------------------------------------------------------
-- 3. Satu rumus untuk live + freeze
-- ---------------------------------------------------------------------------
create or replace function public.performance_month_resume(p_month date)
returns table (
  advertiser_code text,
  advertiser_name text,
  product_code text,
  product_name text,
  leads integer,
  paid integer,
  tickets integer,
  omzet numeric,
  spend numeric,
  tax_amount numeric,
  total_spend numeric,
  profit numeric,
  closing_rate numeric,
  roas numeric
)
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  with bounds as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date as m_end_excl
  ),
  orders_m as (
    select public.normalize_code(o.advertiser_code) as advertiser_key,
           max(o.advertiser_code) as advertiser_code,
           max(o.advertiser_name) as advertiser_name,
           public.normalize_code(o.product_code) as product_key,
           max(o.product_code) as product_code,
           max(o.product_name) as product_name,
           count(*)::int as leads,
           count(*) filter (where o.app_status = 'Paid')::int as paid,
           coalesce(sum(o.quantity) filter (where o.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(o.gross_amount) filter (where o.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from public.orders o
      cross join bounds b
     where o.product_parse_status = 'valid'
       and o.advertiser_code is not null
       and coalesce(o.source_created_at, o.created_at) >= (b.m_start::timestamp at time zone 'Asia/Jakarta')
       and coalesce(o.source_created_at, o.created_at) < (b.m_end_excl::timestamp at time zone 'Asia/Jakarta')
     group by public.normalize_code(o.advertiser_code), public.normalize_code(o.product_code)
  ),
  reports_m as (
    select public.normalize_code(a.code) as advertiser_key,
           max(a.code) as advertiser_code,
           max(a.name) as advertiser_name,
           p.code_normalized as product_key,
           max(p.code) as product_code,
           max(p.name) as product_name,
           sum(
             r.spend * (least(r.date_to, (b.m_end_excl - 1)::date) - greatest(r.date_from, b.m_start) + 1)::numeric
             / (r.date_to - r.date_from + 1)
           )::numeric(18,2) as spend,
           sum(
             round(r.spend * r.tax_percent / 100, 2)
             * (least(r.date_to, (b.m_end_excl - 1)::date) - greatest(r.date_from, b.m_start) + 1)::numeric
             / (r.date_to - r.date_from + 1)
           )::numeric(18,2) as tax_amount
      from public.ad_spend_reports r
      join public.products p on p.id = r.product_id
      join public.advertisers a on a.id = r.advertiser_id
      cross join bounds b
     where r.date_from <= (b.m_end_excl - 1)::date
       and r.date_to >= b.m_start
     group by public.normalize_code(a.code), p.code_normalized
  ),
  keys as (
    select advertiser_key, product_key from orders_m
    union
    select advertiser_key, product_key from reports_m
  )
  select coalesce(o.advertiser_code, r.advertiser_code) as advertiser_code,
         coalesce(o.advertiser_name, r.advertiser_name) as advertiser_name,
         coalesce(o.product_code, r.product_code) as product_code,
         coalesce(o.product_name, r.product_name) as product_name,
         coalesce(o.leads, 0)::int as leads,
         coalesce(o.paid, 0)::int as paid,
         coalesce(o.tickets, 0)::int as tickets,
         coalesce(o.omzet, 0)::numeric(18,2) as omzet,
         coalesce(r.spend, 0)::numeric(18,2) as spend,
         coalesce(r.tax_amount, 0)::numeric(18,2) as tax_amount,
         (coalesce(r.spend, 0) + coalesce(r.tax_amount, 0))::numeric(18,2) as total_spend,
         (coalesce(o.omzet, 0) - (coalesce(r.spend, 0) + coalesce(r.tax_amount, 0)))::numeric(18,2) as profit,
         case when coalesce(o.leads, 0) > 0
           then coalesce(o.tickets, 0)::numeric / o.leads else null end as closing_rate,
         case when coalesce(r.spend, 0) + coalesce(r.tax_amount, 0) > 0
           then coalesce(o.omzet, 0) / (coalesce(r.spend, 0) + coalesce(r.tax_amount, 0)) else null end as roas
    from keys k
    left join orders_m o on o.advertiser_key = k.advertiser_key and o.product_key = k.product_key
    left join reports_m r on r.advertiser_key = k.advertiser_key and r.product_key = k.product_key
$$;

revoke all on function public.performance_month_resume(date) from public, anon, authenticated;
grant execute on function public.performance_month_resume(date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Freeze bulan yang lebih lama dari 3 bulan (bulan ini + 2 sebelumnya live)
-- ---------------------------------------------------------------------------
create or replace function public.performance_freeze(p_until date default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  -- `p_until` hanya untuk backfill/tes; cron memakai default (bulan ini - 2 bulan).
  v_cutoff date := coalesce(p_until, (date_trunc('month', v_today) - interval '2 months')::date);
  v_month date := date_trunc('year', v_today)::date;
  v_frozen integer := 0;
begin
  while v_month < v_cutoff loop
    if not exists (
      select 1 from public.performance_frozen_months where period_month = v_month
    ) then
      insert into public.performance_monthly (
        period_month, advertiser_code, advertiser_name, product_code, product_name,
        leads, paid, tickets, omzet, spend, tax_amount, total_spend, profit, closing_rate, roas
      )
      select v_month,
             r.advertiser_code, r.advertiser_name, r.product_code, r.product_name,
             r.leads, r.paid, r.tickets, r.omzet, r.spend, r.tax_amount,
             r.total_spend, r.profit, r.closing_rate, r.roas
        from public.performance_month_resume(v_month) r
      on conflict (period_month, advertiser_code, product_code) do nothing;

      insert into public.performance_frozen_months (period_month)
      values (v_month)
      on conflict (period_month) do nothing;

      v_frozen := v_frozen + 1;
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  return v_frozen;
end $$;

revoke all on function public.performance_freeze(date) from public, anon, authenticated;
grant execute on function public.performance_freeze(date) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'dvflow_performance_freeze') then
      perform cron.unschedule('dvflow_performance_freeze');
    end if;
    -- 01:00 WIB (18:00 UTC).
    perform cron.schedule(
      'dvflow_performance_freeze',
      '0 18 * * *',
      $cron$select public.performance_freeze()$cron$
    );
  else
    raise warning 'pg_cron tidak tersedia: freeze performa bulanan TIDAK dijadwalkan.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Detail tahun kalender berjalan: snapshot beku + 3 bulan live + KPI
-- ---------------------------------------------------------------------------
create or replace function public.advertiser_performance_year(
  p_advertiser_code text,
  p_product_code text default null
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
  v_advertiser_key text;
  v_product_key text;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_year_start date := date_trunc('year', (now() at time zone 'Asia/Jakarta')::date)::date;
  v_current_month date := date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)::date;
  v_year integer := extract(year from (now() at time zone 'Asia/Jakarta')::date)::int;
  v_result jsonb;
begin
  if not public.has_permission('operasional.analytics') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select a.code_normalized into v_own_advertiser_key
    from public.users u
    join public.advertisers a on a.id = u.advertiser_id
   where u.id = v_actor;

  v_advertiser_key := case when nullif(btrim(coalesce(p_advertiser_code, '')), '') is null
    then null else public.normalize_code(btrim(p_advertiser_code)) end;
  v_product_key := case when nullif(btrim(coalesce(p_product_code, '')), '') is null
    then null else public.normalize_code(btrim(p_product_code)) end;

  if v_own_advertiser_key is not null then
    if v_advertiser_key is not null and v_advertiser_key <> v_own_advertiser_key then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
    v_advertiser_key := v_own_advertiser_key;
  end if;
  if v_advertiser_key is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  with months as (
    select gs::date as month_start
      from generate_series(
        v_year_start::timestamp,
        (v_year_start + interval '11 months')::timestamp,
        interval '1 month'
      ) gs
  ),
  frozen as (
    select f.period_month
      from public.performance_frozen_months f
      join months m on m.month_start = f.period_month
  ),
  frozen_rows as (
    select m.month_start,
           pm.advertiser_code, pm.advertiser_name, pm.product_code, pm.product_name,
           pm.leads, pm.paid, pm.tickets, pm.omzet, pm.spend, pm.tax_amount,
           pm.total_spend, pm.profit, pm.closing_rate, pm.roas
      from months m
      join public.performance_monthly pm on pm.period_month = m.month_start
      join frozen f on f.period_month = m.month_start
     where public.normalize_code(pm.advertiser_code) = v_advertiser_key
       and (v_product_key is null or public.normalize_code(pm.product_code) = v_product_key)
       and public.actor_can_product(v_actor, pm.product_code)
  ),
  live_months as (
    select m.month_start
      from months m
     where m.month_start <= v_current_month
       and not exists (select 1 from frozen f where f.period_month = m.month_start)
  ),
  live_rows as (
    select m.month_start,
           r.advertiser_code, r.advertiser_name, r.product_code, r.product_name,
           r.leads, r.paid, r.tickets, r.omzet, r.spend, r.tax_amount,
           r.total_spend, r.profit, r.closing_rate, r.roas
      from live_months m
      cross join lateral public.performance_month_resume(m.month_start) r
     where public.normalize_code(r.advertiser_code) = v_advertiser_key
       and (v_product_key is null or public.normalize_code(r.product_code) = v_product_key)
       and public.actor_can_product(v_actor, r.product_code)
  ),
  all_rows as (
    select * from frozen_rows
    union all
    select * from live_rows
  ),
  agg as (
    select m.month_start,
           (m.month_start + interval '1 month' - interval '1 day')::date as period_end,
           (m.month_start = v_current_month) as is_partial,
           (m.month_start > v_current_month) as is_future,
           exists(select 1 from frozen f where f.period_month = m.month_start) as is_frozen,
           coalesce(sum(a.leads), 0)::int as leads,
           coalesce(sum(a.paid), 0)::int as paid,
           coalesce(sum(a.tickets), 0)::int as tickets,
           coalesce(sum(a.omzet), 0)::numeric(18,2) as omzet,
           coalesce(sum(a.spend), 0)::numeric(18,2) as spend,
           coalesce(sum(a.tax_amount), 0)::numeric(18,2) as tax_amount,
           coalesce(sum(a.total_spend), 0)::numeric(18,2) as total_spend,
           coalesce(sum(a.profit), 0)::numeric(18,2) as profit,
           case when coalesce(sum(a.leads), 0) > 0
             then coalesce(sum(a.tickets), 0)::numeric / sum(a.leads) else null end as closing_rate,
           case when coalesce(sum(a.total_spend), 0) > 0
             then coalesce(sum(a.omzet), 0) / sum(a.total_spend) else null end as roas
      from months m
      left join all_rows a on a.month_start = m.month_start
     group by m.month_start
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
             then coalesce(sum(omzet), 0) / sum(total_spend) else null end as roas
      from agg
     where not is_future
  ),
  discipline as (
    select * from public.ad_calendar_scores(v_actor, v_year_start, v_today, v_advertiser_key, v_product_key, null::text)
  ),
  products as (
    select public.normalize_code(a.product_code) as product_key,
           max(a.product_code) as product_code,
           max(a.product_name) as product_name,
           coalesce(sum(a.tickets), 0)::int as tickets,
           coalesce(sum(a.omzet), 0)::numeric(18,2) as omzet
      from all_rows a
     where a.month_start <= v_current_month
     group by public.normalize_code(a.product_code)
    having coalesce(sum(a.tickets), 0) > 0
  )
  select jsonb_build_object(
    'year', v_year,
    'summary', (select to_jsonb(s) || jsonb_build_object(
      'coverage', null,
      'discipline_rate', (select case when batches > 0 then total_score::numeric / (batches * 10) else null end from discipline),
      'discipline_score', (select coalesce(total_score, 0) from discipline),
      'discipline_batches', (select coalesce(batches, 0) from discipline),
      'discipline_on_time', (select coalesce(on_time, 0) from discipline),
      'discipline_late', (select coalesce(late, 0) from discipline),
      'discipline_unpublished', (select coalesce(unpublished, 0) from discipline),
      'discipline_upcoming', (select coalesce(upcoming, 0) from discipline)
    ) from summary s),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period_start', a.month_start,
        'period_end', a.period_end,
        'is_partial', a.is_partial,
        'is_future', a.is_future,
        'is_frozen', a.is_frozen,
        'spend', a.spend,
        'tax_amount', a.tax_amount,
        'total_spend', a.total_spend,
        'leads', a.leads,
        'paid', a.paid,
        'tickets', a.tickets,
        'omzet', a.omzet,
        'profit', a.profit,
        'closing_rate', a.closing_rate,
        'roas', a.roas,
        'coverage', null,
        'kpi_target', k.target_tickets
      ) order by a.month_start)
        from agg a
        left join public.performance_kpi_targets k on k.period_month = a.month_start
    ), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code', p.product_code,
        'product_name', p.product_name,
        'tickets', p.tickets,
        'omzet', p.omzet
      ) order by p.tickets desc, p.omzet desc, p.product_name)
        from (select * from products order by tickets desc, omzet desc, product_name limit 3) p
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code', p.product_code,
        'product_name', p.product_name,
        'tickets', p.tickets,
        'omzet', p.omzet
      ) order by p.tickets desc, p.omzet desc, p.product_name)
        from products p
    ), '[]'::jsonb),
    'batches', '[]'::jsonb
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.advertiser_performance_year(text, text) from public, anon, authenticated;
grant execute on function public.advertiser_performance_year(text, text) to authenticated;

notify pgrst, 'reload schema';
