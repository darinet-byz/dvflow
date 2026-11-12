-- Fitur 3.0.1 — WA Admin Bot: grup per produk, nomor pengiklan, jenis acara,
-- idempotensi, retensi 3 hari, dan izin.
-- Waktu uji dipaku: 2026-11-11 09:00 WIB (Rabu).
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select is(public.schema_version(), 72, 'schema version 72');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into public.advertisers (id, name, code, wa_phone) values
  ('aa000000-0000-0000-0000-000000000001', 'Advertiser Satu', '91', '628111111111'),
  ('aa000000-0000-0000-0000-000000000002', 'Advertiser Dua', '92', '628222222222'),
  ('aa000000-0000-0000-0000-000000000003', 'Advertiser Tiga', '93', '628333333333');

insert into public.products (id, name, code) values
  ('aa000000-0000-0000-0000-000000000011', 'Produk Satu', 'WAAA'),
  ('aa000000-0000-0000-0000-000000000012', 'Produk Dua', 'WBBB'),
  ('aa000000-0000-0000-0000-000000000013', 'Produk Tiga', 'WCCC');

insert into public.product_advertisers (product_id, advertiser_id) values
  ('aa000000-0000-0000-0000-000000000011', 'aa000000-0000-0000-0000-000000000001'),
  ('aa000000-0000-0000-0000-000000000011', 'aa000000-0000-0000-0000-000000000002'),
  ('aa000000-0000-0000-0000-000000000012', 'aa000000-0000-0000-0000-000000000003'),
  ('aa000000-0000-0000-0000-000000000013', 'aa000000-0000-0000-0000-000000000003');

insert into public.wa_product_groups (id, product_id, fonnte_group_id, is_active) values
  ('aa000000-0000-0000-0000-000000000021', 'aa000000-0000-0000-0000-000000000011', '111@g.us', true),
  ('aa000000-0000-0000-0000-000000000022', 'aa000000-0000-0000-0000-000000000012', '222@g.us', false),
  ('aa000000-0000-0000-0000-000000000023', 'aa000000-0000-0000-0000-000000000013', '333@g.us', true);

insert into public.wa_reminder_templates (id, name, message_content) values
  ('aa000000-0000-0000-0000-000000000031', 'Pagi',
   'Halo {{mention}}, laporan {{store_name}} produk {{product_name}} {{event_type}} tanggal {{date}} belum diisi. Leads {{leads}}, Paid {{paid}}. {{report_url}}');

insert into public.wa_reminder_schedules (id, execution_time, template_id) values
  ('aa000000-0000-0000-0000-000000000041', '09:00', 'aa000000-0000-0000-0000-000000000031');

