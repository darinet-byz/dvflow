-- ============================================================================
-- 01_rls_and_grants — batas keamanan (04 §5, §15; L01–L04, L08; B02, B03)
-- ============================================================================
-- Dijalankan dengan `supabase test db`. Seluruh berkas berjalan di dalam satu
-- transaksi dan di-rollback, jadi tidak meninggalkan data.

begin;

-- pgtap sudah dipasang CLI di schema `extensions`; jangan dibuat di `public`
-- (lihat catatan platform di supabase/tests/README.md).
set local search_path = public, extensions, pg_catalog;

select no_plan();

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into public.users (id, username, display_name, password_hash, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin1', 'Admin Satu',
   extensions.crypt('rahasia123', extensions.gen_salt('bf', 4)), 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'staff1', 'Staff Satu',
   extensions.crypt('rahasia123', extensions.gen_salt('bf', 4)), 'staff');

insert into public.orders (order_id, name, app_status, gross_amount, event_type)
values ('900001', 'Peserta Satu', 'Paid', 300000, 'Seminar Offline');

insert into public.products (name, code) values ('Produk Uji', 'PROD');

-- ---------------------------------------------------------------------------
-- anon: tidak boleh menyentuh apa pun (L03)
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok('select 1 from public.orders limit 1',
  '42501', null, 'anon tidak dapat membaca orders');
select throws_ok('select 1 from public.attendance_events limit 1',
  '42501', null, 'anon tidak dapat membaca attendance_events');
select throws_ok('select 1 from public.users limit 1',
  '42501', null, 'anon tidak dapat membaca users');
select throws_ok('select 1 from public.app_settings limit 1',
  '42501', null, 'anon tidak dapat membaca app_settings');

reset role;

-- ---------------------------------------------------------------------------
-- authenticated TANPA claim app_user_id: tertutup, bukan terbuka
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{}';

select is((select count(*) from public.orders), 0::bigint,
  'authenticated tanpa JWT aplikasi melihat nol baris orders (bukan error, tapi kosong)');
select is((select count(*) from public.attendance_events), 0::bigint,
  'authenticated tanpa JWT aplikasi melihat nol baris attendance_events');

reset role;

-- ---------------------------------------------------------------------------
-- authenticated sebagai staff AKTIF
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","app_user_id":"22222222-2222-2222-2222-222222222222","app_role":"staff"}';

select is((select count(*) from public.orders where order_id = '900001'), 1::bigint,
  'staff dapat membaca orders');
select is((select count(*) from public.products where code = 'PROD'), 1::bigint,
  'staff dapat membaca konfigurasi produk (dibutuhkan generator/filter)');

-- L04 / 04 §6: kolom kredensial tidak dapat di-SELECT sama sekali.
select throws_ok('select password_hash from public.users',
  '42501', null, 'kolom password_hash tidak dapat dibaca authenticated');
select throws_ok('select password_algo from public.users',
  '42501', null, 'kolom password_algo tidak dapat dibaca authenticated');
select throws_ok('select token_hash from public.app_sessions',
  '42501', null, 'token_hash tidak dapat dibaca authenticated');

-- Hanya baris sendiri.
select is((select count(*) from public.users), 1::bigint,
  'users hanya mengembalikan baris milik pemanggil');

-- L08 / B02 / B03: staff ditolak SERVER-SIDE, bukan hanya tombol disembunyikan.
select throws_ok('update public.products set name = ''disunting'' where code = ''PROD''',
  '42501', null, 'staff tidak dapat mengubah konfigurasi produk');
select throws_ok('update public.payment_fee_rules set fee_value = 0 where true',
  '42501', null, 'staff tidak dapat mengubah konfigurasi tax');
select throws_ok('delete from public.products where code = ''PROD''',
  '42501', null, 'staff tidak dapat menghapus konfigurasi produk');
