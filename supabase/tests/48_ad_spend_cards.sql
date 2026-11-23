-- A88: Card template -> laporan harian -> resume draft 3 bulan.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 89, 'schema_version mencakup 0089');
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
-- Card template + laporan harian multi-budget
-- ---------------------------------------------------------------------------
select is((public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a1', null, 'Card Batch 300', 'CARD', '0300', 'Seminar Offline', null, null
))->>'action', 'created', 'advertiser membuat card setting saja');
select is((select count(*)::int from public.ad_spend_report_entries
  where card_id = (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  0, 'card baru belum punya laporan');
select is((select status from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'),
  'berjalan', 'card baru Berjalan');

select is((public.save_ad_spend_entry(
  'f9000000-0000-0000-0000-0000000000a1', null,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'),
  '2026-10-20', '2026-10-21',
  '[{"spend":6000000,"tax_percent":11},{"spend":4000000,"tax_percent":0}]'::jsonb
))->>'action', 'created', 'laporan harian dibuat');
select is((select count(*)::int from public.ad_spend_reports
  where card_id = (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  2, 'dua baris budget dalam satu laporan');
select is((select date_from::text || '..' || date_to::text from public.ad_spend_cards
  where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'),
  '2026-10-20..2026-10-21', 'rentang card mengikuti laporan');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table card_read on commit drop as
  select public.ad_spend_report('2026-10-20','2026-10-21') as v;
select is((select (v->'summary'->>'reports')::int from card_read), 1, 'satu laporan pada rentang');
select is((select (v->'summary'->>'spend')::numeric from card_read), 10000000.00::numeric, 'spend = 6jt + 4jt');
select is((select (v->'summary'->>'tax_amount')::numeric from card_read), 660000.00::numeric, 'PPN = 660rb');
select is((select (v->'summary'->>'total_spend')::numeric from card_read), 10660000.00::numeric, 'total spend = spend + PPN');
select is((select (v->'summary'->>'leads')::int from card_read), 3, 'leads dihitung sekali');
select is((select (v->'summary'->>'paid')::int from card_read), 2, 'paid dihitung sekali');
select is((select (v->'summary'->>'tickets')::int from card_read), 3, 'tickets = sum quantity Paid');
select is((select (v->'summary'->>'omzet')::numeric from card_read), 250000.00::numeric, 'omzet order Paid');
select is((select jsonb_array_length(v->'cards') from card_read), 1, 'card aktif tampil');
select is((select jsonb_array_length(v->'entries') from card_read), 1, 'satu baris Laporan Berjalan');
select is((select jsonb_array_length(v->'resumes') from card_read), 0, 'belum ada resume');
select is((select jsonb_array_length(x->'spends') from card_read, jsonb_array_elements(v->'entries') x), 2, 'detail laporan membawa dua budget');
reset role;

-- Laporan bertumpuk ditolak.
select throws_ok(format($$select public.save_ad_spend_entry(
  'f9000000-0000-0000-0000-0000000000a1', null, '%s', '2026-10-21', '2026-10-22',
  '[{"spend":1,"tax_percent":0}]'::jsonb)$$,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  'DF028', 'AD_SPEND_ENTRY_OVERLAP', 'laporan bertumpuk ditolak');

-- Pengiklan lain tidak boleh mengisi card 91.
select throws_ok(format($$select public.save_ad_spend_entry(
  'f9000000-0000-0000-0000-0000000000a2', null, '%s', '2026-10-22', '2026-10-22',
  '[{"spend":1,"tax_percent":0}]'::jsonb)$$,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  'DF006', 'FORBIDDEN', 'advertiser lain tidak bisa mengisi card');

-- Laporan kedua yang tidak bertumpuk.
select lives_ok(format($$select public.save_ad_spend_entry(
  'f9000000-0000-0000-0000-0000000000a1', null, '%s', '2026-10-22', '2026-10-22',
  '[{"spend":1000000,"tax_percent":0}]'::jsonb)$$,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  'laporan tanggal lain boleh');
select is((select count(*)::int from public.ad_spend_report_entries
  where card_id = (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  2, 'dua laporan harian');

-- ---------------------------------------------------------------------------
-- Selesai -> resume -> Aktifkan -> Selesai lagi
-- ---------------------------------------------------------------------------
select is((public.finish_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a1',
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')
))->>'status', 'selesai', 'card ditandai Selesai');
select ok((select finished_at is not null from public.ad_spend_cards
  where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'), 'finished_at terisi');
select ok((select count(*) = 1 from public.ad_spend_resumes
  where card_id = (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  'resume snapshot dibuat');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table card_done on commit drop as
  select public.ad_spend_report('2026-10-20','2026-10-22') as v;
select is((select jsonb_array_length(v->'cards') from card_done), 0, 'card Selesai keluar dari daftar aktif');
select is((select jsonb_array_length(v->'entries') from card_done), 0, 'laporan harian keluar dari Laporan Berjalan');
select is((select jsonb_array_length(v->'resumes') from card_done), 1, 'resume tampil di Laporan Selesai');
select ok((select (x->>'finished_at') is not null from jsonb_array_elements((select v->'resumes' from card_done)) x),
  'A92: resume membawa finished_at');
select is((select (v->'summary'->>'spend')::numeric from card_done), 11000000.00::numeric, 'summary memakai resume');
select is((select (v->'summary'->>'leads')::int from card_done), 3, 'summary resume tetap sekali');
reset role;

-- Card selesai menolak edit/tambah laporan.
select throws_ok(format($$select public.save_ad_spend_entry(
  'f9000000-0000-0000-0000-0000000000a1', null, '%s', '2026-10-23', '2026-10-23',
  '[{"spend":1,"tax_percent":0}]'::jsonb)$$,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  'DF027', 'AD_SPEND_CARD_ARCHIVED', 'card Selesai harus diaktifkan dulu');

select is((public.activate_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000c1',
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')
))->>'status', 'berjalan', 'manajer mengaktifkan card');
select is((select count(*)::int from public.ad_spend_resumes
  where card_id = (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  0, 'resume draft dihapus saat aktif');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table card_active_again on commit drop as
  select public.ad_spend_report('2026-10-20','2026-10-22') as v;
select is((select jsonb_array_length(v->'entries') from card_active_again), 2, 'laporan kembali ke Berjalan');
select is((select jsonb_array_length(v->'resumes') from card_active_again), 0, 'resume hilang sementara');
reset role;

-- Hapus laporan kedua, lalu Selesai lagi.
select lives_ok(format($$select public.delete_ad_spend_entry(
  'f9000000-0000-0000-0000-0000000000a1', '%s')$$,
  (select id from public.ad_spend_report_entries
    where card_id = (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')
      and date_from = '2026-10-22')), 'hapus laporan tanggal 22');
select is((select count(*)::int from public.ad_spend_report_entries
  where card_id = (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  1, 'satu laporan tersisa');
select is((public.finish_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a1',
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')
))->>'status', 'selesai', 'Selesai lagi setelah edit');
select ok((select finished_at > now() - interval '1 minute' from public.ad_spend_cards
  where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300'), 'timer baru dari tanggal Selesai baru');

-- ---------------------------------------------------------------------------
-- Retensi: 3 bulan -> card/laporan harian hilang, resume final tetap
-- ---------------------------------------------------------------------------
select is((public.save_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a1', null, 'Card Lama', 'CARD', '888', 'Seminar Offline', null, null
))->>'action', 'created', 'card lama dibuat');
select lives_ok(format($$select public.save_ad_spend_entry(
  'f9000000-0000-0000-0000-0000000000a1', null, '%s', '2026-01-01', '2026-01-01',
  '[{"spend":500000,"tax_percent":0}]'::jsonb)$$,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '888')),
  'laporan card lama');
select lives_ok(format($$select public.finish_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a1', '%s')$$,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '888')),
  'card lama Selesai');
update public.ad_spend_cards
   set finished_at = now() - interval '4 months'
 where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '888';
select is(public.purge_ad_spend_drafts() >= 1, true, 'purge menghapus card draft lama');
select is((select count(*)::int from public.ad_spend_cards
  where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '888'),
  0, 'card lama hilang');
select is((select count(*)::int from public.ad_spend_report_entries
  where card_id = (select id from public.ad_spend_cards where batch = '888')),
  0, 'laporan harian card lama hilang');
select ok((select frozen_at is not null and card_id is null from public.ad_spend_resumes
  where batch = '888'), 'resume final tersimpan dan dibekukan');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
select is((public.ad_spend_report('2026-01-01','2026-01-01')->'summary'->>'reports')::int, 1,
  'resume final tetap tampil tanpa card');
select is((select x->>'status' from jsonb_array_elements(public.ad_spend_report('2026-01-01','2026-01-01')->'resumes') x where x->>'batch' = '888'),
  'final', 'resume lama berstatus Final');
select is((select (x->>'can_activate')::boolean from jsonb_array_elements(public.ad_spend_report('2026-01-01','2026-01-01')->'resumes') x where x->>'batch' = '888'),
  false, 'resume Final tidak bisa diaktifkan');

-- A92: daftar Laporan Selesai adalah arsip, tidak mengikuti filter tanggal;
-- summary/KPI tetap mengikuti rentang tanggal halaman.
select is((select jsonb_array_length(v->'resumes') from (select public.ad_spend_report('2026-02-01','2026-02-02') as v) q),
  2, 'A92: semua resume tampil walau di luar rentang tanggal');
select is((public.ad_spend_report('2026-02-01','2026-02-02')->'summary'->>'reports')::int, 0,
  'A92: KPI tetap mengikuti filter tanggal');
reset role;

-- Card Selesai tidak bisa dihapus langsung.
select throws_ok(format($$select public.delete_ad_spend_card(
  'f9000000-0000-0000-0000-0000000000a1', '%s')$$,
  (select id from public.ad_spend_cards where advertiser_id = 'f9000000-0000-0000-0000-000000000001' and batch = '300')),
  'DF027', 'AD_SPEND_CARD_ARCHIVED', 'hapus card Selesai harus lewat Aktifkan dulu');

-- Izin fungsi/tabel.
select is(has_function_privilege('authenticated','public.save_ad_spend_entry(uuid,uuid,uuid,date,date,jsonb)','execute'), false,
  'save_ad_spend_entry hanya service_role');
select is(has_function_privilege('service_role','public.save_ad_spend_entry(uuid,uuid,uuid,date,date,jsonb)','execute'), true,
  'service_role bisa menyimpan laporan');
select is(has_function_privilege('authenticated','public.finish_ad_spend_card(uuid,uuid)','execute'), false,
  'finish hanya service_role');
select is(has_table_privilege('authenticated','public.ad_spend_report_entries','insert'), false,
  'browser tidak bisa insert entry langsung');
select is(has_function_privilege('authenticated','public.ad_spend_report(date,date,text,text,text,text)','execute'), true,
  'browser boleh membaca laporan');

select * from finish();
rollback;