-- Kemarin (10 Nov WIB):
--   A1/P1: 2 seminar (1 Paid) + 1 webinar (Paid, paling akhir) -> hanya webinar yang belum lapor.
--   A2/P1: 1 seminar (Paid) -> belum lapor.
--   A3/P2: 1 seminar (Paid) -> grup produk nonaktif, dilewati.
insert into public.orders (order_id, source, name, product_code, product_name, advertiser_code, advertiser_name,
  product_parse_status, event_type, batch, session, city, app_status, gross_amount, source_created_at, created_at) values
  ('wa-online-1', 'orderonline', 'A', 'WAAA', 'Produk Satu', '91', 'Advertiser Satu', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 10:00:00+07', '2026-11-10 10:00:00+07'),
  ('wa-online-2', 'orderonline', 'B', 'WAAA', 'Produk Satu', '91', 'Advertiser Satu', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Pending', 100000,
   '2026-11-10 11:00:00+07', '2026-11-10 11:00:00+07'),
  ('wa-online-3', 'orderonline', 'C', 'WAAA', 'Produk Satu', '91', 'Advertiser Satu', 'valid', 'Webinar Online', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 15:00:00+07', '2026-11-10 15:00:00+07'),
  ('wa-online-4', 'orderonline', 'D', 'WAAA', 'Produk Satu', '92', 'Advertiser Dua', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 12:00:00+07', '2026-11-10 12:00:00+07'),
  ('wa-online-5', 'orderonline', 'E', 'WBBB', 'Produk Dua', '93', 'Advertiser Tiga', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 13:00:00+07', '2026-11-10 13:00:00+07');
-- OTS kemarin tidak boleh ikut memicu pengingat (advertiser_code selalu NULL untuk OTS).
insert into public.orders (order_id, source, name, product_code, product_name, product_parse_status,
  event_type, batch, session, city, app_status, gross_amount, source_created_at, created_at) values
  ('OTS-WA-1', 'ots', 'F', 'WAAA', 'Produk Satu', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 14:00:00+07', '2026-11-10 14:00:00+07');

-- A1 sudah melaporkan SEMINAR (batch berbeda tetap dianggap lapor), webinar belum.
insert into public.ad_spend_reports (advertiser_id, product_id, batch, event_type, date_from, date_to, spend, tax_percent)
values ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000011', '999', 'Seminar Offline',
        '2026-11-10', '2026-11-10', 50000, 0);

-- ---------------------------------------------------------------------------
-- Klaim pertama: webinar A1 + seminar A2; grup P1 dipakai bersama.
-- ---------------------------------------------------------------------------
create temporary table wa_first as
select public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10) as result;

select is(jsonb_array_length((select result from wa_first)), 2, 'dua pengiklan yang belum lapor diklaim');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'advertiser_id' = 'aa000000-0000-0000-0000-000000000001' and t->>'event_type' = 'Webinar Online'), 1,
  'seminar yang sudah lapor tidak menghalangi webinar');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'advertiser_id' = 'aa000000-0000-0000-0000-000000000001' and t->>'event_type' = 'Seminar Offline'), 0,
  'report seminar dengan batch berbeda menutup seminar');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'advertiser_id' = 'aa000000-0000-0000-0000-000000000002' and t->>'event_type' = 'Seminar Offline'), 1,
  'pengiklan kedua pada produk yang sama tetap diklaim');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'advertiser_id' = 'aa000000-0000-0000-0000-000000000003'), 0,
  'grup produk nonaktif dilewati');
select is((select distinct t->>'group_id' from jsonb_array_elements((select result from wa_first)) t limit 1), '111@g.us',
  'target grup berasal dari produk');

select is((select message from public.wa_reminder_logs
            where advertiser_id = 'aa000000-0000-0000-0000-000000000001' and event_type = 'Webinar Online'),
  'Halo @628111111111, laporan Advertiser Satu produk Produk Satu Webinar Online tanggal 2026-11-10 belum diisi. Leads 1, Paid 1. https://app.example.com/report-spend?advertiserCode=91&productCode=WAAA&eventType=Webinar%20Online',
  'placeholder dan mention dirender dari data nyata');
select is((select count(*)::int from public.wa_reminder_logs where status = 'queued'), 2, 'klaim menulis dua log queued');
select is((select reminder_date::text from public.wa_reminder_logs limit 1), '2026-11-11', 'tanggal reminder = tanggal jalan WIB');

-- Klaim kedua pada jam yang sama tidak boleh menggandakan pesan.
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:05:00+07', 'https://app.example.com', 10)), 0,
  'klaim kedua dalam jendela yang sama idempoten');

-- ---------------------------------------------------------------------------
-- Tandai hasil
-- ---------------------------------------------------------------------------
select is((public.wa_reminder_mark(
  (select (t->>'log_id')::uuid from jsonb_array_elements((select result from wa_first)) t where t->>'advertiser_id' = 'aa000000-0000-0000-0000-000000000001'),
  'sent', 'fonnte-1', null))->>'updated', 'true', 'mark sent mengubah baris queued');
