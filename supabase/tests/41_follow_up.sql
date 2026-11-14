-- A76: template Follow Up per produk x jenis acara + penanda bubble per order.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 78, 'schema_version mencakup 78');

-- Tabel internal: browser tidak boleh membaca/menulis langsung.
select is(has_table_privilege('authenticated', 'public.follow_up_templates', 'select'), false,
  'template follow up tertutup untuk authenticated');
select is(has_table_privilege('authenticated', 'public.order_follow_up_marks', 'insert'), false,
  'penanda follow up tertutup untuk authenticated');

insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
  ('ff000000-0000-0000-0000-0000000000a1','fu_dev','Dev Follow Up','test','developer',true),
  ('ff000000-0000-0000-0000-0000000000a2','fu_member','Member Follow Up','test','member',false),
  ('ff000000-0000-0000-0000-0000000000a3','fu_pimpro','Pimpro Follow Up','test','pimpro',false),
  ('ff000000-0000-0000-0000-0000000000a4','fu_pimpro2','Pimpro Tanpa Akses','test','pimpro',false);

insert into public.products(id,name,code,active) values
  ('ff000000-0000-0000-0000-0000000000b1','Produk Follow Up','FUPX',true);
insert into public.event_types(id,name,code,kind,active) values
  ('ff000000-0000-0000-0000-0000000000c1','Kelas Follow Up','FT','seminar',true);

-- ---------------------------------------------------------------------------
-- Batasan tabel
-- ---------------------------------------------------------------------------
insert into public.follow_up_templates(product_id,event_type_id,slot,body)
values ('ff000000-0000-0000-0000-0000000000b1','ff000000-0000-0000-0000-0000000000c1',1,'Halo {nama}');

select throws_ok($$
  insert into public.follow_up_templates(product_id,event_type_id,slot,body)
  values ('ff000000-0000-0000-0000-0000000000b1','ff000000-0000-0000-0000-0000000000c1',1,'Lagi')
$$, '23505', null, 'slot yang sama tidak boleh dobel');
select throws_ok($$
  insert into public.follow_up_templates(product_id,event_type_id,slot,body)
  values ('ff000000-0000-0000-0000-0000000000b1','ff000000-0000-0000-0000-0000000000c1',5,'Di luar batas')
$$, '23514', null, 'slot hanya 1 sampai 4');
select throws_ok($$
  insert into public.follow_up_templates(product_id,event_type_id,slot,body)
  values ('ff000000-0000-0000-0000-0000000000b1','ff000000-0000-0000-0000-0000000000c1',2,'   ')
$$, '23514', null, 'isi template tidak boleh kosong');

-- ---------------------------------------------------------------------------
-- Simpan template lewat RPC
-- ---------------------------------------------------------------------------
select is((public.save_follow_up_templates(
  'ff000000-0000-0000-0000-0000000000a1', 'FUPX', 'FT',
  '{"1":"Halo {nama}, ini {produk}","2":"Info acara: {jenis} {batch} {sesi} {kota}"}'::jsonb
)->>'saved')::boolean, true, 'Developer dapat menyimpan template');

select is((select count(*)::int from public.follow_up_templates
  where product_id='ff000000-0000-0000-0000-0000000000b1' and event_type_id='ff000000-0000-0000-0000-0000000000c1'),
  2, 'dua slot tersimpan (slot lama yang tidak dikirim dihapus)');

select is((public.save_follow_up_templates(
  'ff000000-0000-0000-0000-0000000000a1', 'FUPX', 'FT', '{"1":"","2":"Info"}'::jsonb
)->>'saved')::boolean, true, 'body kosong menghapus slot');
select is((select count(*)::int from public.follow_up_templates
  where product_id='ff000000-0000-0000-0000-0000000000b1' and slot=1), 0, 'slot 1 terhapus');

select throws_ok($$
  select public.save_follow_up_templates('ff000000-0000-0000-0000-0000000000a1','FUPX','FT','{"5":"x"}'::jsonb)
$$, 'DF011', 'INVALID_SLOTS', 'slot di luar 1-4 ditolak');
select throws_ok($$
  select public.save_follow_up_templates('ff000000-0000-0000-0000-0000000000a2','FUPX','FT','{"1":"x"}'::jsonb)
$$, 'DF006', 'FORBIDDEN', 'tanpa izin Order tidak boleh menyimpan');
select throws_ok($$
  select public.save_follow_up_templates('ff000000-0000-0000-0000-0000000000a3','FUPX','FT','{"1":"x"}'::jsonb)
$$, 'DF006', 'FORBIDDEN', 'tanpa akses produk tidak boleh menyimpan');

insert into public.user_product_access(user_id,product_code) values
  ('ff000000-0000-0000-0000-0000000000a3','FUPX');
select is((public.save_follow_up_templates(
  'ff000000-0000-0000-0000-0000000000a3', 'FUPX', 'FT', '{"3":"Halo {nama}"}'::jsonb
)->>'saved')::boolean, true, 'pimpro dengan akses produk dapat menyimpan');

-- ---------------------------------------------------------------------------
-- Penanda bubble per order
-- ---------------------------------------------------------------------------
insert into public.orders(order_id, product_code, name, event_type, app_status, quantity, gross_amount)
values ('FU-A76-1','FUPX','Budi','Seminar Offline','Paid',1,100000);

select is((public.mark_order_follow_up('ff000000-0000-0000-0000-0000000000a1','FU-A76-1',2)->>'slot')::int,
  2, 'penanda slot 2 tersimpan');
select is((select count(*)::int from public.order_follow_up_marks where order_id='FU-A76-1'), 1,
  'penanda upsert, bukan riwayat');
select is((public.mark_order_follow_up('ff000000-0000-0000-0000-0000000000a1','FU-A76-1',2)->>'used_by_name'),
  'Dev Follow Up', 'nama pemakai tersimpan');

select throws_ok($$select public.mark_order_follow_up('ff000000-0000-0000-0000-0000000000a1','FU-A76-1',9)$$,
  'DF011', 'INVALID_SLOT', 'slot penanda hanya 1-4');
select throws_ok($$select public.mark_order_follow_up('ff000000-0000-0000-0000-0000000000a1','TIDAK-ADA',1)$$,
  'DF001', 'ORDER_NOT_FOUND', 'order tidak dikenal ditolak');
select throws_ok($$select public.mark_order_follow_up('ff000000-0000-0000-0000-0000000000a4','FU-A76-1',1)$$,
  'DF006', 'FORBIDDEN', 'pimpro tanpa akses produk tidak boleh menandai');

select * from finish();
rollback;
