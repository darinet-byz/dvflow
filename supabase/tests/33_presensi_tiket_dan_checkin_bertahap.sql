-- 0065 (A61): presensi per tiket, check-in bertahap, dan halaman Presensi hanya peserta Paid.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 65, 'schema_version mencakup 0065');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into public.products(id, name, code) values
  ('fb000000-0000-0000-0000-0000000000a1', 'Produk OTS Tiket', 'OTST');
insert into public.users(id, username, display_name, password_hash, role, has_all_product_access) values
  ('fb000000-0000-0000-0000-000000000001', 'tix_dev', 'Tix Dev', 'test', 'developer', true);

insert into public.orders(
  order_id, name, event_type, app_status, gross_amount, quantity, created_at, paid_at
) values
  ('tix-3', 'Tiga Tiket',  'Seminar Offline', 'Paid',    300000, 3, now(), now()),
  ('tix-2', 'Dua Tiket',   'Seminar Offline', 'Paid',    200000, 2, now(), now()),
  ('tix-1', 'Satu Tiket',  'Seminar Offline', 'Paid',    100000, 1, now(), now()),
  ('tix-clamp', 'Tiket Clamp', 'Seminar Offline', 'Paid', 100000, 1, now(), now()),
  ('tix-legacy', 'Tiket Legacy', 'Seminar Offline', 'Paid', 200000, 2, now(), now()),
  ('tix-old', 'Tiket Lama', 'Seminar Offline', 'Paid',   100000, 2, now() - interval '40 days', now() - interval '40 days'),
  ('tix-pending', 'Belum Bayar', 'Seminar Offline', 'Pending', 100000, 1, now(), null),
  ('tix-web', 'Webinar Dua', 'Webinar Online', 'Paid',    200000, 2, now(), now());

insert into public.attendance_events(order_id, attendance_type, source) values
  ('tix-web', 'webinar', 'webinar_redirect');

-- tix-2 baru 1 dari 2 tiket.
insert into public.attendance_events(order_id, attendance_type, source, scanner_user_id, ticket_no) values
  ('tix-2', 'seminar', 'seminar_qr', 'fb000000-0000-0000-0000-000000000001', 1);

-- ---------------------------------------------------------------------------
-- Check-in bertahap
-- ---------------------------------------------------------------------------
select is(
  (public.checkin_seminar('tix-3', 'seminar_qr', 'fb000000-0000-0000-0000-000000000001', -1) ->> 'state'),
  'NEEDS_QUANTITY',
  'qty 3 probe -1 -> NEEDS_QUANTITY');
select is(
  (select count(*)::int from public.attendance_events where order_id = 'tix-3'),
  0, 'NEEDS_QUANTITY tidak menulis presensi');

select is(
  (public.checkin_seminar('tix-3', 'seminar_qr', 'fb000000-0000-0000-0000-000000000001', 2) ->> 'tickets_confirmed')::int,
  2, 'konfirmasi 2 tiket');
select is(
  (select count(*)::int from public.attendance_events where order_id = 'tix-3'),
  2, 'dua baris presensi untuk dua tiket');
select is(
  (select array_agg(ticket_no order by ticket_no) from public.attendance_events where order_id = 'tix-3'),
  array[1, 2], 'nomor tiket 1 dan 2');
select is(
  (public.checkin_seminar('tix-3', 'seminar_qr', 'fb000000-0000-0000-0000-000000000001') ->> 'tickets_confirmed')::int,
  1, 'scan berikutnya: sisa 1 -> langsung check-in tanpa dialog');
select is(
  (public.checkin_seminar('tix-3', 'seminar_qr', 'fb000000-0000-0000-0000-000000000001') ->> 'state'),
  'ALREADY_CHECKED_IN', 'semua tiket sudah -> ALREADY_CHECKED_IN');
select is(
  (select count(*)::int from public.attendance_events where order_id = 'tix-3'),
  3, 'tidak ada baris keempat');

