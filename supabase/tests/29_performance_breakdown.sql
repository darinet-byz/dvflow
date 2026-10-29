-- 0061 (A56): breakdown batch/produk halaman Performa.
-- Mengunci: tidak ada parameter tanggal (semua waktu), spend per produk ikut dihitung,
-- produk/batch dengan spend tanpa tiket tetap muncul, scope pengiklan A48, scope produk A44,
-- filter produk/batch, batas p_limit, dan izin.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 61, 'schema_version mencakup 0061');

insert into public.products(id,name,code) values
 ('fc000000-0000-0000-0000-00000000000a','Break Produk A','PAAA'),
 ('fc000000-0000-0000-0000-00000000000b','Break Produk B','PBBB'),
 ('fc000000-0000-0000-0000-00000000000c','Break Produk C','PCCC');
insert into public.advertisers(id,name,code) values
 ('fc000000-0000-0000-0000-000000000001','Break Zul','71'),
 ('fc000000-0000-0000-0000-000000000002','Break Rina','72');
insert into public.app_roles(id,name,description,is_system) values ('break_viewer','Break Viewer',null,false);
insert into public.app_role_permissions(role_id,permission_key) values
 ('break_viewer','operasional.analytics'),
 ('break_viewer','operasional.report_spend');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
 ('fc000000-0000-0000-0000-0000000000c1','break_all','Break All','test','break_viewer',true,null),
 ('fc000000-0000-0000-0000-0000000000c2','break_b','Break B','test','break_viewer',false,null),
 ('fc000000-0000-0000-0000-0000000000a1','break_adv','Break Adv','test','advertiser',true,'fc000000-0000-0000-0000-000000000001'),
 ('fc000000-0000-0000-0000-0000000000e1','break_mem','Break Member','test','member',true,null);
insert into public.user_product_access(user_id,product_code) values ('fc000000-0000-0000-0000-0000000000c2','PBBB');

-- Report: satu di Januari (di luar "bulan berjalan"), satu spend-only (PCCC).
insert into public.ad_spend_reports(advertiser_id,product_id,batch,date_from,date_to,spend,tax_percent) values
 ('fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-00000000000a','100','2026-01-01','2026-01-31',100000,11),
 ('fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-00000000000b','200','2026-09-01','2026-09-30',200000,0),
 ('fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-00000000000c','300','2026-09-01','2026-09-30',50000,0),
 ('fc000000-0000-0000-0000-000000000002','fc000000-0000-0000-0000-00000000000a','100','2026-09-01','2026-09-30',999000,0);

-- Order Desember 2025 (di luar bulan berjalan) membuktikan breakdown tidak memakai tanggal.
insert into public.orders(order_id,product_code,product_name,advertiser_code,advertiser_name,batch,session,city,
  product_raw,product_parse_status,event_type,app_status,gross_amount,quantity,source_created_at,source) values
 ('break-1','PAAA','Break Produk A','71','Break Zul','100','S1','Solo','r','valid','Seminar Offline','Paid',300000,2,'2025-12-31T05:00:00Z','orderonline'),
 ('break-2','PBBB','Break Produk B','71','Break Zul','200','S2','Bandung','r','valid','Seminar Offline','Paid',800000,4,'2026-09-10T05:00:00Z','orderonline'),
 ('break-3','PAAA','Break Produk A','71','Break Zul','100','S1','Solo','r','valid','Seminar Offline','Pending',150000,1,'2026-09-10T05:00:00Z','orderonline'),
 ('break-4','PAAA','Break Produk A','72','Break Rina','100','S1','Solo','r','valid','Seminar Offline','Paid',450000,3,'2026-09-10T05:00:00Z','orderonline');

set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-0000000000c1","app_role":"break_viewer"}';
create temp table brk on commit drop as
  select public.advertiser_breakdown('71',null,null,200) as v;

select is((select jsonb_array_length(v->'products') from brk), 3,
  'produk: tiga baris termasuk produk spend-only');
select is((select v->'products'->0->>'product_code' from brk), 'PBBB',
  'produk: urut spend menurun');
