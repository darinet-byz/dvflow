-- ============================================================================
-- 06_orders_page — RPC baca tabel Master Order (PRD §44–§47, 01 §6–§7, §15)
-- ============================================================================
-- Uji terpenting di berkas ini: `orders_page` dan `dashboard_summary` memakai
-- SATU definisi filter (PRD §41). Keduanya harus menghasilkan angka yang sama
-- pada filter yang sama — kalau predikatnya menyimpang, test ini gagal.

begin;

set local search_path = public, extensions, pg_catalog;

select no_plan();

-- ---------------------------------------------------------------------------
-- Fixture: 5 order berbeda status, produk, batch, kota, dan payment method
--
-- Waktu sengaja dihitung dari AWAL HARI, bukan dari `now()` dikurangi jam.
-- `now() - interval '1 hour'` bisa jatuh ke hari sebelumnya bila test dijalankan
-- dekat tengah malam UTC, sehingga asersi "hari ini" menjadi gagal-hidup-hidup
-- (flaky). Dengan `date_trunc('day', now())` hasilnya sama kapan pun dijalankan.
-- ---------------------------------------------------------------------------
insert into public.orders
  (order_id, name, phone, product_code, product_name, advertiser_code, advertiser_name,
   event_type, batch, session, city, app_status, payment_method,
   gross_amount, tax_amount, net_amount, created_at, paid_at)
values
  ('500001', 'Ahmad',  '+628111', 'KM', 'Kuliner Masteri', '01', 'Zul',
   'Seminar Offline', '392', 'S1', 'Solo',    'Paid',      'bank_transfer', 300000, 4000, 296000,
   date_trunc('day', now()) - interval '3 days', date_trunc('day', now()) - interval '3 days'),
  ('500002', 'Bella',  '+628222', 'KM', 'Kuliner Masteri', '01', 'Zul',
   'Webinar Online',  '392', 'S1', 'Solo',    'Paid',      'QRIS',          300000, 2100, 297900,
   date_trunc('day', now()) - interval '2 days', date_trunc('day', now()) - interval '2 days'),
  ('500003', 'Candra', '+628333', 'BM', 'Bisnis Masteri',  '02', 'Rahman',
   'Seminar Offline', '001', 'ST', 'Bandung', 'Pending',   'bank_transfer', 100000, 0,    100000,
   date_trunc('day', now()) - interval '1 day', null),
  ('500004', 'Dewi',   '+628444', 'BM', 'Bisnis Masteri',  '02', 'Rahman',
   'Seminar Offline', '001', 'ST', 'Bandung', 'Cancelled', 'bank_transfer', 100000, 0,    100000,
   date_trunc('day', now()) + interval '1 minute', null),
  ('500005', 'Erik',   '+628555', 'KM', 'Kuliner Masteri', '02', 'Rahman',
   'Webinar Online',  '392', 'ST', 'Jakarta', 'Paid',      'qris',          50000,  350,  49650,
   date_trunc('day', now()) + interval '2 minutes', date_trunc('day', now()) + interval '2 minutes');

-- ---------------------------------------------------------------------------
-- Bentuk hasil
-- ---------------------------------------------------------------------------
select is(jsonb_typeof(public.orders_page() -> 'rows'), 'array', 'rows berupa array');
select is((public.orders_page() -> 'total')::int, 5, 'total = 5');
select is(
  (public.orders_page() -> 'summary' ->> 'total')::int, 5,
  'ringkasan total mengikuti filter');
select is((public.orders_page() -> 'summary' ->> 'paid')::int, 3, 'ringkasan paid = 3');
select is((public.orders_page() -> 'summary' ->> 'pending')::int, 1, 'ringkasan pending = 1');

-- ---------------------------------------------------------------------------
-- Sort: default created_at DESC, dan hanya kolom 01 §6 yang diizinkan
-- ---------------------------------------------------------------------------
select is((public.orders_page() -> 'rows' -> 0 ->> 'order_id'), '500005',
  'default sort = created_at DESC');
