-- 0048 (A37): Report Spend Iklan — input hanya Advertiser (pengiklannya sendiri), angka order live,
-- data kosong = 0, rentang bertumpuk butuh konfirmasi, total tidak menghitung order dua kali.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 48, 'schema_version mencakup 0048');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'advertiser' and permission_key = 'action.input_spend'),
  'advertiser punya izin input bawaan');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'advertiser' and permission_key = 'operasional.report_spend'),
  'advertiser punya izin lihat bawaan');

insert into public.products(id,name,code) values
 ('f8000000-0000-0000-0000-00000000000a','Produk A','AAAA'),
 ('f8000000-0000-0000-0000-00000000000b','Produk B','BBBB');
insert into public.advertisers(id,name,code) values
 ('f8000000-0000-0000-0000-000000000001','Zul','91'),
 ('f8000000-0000-0000-0000-000000000002','Rina','92');
insert into public.app_roles(id,name,description,is_system) values ('spend_viewer','Viewer Spend',null,false);
insert into public.app_role_permissions(role_id,permission_key) values ('spend_viewer','operasional.report_spend');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
 ('f8000000-0000-0000-0000-0000000000d1','sp_dev','Dev','test','developer',true,null),
 ('f8000000-0000-0000-0000-0000000000a1','sp_zul','Zul','test','advertiser',true,'f8000000-0000-0000-0000-000000000001'),
 ('f8000000-0000-0000-0000-0000000000a2','sp_rina','Rina','test','advertiser',true,'f8000000-0000-0000-0000-000000000002'),
 ('f8000000-0000-0000-0000-0000000000c1','sp_view','Viewer','test','spend_viewer',true,null),
 ('f8000000-0000-0000-0000-0000000000c2','sp_view_b','Viewer B','test','spend_viewer',false,null),
 ('f8000000-0000-0000-0000-0000000000e1','sp_member','Member','test','member',true,null);
insert into public.user_product_access(user_id,product_code) values ('f8000000-0000-0000-0000-0000000000c2','BBBB');

-- Order tanggal WIB: 20 Okt 2026 00:30 WIB = 19 Okt 17:30 UTC (masuk 20 Okt, bukan 19 Okt).
insert into public.orders(order_id,product_code,advertiser_code,batch,product_raw,name,event_type,app_status,gross_amount,source_created_at) values
 ('sp-1','AAAA','91','122','AAAA91SO122 - S1 - Solo','O1','Seminar Offline','Paid',150000,'2026-10-19T17:30:00Z'),
 ('sp-2','AAAA','91','122','AAAA91WO122 - S2 - Online','O2','Webinar Online','Pending',150000,'2026-10-20T05:00:00Z'),
 ('sp-3','AAAA','91','122','AAAA91SO122 - S3 - Solo','O3','Seminar Offline','Paid',300000,'2026-10-21T05:00:00Z'),
 ('sp-4','AAAA','91','122','AAAA91SO122 - S1 - Solo','O4','Seminar Offline','Cancelled',150000,'2026-10-21T06:00:00Z'),
 ('sp-5','AAAA','92','122','AAAA92SO122 - S1 - Solo','O5','Seminar Offline','Paid',999000,'2026-10-20T05:00:00Z'),
 ('sp-6','AAAA','91','123','AAAA91SO123 - S1 - Solo','O6','Seminar Offline','Paid',999000,'2026-10-20T05:00:00Z'),
 ('sp-7','AAAA','91','122','AAAA91SO122 - S1 - Solo','O7','Seminar Offline','Paid',999000,'2026-10-19T16:30:00Z');

-- Tulis: hanya akun Advertiser.
select throws_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000d1',null,'AAAA','122','2026-10-20','2026-10-20',100,0)$$,
  'DF006', 'FORBIDDEN', 'developer (tanpa pengiklan) tidak bisa input');
