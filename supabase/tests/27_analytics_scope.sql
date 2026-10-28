-- 0057 (A48): halaman Performa hanya menampilkan pengiklan sendiri untuk akun Advertiser.
-- Pimpro tetap melihat semua pengiklan di produknya; Admin/Manajer melihat seluruh pengiklan.
-- A44 (baca order semua pengiklan di produk yang sama) sengaja TIDAK diuji di sini karena tidak berubah.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 57, 'schema_version mencakup 0057');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'advertiser' and permission_key = 'operasional.analytics'),
  'advertiser punya izin Performa bawaan');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'pimpro' and permission_key = 'operasional.analytics'),
  'pimpro punya izin Performa bawaan');

insert into public.products(id,name,code) values
 ('fb000000-0000-0000-0000-00000000000a','Scope Produk A','SAAA'),
 ('fb000000-0000-0000-0000-00000000000b','Scope Produk B','SBBB');
insert into public.advertisers(id,name,code) values
 ('fb000000-0000-0000-0000-000000000001','Scope Ana','81'),
 ('fb000000-0000-0000-0000-000000000002','Scope Budi','82');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
 ('fb000000-0000-0000-0000-0000000000a1','scope_adv_a','Ana A','test','advertiser',false,'fb000000-0000-0000-0000-000000000001'),
 ('fb000000-0000-0000-0000-0000000000a2','scope_adv_all','Ana All','test','advertiser',true,'fb000000-0000-0000-0000-000000000001'),
 ('fb000000-0000-0000-0000-0000000000b1','scope_pim_a','Pim A','test','pimpro',false,null),
 ('fb000000-0000-0000-0000-0000000000c1','scope_mgr','Mgr','test','manajer',true,null),
 ('fb000000-0000-0000-0000-0000000000e1','scope_mem','Mem','test','member',true,null);
insert into public.user_product_access(user_id,product_code) values
 ('fb000000-0000-0000-0000-0000000000a1','SAAA'),
 ('fb000000-0000-0000-0000-0000000000b1','SAAA');

insert into public.ad_spend_reports(advertiser_id,product_id,batch,date_from,date_to,spend,tax_percent) values
 ('fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-00000000000a','100','2026-09-01','2026-09-30',100000,11),
 ('fb000000-0000-0000-0000-000000000002','fb000000-0000-0000-0000-00000000000a','100','2026-09-01','2026-09-30',200000,11),
 ('fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-00000000000b','100','2026-09-01','2026-09-30',300000,11);

insert into public.orders(order_id,product_code,product_name,advertiser_code,advertiser_name,batch,session,city,
  product_raw,product_parse_status,event_type,app_status,gross_amount,quantity,source_created_at,source) values
 ('scope-a01','SAAA','Scope Produk A','81','Scope Ana','100','S1','Solo','r','valid','Seminar Offline','Paid',100,1,'2026-09-10T05:00:00Z','orderonline'),
 ('scope-a02','SAAA','Scope Produk A','82','Scope Budi','100','S1','Solo','r','valid','Seminar Offline','Paid',200,1,'2026-09-10T05:00:00Z','orderonline'),
 ('scope-b01','SBBB','Scope Produk B','81','Scope Ana','100','S1','Solo','r','valid','Seminar Offline','Paid',400,1,'2026-09-10T05:00:00Z','orderonline'),
 ('scope-b02','SBBB','Scope Produk B','82','Scope Budi','100','S1','Solo','r','valid','Seminar Offline','Paid',800,1,'2026-09-10T05:00:00Z','orderonline');

-- Advertiser Ana, produk A saja: hanya pengiklan 81, hanya order produk A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table scope_adv on commit drop as
  select public.advertiser_performance(null,null,null,'2026-09-01','2026-09-30','month') as v;

