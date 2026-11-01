-- 0066 (A62): nama operator di Presensi + koreksi manual (tandai hadir / reset).
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 66, 'schema_version mencakup 0066');

-- ---------------------------------------------------------------------------
-- Fixture: role khusus Manual Check-in + Presensi (TANPA scan QR)
-- ---------------------------------------------------------------------------
insert into public.app_roles(id, name, is_system) values
  ('a62_koreksi', 'Koreksi Presensi A62', false)
on conflict (id) do nothing;

insert into public.app_role_permissions(role_id, permission_key) values
  ('a62_koreksi', 'action.manual_checkin'),
  ('a62_koreksi', 'operasional.presensi')
on conflict do nothing;

insert into public.users(id, username, display_name, password_hash, role, has_all_product_access) values
  ('a6200000-0000-0000-0000-000000000001', 'a62_koreksi', 'Operator A62', 'test', 'a62_koreksi', true),
  ('a6200000-0000-0000-0000-000000000002', 'a62_scan', 'Operator Scan', 'test', 'developer', true)
on conflict (id) do nothing;

insert into public.orders(order_id, name, event_type, app_status, quantity, created_at, paid_at) values
  ('a62-2',   'Dua Tiket',   'Seminar Offline', 'Paid',    2, now(), now()),
  ('a62-gap', 'Tiga Tiket',  'Seminar Offline', 'Paid',    3, now(), now()),
  ('a62-web', 'Webinar A62', 'Webinar Online',  'Paid',    2, now(), now());

insert into public.attendance_events(order_id, attendance_type, source, scanner_user_id, ticket_no) values
  ('a62-2',   'seminar', 'seminar_qr', 'a6200000-0000-0000-0000-000000000001', 1),
  ('a62-gap', 'seminar', 'seminar_qr', 'a6200000-0000-0000-0000-000000000002', 1),
  ('a62-gap', 'seminar', 'seminar_qr', 'a6200000-0000-0000-0000-000000000002', 3);

-- ---------------------------------------------------------------------------
-- Nama operator muncul di presensi_page (webinar tetap kosong)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6200000-0000-0000-0000-000000000001","app_role":"a62_koreksi"}';

select is(
  (public.presensi_page(p_search => 'a62-2') -> 'rows' -> 0 ->> 'checked_in_tickets')::int,
  1, 'a62-2: baru 1 dari 2 tiket hadir');
select is(
  (public.presensi_page(p_search => 'a62-2') -> 'rows' -> 0 ->> 'attendance_status'),
  'Hadir Sebagian', 'a62-2: status Hadir Sebagian');
select is(
  (public.presensi_page(p_search => 'a62-2') -> 'rows' -> 0 -> 'scanner_names' ->> 0),
  'Operator A62', 'a62-2: nama operator yang scan ikut terkirim');
select is(
  jsonb_array_length(public.presensi_page(p_search => 'a62-web') -> 'rows' -> 0 -> 'scanner_names'),
  0, 'webinar tidak punya operator scan');
select is(
  (public.presensi_page(p_search => 'a62-gap') -> 'rows' -> 0 -> 'scanner_names' ->> 0),
  'Operator Scan', 'a62-gap: operator scan berbeda tetap terbaca');

reset role;

-- ---------------------------------------------------------------------------
-- Koreksi: tandai hadir tanpa scan (cukup action.manual_checkin)
-- ---------------------------------------------------------------------------
select is(
  (public.checkin_seminar(
    'a62-2', 'seminar_manual', 'a6200000-0000-0000-0000-000000000001', null
  ) ->> 'tickets_confirmed')::int,
  1, 'koreksi manual menandai sisa 1 tiket hadir');
select is(
  (select array_agg(ticket_no order by ticket_no) from public.attendance_events where order_id = 'a62-2'),
  array[1, 2], 'a62-2: kedua tiket tercatat');
select is(
  (public.checkin_seminar(
    'a62-2', 'seminar_manual', 'a6200000-0000-0000-0000-000000000001', null
  ) ->> 'state'),
  'ALREADY_CHECKED_IN', 'semua tiket hadir -> ALREADY_CHECKED_IN');

select throws_ok(
  $$select public.checkin_seminar('a62-gap', 'seminar_qr', 'a6200000-0000-0000-0000-000000000001', 1)$$,
  'DF006', 'FORBIDDEN', 'tanpa operasional.scan_qr tetap tidak boleh memakai jalur QR');

-- ---------------------------------------------------------------------------
-- Nomor tiket kosong pertama (gap) setelah koreksi sebagian
-- ---------------------------------------------------------------------------
select is(
  (public.checkin_seminar(
    'a62-gap', 'seminar_manual', 'a6200000-0000-0000-0000-000000000001', null
  ) ->> 'tickets_confirmed')::int,
  1, 'a62-gap: sisa 1 tiket berhasil ditandai hadir');
select is(
  (select array_agg(ticket_no order by ticket_no) from public.attendance_events where order_id = 'a62-gap'),
  array[1, 2, 3], 'ticket_no 2 (slot kosong) dipakai, bukan bentrok dengan 3');

-- ---------------------------------------------------------------------------
-- Reset: sebagian dan seluruh order
-- ---------------------------------------------------------------------------
select is(
  (public.reset_presensi(
    'a6200000-0000-0000-0000-000000000001', 'a62-2', 1
  ) ->> 'removed_tickets')::int,
  1, 'reset 1 tiket menghapus satu baris presensi');
select is(
  (select count(*)::int from public.attendance_events where order_id = 'a62-2'),
  1, 'a62-2: sisa satu tiket hadir');
select is(
  (public.reset_presensi(
    'a6200000-0000-0000-0000-000000000001', 'a62-2', null
  ) ->> 'checked_in_tickets')::int,
  0, 'reset tanpa jumlah menghapus seluruh presensi order');
select is(
  (select count(*)::int from public.attendance_events where order_id = 'a62-2'),
  0, 'a62-2: tidak ada presensi tersisa');

select is(
  (public.reset_presensi(
    'a6200000-0000-0000-0000-000000000001', 'a62-gap', 9
  ) ->> 'removed_tickets')::int,
  3, 'jumlah melebihi presensi dipotong ke seluruh baris');

select throws_ok(
  $$select public.reset_presensi('a6200000-0000-0000-0000-000000000001', 'a62-web', null)$$,
  'DF003', 'NOT_SEMINAR_ORDER', 'webinar tidak dapat dikoreksi sebagai presensi seminar');
select throws_ok(
  $$select public.reset_presensi('a6200000-0000-0000-0000-000000000001', 'a62-2', 0)$$,
  'DF011', 'INVALID_ARGUMENT', 'jumlah reset 0 ditolak');

select * from finish();
rollback;