select throws_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000c1',null,'AAAA','122','2026-10-20','2026-10-20',100,0)$$,
  'DF006', 'FORBIDDEN', 'role lihat saja tidak bisa input');
select throws_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a1',null,'AAAA','122','2026-10-21','2026-10-20',100,0)$$,
  'DF011', 'INVALID_ARGUMENT', 'tanggal akhir sebelum awal ditolak');
select throws_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a1',null,'ZZZZ','122','2026-10-20','2026-10-20',100,0)$$,
  'DF011', 'INVALID_ARGUMENT', 'produk tidak dikenal ditolak');

select is((public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a1',null,'aaaa','0122','2026-10-20','2026-10-21',6000000,11))->>'batch',
  '122', 'batch 0122 disimpan sebagai 122 (A33)');
select is((select advertiser_id from public.ad_spend_reports where batch = '122'), 'f8000000-0000-0000-0000-000000000001'::uuid,
  'pengiklan diambil dari akun');
select throws_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a1',null,'AAAA','777','2026-10-20','2026-10-20',100,101)$$,
  'DF011', 'INVALID_ARGUMENT', 'PPN di atas 100% ditolak');
select throws_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a1',null,'AAAA','777','2026-10-20','2026-10-20',100,-1)$$,
  'DF011', 'INVALID_ARGUMENT', 'PPN negatif ditolak');
select is((select tax_percent from public.ad_spend_reports where batch = '122'), 11.00::numeric, 'PPN tersimpan per report');

-- Rentang bertumpuk: ditolak tanpa konfirmasi, tersimpan dengan konfirmasi ("Tambahkan Data Ini").
select throws_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a1',null,'AAAA','122','2026-10-21','2026-10-22',1000000,11)$$,
  'DF016', 'AD_SPEND_OVERLAP', 'rentang bertumpuk ditolak tanpa konfirmasi');
select lives_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a1',null,'AAAA','122','2026-10-21','2026-10-22',1000000,11,true)$$,
  'rentang bertumpuk tersimpan dengan konfirmasi');
select lives_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a1',null,'AAAA','999','2026-10-20','2026-10-20',500000,0)$$,
  'batch lain tidak dianggap bertumpuk');
select lives_ok($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a2',null,'AAAA','122','2026-10-20','2026-10-20',2000000,10)$$,
  'pengiklan lain dengan produk + batch sama tidak dianggap bertumpuk');

-- Edit/hapus report pengiklan lain = tidak ditemukan.
select throws_ok(format($$select public.delete_ad_spend_report('f8000000-0000-0000-0000-0000000000a2','%s')$$,
  (select id from public.ad_spend_reports where batch = '999')), 'DF017', 'AD_SPEND_NOT_FOUND', 'tidak bisa hapus report pengiklan lain');
select throws_ok(format($$select public.save_ad_spend_report('f8000000-0000-0000-0000-0000000000a2','%s','AAAA','999','2026-10-20','2026-10-20',1,0)$$,
  (select id from public.ad_spend_reports where batch = '999')), 'DF017', 'AD_SPEND_NOT_FOUND', 'tidak bisa edit report pengiklan lain');

-- A43: sesi/kota/quantity untuk tabel tiket Paid per sesi × pengiklan.
update public.orders set session = 'S1', city = 'Solo', quantity = 2 where order_id = 'sp-1';
update public.orders set session = 'S3', city = 'SOLO', quantity = 1 where order_id = 'sp-3';
update public.orders set session = 'S1', city = 'Solo', quantity = 1 where order_id in ('sp-2','sp-4','sp-5');

