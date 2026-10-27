-- 0056 (A46): Performa / Analitik + perbandingan pengiklan.
-- Mengunci: prorata harian (28 Agu–3 Sep), hanya order Paid untuk tiket/omzet,
-- top 2 produk berdasarkan tiket, prev/yoy, partial bucket, scope produk, dan izin.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 56, 'schema_version mencakup 0056');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'manajer' and permission_key = 'operasional.analytics'),
  'manajer punya izin Performa bawaan');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'admin' and permission_key = 'operasional.analytics'),
  'admin punya izin Performa bawaan');

insert into public.products(id,name,code) values
 ('fa000000-0000-0000-0000-00000000000a','Perf Produk A','PAAA'),
 ('fa000000-0000-0000-0000-00000000000b','Perf Produk B','PBBB');
insert into public.advertisers(id,name,code) values
 ('fa000000-0000-0000-0000-000000000001','Perf Zul','71'),
 ('fa000000-0000-0000-0000-000000000002','Perf Rina','72');
insert into public.app_roles(id,name,description,is_system) values ('perf_viewer','Perf Viewer',null,false);
insert into public.app_role_permissions(role_id,permission_key) values
 ('perf_viewer','operasional.analytics'),
 ('perf_viewer','operasional.report_spend');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('fa000000-0000-0000-0000-0000000000c1','perf_view','Perf Viewer','test','perf_viewer',true),
 ('fa000000-0000-0000-0000-0000000000c2','perf_view_b','Perf Viewer B','test','perf_viewer',false),
 ('fa000000-0000-0000-0000-0000000000e1','perf_member','Perf Member','test','member',true);
insert into public.user_product_access(user_id,product_code) values ('fa000000-0000-0000-0000-0000000000c2','PBBB');

-- Report 28 Agu–3 Sep = 7 hari. Porsi Agustus 4/7, September 3/7.
insert into public.ad_spend_reports(advertiser_id,product_id,batch,date_from,date_to,spend,tax_percent) values
 ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-00000000000a','100','2026-08-28','2026-09-03',700000,11),
 ('fa000000-0000-0000-0000-000000000002','fa000000-0000-0000-0000-00000000000a','100','2026-09-01','2026-09-30',300000,11),
 ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-00000000000b','200','2026-09-10','2026-09-10',100000,0);

insert into public.orders(order_id,product_code,product_name,advertiser_code,advertiser_name,batch,session,city,
  product_raw,product_parse_status,event_type,app_status,gross_amount,quantity,source_created_at,source) values
 ('perf-1','PAAA','Perf Produk A','71','Perf Zul','100','S1','Solo','r','valid','Seminar Offline','Paid',300000,2,'2026-08-30T05:00:00Z','orderonline'),
 ('perf-2','PAAA','Perf Produk A','71','Perf Zul','100','S1','Solo','r','valid','Seminar Offline','Paid',150000,1,'2026-09-02T05:00:00Z','orderonline'),
 ('perf-3','PAAA','Perf Produk A','71','Perf Zul','100','S1','Solo','r','valid','Seminar Offline','Pending',150000,1,'2026-09-02T06:00:00Z','orderonline'),
 ('perf-4','PBBB','Perf Produk B','71','Perf Zul','200','S2','Bandung','r','valid','Seminar Offline','Paid',800000,4,'2026-09-11T05:00:00Z','orderonline'),
 ('perf-5','PAAA','Perf Produk A','72','Perf Rina','100','S1','Solo','r','valid','Seminar Offline','Paid',450000,3,'2026-09-15T05:00:00Z','orderonline'),
 ('perf-6','PAAA','Perf Produk A','72','Perf Rina','200','S1','Solo','r','valid','Seminar Offline','Paid',150000,1,'2026-09-16T05:00:00Z','orderonline'),
 ('perf-7','PAAA','Perf Produk A',null,null,'100','S1','Solo','r','valid','Seminar Offline','Paid',150000,1,'2026-09-16T05:00:00Z','ots'),
 ('perf-8','PAAA','Perf Produk A','71','Perf Zul','100','S1','Solo','r','valid','Seminar Offline','Paid',150000,1,'2026-10-01T05:00:00Z','orderonline');

-- Dashboard semua pengiklan.
set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-0000000000c1","app_role":"perf_viewer"}';
create temp table perf on commit drop as select public.advertiser_performance(null,null,null,'2026-09-01','2026-09-30','month') as v;

select is((select jsonb_array_length(v->'advertisers') from perf), 2, 'dashboard: dua pengiklan aktif; OTS tidak masuk');
select is((select x->>'advertiser_code' from perf, jsonb_array_elements(v->'advertisers') x limit 1), '71',
  'dashboard: urut omzet menurun (Zul lebih dulu)');
