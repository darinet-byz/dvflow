-- Fitur 3.0 — WA Admin Bot: idempotensi, aturan laporan per produk, izin.
-- Waktu uji dipaku: 2026-11-11 09:00 WIB (Rabu).
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select is(public.schema_version(), 70, 'schema version 70');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into public.advertisers (id, name, code) values
  ('aa000000-0000-0000-0000-000000000001', 'Advertiser Uji', '91'),
  ('aa000000-0000-0000-0000-000000000002', 'Advertiser Lapor', '92'),
  ('aa000000-0000-0000-0000-000000000003', 'Advertiser Nonaktif', '93');

insert into public.products (id, name, code) values
  ('aa000000-0000-0000-0000-000000000011', 'Produk Uji', 'WAAA'),
  ('aa000000-0000-0000-0000-000000000012', 'Produk Lapor', 'WBBB'),
  ('aa000000-0000-0000-0000-000000000013', 'Produk Nonaktif', 'WCCC');

insert into public.wa_reminder_groups (id, advertiser_id, fonnte_group_id, pic_phone, pic_name) values
  ('aa000000-0000-0000-0000-000000000021', 'aa000000-0000-0000-0000-000000000001', '111@g.us', '628111111111', 'PIC Satu'),
  ('aa000000-0000-0000-0000-000000000022', 'aa000000-0000-0000-0000-000000000002', '222@g.us', '628222222222', 'PIC Dua'),
  ('aa000000-0000-0000-0000-000000000023', 'aa000000-0000-0000-0000-000000000003', '333@g.us', '628333333333', 'PIC Tiga');

update public.wa_reminder_groups set is_active = false
 where id = 'aa000000-0000-0000-0000-000000000023';

insert into public.wa_reminder_templates (id, name, message_content) values
  ('aa000000-0000-0000-0000-000000000031', 'Pagi',
   'Halo {{mention}}, laporan {{store_name}} produk {{product_name}} belum diisi. Leads {{leads}}, Paid {{paid}}. {{report_url}}');

insert into public.wa_reminder_schedules (id, execution_time, template_id) values
  ('aa000000-0000-0000-0000-000000000041', '09:00', 'aa000000-0000-0000-0000-000000000031');

-- Kemarin (10 Nov WIB): advertiser W1 -> 2 order (1 Paid), W2 -> 1 Paid, W3 -> 1 Paid.
insert into public.orders (order_id, source, name, product_code, product_name, advertiser_code, advertiser_name,
  product_parse_status, event_type, batch, session, city, app_status, gross_amount, source_created_at, created_at) values
  ('wa-online-1', 'orderonline', 'A', 'WAAA', 'Produk Uji', '91', 'Advertiser Uji', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 10:00:00+07', '2026-11-10 10:00:00+07'),
  ('wa-online-2', 'orderonline', 'B', 'WAAA', 'Produk Uji', '91', 'Advertiser Uji', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Pending', 100000,
   '2026-11-10 11:00:00+07', '2026-11-10 11:00:00+07'),
  ('wa-online-3', 'orderonline', 'C', 'WBBB', 'Produk Lapor', '92', 'Advertiser Lapor', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 12:00:00+07', '2026-11-10 12:00:00+07'),
  ('wa-online-4', 'orderonline', 'D', 'WCCC', 'Produk Nonaktif', '93', 'Advertiser Nonaktif', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 13:00:00+07', '2026-11-10 13:00:00+07');
-- OTS kemarin tidak boleh ikut memicu pengingat (advertiser_code selalu NULL untuk OTS).
insert into public.orders (order_id, source, name, product_code, product_name, product_parse_status,
  event_type, batch, session, city, app_status, gross_amount, source_created_at, created_at) values
  ('OTS-WA-1', 'ots', 'E', 'WAAA', 'Produk Uji', 'valid', 'Seminar Offline', '100', 'S1', 'Solo', 'Paid', 100000,
   '2026-11-10 14:00:00+07', '2026-11-10 14:00:00+07');

-- ---------------------------------------------------------------------------
-- Klaim pertama: hanya W1/WP (W2 sudah lapor, W3 grup nonaktif, OTS diabaikan)
-- ---------------------------------------------------------------------------
insert into public.ad_spend_reports (advertiser_id, product_id, batch, event_type, date_from, date_to, spend, tax_percent)
values ('aa000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000012', '999', 'Seminar Offline',
        '2026-11-10', '2026-11-10', 50000, 0);

create temporary table wa_first as
select public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10) as result;

select is(jsonb_array_length((select result from wa_first)), 1, 'only the unreported active advertiser is claimed');
select is((select result->0->>'group_id' from wa_first), '111@g.us', 'target group comes from the advertiser mapping');
select is((select result->0->>'product_code' from wa_first), 'WAAA', 'claim is per product');
select is((select result->0->>'message' from wa_first),
  'Halo @628111111111, laporan Advertiser Uji produk Produk Uji belum diisi. Leads 2, Paid 1. https://app.example.com/report-spend?advertiserCode=91&productCode=WAAA',
  'placeholders are rendered from live data');

select is((select count(*)::int from public.wa_reminder_logs where status = 'queued'), 1, 'claim writes one queued log');
select is((select reminder_date::text from public.wa_reminder_logs limit 1), '2026-11-11', 'reminder date is the WIB run date');

-- Klaim kedua pada jam yang sama tidak boleh menggandakan pesan.
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:05:00+07', 'https://app.example.com', 10)), 0,
  'second claim within the same window is idempotent');

-- Batch diabaikan: laporan W2 batch 999 tetap dianggap produk WQ sudah lapor.
select is((select count(*)::int from public.wa_reminder_logs where advertiser_id = 'aa000000-0000-0000-0000-000000000002'), 0,
  'report matching ignores batch');

-- ---------------------------------------------------------------------------
-- Tandai hasil
-- ---------------------------------------------------------------------------
select is((public.wa_reminder_mark((select (result->0->>'log_id')::uuid from wa_first), 'sent', 'fonnte-1', null))->>'updated',
  'true', 'mark sent updates the queued row');
select is((select status from public.wa_reminder_logs limit 1), 'sent', 'status becomes sent');
select is((select fonnte_message_id from public.wa_reminder_logs limit 1), 'fonnte-1', 'provider id is stored');
select is((public.wa_reminder_mark((select (result->0->>'log_id')::uuid from wa_first), 'sent', 'again', null))->>'updated',
  'false', 'a sent row cannot be marked twice');

-- Sudah sent -> klaim berikutnya tetap kosong.
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:10:00+07', 'https://app.example.com', 10)), 0,
  'sent rows block later claims');