select is(
  (public.checkin_seminar('tix-clamp', 'seminar_qr', 'fb000000-0000-0000-0000-000000000001', 9) ->> 'tickets_confirmed')::int,
  1, 'jumlah melebihi sisa dipotong ke sisa');
select throws_ok(
  $$select public.checkin_seminar('tix-clamp', 'seminar_qr', 'fb000000-0000-0000-0000-000000000001', 0)$$,
  'DF011', 'INVALID_ARGUMENT', 'jumlah tiket 0 ditolak');

-- Kompatibilitas klien lama (3 argumen / tanpa p_tickets): seluruh sisa tiket
-- langsung check-in, sama seperti perilaku sebelum A61.
select is(
  (public.checkin_seminar('tix-legacy', 'seminar_qr', 'fb000000-0000-0000-0000-000000000001') ->> 'tickets_confirmed')::int,
  2, 'pemanggil lama: seluruh 2 tiket check-in');
select is(
  (select count(*)::int from public.attendance_events where order_id = 'tix-legacy'),
  2, 'pemanggil lama tetap membuat presensi per tiket');

-- ---------------------------------------------------------------------------
-- Presensi: hanya Paid, status per tiket, data kedaluwarsa
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-000000000001","app_role":"developer"}';

select is((public.presensi_page() ->> 'total')::int, 7, 'hanya peserta Paid yang tampil');
select is((public.presensi_page(p_search => 'tix-pending') ->> 'total')::int, 0, 'order Pending tidak tampil');

select is(
  (public.presensi_page(p_search => 'tix-3') -> 'rows' -> 0 ->> 'attendance_status'),
  'Hadir', 'qty 3 dengan 3 check-in -> Hadir');
select is(
  (public.presensi_page(p_search => 'tix-2') -> 'rows' -> 0 ->> 'attendance_status'),
  'Hadir Sebagian', 'qty 2 dengan 1 check-in -> Hadir Sebagian');
select is(
  (public.presensi_page(p_search => 'tix-2') -> 'rows' -> 0 ->> 'checked_in_tickets')::int,
  1, 'tiket hadir tix-2 = 1');
select is(
  (public.presensi_page(p_search => 'tix-1') -> 'rows' -> 0 ->> 'attendance_status'),
  'Belum Hadir', 'tanpa check-in -> Belum Hadir');
select is(
  (public.presensi_page(p_search => 'tix-old') -> 'rows' -> 0 ->> 'attendance_status'),
  'Data presensi tidak tersedia', 'order > 30 hari tanpa presensi -> data tidak tersedia');
select is(
  (public.presensi_page(p_attendance_status => 'Data presensi tidak tersedia') ->> 'total')::int,
  1, 'filter data presensi tidak tersedia');
select is(
  (public.presensi_page(p_search => 'tix-web') -> 'rows' -> 0 ->> 'checked_in_tickets')::int,
  2, 'webinar: satu klik = semua tiket hadir');

select is(
  public.presensi_summary(),
  '{"paid_tickets":11,"sudah_hadir":9,"belum_hadir":2,"attendance_rate":0.8182}'::jsonb,
  'KPI dari jumlah tiket, order kedaluwarsa tidak masuk penyebut');
select is((public.export_presensi_page() ->> 'total')::int, 7, 'export presensi juga hanya peserta Paid');
reset role;

-- ---------------------------------------------------------------------------
-- OTS: semua tiket langsung hadir
-- ---------------------------------------------------------------------------
select is((public.save_ots_registration(
  'fb000000-0000-0000-0000-000000000001', null, 'Rombongan OTS', '0812', 'OTST', '392', 'S1', 'Solo',
  'Seminar Offline', 0, 'ots_tunai', 4, 100000
)->>'quantity')::int, 4, 'OTS 4 tiket dibuat');
select is(
  (select count(*)::int from public.attendance_events e join public.orders o using (order_id)
    where o.name = 'Rombongan OTS' and e.attendance_type = 'seminar'),
  4, 'OTS membuat 4 baris presensi');

select * from finish();
rollback;