-- Baca sebagai Advertiser 01.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
select is((select count(*) from public.ad_spend_reports)::int, 4, 'advertiser: tabel memuat report pengiklan lain di produk yang sama (A44)');
-- Angka per pengiklan diuji lewat filter pengiklan 91; tanpa filter, report pengiklan 92 ikut (A44).
create temp table r on commit drop as select public.ad_spend_report('2026-10-20','2026-10-22',p_advertiser_code => '91') as v;
select is((select jsonb_array_length(v->'rows') from r), 3, 'filter pengiklan 91: 3 report');
-- Report 20–21 Okt batch 122: sp-1 (Paid, 00:30 WIB 20 Okt), sp-2 (Pending), sp-3 (Paid), sp-4 (Cancelled).
-- sp-5 (pengiklan 92), sp-6 (batch 123), sp-7 (23:30 WIB 19 Okt) tidak ikut.
select is((select x from r, jsonb_array_elements(v->'rows') x where x->>'date_from' = '2026-10-20' and x->>'batch' = '122')
  - 'id' - 'product_name' - 'advertiser_name' - 'date_from' - 'date_to' - 'product_code' - 'advertiser_code',
  '{"batch":"122","spend":6000000.00,"tax_percent":11.00,"tax_amount":660000.00,"total_spend":6660000.00,"leads":4,"paid":2,"tickets":3,"omzet":450000.00,"own":true}'::jsonb,
  'leads = semua order, paid = jumlah Order ID Paid, tickets = sum quantity Paid (A45), omzet = gross Paid, batas hari WIB');
select is((select x->>'leads' from r, jsonb_array_elements(v->'rows') x where x->>'batch' = '999'), '0', 'tanpa order: leads 0, bukan error');
select is((select x->>'omzet' from r, jsonb_array_elements(v->'rows') x where x->>'batch' = '999'), '0.00', 'tanpa order: omzet 0');
-- Total: spend 6jt + 1jt + 500rb, PPN 660rb + 110rb + 0 (11%, 11%, 0%); order sp-3/sp-4 tercakup dua report tetapi dihitung sekali.
select is((select v->'summary' from r), '{"reports":3,"spend":7500000.00,"tax_amount":770000.00,"total_spend":8270000.00,"leads":4,"paid":2,"omzet":450000.00}'::jsonb,
  'total: spend dijumlah, order tidak dihitung dua kali');
-- A43: hanya order Paid (sp-2 Pending, sp-4 Cancelled tidak dihitung); sp-3 tercakup dua report dihitung sekali.
select is((select v->'sessions' from r),
  '{"tickets":3,"advertisers":[{"advertiser_code":"91","advertiser_name":"Zul","tickets":3}],"rows":[
    {"session":"S1","city":"Solo","event_type":"Seminar Offline","tickets":2,"advertisers":[{"advertiser_code":"91","tickets":2}]},
    {"session":"S3","city":"SOLO","event_type":"Seminar Offline","tickets":1,"advertisers":[{"advertiser_code":"91","tickets":1}]}]}'::jsonb,
  'sesi × pengiklan: tiket Paid = sum quantity, urut kota lalu sesi');
-- A44: produk dikontrol bersama — report + order pengiklan 92 di produk AAAA ikut terlihat, tetapi bukan "milik sendiri".
select is((public.ad_spend_report('2026-10-20','2026-10-22')->'summary'),
  '{"reports":4,"spend":9500000.00,"tax_amount":970000.00,"total_spend":10470000.00,"leads":5,"paid":3,"omzet":1449000.00}'::jsonb,
  'advertiser: total semua pengiklan di produknya');
select is((select bool_or((x->>'own')::boolean) from jsonb_array_elements(public.ad_spend_report('2026-10-20','2026-10-22',p_advertiser_code => '92')->'rows') x),
  false, 'advertiser: report pengiklan lain terlihat tetapi tidak bisa diedit');
select is((public.ad_spend_report('2026-10-20','2026-10-22')->'sessions'->'advertisers'),
  '[{"advertiser_code":"91","advertiser_name":"Zul","tickets":3},{"advertiser_code":"92","advertiser_name":"Rina","tickets":1}]'::jsonb,
  'advertiser: kolom tiket per sesi memuat semua pengiklan di produknya');