select throws_ok('insert into public.attendance_events (order_id, attendance_type, source) values (''900001'', ''seminar'', ''seminar_qr'')',
  '42501', null, 'browser tidak dapat menyisipkan presensi — check-in lewat backend');
select throws_ok('update public.orders set app_status = ''Paid'' where order_id = ''900001''',
  '42501', null, 'browser tidak dapat mengubah Master Order');

-- RPC tulis hanya untuk service_role.
--
-- Diperiksa lewat has_function_privilege, BUKAN dengan memanggil fungsinya:
-- pada image Supabase lokal (PostgreSQL 17.6) memanggil fungsi yang hak
-- EXECUTE-nya dicabut membuat backend SEGFAULT. Itu bug platform, bukan bug
-- skema — catatan lengkap di supabase/tests/README.md. has_function_privilege
-- menanyakan hak yang sama tanpa menjalankan fungsinya.
select is(has_function_privilege('authenticated', 'public.upsert_order_webhook(jsonb)', 'execute'),
  false, 'RPC upsert webhook tertutup untuk authenticated');
select is(has_function_privilege('anon', 'public.upsert_order_webhook(jsonb)', 'execute'),
  false, 'RPC upsert webhook tertutup untuk anon');
select is(has_function_privilege('authenticated', 'public.verify_login(text, text)', 'execute'),
  false, 'RPC verifikasi login tertutup untuk authenticated');
select is(has_function_privilege('authenticated', 'public.checkin_seminar(text, text, uuid)', 'execute'),
  false, 'RPC check-in tertutup untuk authenticated');
select is(has_function_privilege('authenticated',
    'public.admin_create_user(uuid, text, text, text, text, text, boolean)', 'execute'),
  false, 'RPC provisioning user tertutup untuk authenticated');
select is(has_function_privilege('authenticated', 'public.change_password(uuid, text, text, text)', 'execute'),
  false, 'RPC ganti password tertutup untuk authenticated');
select is(has_function_privilege('service_role', 'public.upsert_order_webhook(jsonb)', 'execute'),
  true, 'RPC tulis terbuka untuk service_role');

-- Positif: helper RLS dan RPC baca memang harus dapat dijalankan user aplikasi,
-- kalau tidak seluruh halaman mati.
select is(has_function_privilege('authenticated', 'public.app_role()', 'execute'),
  true, 'helper app_role dapat dijalankan authenticated (dipakai policy RLS)');
select is(has_function_privilege('authenticated', 'public.is_app_user()', 'execute'),
  true, 'helper is_app_user dapat dijalankan authenticated');
select is(has_function_privilege('authenticated',
    'public.presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer)',
    'execute'),
  true, 'RPC baca presensi terbuka untuk authenticated');
select is(has_function_privilege('anon', 'public.presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer)',
    'execute'),
  false, 'RPC baca presensi tertutup untuk anon');
select is(has_function_privilege('authenticated', 'public.set_updated_at()', 'execute'),
  false, 'fungsi trigger internal tidak dapat dijalankan authenticated');

reset role;

-- ---------------------------------------------------------------------------
-- service_role: backend boleh menulis
-- ---------------------------------------------------------------------------
set local role service_role;

select lives_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'orderId', '900002',
       'rawStatus', 'pending',
       'appStatus', 'Pending',
       'grossAmount', 10000
     ))$q$,
  'service_role dapat menjalankan RPC upsert webhook');

reset role;

-- ---------------------------------------------------------------------------
-- User nonaktif: walau tokennya sah, barisnya tidak terbaca (A04)
-- ---------------------------------------------------------------------------
update public.users set active = false where id = '22222222-2222-2222-2222-222222222222';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","app_user_id":"22222222-2222-2222-2222-222222222222","app_role":"staff"}';

select is((select count(*) from public.users), 0::bigint,
  'user nonaktif tidak dapat membaca barisnya sendiri');
select is((select count(*) from public.orders), 0::bigint,
  'user nonaktif tidak dapat membaca orders');

reset role;

select * from finish();
rollback;