select is((public.orders_page(p_sort => 'order_id', p_sort_dir => 'asc') -> 'rows' -> 0 ->> 'order_id'), '500001',
  'sort order_id asc');
select is((public.orders_page(p_sort => 'gross_amount', p_sort_dir => 'desc') -> 'rows' -> 0 ->> 'order_id'), '500001',
  'sort gross_amount desc');
select is((public.orders_page(p_sort => 'paid_at', p_sort_dir => 'asc') -> 'rows' -> 0 ->> 'order_id'), '500001',
  'sort paid_at asc (null terakhir)');

select throws_ok('select public.orders_page(p_sort => ''id'')',
  'DF011', 'INVALID_SORT', 'kolom di luar whitelist ditolak');
select throws_ok('select public.orders_page(p_sort => ''order_id; drop table orders'')',
  'DF011', 'INVALID_SORT', 'sort tidak dapat disuntik SQL');
select throws_ok('select public.orders_page(p_sort_dir => ''desc; drop table orders'')',
  'DF011', 'INVALID_SORT_DIRECTION', 'arah sort tidak dapat disuntik SQL');
select throws_ok('select public.orders_page(p_page_size => 20)',
  'DF011', 'INVALID_PAGE_SIZE', 'ukuran halaman hanya 50/100');
select throws_ok('select public.orders_page(p_page => 0)',
  'DF011', 'INVALID_PAGE', 'nomor halaman 0 ditolak');
select throws_ok('select public.orders_page(p_app_status => ''Refunded'')',
  'DF011', 'INVALID_APP_STATUS', 'status di luar daftar ditolak');

-- ---------------------------------------------------------------------------
-- Pagination
-- ---------------------------------------------------------------------------
select is(jsonb_array_length(public.orders_page(p_page_size => 50) -> 'rows'), 5, 'halaman 1 memuat seluruh baris');
select is(jsonb_array_length(public.orders_page(p_page_size => 50, p_page => 2) -> 'rows'), 0, 'halaman 2 kosong');

insert into public.orders (order_id, app_status, gross_amount, created_at)
select '59' || lpad(n::text, 4, '0'), 'Pending', 1000, now()
  from generate_series(1, 55) n;

select is(jsonb_array_length(public.orders_page() -> 'rows'), 50, 'J01 default 50 baris per halaman');
select is((public.orders_page() -> 'total')::int, 60, 'total tetap menghitung seluruh baris');
select is(jsonb_array_length(public.orders_page(p_page => 2) -> 'rows'), 10, 'halaman terakhir memuat sisanya');
select is(jsonb_array_length(public.orders_page(p_page_size => 100) -> 'rows'), 60, 'J02 ukuran 100 diterima');

delete from public.orders where order_id like '59%';

-- ---------------------------------------------------------------------------
-- Filter
-- ---------------------------------------------------------------------------
select is((public.orders_page(p_product_code => 'KM') -> 'total')::int, 3, 'filter produk');
select is((public.orders_page(p_app_status => 'Paid') -> 'total')::int, 3, 'filter status');
select is((public.orders_page(p_city => 'Solo') -> 'total')::int, 2, 'filter kota');
select is((public.orders_page(p_batch => '001') -> 'total')::int, 2, 'filter batch');
select is((public.orders_page(p_event_type => 'Webinar Online') -> 'total')::int, 2, 'filter seminar/webinar');
select is((public.orders_page(p_advertiser_code => '01') -> 'total')::int, 2, 'filter pengiklan');

-- Dua filter digabung memakai AND, bukan OR.
select is((public.orders_page(p_product_code => 'KM', p_city => 'Jakarta') -> 'total')::int, 1,
  'filter gabungan memakai AND');
select is((public.orders_page(p_product_code => 'KM', p_city => 'Bandung') -> 'total')::int, 0,
  'kombinasi yang tidak cocok menghasilkan nol');

-- Payment method: sama persis, hanya mengabaikan besar/kecil huruf dan spasi tepi.
-- Fixture memang memuat 'QRIS' dan 'qris' sebagai dua nilai berbeda di database;
-- keduanya cocok dengan satu istilah karena perbandingannya case-insensitive.
select is((public.orders_page(p_payment_method => 'QRIS') -> 'total')::int, 2,
  'payment method cocok tanpa peduli besar/kecil huruf');