select is((public.ad_spend_report('2026-10-23','2026-10-30')->'summary'->>'reports')::int, 0, 'rentang tidak beririsan tidak tampil');
select is((public.ad_spend_report('2026-10-22','2026-10-22')->'summary'->>'reports')::int, 1, 'report beririsan dengan filter tampil');
select is((public.ad_spend_report(p_batch => '0122')->'summary'->>'reports')::int, 3, 'filter batch 0122 = 122');

-- Role lihat saja (semua produk): semua pengiklan.
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000c1","app_role":"spend_viewer"}';
select is((public.ad_spend_report('2026-10-20','2026-10-22')->'summary'->>'reports')::int, 4, 'viewer: semua pengiklan');
select is((select bool_or((x->>'own')::boolean) from jsonb_array_elements(public.ad_spend_report('2026-10-20','2026-10-22')->'rows') x), false,
  'viewer: tidak ada report "milik sendiri"');
select is((select jsonb_agg(x->'advertisers' order by x->>'session')
             from jsonb_array_elements(public.ad_spend_report('2026-10-20','2026-10-22')->'sessions'->'rows') x),
  '[[{"advertiser_code":"91","tickets":2},{"advertiser_code":"92","tickets":1}],[{"advertiser_code":"91","tickets":1}]]'::jsonb,
  'viewer: sel per pengiklan dari semua pengiklan');
select ok((select count(*) from public.products) > 0, 'viewer: dropdown produk terbaca');
-- Viewer produk B saja: report produk A tidak terlihat.
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000c2","app_role":"spend_viewer"}';
select is((public.ad_spend_report()->'summary'->>'reports')::int, 0, 'viewer produk B: report produk A tidak terlihat');
select is((select count(*) from public.ad_spend_reports)::int, 0, 'viewer produk B: tabel kosong');
-- Tanpa izin.
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000e1","app_role":"member"}';
select throws_ok($$select public.ad_spend_report()$$, 'DF006', 'FORBIDDEN', 'tanpa izin lihat ditolak');
select is((select count(*) from public.ad_spend_reports)::int, 0, 'tanpa izin: tabel kosong');
reset role;

-- Konfigurasi Role: Input Biaya Iklan hanya untuk role advertiser; tidak ikut ke role penuh.
select throws_ok($$select public.save_role_permissions('f8000000-0000-0000-0000-0000000000d1','spend_viewer',array['action.input_spend'])$$,
  'DF011', 'INVALID_PERMISSION', 'input spend ditolak untuk role selain advertiser');
select lives_ok($$select public.save_role_permissions('f8000000-0000-0000-0000-0000000000d1','advertiser',array['operasional.report_spend','action.input_spend'])$$,
  'input spend boleh untuk advertiser');
select lives_ok($$select public.save_role_permissions('f8000000-0000-0000-0000-0000000000d1','owner',array[]::text[])$$, 'simpan role owner');
select ok(not exists(select 1 from public.app_role_permissions where role_id = 'owner' and permission_key = 'action.input_spend'),
  'role penuh tidak menerima input spend otomatis');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'owner' and permission_key = 'operasional.report_spend'),
  'role penuh tetap bisa melihat report');

-- Produk/pengiklan yang punya report dianggap dipakai.
select ok(public.master_is_used('products','AAAA',null), 'produk dengan report dianggap dipakai');
select is(has_function_privilege('authenticated','public.save_ad_spend_report(uuid,uuid,text,text,date,date,numeric,numeric,boolean)','execute'), false,
  'save_ad_spend_report tidak bisa dipanggil browser');
select is(has_function_privilege('authenticated','public.delete_ad_spend_report(uuid,uuid)','execute'), false,
  'delete_ad_spend_report tidak bisa dipanggil browser');
select is(has_function_privilege('anon','public.ad_spend_report(date,date,text,text,text)','execute'), false,
  'ad_spend_report tidak bisa dipanggil anon');

select * from finish();
rollback;
