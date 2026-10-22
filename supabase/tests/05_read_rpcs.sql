-- ============================================================================
-- 05_read_rpcs — KPI, filter, sort, dan pagination (I01–I09, J01–J10, B04)
-- ============================================================================
-- Uji terpenting di berkas ini: `dashboard_summary`, `presensi_page`, dan
-- `tax_report` memakai SATU definisi filter yang sama (PRD §41). Ketiganya
-- harus menghasilkan angka yang konsisten pada filter yang sama — kalau
-- predikatnya menyimpang, test ini gagal.

begin;

-- pgtap sudah dipasang CLI di schema `extensions`; jangan dibuat di `public`
-- (lihat catatan platform di supabase/tests/README.md).
set local search_path = public, extensions, pg_catalog;

select no_plan();
-- RPCs now resolve a real active actor, not a role-only claim.
insert into public.users(id,username,display_name,password_hash,role) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','rpcadmin','RPC admin','test','admin'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','rpcstaff','RPC staff','test','member'),
 ('cccccccc-cccc-cccc-cccc-cccccccccccc','rpcmaster','RPC master','test','owner');
insert into public.app_role_permissions(role_id,permission_key) values ('admin','config.report_tax') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","app_role":"admin"}';

-- ---------------------------------------------------------------------------
-- Fixture: 4 order berbeda status + presensi
-- ---------------------------------------------------------------------------
-- 400003/400004 sengaja diberi created_at lebih tua: keduanya belum pernah
-- hadir, sehingga default sort "aktivitas terbaru, fallback created_at"
-- menempatkan aktivitas 400002 di depan tanpa seri.
insert into public.orders
  (order_id, name, phone, product_code, product_name, advertiser_code, advertiser_name,
   event_type, batch, session, city, app_status, gross_amount, tax_amount, net_amount, created_at)
values
  ('400001', 'Ahmad',  '+628111', 'KM', 'Kuliner Masteri', '01', 'Zul',
   'Seminar Offline', '392', 'S1', 'Solo',   'Paid',      300000, 4000, 296000, now()),
  ('400002', 'Bella',  '+628222', 'KM', 'Kuliner Masteri', '01', 'Zul',
   'Webinar Online',  '392', 'S1', 'Solo',   'Paid',      300000, 2100, 297900, now()),
  ('400003', 'Candra', '+628333', 'BM', 'Bisnis Masteri',  '02', 'Rahman',
   'Seminar Offline', '001', 'ST', 'Bandung','Pending',   100000, 0,    100000, now() - interval '2 days'),
  ('400004', 'Dewi',   '+628444', 'BM', 'Bisnis Masteri',  '02', 'Rahman',
   'Seminar Offline', '001', 'ST', 'Bandung','Cancelled', 100000, 0,    100000, now() - interval '2 days');

insert into public.attendance_events (order_id, attendance_type, source, clicked_at) values
  ('400001', 'seminar', 'seminar_qr', now() - interval '2 hours'),
  ('400002', 'webinar', 'webinar_redirect', now() - interval '1 hour'),
  ('400002', 'webinar', 'webinar_redirect', now());

-- ---------------------------------------------------------------------------
-- I02–I05: status presensi dihitung dari data, bukan disimpan
-- ---------------------------------------------------------------------------
select is(
  (select public.presensi_page() -> 'rows' -> 0 ->> 'order_id'), '400002',
  'default sort = aktivitas terbaru (400002 punya klik terbaru)');

select is(
  (select r ->> 'attendance_status'
     from jsonb_array_elements(public.presensi_page() -> 'rows') r
    where r ->> 'order_id' = '400001'),
  'Hadir', 'I03 Paid + presensi -> Hadir');

select is(
  (select r ->> 'attendance_status'
     from jsonb_array_elements(public.presensi_page() -> 'rows') r
    where r ->> 'order_id' = '400003'),
  'Pending', 'I04 Pending bukan Belum Hadir');