-- ---------------------------------------------------------------------------
-- Jendela waktu, hari, dan status grup
-- ---------------------------------------------------------------------------
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 10:30:00+07', 'https://app.example.com', 10)), 0,
  'outside the 60 minute grace window nothing is claimed');

update public.wa_reminder_schedules set days = '{1}' where id = 'aa000000-0000-0000-0000-000000000041';
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-12 09:00:00+07', 'https://app.example.com', 10)), 0,
  'schedule day filter is respected');
update public.wa_reminder_schedules set days = '{0,1,2,3,4,5,6}';

delete from public.wa_reminder_logs;
update public.wa_reminder_groups set is_active = false where id = 'aa000000-0000-0000-0000-000000000021';
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10)), 0,
  'inactive group is skipped');
update public.wa_reminder_groups set is_active = true where id = 'aa000000-0000-0000-0000-000000000021';

-- ---------------------------------------------------------------------------
-- Retry maksimal tiga kali
-- ---------------------------------------------------------------------------
insert into public.wa_reminder_logs (schedule_id, advertiser_id, advertiser_name, product_code, product_name,
  reminder_date, group_id, template_id, message, status, attempts, claimed_at)
select 'aa000000-0000-0000-0000-000000000041', 'aa000000-0000-0000-0000-000000000001', 'Advertiser Uji', 'WAAA', 'Produk Uji',
       '2026-11-11', '111@g.us', 'aa000000-0000-0000-0000-000000000031', 'gagal', 'failed', n, '2026-11-11 09:00:00+07'
  from generate_series(1, 3) n;

select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10)), 0,
  'three failed attempts stop automatic retries');

delete from public.wa_reminder_logs where status = 'failed' and attempts = 3;
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:00:00+07', 'https://app.example.com', 10)), 1,
  'below the retry cap the reminder is claimed again');

-- Klaim yang menggantung (worker mati) ditandai gagal lalu boleh dicoba lagi.
update public.wa_reminder_logs set status = 'queued', claimed_at = '2026-11-11 08:00:00+07' where status = 'queued';
select is(jsonb_array_length(public.wa_reminder_claim('2026-11-11 09:20:00+07', 'https://app.example.com', 10)), 0,
  'stale claim is failed first, then retry cap still applies');

-- ---------------------------------------------------------------------------
-- Preview / uji kirim
-- ---------------------------------------------------------------------------
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '91', 'WAAA', 'aa000000-0000-0000-0000-000000000031', 'https://app.example.com'))->>'found',
  'true', 'preview finds a configured group');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '91', 'WAAA', 'aa000000-0000-0000-0000-000000000031', 'https://app.example.com'))->>'leads',
  '2', 'preview counts yesterday leads');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '91', 'WAAA', 'aa000000-0000-0000-0000-000000000031', 'https://app.example.com'))->>'paid',
  '1', 'preview counts yesterday paid');
select is((public.wa_reminder_preview('2026-11-11 09:00:00+07', '93', 'WCCC', 'aa000000-0000-0000-0000-000000000031', 'https://app.example.com'))->>'reason',
  'GROUP_NOT_FOUND', 'inactive/missing group is reported honestly');

-- ---------------------------------------------------------------------------
-- Izin
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.app_permissions where key in ('config.wa_bot', 'action.wa_bot_send')), 2,
  'both permissions are registered');
select is((select count(*)::int from public.app_role_permissions
            where role_id in ('manajer', 'admin') and permission_key in ('config.wa_bot', 'action.wa_bot_send')), 4,
  'manajer and admin receive both permissions by default');

select is(has_function_privilege('authenticated', 'public.wa_reminder_claim(timestamptz,text,integer)', 'execute'), false,
  'browser cannot claim reminders');
select is(has_function_privilege('authenticated', 'public.wa_reminder_mark(uuid,text,text,text)', 'execute'), false,
  'browser cannot mark reminders');
select is(has_function_privilege('authenticated', 'public.wa_reminder_preview(timestamptz,text,text,uuid,text)', 'execute'), false,
  'browser cannot preview with service data');
select is(has_table_privilege('authenticated', 'public.wa_bot_settings', 'select'), false,
  'Fonnte token table is not readable by the browser');
select is(has_table_privilege('authenticated', 'public.wa_reminder_logs', 'select'), false,
  'send log is not readable by the browser');

select * from finish();
rollback;