select is((select (x->>'spend')::numeric from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PCCC'), 50000::numeric,
  'produk: spend-only tetap muncul walau tanpa tiket');
select is((select (x->>'tickets')::int from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PCCC'), 0,
  'produk: spend-only tiket 0');
select is((select (x->>'profit')::numeric from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PCCC'), -50000::numeric,
  'produk: spend-only profit negatif (boncos)');
select is((select (x->>'tickets')::int from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 2,
  'produk: tiket Paid PAAA termasuk order Desember 2025 (semua waktu)');
select is((select (x->>'leads')::int from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 2,
  'produk: leads termasuk order Pending');
select is((select (x->>'omzet')::numeric from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 300000::numeric,
  'produk: omzet hanya order Paid');
select is((select (x->>'total_spend')::numeric from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 111000::numeric,
  'produk: total spend = spend + PPN');
select is((select (x->>'profit')::numeric from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 189000::numeric,
  'produk: profit = omzet - total spend');
select is((select round((x->>'roas')::numeric, 4) from brk, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), round(300000::numeric / 111000, 4),
  'produk: ROAS memakai total spend');

select is((select jsonb_array_length(v->'batches') from brk), 3,
  'batch: tiga baris termasuk batch spend-only');
select is((select v->'batches'->0->>'batch' from brk), '200',
  'batch: urut spend menurun');
select is((select (x->>'spend')::numeric from brk, jsonb_array_elements(v->'batches') x
    where x->>'batch' = '300'), 50000::numeric,
  'batch: spend-only tetap muncul');
select is((select (x->>'tickets')::int from brk, jsonb_array_elements(v->'batches') x
    where x->>'batch' = '100'), 2,
  'batch: tiket batch 100 semua waktu');
select is((select (x->>'total_spend')::numeric from brk, jsonb_array_elements(v->'batches') x
    where x->>'batch' = '100'), 111000::numeric,
  'batch: total spend termasuk PPN');

-- Filter produk dan batch tetap berlaku (hanya tanggal yang diabaikan).
create temp table brk_product on commit drop as
  select public.advertiser_breakdown('71','PAAA',null,200) as v;
select is((select jsonb_array_length(v->'products') from brk_product), 1, 'filter produk: satu baris');
select is((select v->'products'->0->>'product_code' from brk_product), 'PAAA', 'filter produk: PAAA');
select is((select jsonb_array_length(v->'batches') from brk_product), 1, 'filter produk: batch ikut terfilter');

create temp table brk_batch on commit drop as
  select public.advertiser_breakdown('71',null,'300',200) as v;
select is((select jsonb_array_length(v->'batches') from brk_batch), 1, 'filter batch: satu baris');
select is((select v->'batches'->0->>'batch' from brk_batch), '300', 'filter batch: batch 300');
select is((select (v->'batches'->0->>'tickets')::int from brk_batch), 0, 'filter batch: tanpa tiket');

create temp table brk_limit on commit drop as
  select public.advertiser_breakdown('71',null,null,1) as v;
select is((select jsonb_array_length(v->'products') from brk_limit), 1, 'p_limit: produk dipotong');
select is((select jsonb_array_length(v->'batches') from brk_limit), 1, 'p_limit: batch dipotong');

select throws_ok($$select public.advertiser_breakdown(null,null,null,200)$$,
  'DF011', 'INVALID_ARGUMENT', 'tanpa pengiklan ditolak (bukan dashboard)');

-- Scope produk A44: viewer produk B hanya melihat PBBB/batch 200 milik 71.
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-0000000000c2","app_role":"break_viewer"}';
create temp table brk_scope on commit drop as
  select public.advertiser_breakdown('71',null,null,200) as v;
select is((select jsonb_array_length(v->'products') from brk_scope), 1, 'scope produk: hanya satu produk');
select is((select v->'products'->0->>'product_code' from brk_scope), 'PBBB', 'scope produk: hanya PBBB');
select is((select jsonb_array_length(v->'batches') from brk_scope), 1, 'scope produk: hanya satu batch');

-- Scope pengiklan A48.
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table brk_adv on commit drop as
  select public.advertiser_breakdown(null,null,null,200) as v;
select is((select (x->>'spend')::numeric from brk_adv, jsonb_array_elements(v->'products') x
    where x->>'product_code' = 'PAAA'), 100000::numeric,
  'advertiser: tanpa kode pun terkunci ke pengiklannya sendiri');
select throws_ok($$select public.advertiser_breakdown('72',null,null,200)$$,
  'DF006', 'FORBIDDEN', 'advertiser: breakdown pengiklan lain ditolak');

-- Tanpa izin Performa.
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-0000000000e1","app_role":"member"}';
select throws_ok($$select public.advertiser_breakdown('71',null,null,200)$$,
  'DF006', 'FORBIDDEN', 'member tanpa izin Performa ditolak');

reset role;
select is(has_function_privilege('anon','public.advertiser_breakdown(text,text,text,integer)','execute'), false,
  'advertiser_breakdown tidak bisa dipanggil anon');
select is(has_function_privilege('authenticated','public.advertiser_breakdown(text,text,text,integer)','execute'), true,
  'advertiser_breakdown bisa dipanggil authenticated');

select * from finish();
rollback;