select is(
  (select r ->> 'attendance_status'
     from jsonb_array_elements(public.presensi_page() -> 'rows') r
    where r ->> 'order_id' = '400004'),
  'Cancelled', 'order Cancelled punya label sendiri');

select is(
  (select r ->> 'total_activity'
     from jsonb_array_elements(public.presensi_page() -> 'rows') r
    where r ->> 'order_id' = '400002'),
  '2', 'I05 Total Activity = jumlah seluruh baris presensi');

-- I05/I06 dengan 17 aktivitas diuji di akhir berkas memakai order terpisah,
-- supaya tidak menggeser angka KPI di bawah.

-- ---------------------------------------------------------------------------
-- I01: seminar dan webinar tampil di tabel yang sama
-- ---------------------------------------------------------------------------
select is((select public.presensi_page() ->> 'total')::int, 4,
  'I01 tanpa filter, seluruh order tampil di satu tabel presensi');

-- ---------------------------------------------------------------------------
-- J04: filter gabungan memakai semantik AND
-- ---------------------------------------------------------------------------
select is((select (public.presensi_page(
    p_product_code => 'KM', p_attendance_status => 'Hadir') ->> 'total')::int), 2,
  'J04 produk KM + Hadir');

select is((select (public.presensi_page(
    p_product_code => 'KM', p_attendance_status => 'Hadir', p_city => 'Bandung') ->> 'total')::int), 0,
  'J04 menambah filter yang tidak cocok menghasilkan nol (AND, bukan OR)');

select is((select (public.presensi_page(p_attendance_status => 'Hadir') ->> 'total')::int), 2,
  'filter Hadir/Belum Hadir bekerja setelah status dihitung');

select is((select (public.presensi_page(p_event_type => 'Seminar Offline') ->> 'total')::int), 3,
  'filter Seminar/Webinar bekerja');

select is((select (public.presensi_page(p_search => 'Bella') ->> 'total')::int), 1,
  'J08 pencarian nama');

select is((select (public.presensi_page(p_search => '628333') ->> 'total')::int), 1,
  'J08 pencarian nomor WA');

select is((select (public.presensi_page(p_search => '400004') ->> 'total')::int), 1,
  'J08 pencarian Order ID');

select is((select (public.presensi_page(p_search => '%') ->> 'total')::int), 0,
  'L06 wildcard `%` diperlakukan sebagai teks biasa, bukan "tampilkan semua"');

select is((select (public.presensi_page(p_search => '_') ->> 'total')::int), 0,
  'L06 wildcard `_` diperlakukan sebagai teks biasa');

