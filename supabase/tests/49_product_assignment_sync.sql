-- A88: sinkronisasi penugasan produk Add Team <-> Status Produk/Pengiklan.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 86, 'schema_version mencakup 0086');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'manajer' and permission_key = 'action.manage_spend'),
  'permission A88 ada');

insert into public.products(id,name,code) values
  ('f9100000-0000-0000-0000-00000000000a','Produk Sync A','SYNA'),
  ('f9100000-0000-0000-0000-00000000000b','Produk Sync B','SYNB'),
  ('f9100000-0000-0000-0000-00000000000c','Produk Sync C','SYNC');
insert into public.advertisers(id,name,code) values
  ('f9100000-0000-0000-0000-000000000001','Sync Satu','91'),
  ('f9100000-0000-0000-0000-000000000002','Sync Dua','92'),
  ('f9100000-0000-0000-0000-000000000003','Sync Tiga','93'),
  ('f9100000-0000-0000-0000-000000000004','Sync Empat','94');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
  ('f9100000-0000-0000-0000-0000000000d1','sync_dev','Dev Sync','test','developer',true,null),
  ('f9100000-0000-0000-0000-0000000000a1','sync_zul1','Zul Satu','test','advertiser',false,'f9100000-0000-0000-0000-000000000001'),
  ('f9100000-0000-0000-0000-0000000000a2','sync_zul2','Zul Dua','test','advertiser',false,'f9100000-0000-0000-0000-000000000001'),
  ('f9100000-0000-0000-0000-0000000000b1','sync_rina','Rina Sync','test','advertiser',false,'f9100000-0000-0000-0000-000000000002'),
  ('f9100000-0000-0000-0000-0000000000c1','sync_empat','Empat Sync','test','advertiser',false,'f9100000-0000-0000-0000-000000000004');
insert into public.user_product_access(user_id,product_code) values
  ('f9100000-0000-0000-0000-0000000000a1','SYNA'),
  ('f9100000-0000-0000-0000-0000000000b1','SYNB');

-- Helper: akses user -> mapping.
select lives_ok($$select public.sync_advertiser_product_mapping('f9100000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-0000000000d1')$$,
  'sync helper mapping dijalankan');
select is((select string_agg(p.code, ',' order by p.code)
  from public.product_advertisers pa join public.products p on p.id = pa.product_id
  where pa.advertiser_id = 'f9100000-0000-0000-0000-000000000001'), 'SYNA',
  'akses user menjadi mapping Status Pengiklan');

-- Helper: mapping -> akses semua akun advertiser.
insert into public.product_advertisers(product_id,advertiser_id) values
  ('f9100000-0000-0000-0000-00000000000b','f9100000-0000-0000-0000-000000000001');
select lives_ok($$select public.sync_advertiser_user_access('f9100000-0000-0000-0000-000000000001')$$,
  'sync helper akses dijalankan');
select is((select string_agg(distinct x.product_code, ',' order by x.product_code)
  from public.user_product_access x
  where x.user_id in ('f9100000-0000-0000-0000-0000000000a1','f9100000-0000-0000-0000-0000000000a2')),
  'SYNA,SYNB', 'mapping menjadi akses kedua akun advertiser');

-- Add Team: user kedua ditambah produk lain -> mapping union.
select lives_ok(format($$select public.admin_update_user(
  'f9100000-0000-0000-0000-0000000000d1','f9100000-0000-0000-0000-0000000000a2',
  'Zul Dua','advertiser',true,null,false,false,array['SYNC'],'f9100000-0000-0000-0000-000000000001')$$),
  'admin_update_user advertiser');
select is((select string_agg(p.code, ',' order by p.code)
  from public.product_advertisers pa join public.products p on p.id = pa.product_id
  where pa.advertiser_id = 'f9100000-0000-0000-0000-000000000001'), 'SYNA,SYNB,SYNC',
  'produk user kedua ikut ke mapping');
select is((select has_all_product_access from public.users where id = 'f9100000-0000-0000-0000-0000000000a2'),
  false, 'advertiser tidak boleh Semua Produk');

-- Status Pengiklan: set produk advertiser -> akses semua akun.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9100000-0000-0000-0000-0000000000d1","app_role":"developer"}';
select lives_ok($$select public.set_advertiser_products(
  'f9100000-0000-0000-0000-000000000001',
  array['f9100000-0000-0000-0000-00000000000a'::uuid,'f9100000-0000-0000-0000-00000000000b'::uuid])$$,
  'set_advertiser_products');
reset role;
select is((select string_agg(distinct x.product_code, ',' order by x.product_code)
  from public.user_product_access x
  where x.user_id in ('f9100000-0000-0000-0000-0000000000a1','f9100000-0000-0000-0000-0000000000a2')),
  'SYNA,SYNB', 'Status Pengiklan mengubah akses semua akun');

-- Status Produk: tambah/hapus advertiser -> akses produk pengiklan itu.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9100000-0000-0000-0000-0000000000d1","app_role":"developer"}';
select lives_ok($$select public.set_product_advertisers(
  'f9100000-0000-0000-0000-00000000000b',
  array['f9100000-0000-0000-0000-000000000001'::uuid,'f9100000-0000-0000-0000-000000000002'::uuid])$$,
  'set_product_advertisers menambah advertiser');
reset role;
select ok(exists(select 1 from public.user_product_access
  where user_id = 'f9100000-0000-0000-0000-0000000000b1' and product_code = 'SYNB'),
  'produk ditambahkan ke akun advertiser kedua');
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9100000-0000-0000-0000-0000000000d1","app_role":"developer"}';
select lives_ok($$select public.set_product_advertisers(
  'f9100000-0000-0000-0000-00000000000b',
  array['f9100000-0000-0000-0000-000000000001'::uuid])$$,
  'set_product_advertisers menghapus advertiser');
reset role;
select ok(not exists(select 1 from public.user_product_access
  where user_id = 'f9100000-0000-0000-0000-0000000000b1' and product_code = 'SYNB'),
  'produk dicabut dari akun advertiser kedua');

-- Advertiser baru dengan Semua Produk -> kosong.
select is((public.admin_create_user(
  'f9100000-0000-0000-0000-0000000000d1','sync_tiga','Tiga Sync','password123','advertiser',
  null,false,true,array[]::text[],'f9100000-0000-0000-0000-000000000003'
))->>'has_all_product_access', 'false', 'create advertiser memaksa Semua Produk false');
select is((select count(*)::int from public.user_product_access
  where user_id = (select id from public.users where username = 'sync_tiga')), 0,
  'advertiser baru dengan Semua Produk tidak punya akses produk');
select is((select count(*)::int from public.product_advertisers
  where advertiser_id = 'f9100000-0000-0000-0000-000000000003'), 0,
  'mapping advertiser baru kosong');

-- Update advertiser menjadi Semua Produk -> tetap kosong/false.
select is((public.admin_update_user(
  'f9100000-0000-0000-0000-0000000000d1',
  (select id from public.users where username = 'sync_tiga'),
  'Tiga Sync','advertiser',true,null,false,true,array[]::text[],'f9100000-0000-0000-0000-000000000003'
))->>'has_all_product_access', 'false', 'update advertiser memaksa Semua Produk false');
select is((select count(*)::int from public.user_product_access
  where user_id = (select id from public.users where username = 'sync_tiga')), 0,
  'update advertiser dengan Semua Produk tetap kosong');

select * from finish();
rollback;