select is((select (x->>'spend')::numeric from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  400000::numeric, 'Zul: spend September = 3/7 report Agustus + report PB');
select is((select (x->>'tax_amount')::numeric from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  33000::numeric, 'Zul: PPN ikut prorata 3/7');
select is((select (x->>'leads')::int from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  3, 'Zul: leads semua status (2 order Sep + 1 Pending)');
select is((select (x->>'paid')::int from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  2, 'Zul: paid hanya order Paid');
select is((select (x->>'tickets')::int from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  5, 'Zul: tiket = sum quantity Paid (1 + 4), order Agustus & Oktober tidak masuk');
select is((select (x->>'omzet')::numeric from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  950000::numeric, 'Zul: omzet gross Paid');
select is((select (x->>'profit')::numeric from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  517000::numeric, 'Zul: profit = omzet - (spend + PPN)');
select is((select round((x->>'closing_rate')::numeric, 4) from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  1.6667::numeric, 'Zul: closing rate = tiket / leads');
select is((select round((x->>'roas')::numeric, 4) from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  2.1940::numeric, 'Zul: ROAS = omzet / (spend + PPN)');
select is((select round((x->>'coverage')::numeric, 4) from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  0.2000::numeric, 'Zul: hanya 1 dari 5 tiket tercakup report');
select is((select x->'top_products'->0->>'product_code' from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  'PBBB', 'Zul: top produk berdasarkan tiket (PB 4 tiket)');
select is((select (x->'top_products'->0->>'tickets')::int from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '71'),
  4, 'Zul: top produk 4 tiket');
select is((select jsonb_array_length(x->'top_products') from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '72'),
  1, 'Rina: hanya satu produk dengan tiket');
select is((select (x->>'tickets')::int from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '72'),
  4, 'Rina: tiket 3 + 1');
select is((select round((x->>'coverage')::numeric, 4) from perf, jsonb_array_elements(v->'advertisers') x where x->>'advertiser_code' = '72'),
  0.7500::numeric, 'Rina: 3 dari 4 tiket tercakup report');

-- Detail satu pengiklan.
create temp table perf_detail on commit drop as
  select public.advertiser_performance('71',null,null,'2026-09-01','2026-09-30','month') as v;

select is((select jsonb_array_length(v->'rows') from perf_detail), 1, 'detail: satu bucket bulanan');
select is((select v->'rows'->0->>'period_start' from perf_detail), '2026-09-01', 'detail: periode September');
select is((select v->'rows'->0->>'is_partial' from perf_detail), 'false', 'detail: September penuh');
select is((select (v->'rows'->0->'prev'->>'tickets')::int from perf_detail), 2, 'detail: prev Agustus punya 2 tiket');
select is((select (v->'rows'->0->'prev'->>'spend')::numeric from perf_detail), 400000::numeric,
  'detail: prev Agustus memakai porsi 4/7 report');
select is((select (v->'rows'->0->'yoy'->>'tickets')::int from perf_detail), 0, 'detail: YoY belum ada data -> 0');
select is((select (v->'summary'->>'spend')::numeric from perf_detail), 400000::numeric, 'detail: summary spend');
select is((select (v->'summary'->>'total_spend')::numeric from perf_detail), 433000::numeric, 'detail: summary total spend');
select is((select (v->'summary'->>'tickets')::int from perf_detail), 5, 'detail: summary tiket');
select is((select round((v->'summary'->>'closing_rate')::numeric, 4) from perf_detail), 1.6667::numeric,
  'detail: summary closing rate');
select is((select jsonb_array_length(v->'top_products') from perf_detail), 2, 'detail: top 2 produk');
select is((select v->'top_products'->0->>'product_code' from perf_detail), 'PBBB', 'detail: top produk pertama');
select is((select jsonb_array_length(v->'products') from perf_detail), 2, 'detail: semua produk');
select is((select jsonb_array_length(v->'batches') from perf_detail), 2, 'detail: dua batch');
select is((select (x->>'tickets')::int from perf_detail, jsonb_array_elements(v->'batches') x where x->>'batch' = '200'),
  4, 'detail: batch 200 4 tiket');
select is((select (x->>'profit')::numeric from perf_detail, jsonb_array_elements(v->'batches') x where x->>'batch' = '200'),
  700000::numeric, 'detail: profit batch 200');

-- Granularitas harian: 2–15 Sep = 14 titik; porsi report 1/7 per hari.
create temp table perf_day on commit drop as
  select public.advertiser_performance('71',null,null,'2026-09-02','2026-09-15','day') as v;
select is((select jsonb_array_length(v->'rows') from perf_day), 14, 'harian: 14 titik');
select is((select (x->>'tickets')::int from perf_day, jsonb_array_elements(v->'rows') x where x->>'period_start' = '2026-09-02'),
  1, 'harian: 2 Sep = 1 tiket');
select is((select (x->>'leads')::int from perf_day, jsonb_array_elements(v->'rows') x where x->>'period_start' = '2026-09-02'),
  2, 'harian: 2 Sep = 2 leads (Paid + Pending)');
select is((select (x->>'spend')::numeric from perf_day, jsonb_array_elements(v->'rows') x where x->>'period_start' = '2026-09-02'),
  100000::numeric, 'harian: spend 2 Sep = 1/7 report');
select is((select (x->>'tickets')::int from perf_day, jsonb_array_elements(v->'rows') x where x->>'period_start' = '2026-09-11'),
  4, 'harian: 11 Sep = 4 tiket PB');
select is((select sum((x->>'tickets')::int)::int from perf_day, jsonb_array_elements(v->'rows') x), 5, 'harian: total tiket 5');

-- Bulan sebagian: delta disembunyikan.
create temp table perf_partial on commit drop as
  select public.advertiser_performance('71',null,null,'2026-09-02','2026-09-15','month') as v;
select is((select v->'rows'->0->>'is_partial' from perf_partial), 'true', 'partial: September sebagian');
select is((select v->'rows'->0->'prev' from perf_partial), 'null'::jsonb, 'partial: prev null');
select is((select v->'rows'->0->'yoy' from perf_partial), 'null'::jsonb, 'partial: yoy null');
select is((select (v->'summary'->>'spend')::numeric from perf_partial), 300000::numeric,
  'partial: spend hanya 2–3 Sep (2/7) + 10 Sep, bukan 1 Sep');
select is((select (v->'summary'->>'total_spend')::numeric from perf_partial), 322000::numeric,
  'partial: PPN ikut terpotong');
select is((select (v->'summary'->>'tickets')::int from perf_partial), 5, 'partial: tiket tetap 5');

-- Input tidak valid & scope produk.
select throws_ok($$select public.advertiser_performance('71',null,null,'2026-09-01','2026-09-30','week')$$,
  'DF011', 'INVALID_ARGUMENT', 'granularitas tidak dikenal ditolak');
select is((select jsonb_array_length(public.advertiser_performance(null,'ZZZZ',null,'2026-09-01','2026-09-30','month')->'advertisers')),
  0, 'produk tidak ada = daftar kosong');

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-0000000000c2","app_role":"perf_viewer"}';
select is((select jsonb_array_length(public.advertiser_performance(null,'PAAA',null,'2026-09-01','2026-09-30','month')->'advertisers')),
  0, 'viewer produk B: produk A tidak terlihat');
select is((select (public.advertiser_performance(null,'PBBB',null,'2026-09-01','2026-09-30','month')->'advertisers'->0->>'advertiser_code')),
  '71', 'viewer produk B: hanya produk B yang terlihat');

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-0000000000e1","app_role":"member"}';
select throws_ok($$select public.advertiser_performance(null,null,null,'2026-09-01','2026-09-30','month')$$,
  'DF006', 'FORBIDDEN', 'tanpa izin Performa ditolak');

-- Comparison di Report Spend: total harus sama dengan summary.
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-0000000000c1","app_role":"perf_viewer"}';
create temp table perf_cmp on commit drop as
  select public.ad_spend_report('2026-09-01','2026-09-30',null,null,'100') as v;
select is((select jsonb_array_length(v->'comparison'->'rows') from perf_cmp), 2, 'comparison: dua pengiklan');
select is((select (v->'comparison'->'totals'->>'spend')::numeric from perf_cmp), 1000000::numeric, 'comparison: total spend');
select is((select (v->'comparison'->'totals'->>'tickets')::int from perf_cmp), 6, 'comparison: total tiket');
select is((select sum((x->>'tickets')::int)::int from perf_cmp, jsonb_array_elements(v->'comparison'->'rows') x),
  6, 'comparison: jumlah tiket per baris = total');
select is((select (x->>'spend')::numeric from perf_cmp, jsonb_array_elements(v->'comparison'->'rows') x where x->>'advertiser_code' = '71'),
  700000::numeric, 'comparison: report 28 Agu–3 Sep dihitung penuh (perilaku Report Spend)');
select is((select (x->>'tickets')::int from perf_cmp, jsonb_array_elements(v->'comparison'->'rows') x where x->>'advertiser_code' = '72'),
  3, 'comparison: Rina 3 tiket');

reset role;
select is(has_function_privilege('anon','public.advertiser_performance(text,text,text,date,date,text)','execute'), false,
  'advertiser_performance tidak bisa dipanggil anon');
select is(has_function_privilege('authenticated','public.advertiser_performance(text,text,text,date,date,text)','execute'), true,
  'advertiser_performance bisa dipanggil authenticated');

select * from finish();
rollback;
