-- 0062 (A57): pemilihan batch terakhir halaman Performa.
-- Mengunci: produk memakai 2 batch terakhir per produk, kartu batch memakai 5 batch
-- terakhir, "terakhir" = tanggal aktivitas terbaru (order atau report spend),
-- batch spend-only ikut dihitung, dan pemanggilan 4 argumen lama tetap jalan.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 62, 'schema_version mencakup 0062');

insert into public.products(id,name,code) values
 ('fd000000-0000-0000-0000-00000000000a','Recent Produk A','PAAA'),
 ('fd000000-0000-0000-0000-00000000000b','Recent Produk B','PBBB');
insert into public.advertisers(id,name,code) values
 ('fd000000-0000-0000-0000-000000000001','Recent Zul','71');
insert into public.app_roles(id,name,description,is_system) values ('recent_viewer','Recent Viewer',null,false);
insert into public.app_role_permissions(role_id,permission_key) values
 ('recent_viewer','operasional.analytics'),
 ('recent_viewer','operasional.report_spend');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('fd000000-0000-0000-0000-0000000000c1','recent_view','Recent Viewer','test','recent_viewer',true);

-- PAAA punya 6 batch order (100..600) + report pada 100 dan 200.
-- PBBB punya 2 batch order (700, 800) + report pada 700/800/900 (900 spend-only).
insert into public.ad_spend_reports(advertiser_id,product_id,batch,date_from,date_to,spend,tax_percent) values
 ('fd000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-00000000000a','100','2026-01-01','2026-01-31',10000,10),
 ('fd000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-00000000000a','200','2026-09-01','2026-09-30',20000,0),
 ('fd000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-00000000000b','700','2026-08-01','2026-08-31',70000,0),
 ('fd000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-00000000000b','800','2026-08-01','2026-08-31',80000,0),
 ('fd000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-00000000000b','900','2026-11-01','2026-11-30',90000,0);

insert into public.orders(order_id,product_code,product_name,advertiser_code,advertiser_name,batch,session,city,
  product_raw,product_parse_status,event_type,app_status,gross_amount,quantity,source_created_at,source) values
 ('recent-1','PAAA','Recent Produk A','71','Recent Zul','100','S1','Solo','r','valid','Seminar Offline','Paid',100000,1,'2026-01-10T05:00:00Z','orderonline'),
 ('recent-2','PAAA','Recent Produk A','71','Recent Zul','200','S1','Solo','r','valid','Seminar Offline','Paid',200000,2,'2026-09-10T05:00:00Z','orderonline'),
 ('recent-3','PAAA','Recent Produk A','71','Recent Zul','300','S1','Solo','r','valid','Seminar Offline','Paid',300000,3,'2026-10-10T05:00:00Z','orderonline'),
 ('recent-4','PAAA','Recent Produk A','71','Recent Zul','400','S1','Solo','r','valid','Seminar Offline','Paid',400000,4,'2026-10-20T05:00:00Z','orderonline'),
 ('recent-5','PAAA','Recent Produk A','71','Recent Zul','500','S1','Solo','r','valid','Seminar Offline','Paid',500000,5,'2026-10-25T05:00:00Z','orderonline'),
 ('recent-6','PAAA','Recent Produk A','71','Recent Zul','600','S1','Solo','r','valid','Seminar Offline','Paid',600000,6,'2026-10-26T05:00:00Z','orderonline'),
 ('recent-7','PBBB','Recent Produk B','71','Recent Zul','700','S2','Bandung','r','valid','Seminar Offline','Paid',700000,7,'2026-08-10T05:00:00Z','orderonline'),
 ('recent-8','PBBB','Recent Produk B','71','Recent Zul','800','S2','Bandung','r','valid','Seminar Offline','Paid',800000,8,'2026-08-20T05:00:00Z','orderonline');

set local role authenticated;
set local request.jwt.claims = '{"sub":"fd000000-0000-0000-0000-0000000000c1","app_role":"recent_viewer"}';

-- Produk: hanya 2 batch terakhir per produk.
create temp table recent_products on commit drop as
  select public.advertiser_breakdown('71',null,null,200,2,null) as v;
