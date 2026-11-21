-- A87: Card Report Iklan — satu card berisi banyak baris budget (masing-masing PPN),
-- order dihitung sekali, status Berjalan/Selesai, dan izin manajer/owner/developer.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 85, 'schema_version mencakup 0085');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'manajer' and permission_key = 'operasional.report_spend'),
  'manajer otomatis bisa melihat Report Spend');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'manajer' and permission_key = 'action.manage_spend'),
  'manajer otomatis bisa mengelola Card Report');

insert into public.products(id,name,code) values
  ('f9000000-0000-0000-0000-00000000000a','Produk Card','CARD');
insert into public.advertisers(id,name,code) values
  ('f9000000-0000-0000-0000-000000000001','Zul Card','91'),
  ('f9000000-0000-0000-0000-000000000002','Rina Card','92');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
  ('f9000000-0000-0000-0000-0000000000d1','card_dev','Dev Card','test','developer',true,null),
  ('f9000000-0000-0000-0000-0000000000c1','card_mgr','Manajer Card','test','manajer',true,null),
  ('f9000000-0000-0000-0000-0000000000a1','card_zul','Zul Card','test','advertiser',true,'f9000000-0000-0000-0000-000000000001'),
  ('f9000000-0000-0000-0000-0000000000a2','card_rina','Rina Card','test','advertiser',true,'f9000000-0000-0000-0000-000000000002');

insert into public.orders(order_id,product_code,advertiser_code,batch,product_raw,name,event_type,app_status,gross_amount,quantity,source_created_at) values
  ('card-1','CARD','91','300','CARD91SO300 - S1 - Solo','C1','Seminar Offline','Paid',100000,1,'2026-10-19T17:30:00Z'),
  ('card-2','CARD','91','300','CARD91SO300 - S1 - Solo','C2','Seminar Offline','Paid',150000,2,'2026-10-20T05:00:00Z'),
  ('card-3','CARD','91','300','CARD91SO300 - S1 - Solo','C3','Seminar Offline','Pending',100000,1,'2026-10-21T05:00:00Z'),
  ('card-4','CARD','92','300','CARD92SO300 - S1 - Solo','C4','Seminar Offline','Paid',999000,1,'2026-10-20T05:00:00Z'),
  ('card-5','CARD','91','301','CARD91SO301 - S1 - Solo','C5','Seminar Offline','Paid',999000,1,'2026-10-20T05:00:00Z');

-- ---------------------------------------------------------------------------
-- Buat card: dua baris budget, PPN berbeda; order tidak boleh dihitung dua kali.
-- ---------------------------------------------------------------------------
select is((public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a1', null, 'Card Batch 300', 'CARD', '0300', 'Seminar Offline', null,
  '[{"date_from":"2026-10-20","date_to":"2026-10-21","spend":6000000,"tax_percent":11},
    {"date_from":"2026-10-20","date_to":"2026-10-21","spend":4000000,"tax_percent":0}]'::jsonb
))->>'action', 'created', 'advertiser membuat card dengan dua baris budget');

select is((select status from public.ad_spend_cards where batch = '300' and advertiser_id = 'f9000000-0000-0000-0000-000000000001'),
  'berjalan', 'card baru berstatus Berjalan');
