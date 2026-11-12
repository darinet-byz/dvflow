-- A68: tanggal presensi (realtime) vs tanggal order, plus rincian Online/OTS.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 72, 'schema_version mencakup A68');

-- Tanggal dihitung relatif terhadap hari ini (WIB) supaya retensi 30 hari tidak
-- ikut mengubah hasil saat tes dijalankan kapan pun.
create temporary table t38_dates as
select (now() at time zone 'Asia/Jakarta')::date as today,
       (now() at time zone 'Asia/Jakarta')::date - 1 as yesterday,
       (now() at time zone 'Asia/Jakarta')::date - 2 as old_day;

insert into public.products(id, name, code)
values ('fe380000-0000-0000-0000-000000000001', 'Produk 38', 'PRTD');

insert into public.users(id, username, display_name, password_hash, role, has_all_product_access)
values ('fe380000-0000-0000-0000-000000000002', 'p38_dev', 'P38 Dev', 'test', 'developer', true);

insert into public.orders(
  order_id, name, phone, product_code, product_name, product_parse_status,
  event_type, batch, session, city, app_status, quantity, gross_amount, source,
  created_at, paid_at, payment_method
)
select 'p38-online-a', 'Online A', '0811', 'PRTD', 'Produk 38', 'valid',
       'Seminar Offline', '380', 'S1', 'Solo', 'Paid', 2, 200000, 'orderonline',
       (d.old_day + time '09:00') at time zone 'Asia/Jakarta',
       (d.old_day + time '09:05') at time zone 'Asia/Jakarta', 'bank_transfer'
  from t38_dates d;

insert into public.orders(
  order_id, name, phone, product_code, product_name, product_parse_status,
  event_type, batch, session, city, app_status, quantity, gross_amount, source,
  created_at, paid_at, payment_method
)
select 'p38-partial', 'Online Partial', '0812', 'PRTD', 'Produk 38', 'valid',
       'Seminar Offline', '380', 'S1', 'Solo', 'Paid', 3, 300000, 'orderonline',
       (d.old_day + time '09:10') at time zone 'Asia/Jakarta',
       (d.old_day + time '09:15') at time zone 'Asia/Jakarta', 'bank_transfer'
  from t38_dates d;

insert into public.orders(
  order_id, name, phone, product_code, product_name, product_parse_status,
  event_type, batch, session, city, app_status, quantity, gross_amount, source,
  created_at, paid_at, payment_method
)
select 'p38-none', 'Online Belum Hadir', '0813', 'PRTD', 'Produk 38', 'valid',
       'Seminar Offline', '380', 'S1', 'Solo', 'Paid', 1, 100000, 'orderonline',
       (d.today + time '08:00') at time zone 'Asia/Jakarta',
       (d.today + time '08:05') at time zone 'Asia/Jakarta', 'bank_transfer'
  from t38_dates d;

insert into public.orders(
  order_id, name, phone, product_code, product_name, product_parse_status,
  event_type, batch, session, city, app_status, quantity, gross_amount, source,
  ots_collected_by, created_at, paid_at, payment_method
)
select 'OTS-380001', 'OTS Satu', '0814', 'PRTD', 'Produk 38', 'valid',
       'Seminar Offline', '380', 'S1', 'Solo', 'Paid', 2, 200000, 'ots',
       'fe380000-0000-0000-0000-000000000002',
       (d.today + time '08:30') at time zone 'Asia/Jakarta',
       (d.today + time '08:30') at time zone 'Asia/Jakarta', 'ots_tunai'
  from t38_dates d;

insert into public.orders(
  order_id, name, phone, product_code, product_name, product_parse_status,
  event_type, batch, session, city, event_session, event_city, app_status, quantity,
  gross_amount, source, created_at, paid_at, payment_method
)
select 'p38-resched', 'Pindah Sesi', '0815', 'PRTD', 'Produk 38', 'valid',
       'Seminar Offline', '380', 'S1', 'Solo', 'S2', 'Bandung', 'Paid', 1, 100000,
       'orderonline',
       (d.old_day + time '09:20') at time zone 'Asia/Jakarta',
       (d.old_day + time '09:25') at time zone 'Asia/Jakarta', 'bank_transfer'
  from t38_dates d;