select is((select jsonb_array_length(v->'products') from recent_products), 2, 'produk: dua produk');
select is((select (x->>'tickets')::int from recent_products, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 11,
  'produk PAAA: hanya tiket batch 600 + 500');
select is((select (x->>'omzet')::numeric from recent_products, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 1100000::numeric,
  'produk PAAA: omzet batch 600 + 500');
select is((select (x->>'total_spend')::numeric from recent_products, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 0::numeric,
  'produk PAAA: report batch 100/200 tidak ikut karena bukan 2 batch terakhir');
select is((select (x->>'tickets')::int from recent_products, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PBBB'), 8,
  'produk PBBB: batch 900 spend-only menggusur batch 700');
select is((select (x->>'total_spend')::numeric from recent_products, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PBBB'), 170000::numeric,
  'produk PBBB: spend batch 900 + 800');
select is((select (x->>'profit')::numeric from recent_products, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PBBB'), 630000::numeric,
  'produk PBBB: profit memakai 2 batch terakhir');

-- Tanpa batas: perilaku lama (semua batch).
create temp table recent_all on commit drop as
  select public.advertiser_breakdown('71',null,null,200,null,null) as v;
select is((select (x->>'tickets')::int from recent_all, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 21, 'tanpa batas: semua tiket PAAA');
select is((select (x->>'total_spend')::numeric from recent_all, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 31000::numeric,
  'tanpa batas: semua spend PAAA termasuk PPN 10%');
select is((select (x->>'tickets')::int from recent_all, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PBBB'), 15, 'tanpa batas: semua tiket PBBB');

-- Kompatibilitas pemanggilan 4 argumen lama.
create temp table recent_legacy on commit drop as
  select public.advertiser_breakdown('71',null,null,200) as v;
select is((select (x->>'tickets')::int from recent_legacy, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 21, '4 argumen lama: tetap tanpa batas');

-- Batch: 5 terakhir untuk produk terpilih, urut aktivitas terbaru.
create temp table recent_batches on commit drop as
  select public.advertiser_breakdown('71','PAAA',null,200,null,5) as v;
select is((select jsonb_array_length(v->'batches') from recent_batches), 5, 'batch: hanya 5 baris');
select is((select v->'batches'->0->>'batch' from recent_batches), '600', 'batch: terbaru lebih dulu');
select is((select v->'batches'->4->>'batch' from recent_batches), '200', 'batch: batch kelima');
select is((select count(*)::int from recent_batches, jsonb_array_elements(v->'batches') x
    where x->>'batch' = '100'), 0, 'batch: batch tertua tidak ikut');
select is((select v->'batches'->4->>'last_activity' from recent_batches), '2026-09-30',
  'batch: last_activity memakai report date yang lebih baru');
select is((select v->'batches'->0->>'product_code' from recent_batches), 'PAAA',
  'batch: kode produk dikembalikan');

create temp table recent_batches_all on commit drop as
  select public.advertiser_breakdown('71','PAAA',null,200,null,null) as v;
select is((select jsonb_array_length(v->'batches') from recent_batches_all), 6,
  'batches tanpa batas: semua batch produk');

-- Kombinasi produk (2 batch) + batch (5 terakhir) dalam satu panggilan.
create temp table recent_both on commit drop as
  select public.advertiser_breakdown('71',null,null,200,2,5) as v;
select is((select jsonb_array_length(v->'products') from recent_both), 2, 'kombinasi: produk tetap dua');
select is((select jsonb_array_length(v->'batches') from recent_both), 5, 'kombinasi: batch dibatasi lima');
select is((select v->'batches'->0->>'batch' from recent_both), '900',
  'kombinasi: batch terbaru keseluruhan adalah batch spend-only PBBB');

reset role;
select is(has_function_privilege('anon','public.advertiser_breakdown(text,text,text,integer,integer,integer)','execute'), false,
  'advertiser_breakdown baru tidak bisa dipanggil anon');
select is(has_function_privilege('authenticated','public.advertiser_breakdown(text,text,text,integer,integer,integer)','execute'), true,
  'advertiser_breakdown baru bisa dipanggil authenticated');

select * from finish();
rollback;
