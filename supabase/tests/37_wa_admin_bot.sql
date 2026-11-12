-- Fitur 3.0.1 — WA Admin Bot: grup per produk, nomor pengiklan, jenis acara,
-- idempotensi, retensi 3 hari, dan izin.
-- Waktu uji dipaku: 2026-11-11 09:00 WIB (Rabu).
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select is(public.schema_version(), 74, 'schema version 74');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into public.advertisers (id, name, code) values
  ('aa000000-0000-0000-0000-000000000001', 'Advertiser Satu', '91'),
  ('aa000000-0000-0000-0000-000000000002', 'Advertiser Dua', '92'),
  ('aa000000-0000-0000-0000-000000000003', 'Advertiser Tiga', '93');

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
-- Klaim pertama: satu pesan per grup + jenis acara.
--   P1/Seminar : A1 (sudah lapor) + A2 (belum) -> tetap dikirim karena A2,
--                menyebut keduanya sesuai permintaan pengguna.
--   P1/Webinar : hanya A1.
-- ---------------------------------------------------------------------------
create temporary table wa_first as
select public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10) as result;

select is(jsonb_array_length((select result from wa_first)), 2, 'dua pesan grup (seminar + webinar) diklaim');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'event_type' = 'Webinar Online'), 1,
  'webinar A1 tetap dikirim walau seminar sudah lapor');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'event_type' = 'Seminar Offline'), 1,
  'seminar grup P1 dikirim karena A2 belum lapor');
select is((select t->>'message' from jsonb_array_elements((select result from wa_first)) t
            where t->>'event_type' = 'Webinar Online'), 
  'Halo @Advertiser Satu, laporan Advertiser Satu produk Produk Satu Webinar Online tanggal 2026-11-10 belum diisi. Leads 1, Paid 1. https://app.example.com/report-spend?productCode=WAAA&eventType=Webinar%20Online',
  'pesan webinar menyebut pengiklan yang beraktivitas');
select is((select t->>'message' from jsonb_array_elements((select result from wa_first)) t
            where t->>'event_type' = 'Seminar Offline'),
  'Halo @Advertiser Dua, @Advertiser Satu, laporan Advertiser Dua, Advertiser Satu produk Produk Satu Seminar Offline tanggal 2026-11-10 belum diisi. Leads 3, Paid 2. https://app.example.com/report-spend?productCode=WAAA&eventType=Seminar%20Offline',
  'satu pesan seminar menyebut semua pengiklan grup');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'advertiser_id' is not null), 0,
  'task grup tidak lagi membawa advertiser_id tunggal');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'group_id' <> '111@g.us'), 0,
  'target grup berasal dari produk');
select is((select count(*)::int from jsonb_array_elements((select result from wa_first)) t
            where t->>'message' like '%Advertiser Tiga%'), 0,
  'grup produk nonaktif dilewati');

select is((select message from public.wa_reminder_logs where event_type = 'Seminar Offline'),
  'Halo @Advertiser Dua, @Advertiser Satu, laporan Advertiser Dua, Advertiser Satu produk Produk Satu Seminar Offline tanggal 2026-11-10 belum diisi. Leads 3, Paid 2. https://app.example.com/report-spend?productCode=WAAA&eventType=Seminar%20Offline',
  'placeholder, mention, dan total dirender dari data nyata');
select is((select advertiser_name from public.wa_reminder_logs where event_type = 'Seminar Offline'),
  'Advertiser Dua, Advertiser Satu', 'log menyimpan daftar pengiklan yang disebut');
select is((select count(*)::int from public.wa_reminder_logs where status = 'queued'), 2, 'klaim menulis dua log queued');
select is((select reminder_date::text from public.wa_reminder_logs limit 1), '2026-11-11', 'tanggal reminder = tanggal jalan WIB');

-- Klaim kedua pada jam yang sama tidak boleh menggandakan pesan.
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:05:00+07', 'https://app.example.com', 10)), 0,
  'klaim kedua dalam jendela yang sama idempoten');

-- ---------------------------------------------------------------------------
-- Tandai hasil
-- ---------------------------------------------------------------------------
select is((public.wa_reminder_mark(
  (select (t->>'log_id')::uuid from jsonb_array_elements((select result from wa_first)) t where t->>'event_type' = 'Webinar Online'),
  'sent', 'fonnte-1', null))->>'updated', 'true', 'mark sent mengubah baris queued');
select is((select count(*)::int from public.wa_reminder_logs where status = 'sent'), 1, 'status menjadi sent');
select is((select fonnte_message_id from public.wa_reminder_logs where status = 'sent'), 'fonnte-1', 'provider id disimpan');
select is((public.wa_reminder_mark(
  (select (t->>'log_id')::uuid from jsonb_array_elements((select result from wa_first)) t where t->>'event_type' = 'Webinar Online'),
  'sent', 'again', null))->>'updated', 'false', 'baris sent tidak bisa ditandai dua kali');