insert into public.orders(
  order_id, name, phone, product_code, product_name, product_parse_status,
  event_type, batch, session, app_status, quantity, gross_amount, source,
  created_at, paid_at, payment_method
)
select 'p38-webinar', 'Webinar Satu', '0816', 'PRTD', 'Produk 38', 'valid',
       'Webinar Online', '380', 'S1', 'Paid', 1, 100000, 'orderonline',
       (d.old_day + time '09:30') at time zone 'Asia/Jakarta',
       (d.old_day + time '09:35') at time zone 'Asia/Jakarta', 'bank_transfer'
  from t38_dates d;

insert into public.orders(
  order_id, name, phone, product_code, product_name, product_parse_status,
  event_type, batch, session, city, app_status, quantity, gross_amount, source,
  created_at, paid_at, payment_method
)
select 'p38-yesterday', 'Kemarin Saja', '0817', 'PRTD', 'Produk 38', 'valid',
       'Seminar Offline', '380', 'S1', 'Solo', 'Paid', 1, 100000, 'orderonline',
       (d.old_day + time '09:40') at time zone 'Asia/Jakarta',
       (d.old_day + time '09:45') at time zone 'Asia/Jakarta', 'bank_transfer'
  from t38_dates d;

insert into public.attendance_events(order_id, attendance_type, source, clicked_at, ticket_no)
select 'p38-online-a', 'seminar', 'seminar_qr',
       (d.today + time '10:00') at time zone 'Asia/Jakarta' + ((g - 1) * interval '5 minutes'), g
  from t38_dates d, generate_series(1, 2) g;

insert into public.attendance_events(order_id, attendance_type, source, clicked_at, ticket_no)
select 'p38-partial', 'seminar', 'seminar_qr',
       (d.today + time '11:00') at time zone 'Asia/Jakarta' + ((g - 1) * interval '5 minutes'), g
  from t38_dates d, generate_series(1, 2) g;
insert into public.attendance_events(order_id, attendance_type, source, clicked_at, ticket_no)
select 'p38-partial', 'seminar', 'seminar_qr',
       (d.yesterday + time '11:00') at time zone 'Asia/Jakarta', 3
  from t38_dates d;

insert into public.attendance_events(order_id, attendance_type, source, clicked_at, ticket_no)
select 'OTS-380001', 'seminar', 'seminar_ots',
       (d.today + time '12:00') at time zone 'Asia/Jakarta' + ((g - 1) * interval '5 minutes'), g
  from t38_dates d, generate_series(1, 2) g;

insert into public.attendance_events(order_id, attendance_type, source, clicked_at, ticket_no)
select 'p38-resched', 'seminar', 'seminar_qr',
       (d.today + time '13:00') at time zone 'Asia/Jakarta', 1
  from t38_dates d;

insert into public.attendance_events(order_id, attendance_type, source, clicked_at, ticket_no)
select 'p38-webinar', 'webinar', 'webinar_redirect',
       (d.today + time '14:00') at time zone 'Asia/Jakarta', 1
  from t38_dates d;

insert into public.attendance_events(order_id, attendance_type, source, clicked_at, ticket_no)
select 'p38-yesterday', 'seminar', 'seminar_qr',
       (d.yesterday + time '15:00') at time zone 'Asia/Jakarta', 1
  from t38_dates d;

grant select on t38_dates to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fe380000-0000-0000-0000-000000000002","role":"authenticated","app_user_id":"fe380000-0000-0000-0000-000000000002","app_role":"developer"}',
  true);

-- ---------------------------------------------------------------------------
-- Tanggal order (perilaku lama)
-- ---------------------------------------------------------------------------
select is((public.presensi_page(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates)
  )->>'total')::int, 2, 'order: hanya order yang dibuat hari ini');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates)
  )->>'paid_tickets')::int, 3, 'order summary: tiket order hari ini');

