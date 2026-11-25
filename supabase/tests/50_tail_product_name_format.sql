-- A96: format ketiga nama produk — teks bebas dibaca dari BELAKANG.
-- Order dengan pola `teks bebas - kota - sesi - kode` tetap dikenali guard
-- hapus konfigurasi dan key Zoom/tiket.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 95, 'schema_version mencakup 95');

insert into public.products(id,name,code,active) values
  ('fe000000-0000-0000-0000-000000000001','Produk Ekor A96','TAIL',true);
insert into public.advertisers(id,name,code,active) values
  ('fe000000-0000-0000-0000-000000000002','Pengiklan A96','77',true);
insert into public.event_types(id,name,code,kind,active) values
  ('fe000000-0000-0000-0000-000000000003','Kelas A96','KK','seminar',true);

-- ---------------------------------------------------------------------------
-- Pengenalan format teks bebas (dibaca dari belakang)
-- ---------------------------------------------------------------------------
select is((select product_code from public.master_tail_parts('Kelas Pagi - Live Zoom - S1 - TAIL77KK600')),
  'TAIL', 'produk format teks bebas dikenali');
select is((select advertiser_code from public.master_tail_parts('Kelas Pagi - Live Zoom - S1 - TAIL77KK600')),
  '77', 'pengiklan format teks bebas dikenali');
select is((select type_code from public.master_tail_parts('Kelas Pagi - Live Zoom - S1 - TAIL77KK600')),
  'KK', 'tipe kelas format teks bebas dikenali');
select is((select session_code from public.master_tail_parts('Kelas Pagi - Live Zoom - S1 - TAIL77KK600')),
  'S1', 'sesi format teks bebas dikenali');
select is((select count(*)::int from public.master_tail_parts('Kelas Pagi - Batch A - Live Zoom - ST - TAIL77KK7')),
  1, 'teks bebas boleh memuat pemisah');
select is((select count(*)::int from public.master_tail_parts('kelas pagi - live zoom - s1 - tail77kk600')),
  1, 'huruf besar/kecil tetap cocok');
select is((select count(*)::int from public.master_tail_parts('Live Zoom - S1 - TAIL77KK600')),
  0, 'teks bebas wajib ada');
select is((select count(*)::int from public.master_tail_parts('Kelas Pagi - Live Zoom - S9 - TAIL77KK600')),
  0, 'sesi tak dikenal tidak menghasilkan kandidat');
select is((select count(*)::int from public.master_tail_parts('TAIL77KK600 - S1 - Solo')),
  0, 'format kode lama tidak terbaca sebagai format teks bebas');

select is((select product_code from public.master_setting_parts('webinar_destination::Kelas Pagi - Live Zoom - S1 - TAIL77KK600')),
  'TAIL', 'key Zoom format teks bebas dikenali');
select is((select product_code from public.master_setting_parts('webinar_destination::TAIL77KK600 - S1 - Solo')),
  'TAIL', 'key Zoom format kode tetap dikenali');

-- Order yang GAGAL parse (product_code null) tetapi memakai format teks bebas
-- tidak boleh membuat konfigurasinya dianggap tidak terpakai.
insert into public.orders(order_id,product_raw,product_parse_status,name,event_type,app_status,gross_amount,advertiser_code)
values ('a96-1','Kelas Pagi - Live Zoom - S1 - TAIL77KK600','invalid','Peserta A96','Seminar Offline','Pending',100,'77');

select ok(public.master_is_used('products','TAIL','fe000000-0000-0000-0000-000000000001'),
  'produk yang hanya muncul di order format teks bebas dianggap terpakai');
select ok(public.master_is_used('advertisers','77','fe000000-0000-0000-0000-000000000002'),
  'pengiklan format teks bebas dianggap terpakai');
select ok(public.master_is_used('event-types','KK','fe000000-0000-0000-0000-000000000003'),
  'tipe kelas format teks bebas dianggap terpakai');
select ok(public.master_is_used('sessions','S1',null::uuid),
  'sesi format teks bebas dianggap terpakai');

select * from finish();
rollback;