select is((select (public.presensi_page(p_search => ''' or 1=1 --') ->> 'total')::int), 0,
  'L06 teks mirip injeksi SQL diperlakukan sebagai data dan tidak mencocokkan apa pun');

-- ---------------------------------------------------------------------------
-- J01 / J02: ukuran halaman hanya 50 atau 100
-- ---------------------------------------------------------------------------
select is((select (public.presensi_page(p_page_size => 100) ->> 'page_size')::int), 100,
  'J02 ukuran halaman 100 diterima');
select throws_ok('select public.presensi_page(p_page_size => 20)',
  'DF011', 'INVALID_PAGE_SIZE', 'ukuran halaman di luar 50/100 ditolak');
select throws_ok('select public.presensi_page(p_page => 0)',
  'DF011', 'INVALID_PAGE', 'nomor halaman 0 ditolak');

-- ---------------------------------------------------------------------------
-- J09: sort hanya untuk kolom yang diizinkan
-- ---------------------------------------------------------------------------
select is((select public.presensi_page(p_sort => 'order_id', p_sort_dir => 'asc') -> 'rows' -> 0 ->> 'order_id'),
  '400001', 'J09 sort order_id asc');
select is((select public.presensi_page(p_sort => 'order_id', p_sort_dir => 'desc') -> 'rows' -> 0 ->> 'order_id'),
  '400004', 'J09 sort order_id desc');
select is((select public.presensi_page(p_sort => 'city', p_sort_dir => 'asc') -> 'rows' -> 0 ->> 'city'),
  'Bandung', 'J09 sort city asc');

select throws_ok('select public.presensi_page(p_sort => ''created_at'')',
  'DF011', 'INVALID_SORT', 'kolom database mentah tidak dapat dipakai sebagai sort');
select throws_ok('select public.presensi_page(p_sort => ''name; drop table orders'')',
  'DF011', 'INVALID_SORT', 'sort tidak dapat disuntik SQL');
select throws_ok('select public.presensi_page(p_sort_dir => ''asc; drop table orders'')',
  'DF011', 'INVALID_SORT_DIRECTION', 'arah sort tidak dapat disuntik SQL');
select throws_ok('select public.presensi_page(p_attendance_status => ''Alpa'')',
  'DF011', 'INVALID_ATTENDANCE_STATUS', 'status presensi di luar daftar ditolak');

-- ---------------------------------------------------------------------------
-- PRD §41: seluruh KPI memakai SATU set filter yang sama
-- ---------------------------------------------------------------------------
select is(
  (select (public.dashboard_summary() ->> 'leads')::int),
  (select (public.presensi_page(p_page_size => 100) ->> 'total')::int),
  'paritas filter: Leads = total baris presensi tanpa filter');

select is(
  (select (public.dashboard_summary(p_product_code => 'KM') ->> 'leads')::int),
  (select (public.presensi_page(p_product_code => 'KM', p_page_size => 100) ->> 'total')::int),
  'paritas filter: Leads = total baris presensi dengan filter produk');

select is(
  (select (public.dashboard_summary(p_date_from => current_date) ->> 'leads')::int),
  (select (public.presensi_page(p_date_from => current_date, p_page_size => 100) ->> 'total')::int),
  'paritas filter: filter tanggal juga identik');

-- ---------------------------------------------------------------------------
-- KPI (PRD §40, K4)
-- ---------------------------------------------------------------------------
select is((select (public.dashboard_summary() ->> 'leads')::int), 4, 'KPI Leads');
select is((select (public.dashboard_summary() ->> 'paid')::int), 2, 'KPI Paid');
select is((select (public.dashboard_summary() ->> 'pending')::int), 1, 'KPI Pending');
select is((select (public.dashboard_summary() ->> 'conversion_rate')::numeric), 0.5,
  'K4 Conversion Rate = Paid / Leads');
-- A15: nominal uang hanya dari order Paid (400001 + 400002); leads tetap semua status.
select is((select (public.dashboard_summary() ->> 'gross_amount')::numeric), 600000.00,
  'KPI Gross = jumlah order Paid yang lolos filter');
select is((select (public.dashboard_summary() ->> 'tax_amount')::numeric), 6100.00, 'KPI Tax');
select is((select (public.dashboard_summary() ->> 'net_amount')::numeric), 593900.00, 'KPI Net (Paid)');
select is((select (public.dashboard_summary() ->> 'sudah_hadir')::int), 2, 'KPI Sudah Hadir');
select is((select (public.dashboard_summary() ->> 'belum_hadir')::int), 0, 'KPI Belum Hadir');
select is((select (public.dashboard_summary() ->> 'attendance_rate')::numeric), 1.0,
  'K4 Attendance Rate = Sudah Hadir / Paid');

-- Penyebut nol -> NULL, bukan 0 (membedakan "belum ada data" dari "nol persen")
select is((select public.dashboard_summary(p_city => 'Tidak Ada') ->> 'conversion_rate'),
  null::text, 'Conversion Rate NULL saat belum ada lead');
select is((select public.dashboard_summary(p_city => 'Tidak Ada') ->> 'attendance_rate'),
  null::text, 'Attendance Rate NULL saat belum ada Paid');

-- ---------------------------------------------------------------------------
-- B04: staff ditolak Report Tax; admin boleh (01 §5, 04 §1)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","app_role":"member"}';

select throws_ok('select public.tax_report(''payment_method'')',
  'DF006', 'FORBIDDEN', 'B04 staff ditolak Report Tax (server-side)');

set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","app_role":"admin"}';

select lives_ok('select public.tax_report(''payment_method'')',
  'B05 admin dapat membuka Report Tax');

set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","app_role":"owner"}';

select lives_ok('select public.tax_report(''city'')',
  'owner dapat membuka Report Tax');

-- Tujuh dimensi breakdown (PRD §85)
select lives_ok('select public.tax_report(''payment_method'')', 'dimensi payment_method');
select lives_ok('select public.tax_report(''product'')', 'dimensi product');
select lives_ok('select public.tax_report(''batch'')', 'dimensi batch');
select lives_ok('select public.tax_report(''advertiser'')', 'dimensi advertiser');
select lives_ok('select public.tax_report(''date'')', 'dimensi date');
select lives_ok('select public.tax_report(''city'')', 'dimensi city');
select lives_ok('select public.tax_report(''event_type'')', 'dimensi event_type');

select throws_ok('select public.tax_report(''gross_amount'')',
  'DF011', 'INVALID_DIMENSION', 'dimensi di luar daftar ditolak');

-- Summary Report Tax hanya menghitung order Paid (Report Tax adalah laporan transaksi).
select is((select (public.tax_report('city') -> 'summary' ->> 'transactions')::int), 2,
  'Report Tax: hanya transaksi Paid');
select is((select (public.tax_report('city') -> 'summary' ->> 'tax_amount')::numeric), 6100.00,
  'Report Tax: total tax mengikuti filter');

-- ---------------------------------------------------------------------------
-- RPC baca tidak dapat dieksekusi anon
-- ---------------------------------------------------------------------------
-- Lewat has_function_privilege, bukan dengan memanggil: memanggil fungsi yang
-- EXECUTE-nya dicabut membuat backend segfault pada image Supabase lokal
-- (lihat supabase/tests/README.md).
reset role;

select is(has_function_privilege('anon', 'public.dashboard_summary(text, date, date, text, text, text, text, text, text)', 'execute'),
  false, 'anon tidak dapat memanggil dashboard_summary');
select is(has_function_privilege('anon', 'public.tax_report(text, text, date, date, text, text, text, text, text, text)', 'execute'),
  false, 'anon tidak dapat memanggil tax_report');
select is(has_function_privilege('anon', 'public.app_role()', 'execute'),
  false, 'anon tidak dapat memanggil helper app_role');

-- ---------------------------------------------------------------------------
-- I05 / I06: 17 aktivitas -> Total Activity 17, tetapi hanya 10 timestamp
-- terbaru yang dikirim ke UI. Order terpisah supaya angka KPI di atas tidak
-- ikut berubah.
-- ---------------------------------------------------------------------------
insert into public.orders (order_id, name, app_status, event_type, gross_amount)
values ('400005', 'Erik', 'Paid', 'Webinar Online', 50000);

insert into public.attendance_events (order_id, attendance_type, source, clicked_at)
select '400005', 'webinar', 'webinar_redirect', now() - (n || ' minutes')::interval
  from generate_series(0, 16) n;

select is(
  (select r ->> 'total_activity'
     from jsonb_array_elements(public.presensi_page(p_search => '400005') -> 'rows') r),
  '17', 'I05 17 aktivitas -> Total Activity 17');

select is(
  (select jsonb_array_length(r -> 'timestamps')
     from jsonb_array_elements(public.presensi_page(p_search => '400005') -> 'rows') r),
  10, 'I06 hanya 10 timestamp terbaru yang dikirim ke UI (database tetap row-based)');

select is(
  (select r ->> 'attendance_status'
     from jsonb_array_elements(public.presensi_page(p_search => '400005') -> 'rows') r),
  'Hadir', 'I03 Paid + presensi -> Hadir');

select * from finish();
rollback;