select is((select count(*)::int from public.wa_reminder_logs where status = 'sent'), 1, 'status menjadi sent');
select is((select fonnte_message_id from public.wa_reminder_logs where status = 'sent'), 'fonnte-1', 'provider id disimpan');
select is((public.wa_reminder_mark(
  (select (t->>'log_id')::uuid from jsonb_array_elements((select result from wa_first)) t where t->>'advertiser_id' = 'aa000000-0000-0000-0000-000000000001'),
  'sent', 'again', null))->>'updated', 'false', 'baris sent tidak bisa ditandai dua kali');

-- Sudah sent -> klaim berikutnya kosong untuk pengiklan tersebut.
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:10:00+07', 'https://app.example.com', 10)), 0,
  'baris sent memblokir klaim berikutnya');

-- ---------------------------------------------------------------------------
-- Jendela waktu, hari, dan status grup
-- ---------------------------------------------------------------------------
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 10:30:00+07', 'https://app.example.com', 10)), 0,
  'di luar jendela 60 menit tidak ada yang diklaim');

update public.wa_reminder_schedules set days = '{1}' where id = 'aa000000-0000-0000-0000-000000000041';
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-12 09:00:00+07', 'https://app.example.com', 10)), 0,
  'filter hari jadwal dihormati');
update public.wa_reminder_schedules set days = '{0,1,2,3,4,5,6}';

delete from public.wa_reminder_logs;
update public.wa_product_groups set is_active = false where product_id = 'aa000000-0000-0000-0000-000000000011';
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10)), 0,
  'grup produk nonaktif dilewati');
update public.wa_product_groups set is_active = true where product_id = 'aa000000-0000-0000-0000-000000000011';

-- Pengiklan tanpa nomor tidak pernah diklaim.
delete from public.wa_reminder_logs;
update public.advertisers set wa_phone = null where id = 'aa000000-0000-0000-0000-000000000001';
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10)), 1,
  'pengiklan tanpa nomor WA dilewati');
select is((select count(*)::int from public.wa_reminder_logs where advertiser_id = 'aa000000-0000-0000-0000-000000000001'), 0,
  'tidak ada log untuk pengiklan tanpa nomor');
update public.advertisers set wa_phone = '628111111111' where id = 'aa000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Retry maksimal tiga kali
-- ---------------------------------------------------------------------------
delete from public.wa_reminder_logs;
insert into public.wa_reminder_logs (schedule_id, advertiser_id, advertiser_name, product_code, product_name,
  reminder_date, group_id, template_id, event_type, message, status, attempts, claimed_at)
select 'aa000000-0000-0000-0000-000000000041', 'aa000000-0000-0000-0000-000000000001', 'Advertiser Satu', 'WAAA', 'Produk Satu',
       '2026-11-11', '111@g.us', 'aa000000-0000-0000-0000-000000000031', 'Webinar Online', 'gagal', 'failed', n,
       '2026-11-11 09:00:00+07'
  from generate_series(1, 3) n;

select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10)), 1,
  'tiga percobaan gagal menghentikan retry pengiklan itu, pengiklan lain tetap diklaim');
select is((select count(*)::int from jsonb_array_elements(public.wa_reminder_claim('2026-11-11 09:05:00+07', 'https://app.example.com', 10)) t
            where t->>'advertiser_id' = 'aa000000-0000-0000-0000-000000000001'), 0,
  'pengiklan dengan tiga kegagalan tidak diklaim lagi');

delete from public.wa_reminder_logs where status = 'failed' and attempts = 3;
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:10:00+07', 'https://app.example.com', 10)), 1,
  'di bawah batas retry pengingat diklaim lagi');

-- Klaim menggantung (worker mati) ditandai gagal lalu boleh dicoba lagi.
update public.wa_reminder_logs set status = 'queued', claimed_at = '2026-11-11 08:00:00+07' where status = 'queued';
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:20:00+07', 'https://app.example.com', 10)), 1,
  'klaim basi ditandai gagal lalu dicoba lagi selama batas retry belum habis');