-- Sudah sent -> klaim berikutnya kosong untuk grup/jenis acara tersebut,
-- sedangkan seminar yang masih queued juga idempoten.
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:10:00+07', 'https://app.example.com', 10)), 0,
  'baris sent dan queued memblokir klaim berikutnya');

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

-- ---------------------------------------------------------------------------
-- Retry maksimal tiga kali
-- ---------------------------------------------------------------------------
delete from public.wa_reminder_logs;
insert into public.wa_reminder_logs (schedule_id, advertiser_id, advertiser_name, product_code, product_name,
  reminder_date, group_id, template_id, event_type, message, status, attempts, claimed_at)
select 'aa000000-0000-0000-0000-000000000041', null, 'Advertiser Satu', 'WAAA', 'Produk Satu',
       '2026-11-11', '111@g.us', 'aa000000-0000-0000-0000-000000000031', 'Webinar Online', 'gagal', 'failed', n,
       '2026-11-11 09:00:00+07'
  from generate_series(1, 3) n;

select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10)), 1,
  'tiga kegagalan webinar menghentikan grup itu; seminar grup tetap diklaim');
select is((select count(*)::int from jsonb_array_elements(public.wa_reminder_claim('2026-11-11 09:05:00+07', 'https://app.example.com', 10)) t
            where t->>'event_type' = 'Webinar Online'), 0,
  'grup dengan tiga kegagalan tidak diklaim lagi');

delete from public.wa_reminder_logs;
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:10:00+07', 'https://app.example.com', 10)), 2,
  'di bawah batas retry seminar dan webinar diklaim lagi');

-- Klaim menggantung (worker mati) ditandai gagal lalu boleh dicoba lagi.
update public.wa_reminder_logs set status = 'queued', claimed_at = '2026-11-11 08:00:00+07' where status = 'queued';
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:20:00+07', 'https://app.example.com', 10)), 2,
  'klaim basi ditandai gagal lalu dicoba lagi selama batas retry belum habis');

-- ---------------------------------------------------------------------------
-- Preview / uji kirim
-- ---------------------------------------------------------------------------
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'found',
  'true', 'preview menemukan grup produk');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'leads',
  '3', 'preview menghitung leads kemarin seluruh pengiklan');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'paid',
  '2', 'preview menghitung paid kemarin');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'message',
  'Halo @Advertiser Dua, @Advertiser Satu, laporan Advertiser Dua, Advertiser Satu produk Produk Satu Seminar Offline tanggal 2026-11-10 belum diisi. Leads 3, Paid 2. https://app.example.com/report-spend?productCode=WAAA&eventType=Seminar%20Offline',
  'preview menyebut seluruh pengiklan grup');
select is(jsonb_array_length((public.wa_reminder_preview('2026-11-11 09:00:00+07', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->'advertisers'),
  2, 'preview mengembalikan daftar pengiklan yang disebut');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', 'WAAA',
  'aa000000-0000-0000-0000-000000000031', null, 'https://app.example.com'))->>'event_type',
  'Webinar Online', 'tanpa jenis acara, preview memakai aktivitas terbaru');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', 'WBBB',
  'aa000000-0000-0000-0000-000000000031', 'Seminar Offline', 'https://app.example.com'))->>'reason',
  'GROUP_NOT_FOUND', 'grup produk nonaktif dilaporkan jujur');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', 'WCCC',
  'aa000000-0000-0000-0000-000000000031', null, 'https://app.example.com'))->>'reason',
  'EVENT_TYPE_NOT_FOUND', 'produk tanpa order kemarin tidak punya jenis acara');

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
select is(has_function_privilege('authenticated', 'public.wa_reminder_preview(timestamptz,text,uuid,text,text)', 'execute'), false,
  'browser tidak bisa preview dengan data service');
select is(has_function_privilege('authenticated', 'public.wa_reminder_purge(timestamptz,integer)', 'execute'), false,
  'browser tidak bisa menghapus log');
select is(has_table_privilege('authenticated', 'public.wa_product_groups', 'select'), false,
  'mapping grup produk tidak dibaca browser langsung');
select is(has_table_privilege('authenticated', 'public.wa_bot_settings', 'select'), false,
  'tabel token Fonnte tidak dibaca browser');
select is(has_table_privilege('authenticated', 'public.wa_reminder_logs', 'select'), false,
  'log pengiriman tidak dibaca browser');

select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'advertisers' and column_name = 'wa_phone'), 0,
  'kolom nomor WA pengiklan sudah dihapus');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'wa_reminder_logs' and column_name = 'advertiser_id'
              and is_nullable = 'YES'), 1,
  'advertiser_id log boleh kosong untuk pesan grup');

select * from finish();
rollback;