select is((select jsonb_array_length(v->'advertisers') from scope_adv), 1, 'advertiser: hanya satu baris pengiklan');
select is((select v->'advertisers'->0->>'advertiser_code' from scope_adv), '81', 'advertiser: hanya kode sendiri');
select is((select (v->'advertisers'->0->>'leads')::int from scope_adv), 1, 'advertiser: hanya order di produk A');
select is((select (v->'advertisers'->0->>'spend')::numeric from scope_adv), 100000::numeric, 'advertiser: hanya report sendiri');

select throws_ok($$select public.advertiser_performance('82',null,null,'2026-09-01','2026-09-30','month')$$,
  'DF006', 'FORBIDDEN', 'advertiser: detail pengiklan lain ditolak');

create temp table scope_adv_detail on commit drop as
  select public.advertiser_performance('81',null,null,'2026-09-01','2026-09-30','month') as v;
select is((select (v->'summary'->>'leads')::int from scope_adv_detail), 1, 'advertiser: detail hanya produk A');
select is((select (v->'summary'->>'spend')::numeric from scope_adv_detail), 100000::numeric, 'advertiser: detail spend sendiri');

-- Advertiser Ana dengan Semua Produk: tetap hanya pengiklan 81, tetapi A+B.
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-0000000000a2","app_role":"advertiser"}';
create temp table scope_adv_all on commit drop as
  select public.advertiser_performance(null,null,null,'2026-09-01','2026-09-30','month') as v;
select is((select jsonb_array_length(v->'advertisers') from scope_adv_all), 1, 'advertiser semua produk: tetap satu pengiklan');
select is((select (v->'advertisers'->0->>'leads')::int from scope_adv_all), 2, 'advertiser semua produk: order sendiri di A+B');

-- Pimpro produk A: semua pengiklan di produk A, tidak melihat produk B.
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-0000000000b1","app_role":"pimpro"}';
create temp table scope_pim on commit drop as
  select public.advertiser_performance(null,null,null,'2026-09-01','2026-09-30','month') as v;
select is((select jsonb_array_length(v->'advertisers') from scope_pim), 2, 'pimpro: dua pengiklan di produk A');
select is((select array_agg(x->>'advertiser_code' order by x->>'advertiser_code')
    from scope_pim, jsonb_array_elements(v->'advertisers') x), array['81','82']::text[], 'pimpro: kode 81 dan 82');
select is((select (x->>'leads')::int from scope_pim, jsonb_array_elements(v->'advertisers') x
    where x->>'advertiser_code' = '81'), 1, 'pimpro: hanya order produk A untuk 81');

create temp table scope_pim_detail on commit drop as
  select public.advertiser_performance('81',null,null,'2026-09-01','2026-09-30','month') as v;
select is((select (v->'summary'->>'leads')::int from scope_pim_detail), 1, 'pimpro: detail 81 hanya produk A');

-- Manajer semua produk: seluruh pengiklan dan seluruh order.
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-0000000000c1","app_role":"manajer"}';
create temp table scope_mgr on commit drop as
  select public.advertiser_performance(null,null,null,'2026-09-01','2026-09-30','month') as v;
select is((select jsonb_array_length(v->'advertisers') from scope_mgr), 2, 'manajer: semua pengiklan');
select is((select (x->>'leads')::int from scope_mgr, jsonb_array_elements(v->'advertisers') x
    where x->>'advertiser_code' = '81'), 2, 'manajer: 81 di produk A dan B');

-- Member tanpa izin Performa tetap ditolak.
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-0000000000e1","app_role":"member"}';
select throws_ok($$select public.advertiser_performance(null,null,null,'2026-09-01','2026-09-30','month')$$,
  'DF006', 'FORBIDDEN', 'member tanpa izin Performa ditolak');

reset role;
select is(has_function_privilege('anon','public.advertiser_performance(text,text,text,date,date,text)','execute'), false,
  'advertiser_performance tidak bisa dipanggil anon');
select is(has_function_privilege('authenticated','public.advertiser_performance(text,text,text,date,date,text)','execute'), true,
  'advertiser_performance bisa dipanggil authenticated');

select * from finish();
rollback;