select is((select count(*)::int from public.ad_spend_reports
  where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'), 2,
  'dua baris budget tersimpan');
select is((select date_from::text || '..' || date_to::text from public.ad_spend_cards
  where batch = '300' and advertiser_id = 'f9000000-0000-0000-0000-000000000001'),
  '2026-10-20..2026-10-21', 'rentang card mengikuti baris budget');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table card_read on commit drop as
  select public.ad_spend_report('2026-10-20','2026-10-21') as v;

select is((select (v->'summary'->>'reports')::int from card_read), 1, 'satu card pada rentang');
select is((select (v->'summary'->>'spend')::numeric from card_read), 10000000.00::numeric,
  'spend = 6jt + 4jt dari dua baris');
select is((select (v->'summary'->>'tax_amount')::numeric from card_read), 660000.00::numeric,
  'PPN = 660rb dari baris 11%; baris 0% tidak ikut');
select is((select (v->'summary'->>'total_spend')::numeric from card_read), 10660000.00::numeric,
  'total spend = spend + PPN');
select is((select (v->'summary'->>'leads')::int from card_read), 3,
  'leads dihitung sekali walau dua baris menutupi order yang sama');
select is((select (v->'summary'->>'paid')::int from card_read), 2, 'paid dihitung sekali');
select is((select (v->'summary'->>'omzet')::numeric from card_read), 250000.00::numeric, 'omzet hanya order Paid');
select is((select jsonb_array_length(v->'cards') from card_read), 1, 'card Berjalan ada di daftar cards');
select is((select jsonb_array_length(v->'rows') from card_read), 0, 'card Berjalan belum masuk tabel resume');
select is((select jsonb_array_length(x->'spends') from card_read, jsonb_array_elements(v->'cards') x), 2,
  'detail card membawa dua baris budget');
select is((select (x->>'can_edit')::boolean from card_read, jsonb_array_elements(v->'cards') x), true,
  'advertiser pemilik bisa mengedit card');
reset role;

-- Card untuk pengiklan lain dengan scope sama.
select is((public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a2', null, 'Card Rina', 'CARD', '300', 'Seminar Offline', null,
  '[{"date_from":"2026-10-20","date_to":"2026-10-21","spend":2000000,"tax_percent":10}]'::jsonb
))->>'action', 'created', 'pengiklan lain boleh punya card scope sama');
select lives_ok($$select public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a2',
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000002' and batch = '300'),
  'Card Rina', null, null, null, 'selesai',
  '[{"date_from":"2026-10-20","date_to":"2026-10-21","spend":2000000,"tax_percent":10}]'::jsonb
)$$, 'card pengiklan 92 ditandai Selesai');

-- Duplikat scope: card yang ada dikembalikan, bukan dibuat baru.
select is((public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a1', null, 'Duplikat', 'CARD', '300', 'Seminar Offline', null,
  '[{"date_from":"2026-10-20","date_to":"2026-10-21","spend":1,"tax_percent":0}]'::jsonb
))->>'action', 'existing', 'card scope sama mengembalikan card yang sudah ada');
select is((select count(*)::int from public.ad_spend_cards where batch = '300'), 2,
  'dua card: satu per pengiklan');

-- Pengiklan lain tidak boleh mengedit card 91.
select throws_ok(format($$select public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a2','%s','Curang','CARD','300','Seminar Offline','selesai',
  '[{"date_from":"2026-10-20","date_to":"2026-10-21","spend":1,"tax_percent":0}]'::jsonb)$$,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  'DF006', 'FORBIDDEN', 'pengiklan lain tidak bisa mengedit card');

