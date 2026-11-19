-- A83: KPI tiket global + snapshot bulanan Performa.
-- Mengunci: KPI per bulan (baca RLS, tulis backend), bantuan resume bulanan,
-- freeze idempoten, snapshot per pengiklan x produk, dan RPC detail tahun yang
-- memakai snapshot untuk bulan beku + live untuk 3 bulan terakhir.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 83, 'schema_version mencakup 83');

select is(has_table_privilege('authenticated', 'public.performance_kpi_targets', 'select'), true,
  'authenticated dapat membaca KPI lewat RLS');
select is(has_table_privilege('authenticated', 'public.performance_kpi_targets', 'insert'), false,
  'authenticated tidak dapat menulis KPI');
select is(has_table_privilege('authenticated', 'public.performance_monthly', 'select'), false,
  'performance_monthly tertutup untuk authenticated');
select is(has_table_privilege('authenticated', 'public.performance_frozen_months', 'select'), false,
  'performance_frozen_months tertutup untuk authenticated');
select is(has_function_privilege('authenticated', 'public.advertiser_performance_year(text,text)', 'execute'), true,
  'authenticated dapat memanggil RPC detail tahun');
select is(has_function_privilege('authenticated', 'public.performance_month_resume(date)', 'execute'), false,
  'performance_month_resume hanya internal');
select is(has_function_privilege('service_role', 'public.performance_freeze(date)', 'execute'), true,
  'service_role dapat menjalankan freeze');

insert into public.app_role_permissions (role_id, permission_key)
values ('manajer', 'operasional.analytics')
on conflict (role_id, permission_key) do nothing;

insert into public.products(id,name,code,active) values
  ('f1000000-0000-0000-0000-000000000001','Produk Performa','PRFX',true);
insert into public.advertisers(id,name,code,active) values
  ('f1000000-0000-0000-0000-000000000002','Pengiklan Performa','77',true);
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
  ('f1000000-0000-0000-0000-000000000003','perf_mgr','Manajer Performa','test','manajer',true);

-- Januari tahun berjalan sebagai bulan uji.
create temp table prf_bounds on commit drop as
  select date_trunc('year', (now() at time zone 'Asia/Jakarta')::date)::date as m_start;

insert into public.orders(
  order_id, product_code, product_name, advertiser_code, advertiser_name, batch, session, city,
  product_raw, product_parse_status, event_type, app_status, gross_amount, quantity, source_created_at, source
)
select 'prf-1','PRFX','Produk Performa','77','Pengiklan Performa','1','S1','Solo',
       'r','valid','Seminar Offline','Paid',100000,2,
       ((b.m_start + 2)::timestamp at time zone 'Asia/Jakarta'),'orderonline'
  from prf_bounds b;

insert into public.ad_spend_reports(advertiser_id, product_id, batch, event_type, date_from, date_to, spend, tax_percent)
select 'f1000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000001','1','Seminar Offline',
       b.m_start, (b.m_start + interval '1 month' - interval '1 day')::date, 50000, 10
  from prf_bounds b;

-- Bantuan resume: satu rumus untuk live + snapshot.
create temp table prf_resume on commit drop as
  select * from public.performance_month_resume((select m_start from prf_bounds));

select is((select leads from prf_resume where advertiser_code = '77' and product_code = 'PRFX'), 1,
  'resume: leads');
select is((select paid from prf_resume where advertiser_code = '77' and product_code = 'PRFX'), 1,
  'resume: paid');
select is((select tickets from prf_resume where advertiser_code = '77' and product_code = 'PRFX'), 2,
  'resume: tiket');
select is((select omzet from prf_resume where advertiser_code = '77' and product_code = 'PRFX'), 100000::numeric,
  'resume: omzet');
select is((select spend from prf_resume where advertiser_code = '77' and product_code = 'PRFX'), 50000::numeric,
  'resume: spend');
select is((select tax_amount from prf_resume where advertiser_code = '77' and product_code = 'PRFX'), 5000::numeric,
  'resume: tax');
select is((select total_spend from prf_resume where advertiser_code = '77' and product_code = 'PRFX'), 55000::numeric,
  'resume: total spend');
select is((select profit from prf_resume where advertiser_code = '77' and product_code = 'PRFX'), 45000::numeric,
  'resume: profit');
select is(round((select roas from prf_resume where advertiser_code = '77' and product_code = 'PRFX')::numeric, 4),
          round(100000::numeric / 55000::numeric, 4), 'resume: roas');

-- KPI: baca boleh, tulis tidak.
insert into public.performance_kpi_targets(period_month, target_tickets)
values ((select m_start from prf_bounds), 100);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000003","app_role":"manajer"}';
select is((select target_tickets from public.performance_kpi_targets
  where period_month = (select m_start from prf_bounds)), 100,
  'authenticated membaca KPI bulanan');
select throws_ok($$insert into public.performance_kpi_targets(period_month, target_tickets)
  values (date '2026-01-01', 10)$$, '42501', null,
  'authenticated tidak dapat menulis KPI');
reset role;

-- Freeze manual dengan cutoff April: Januari-Maret beku, idempoten.
select is(public.performance_freeze((select (m_start + interval '4 months')::date from prf_bounds)) >= 1, true,
  'freeze menjalankan bulan lama');
select is((select count(*)::int from public.performance_frozen_months
  where period_month = (select m_start from prf_bounds)), 1,
  'bulan uji ditandai beku');
select is((select tickets from public.performance_monthly
  where period_month = (select m_start from prf_bounds)
    and advertiser_code = '77' and product_code = 'PRFX'), 2,
  'snapshot menyimpan tiket');
select is(public.performance_freeze((select (m_start + interval '4 months')::date from prf_bounds)), 0,
  'freeze kedua tidak mengulang');

insert into public.performance_kpi_targets(period_month, target_tickets)
values (date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)::date, 200)
on conflict (period_month) do update set target_tickets = excluded.target_tickets;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000003","app_role":"manajer"}';
create temp table prf_year on commit drop as
  select public.advertiser_performance_year('77') as v;

select is((select (v->>'year')::int from prf_year),
          extract(year from (now() at time zone 'Asia/Jakarta')::date)::int,
          'RPC tahun mengembalikan tahun berjalan');
select is(jsonb_array_length((select v->'rows' from prf_year)), 12,
  'RPC tahun mengembalikan 12 baris');
select is(((select v->'rows'->0 from prf_year)->>'is_frozen')::boolean, true,
  'Januari memakai snapshot beku');
select is(((select v->'rows'->0 from prf_year)->>'tickets')::int, 2,
  'tiket Januari dari snapshot');
select is(((select v->'summary' from prf_year)->>'tickets')::int, 2,
  'summary memuat tiket beku');
select is((
  select (r->>'kpi_target')::int
    from jsonb_array_elements((select v->'rows' from prf_year)) r
   where (r->>'period_start')::date = date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)::date
), 200, 'KPI bulan berjalan ikut di baris');
select is((
  select (r->>'is_partial')::boolean
    from jsonb_array_elements((select v->'rows' from prf_year)) r
   where (r->>'period_start')::date = date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)::date
), true, 'bulan berjalan ditandai parsial');

reset role;
select * from finish();
rollback;
