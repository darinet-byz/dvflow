-- ============================================================================
-- 03_seminar_checkin — idempotensi check-in seminar (G01–G06, H01–H05, H09, H10)
-- ============================================================================
-- Dasar idempotensinya adalah partial unique index
-- `attendance_events_seminar_unique (order_id) where attendance_type = 'seminar'`,
-- bukan pengecekan di UI. Karena itu dua scan nyaris bersamaan tetap aman
-- (M02) — mekanisme yang sama dengan yang diuji di sini lewat pengulangan.

begin;

-- pgtap sudah dipasang CLI di schema `extensions`; jangan dibuat di `public`
-- (lihat catatan platform di supabase/tests/README.md).
set local search_path = public, extensions, pg_catalog;

select no_plan();

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into public.users (id, username, display_name, password_hash, role) values
  ('33333333-3333-3333-3333-333333333333', 'operator1', 'Operator Satu',
   extensions.crypt('rahasia123', extensions.gen_salt('bf', 4)), 'staff');

insert into public.orders (order_id, name, app_status, event_type, gross_amount) values
  ('200001', 'Peserta Seminar', 'Paid',      'Seminar Offline', 100000),
  ('200002', 'Peserta Webinar', 'Paid',      'Webinar Online',  100000),
  ('200003', 'Peserta Pending', 'Pending',   'Seminar Offline', 100000),
  ('200004', 'Peserta Cancel',  'Cancelled', 'Seminar Offline', 100000);

-- ---------------------------------------------------------------------------
-- H01: scan pertama berhasil
-- ---------------------------------------------------------------------------
select is(
  (select public.checkin_seminar('200001', 'seminar_qr', '33333333-3333-3333-3333-333333333333') ->> 'state'),
  'CHECKIN_SUCCESS',
  'H01 scan pertama Paid Seminar berhasil');

select is((select count(*) from public.attendance_events where order_id = '200001'), 1::bigint,
  'H01 satu baris presensi dibuat');

select is(
  (select scanner_user_id from public.attendance_events where order_id = '200001'),
  '33333333-3333-3333-3333-333333333333'::uuid,
  'H10 scanner_user_id tercatat');

select is(
  (select source from public.attendance_events where order_id = '200001'),
  'seminar_qr',
  'H01 source = seminar_qr');

-- ---------------------------------------------------------------------------
-- H02 / I09: scan berulang -> ALREADY_CHECKED_IN, tidak ada baris baru,
-- timestamp yang dikembalikan identik
-- ---------------------------------------------------------------------------
do $$
declare
  v_first timestamptz;
  v_result jsonb;
  v_attempt integer;
begin
  select clicked_at into v_first from public.attendance_events where order_id = '200001';

  for v_attempt in 1..5 loop
    v_result := public.checkin_seminar('200001', 'seminar_qr', '33333333-3333-3333-3333-333333333333');

    if v_result ->> 'state' <> 'ALREADY_CHECKED_IN' then
      raise exception 'scan ke-% mengembalikan state=%', v_attempt, v_result ->> 'state';
    end if;
    if (v_result ->> 'clicked_at')::timestamptz is distinct from v_first then
      raise exception 'scan ke-% mengembalikan timestamp yang berbeda', v_attempt;
    end if;
  end loop;
end
$$;

select is((select count(*) from public.attendance_events where order_id = '200001'), 1::bigint,
  'H02 lima scan berulang tetap satu baris presensi');
select pass('H02 timestamp check-in pertama yang dikembalikan pada scan berulang');

-- Check-in manual pada order yang sudah check-in tetap ALREADY_CHECKED_IN
-- (satu Order ID = satu presensi seminar, apa pun sumbernya).
select is(
  (select public.checkin_seminar('200001', 'seminar_manual', '33333333-3333-3333-3333-333333333333') ->> 'state'),
  'ALREADY_CHECKED_IN',
  'H02 check-in manual tidak membuat presensi seminar kedua');

-- H09: manual memakai validasi yang sama, tidak ada bypass Paid.
select throws_ok(
  $q$select public.checkin_seminar('200003', 'seminar_manual', '33333333-3333-3333-3333-333333333333')$q$,
  'DF002', 'ORDER_NOT_PAID', 'H09 check-in manual tidak mem-bypass aturan Paid');

-- ---------------------------------------------------------------------------
-- H03 / H04 / H05
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$select public.checkin_seminar('200002', 'seminar_qr', '33333333-3333-3333-3333-333333333333')$q$,
  'DF003', 'NOT_SEMINAR_ORDER', 'H03 order webinar ditolak scanner seminar');

select throws_ok(
  $q$select public.checkin_seminar('200003', 'seminar_qr', '33333333-3333-3333-3333-333333333333')$q$,
  'DF002', 'ORDER_NOT_PAID', 'H04 order Pending ditolak');