-- ---------------------------------------------------------------------------
-- Manajer dapat mengedit card milik semua pengiklan.
-- ---------------------------------------------------------------------------
select is((public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000c1',
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'),
  'Card diubah Manajer', null, null, null, 'berjalan',
  '[{"date_from":"2026-10-20","date_to":"2026-10-21","spend":5000000,"tax_percent":10}]'::jsonb
))->>'action', 'updated', 'manajer bisa mengedit card pengiklan');
select is((select name from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'),
  'Card diubah Manajer', 'nama card tersimpan');

-- ---------------------------------------------------------------------------
-- Selesai: card pindah dari cards ke rows, order tetap sekali.
-- ---------------------------------------------------------------------------
select is((public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000c1',
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'),
  'Card Batch 300', null, null, null, 'selesai',
  '[{"date_from":"2026-10-20","date_to":"2026-10-21","spend":5000000,"tax_percent":10}]'::jsonb
))->>'status', 'selesai', 'card ditandai Selesai');
select ok((select finished_at is not null from public.ad_spend_cards
  where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'), 'finished_at terisi');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table card_done on commit drop as
  select public.ad_spend_report('2026-10-20','2026-10-21') as v;
select is((select jsonb_array_length(v->'cards') from card_done), 0, 'tidak ada card Berjalan');
select is((select jsonb_array_length(v->'rows') from card_done), 2, 'dua card Selesai di tabel resume');
select is((select (v->'summary'->>'reports')::int from card_done), 2, 'summary menghitung dua card');
select is((select (v->'summary'->>'leads')::int from card_done), 4, 'leads semua pengiklan dihitung sekali per card');
select is((select bool_or((x->>'own')::boolean) from card_done, jsonb_array_elements(v->'rows') x), true,
  'advertiser tetap punya penanda own');
select is((select bool_and((x->>'can_edit')::boolean) from card_done, jsonb_array_elements(v->'rows') x where (x->>'advertiser_code') = '91'),
  true, 'card milik sendiri bisa diedit');
select is((select bool_or((x->>'can_edit')::boolean) from card_done, jsonb_array_elements(v->'rows') x where (x->>'advertiser_code') = '92'),
  false, 'card pengiklan lain tidak bisa diedit');
reset role;

-- Manajer melihat semua card dan bisa mengedit.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000c1","app_role":"manajer"}';
select is((public.ad_spend_report('2026-10-20','2026-10-21')->'summary'->>'reports')::int, 2,
  'manajer melihat semua card');
select is((select bool_and((x->>'can_edit')::boolean)
  from jsonb_array_elements(public.ad_spend_report('2026-10-20','2026-10-21')->'rows') x), true,
  'manajer bisa mengedit semua card');
reset role;

-- ---------------------------------------------------------------------------
-- Kompatibilitas jalur lama: insert report tanpa card_id membuat card otomatis.
-- ---------------------------------------------------------------------------
insert into public.ad_spend_reports(advertiser_id,product_id,batch,event_type,date_from,date_to,spend,tax_percent)
values ('f9000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-00000000000a','777','Seminar Offline','2026-10-20','2026-10-20',100,0);
select ok((select card_id is not null from public.ad_spend_reports where batch = '777'), 'baris lama otomatis punya card_id');
select ok((select status = 'selesai' from public.ad_spend_cards where batch = '777'), 'card otomatis dari jalur lama berstatus Selesai');

select lives_ok(format($$select public.delete_ad_spend_report('f9000000-0000-0000-0000-0000000000a1','%s')$$,
  (select id from public.ad_spend_reports where batch = '777')), 'hapus baris lama');
select is((select count(*)::int from public.ad_spend_cards where batch = '777'), 0,
  'card kosong ikut dihapus');

-- ---------------------------------------------------------------------------
-- Hapus card: semua baris ikut terhapus.
-- ---------------------------------------------------------------------------
select is((public.delete_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000c1',
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')
))->>'deleted', 'true', 'manajer menghapus card');
select is((select count(*)::int from public.ad_spend_reports
  where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'), 0,
  'baris budget card ikut terhapus');

-- ---------------------------------------------------------------------------
-- Izin & RLS
-- ---------------------------------------------------------------------------
select is(has_table_privilege('authenticated','public.ad_spend_cards','insert'), false,
  'browser tidak bisa insert card langsung');
select is(has_function_privilege('authenticated','public.save_ad_spend_card(uuid,uuid,text,text,text,text,text,jsonb)','execute'), false,
  'save_ad_spend_card hanya service_role');
select is(has_function_privilege('service_role','public.save_ad_spend_card(uuid,uuid,text,text,text,text,text,jsonb)','execute'), true,
  'service_role bisa memanggil save_ad_spend_card');

select throws_ok($$select public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000d1', null, 'Dev', 'CARD', '888', 'Seminar Offline', null,
  '[{"date_from":"2026-10-20","date_to":"2026-10-20","spend":1,"tax_percent":0}]'::jsonb)$$,
  'DF006', 'FORBIDDEN', 'developer tanpa pengiklan tidak bisa membuat card');

select * from finish();
rollback;