-- ---------------------------------------------------------------------------
-- Preview / uji kirim
-- ---------------------------------------------------------------------------
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '91', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'found',
  'true', 'preview menemukan grup produk');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '91', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'leads',
  '2', 'preview menghitung leads kemarin untuk jenis acara yang dipilih');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '91', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'paid',
  '1', 'preview menghitung paid kemarin');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '91', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', null, 'https://app.example.com'))->>'event_type',
  'Webinar Online', 'tanpa jenis acara, preview memakai aktivitas terbaru');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '93', 'WBBB',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'reason',
  'GROUP_NOT_FOUND', 'grup produk nonaktif dilaporkan jujur');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '91', 'WBBB',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'reason',
  'ADVERTISER_NOT_ASSIGNED', 'pengiklan yang tidak ditugaskan ke produk ditolak');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '93', 'WCCC',
  'aa000000-0000-0000-0000-000000000031', null, 'https://app.example.com'))->>'reason',
  'EVENT_TYPE_NOT_FOUND', 'produk tanpa order kemarin tidak punya jenis acara');
update public.advertisers set wa_phone = null where id = 'aa000000-0000-0000-0000-000000000002';
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '92', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'reason',
  'ADVERTISER_PHONE_MISSING', 'pengiklan tanpa nomor dilaporkan jujur');
update public.advertisers set wa_phone = '628222222222' where id = 'aa000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- Retensi 3 hari
-- ---------------------------------------------------------------------------
insert into public.wa_reminder_logs (schedule_id, advertiser_id, advertiser_name, product_code, product_name,
  reminder_date, group_id, template_id, event_type, message, status, attempts, claimed_at, created_at)
values ('aa000000-0000-0000-0000-000000000041', 'aa000000-0000-0000-0000-000000000001', 'Advertiser Satu', 'WAAA', 'Produk Satu',
        '2026-11-06', '111@g.us', 'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'lama', 'failed', 1,
        '2026-11-06 09:00:00+07', '2026-11-06 09:00:00+07');
select is((public.wa_reminder_purge('2026-11-11 09:00:00+07', 3))->>'deleted', '1',
  'log lebih tua dari tiga hari dihapus');
select is((select count(*)::int from public.wa_reminder_logs where created_at < '2026-11-08 09:00:00+07'), 0,
  'tidak ada log lama yang tersisa');

-- ---------------------------------------------------------------------------
-- Izin dan batas data
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.app_permissions where key in ('config.wa_bot', 'action.wa_bot_send')), 2,
  'kedua permission terdaftar');
select is((select count(*)::int from public.app_role_permissions
            where role_id in ('manajer', 'admin') and permission_key in ('config.wa_bot', 'action.wa_bot_send')), 4,
  'manajer dan admin mendapat kedua permission secara default');

select is(has_function_privilege('authenticated', 'public.wa_reminder_claim(timestamptz,text,integer)', 'execute'), false,
  'browser tidak bisa klaim reminder');
select is(has_function_privilege('authenticated', 'public.wa_reminder_mark(uuid,text,text,text)', 'execute'), false,
  'browser tidak bisa menandai reminder');
select is(has_function_privilege('authenticated', 'public.wa_reminder_preview(timestamptz,text,text,uuid,text,text)', 'execute'), false,
  'browser tidak bisa preview dengan data service');
select is(has_function_privilege('authenticated', 'public.wa_reminder_purge(timestamptz,integer)', 'execute'), false,
  'browser tidak bisa menghapus log');
select is(has_table_privilege('authenticated', 'public.wa_product_groups', 'select'), false,
  'mapping grup produk tidak dibaca browser langsung');
select is(has_table_privilege('authenticated', 'public.wa_bot_settings', 'select'), false,
  'tabel token Fonnte tidak dibaca browser');
select is(has_table_privilege('authenticated', 'public.wa_reminder_logs', 'select'), false,
  'log pengiriman tidak dibaca browser');

select throws_ok($$insert into public.advertisers (name, code, wa_phone) values ('X', '94', '0812')$$,
  '23514', null, 'nomor WA wajib format 62...');

select * from finish();
rollback;