select is((public.orders_page(p_payment_method => ' qris ') -> 'total')::int, 2,
  'spasi tepi diabaikan');
select is((public.orders_page(p_payment_method => 'bank') -> 'total')::int, 0,
  'TIDAK ada pencocokan mendekati untuk payment method');
select is((public.orders_page(p_payment_method => 'bank_transfer') -> 'total')::int, 3,
  'payment method persis');

-- Pencarian
select is((public.orders_page(p_search => 'Ahmad') -> 'total')::int, 1, 'J08 cari nama');
select is((public.orders_page(p_search => '628444') -> 'total')::int, 1, 'J08 cari nomor WA');
select is((public.orders_page(p_search => '500002') -> 'total')::int, 1, 'J08 cari Order ID');
select is((public.orders_page(p_search => '392') -> 'total')::int, 3, 'cari batch dari kotak pencarian');
select is((public.orders_page(p_search => '%%') -> 'total')::int, 0,
  'L06 wildcard diperlakukan sebagai teks biasa, bukan "tampilkan semua"');
-- Dollar-quoting dipakai supaya teks yang berisi kutip tunggal tidak perlu
-- di-escape; `''` di awal literal akan dibaca sebagai string kosong, bukan
-- sebagai kutip ter-escape.
select is((public.orders_page(p_search => $s$' or 1=1 --$s$) -> 'total')::int, 0,
  'L06 teks mirip injeksi diperlakukan sebagai data');

-- Tanggal
select is((public.orders_page(p_date_from => current_date) -> 'total')::int, 2, 'filter tanggal dari');
select is((public.orders_page(p_date_to => current_date - 2) -> 'total')::int, 2, 'filter tanggal sampai');

-- ---------------------------------------------------------------------------
-- PRD §41: seluruh angka memakai SATU set filter yang sama
-- ---------------------------------------------------------------------------
select is(
  (public.orders_page(p_product_code => 'KM') -> 'summary' ->> 'total')::int,
  (public.dashboard_summary(p_product_code => 'KM') ->> 'leads')::int,
  'paritas filter: total Order = Leads Dashboard (filter produk)');

select is(
  (public.orders_page(p_city => 'Solo') -> 'summary' ->> 'paid')::int,
  (public.dashboard_summary(p_city => 'Solo') ->> 'paid')::int,
  'paritas filter: Paid Order = Paid Dashboard (filter kota)');

select is(
  (public.orders_page(p_date_from => current_date - 5) -> 'total')::int,
  (public.dashboard_summary(p_date_from => current_date - 5) ->> 'leads')::int,
  'paritas filter: filter tanggal juga identik');

-- ---------------------------------------------------------------------------
-- Ringkasan mengikuti filter aktif, termasuk filter status
-- ---------------------------------------------------------------------------
select is((public.orders_page(p_app_status => 'Paid') -> 'summary' ->> 'paid')::int, 3,
  'ringkasan Paid ikut filter status');
select is((public.orders_page(p_app_status => 'Paid') -> 'summary' ->> 'pending')::int, 0,
  'ringkasan Pending nol ketika filter status = Paid');

-- ---------------------------------------------------------------------------
-- Kolom yang dibutuhkan tabel + drawer tersedia
-- ---------------------------------------------------------------------------
select ok(
  (public.orders_page() -> 'rows' -> 0) ?& array[
    'order_id','name','phone','email','product_code','product_name','advertiser_name',
    'event_type','batch','session','city','app_status','payment_method','payment_provider',
    'gross_amount','tax_amount','net_amount','created_at','paid_at','updated_at',
    'raw_status','product_parse_status','payment_identifier','tax_mapping_status',
    'fee_rule_name_snapshot','fee_type_snapshot','fee_value_snapshot'
  ],
  'baris memuat seluruh kolom Master Order (PRD §45) + data snapshot untuk drawer');

select * from finish();
rollback;