select throws_ok(
  $q$select public.checkin_seminar('200004', 'seminar_qr', '33333333-3333-3333-3333-333333333333')$q$,
  'DF002', 'ORDER_NOT_PAID', 'G05 order Cancelled ditolak');

select throws_ok(
  $q$select public.checkin_seminar('999999', 'seminar_qr', '33333333-3333-3333-3333-333333333333')$q$,
  'DF001', 'ORDER_NOT_FOUND', 'H05 order tidak dikenal ditolak (QR palsu tidak mengotorisasi)');

select throws_ok(
  $q$select public.checkin_seminar('200002', 'seminar_qr', '33333333-3333-3333-3333-333333333333')$q$,
  'DF003', 'NOT_SEMINAR_ORDER', 'H03 event_type dari data, bukan dari QR');

-- source di luar daftar ditolak
select throws_ok(
  $q$select public.checkin_seminar('200001', 'webinar_redirect', '33333333-3333-3333-3333-333333333333')$q$,
  'DF011', 'INVALID_ARGUMENT', 'source di luar daftar ditolak');

-- ---------------------------------------------------------------------------
-- Order dengan parse invalid (event_type NULL) tidak dapat check-in.
-- ---------------------------------------------------------------------------
insert into public.orders (order_id, name, app_status, product_parse_status, gross_amount)
values ('200005', 'Parse Invalid', 'Paid', 'invalid', 100000);

select throws_ok(
  $q$select public.checkin_seminar('200005', 'seminar_qr', '33333333-3333-3333-3333-333333333333')$q$,
  'DF003', 'NOT_SEMINAR_ORDER', 'order tanpa event_type tidak dapat check-in');

-- ---------------------------------------------------------------------------
-- Webinar TIDAK idempoten per order: setiap klik adalah baris baru (PRD/§13).
-- Semangat yang sama harus berlaku saat P5 menulis jalur webinar.
-- ---------------------------------------------------------------------------
insert into public.attendance_events (order_id, attendance_type, source)
values ('200002', 'webinar', 'webinar_redirect'),
       ('200002', 'webinar', 'webinar_redirect'),
       ('200002', 'webinar', 'webinar_redirect');

select is((select count(*) from public.attendance_events where order_id = '200002'), 3::bigint,
  'presensi webinar tidak unik — setiap klik dicatat');

-- ---------------------------------------------------------------------------
-- Retensi 30 hari hanya menghapus attendance; Master Order tetap ada (I07, I08).
-- ---------------------------------------------------------------------------
update public.attendance_events set clicked_at = now() - interval '31 days'
 where order_id = '200002';

delete from public.attendance_events where clicked_at < now() - interval '30 days';

select is((select count(*) from public.attendance_events where order_id = '200002'), 0::bigint,
  'I07 attendance lebih dari 30 hari terhapus');
select is((select count(*) from public.orders where order_id = '200002'), 1::bigint,
  'I08 Master Order tetap ada setelah attendance dihapus');

-- FK RESTRICT: Master Order yang punya presensi tidak dapat dihapus diam-diam.
select throws_ok('delete from public.orders where order_id = ''200001''',
  '23503', null, 'Master Order yang punya presensi tidak dapat dihapus (ON DELETE RESTRICT)');

-- ---------------------------------------------------------------------------
-- Presensi seminar hanya boleh satu baris walau event webhook masuk bersamaan
-- dengan check-in: dibuktikan lewat index uniknya.
-- ---------------------------------------------------------------------------
select has_index('public', 'attendance_events', 'attendance_events_seminar_unique',
  'index unik seminar ada');

-- ---------------------------------------------------------------------------
-- Job retensi benar-benar terjadwal (0018, 06 §8).
--
-- Berkas ini memerlukan pg_cron, dan itu memang disengaja: retensi harian adalah
-- syarat operasional (PRD §106, 01 §19), bukan pelengkap. 0018 sengaja tetap
-- berhasil di environment tanpa pg_cron (dengan memberi peringatan) supaya
-- migrasi tidak pernah gagal karena hal di luar kendali; tetapi test ini
-- memeriksa hasil akhirnya, jadi kegagalannya justru informasi yang benar.
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) = 2 from cron.job
    where jobname in ('dvflow_attendance_retention', 'dvflow_webhook_logs_retention')),
  'kedua job retensi terjadwal di pg_cron');

select ok(
  (select command like '%interval ''30 days''%' from cron.job where jobname = 'dvflow_attendance_retention'),
  'job attendance memakai retensi 30 hari');

select ok(
  (select command like '%interval ''7 days''%' from cron.job where jobname = 'dvflow_webhook_logs_retention'),
  'job webhook_logs memakai retensi 7 hari');

-- Job retensi hanya boleh menyentuh presensi & log — tidak pernah Master Order (I08).
select ok(
  (select bool_and(command not like '%public.orders%') from cron.job where jobname like 'dvflow_%'),
  'job retensi tidak menghapus Master Order');

select * from finish();
rollback;
