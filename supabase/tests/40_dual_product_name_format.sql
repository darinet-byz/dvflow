-- A75: dua format nama produk sama-sama sah.
-- Order berbasis nama (5 segmen) tetap dikenali guard hapus konfigurasi dan
-- key Zoom/tiket, dan nama produk wajib unik + tanpa pemisah segmen.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 77, 'schema_version mencakup 77');

-- ---------------------------------------------------------------------------
-- Normalisasi nama produk
-- ---------------------------------------------------------------------------
select is(public.normalize_product_name('  Master   Tiktok  Indonesia '),
  'MASTER TIKTOK INDONESIA', 'nama produk: trim + rapatkan spasi + uppercase');

insert into public.products(id,name,code,active) values
  ('fd000000-0000-0000-0000-000000000001','Master Tiktok A75','MTIA',true);
insert into public.advertisers(id,name,code,active) values
  ('fd000000-0000-0000-0000-000000000002','Pengiklan A75','88',true);
insert into public.event_types(id,name,code,kind,active) values
  ('fd000000-0000-0000-0000-000000000003','Kelas A75','ZZ','seminar',true);

-- ---------------------------------------------------------------------------
-- Pengenalan format berbasis nama produk
-- ---------------------------------------------------------------------------
select is((select product_code from public.master_detailed_parts('88 - ZZ60 - Master Tiktok A75 - S1 - Tegal')),
  'MTIA', 'bagian kode format nama dikenali');
select is((select advertiser_code from public.master_detailed_parts('88 - ZZ60 - Master Tiktok A75 - S1 - Tegal')),
  '88', 'pengiklan format nama dikenali');
select is((select type_code from public.master_detailed_parts('88 - ZZ60 - Master Tiktok A75 - S1 - Tegal')),
  'ZZ', 'tipe kelas format nama dikenali');
select is((select session_code from public.master_detailed_parts('88 - ZZ60 - Master Tiktok A75 - S1 - Tegal')),
  'S1', 'sesi format nama dikenali');
select is((select count(*)::int from public.master_detailed_parts('88 - ZZ60 - master   tiktok a75 - s1 - tegal')),
  1, 'huruf besar/kecil dan spasi ganda tetap cocok');
select is((select count(*)::int from public.master_detailed_parts('88 - ZZ60 - Produk Lain - S1 - Tegal')),
  0, 'nama produk yang tidak terdaftar tidak menghasilkan kandidat');

select is((select product_code from public.master_setting_parts('webinar_destination::88 - ZZ60 - Master Tiktok A75 - S1 - Tegal')),
  'MTIA', 'key Zoom format nama dikenali');
select is((select product_code from public.master_setting_parts('webinar_destination::MTIA88ZZ60 - S1 - Tegal')),
  'MTIA', 'key Zoom format kode tetap dikenali');

-- Order lama yang GAGAL parse (product_code null) tetapi memakai format nama
-- tidak boleh membuat produknya dianggap tidak terpakai.
insert into public.orders(order_id,product_raw,product_parse_status,name,event_type,app_status,gross_amount,advertiser_code)
values ('a75-1','88 - ZZ60 - Master Tiktok A75 - S1 - Tegal','invalid','Peserta A75','Seminar Offline','Pending',100,'88');

select ok(public.master_is_used('products','MTIA','fd000000-0000-0000-0000-000000000001'),
  'produk yang hanya muncul di order format nama dianggap terpakai');
select ok(public.master_is_used('advertisers','88','fd000000-0000-0000-0000-000000000002'),
  'pengiklan format nama dianggap terpakai');
select ok(public.master_is_used('event-types','ZZ','fd000000-0000-0000-0000-000000000003'),
  'tipe kelas format nama dianggap terpakai');

-- ---------------------------------------------------------------------------
-- Nama produk unik dan tanpa pemisah segmen
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.products(name,code) values('master tiktok a75','DUPA')$$,
  '23505', null, 'nama produk duplikat ditolak setelah normalisasi');
select throws_ok($$insert into public.products(name,code) values('Produk - Salah','SEPA')$$,
  '23514', null, 'nama produk tidak boleh memuat pemisah segmen');

select * from finish();
rollback;