-- ---------------------------------------------------------------------------
-- Tanggal presensi (Realtime)
-- ---------------------------------------------------------------------------
select is((public.presensi_page(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'total')::int, 5, 'attendance: peserta yang check-in hari ini');

select is((public.presensi_page(
    p_search => 'p38-online-a',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->'rows'->0->>'attendance_status'), 'Hadir', 'attendance: 2 tiket hadir');

select is((public.presensi_page(
    p_search => 'p38-partial',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->'rows'->0->>'attendance_status'), 'Hadir Sebagian', 'attendance: 2 dari 3 tiket hadir hari ini');

select is((public.presensi_page(
    p_search => 'p38-partial',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->'rows'->0->>'checked_in_in_range')::int, 2, 'attendance: tiket hadir dalam rentang = 2');

select is((public.presensi_page(
    p_search => 'p38-partial',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->'rows'->0->>'checked_in_tickets')::int, 3, 'attendance: total tiket hadir tetap 3');

select is((public.presensi_page(
    p_search => 'p38-partial',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->'rows'->0->>'total_activity')::int, 2, 'attendance: timestamp di luar rentang tidak dihitung');

select is((public.presensi_page(
    p_search => 'p38-yesterday',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'total')::int, 0, 'attendance: check-in kemarin tidak masuk hari ini');

select is((public.presensi_page(
    p_product_code => 'PRTD',
    p_session => 'S2',
    p_city => 'Bandung',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'total')::int, 1, 'attendance: peserta reschedule dicari lewat sesi efektif');

select is((public.presensi_page(
    p_search => 'p38-webinar',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->'rows'->0->>'attendance_status'), 'Hadir', 'attendance: satu klik webinar = tiket hadir');

select is((public.presensi_page(
    p_product_code => 'PRTD',
    p_date_mode => 'attendance'
  )->>'total')::int, 6, 'attendance tanpa tanggal = seluruh peserta yang pernah hadir');

-- ---------------------------------------------------------------------------
-- Ringkasan total per tiket + rincian sumber
-- ---------------------------------------------------------------------------
select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'paid_tickets')::int, 9, 'attendance summary: tiket dari peserta yang hadir hari ini');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'sudah_hadir')::int, 8, 'attendance summary: tiket hadir hari ini');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'belum_hadir')::int, 1, 'attendance summary: sisa tiket rombongan');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'paid_tickets_online')::int, 7, 'attendance summary: tiket online');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'paid_tickets_ots')::int, 2, 'attendance summary: tiket OTS');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'sudah_hadir_online')::int, 6, 'attendance summary: hadir online');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'sudah_hadir_ots')::int, 2, 'attendance summary: hadir OTS');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'attending_orders')::int, 5, 'attendance summary: order yang hadir');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance',
    p_source => 'ots'
  )->>'sudah_hadir')::int, 2, 'attendance summary: filter sumber OTS');

select is((public.presensi_summary(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance',
    p_source => 'ots'
  )->>'sudah_hadir_online')::int, 0, 'attendance summary: rincian online nol saat filter OTS');

-- ---------------------------------------------------------------------------
-- Export & validasi
-- ---------------------------------------------------------------------------
select is((public.export_presensi_page(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates),
    p_date_mode => 'attendance'
  )->>'total')::int, 5, 'export mengikuti tanggal presensi');

select is((public.presensi_page(
    p_product_code => 'PRTD',
    p_date_from => (select today from t38_dates),
    p_date_to => (select today from t38_dates)
  )->>'total')::int, 2, 'default p_date_mode tetap order');

select throws_ok(
  $$select public.presensi_page(p_date_mode => 'nope')$$,
  'DF011', 'INVALID_DATE_MODE', 'mode tanggal tidak dikenal ditolak'
);

reset role;
select * from finish();
rollback;
