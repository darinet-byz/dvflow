-- A74: toggle status sesi khusus Developer + OTS menolak sesi nonaktif.
-- Baris konfigurasi TIDAK dihapus saat sesi dinonaktifkan; data historis tetap
-- dapat dijelaskan parser dan hard delete tetap dijaga MASTER_IN_USE.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 76, 'schema_version mencakup 76');

insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
  ('fa000000-0000-0000-0000-0000000000a1','sesi_dev','Dev','test','developer',true),
  ('fa000000-0000-0000-0000-0000000000a2','sesi_owner','Owner','test','owner',true);

-- ---------------------------------------------------------------------------
-- Reset konfigurasi menanam ST nonaktif (hanya Developer, dan hanya tanpa transaksi)
-- ---------------------------------------------------------------------------
savepoint before_reset;
select is((public.reset_product_configuration('fa000000-0000-0000-0000-0000000000a1')->>'success')::boolean, true, 'Developer dapat reset konfigurasi');
select is((select active from public.sessions_config where code_normalized = 'ST'), false, 'ST ditanam nonaktif');
select is((select count(*)::int from public.sessions_config), 9, 'sembilan sesi tetap ada');
select is((select count(*)::int from public.sessions_config where active), 8, 'S1-S8 aktif');
rollback to savepoint before_reset;

-- ---------------------------------------------------------------------------
-- Hard delete sesi: Owner bukan Developer -> ditolak; Developer boleh bila tak terpakai
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.delete_config_master('fa000000-0000-0000-0000-0000000000a2','sessions',(select id from public.sessions_config where code_normalized = 'S7'))$$,
  'DF006', 'FORBIDDEN', 'owner tidak boleh menghapus permanen sesi');
select lives_ok(
  $$select public.delete_config_master('fa000000-0000-0000-0000-0000000000a1','sessions',(select id from public.sessions_config where code_normalized = 'S7'))$$,
  'developer boleh menghapus sesi yang tidak dipakai order');
select is((select count(*)::int from public.sessions_config where code_normalized = 'S7'), 0, 'sesi S7 terhapus permanen');

-- ---------------------------------------------------------------------------
-- OTS: sesi baru wajib aktif; sesi lama boleh dipertahankan saat edit
-- ---------------------------------------------------------------------------
insert into public.products(id,name,code) values ('fa000000-0000-0000-0000-000000000001','Produk Sesi','SESA');
update public.sessions_config set active = false where code_normalized = 'ST';

select is((select count(*)::int from public.sessions_config where code_normalized = 'ST'), 1, 'baris ST tetap ada, hanya nonaktif');
select throws_ok(
  $$select public.save_ots_registration('fa000000-0000-0000-0000-0000000000a1', null, 'Budi', '0812', 'SESA', '392', 'ST', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$,
  'DF011', 'INVALID_ARGUMENT', 'OTS baru menolak sesi nonaktif');

select is((public.save_ots_registration(
  'fa000000-0000-0000-0000-0000000000a1', null, 'Budi', '0812', 'SESA', '392', 'S1', 'Solo',
  'Seminar Offline', 0, 'ots_tunai', 1, 150000
)->>'action'), 'created', 'OTS dengan sesi aktif dibuat');

update public.sessions_config set active = false where code_normalized in ('S1', 'S3');

select is((public.save_ots_registration(
  'fa000000-0000-0000-0000-0000000000a1', (select order_id from public.orders where source = 'ots' and name = 'Budi'),
  'Budi Edit', '0812', 'SESA', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000
)->>'action'), 'updated', 'edit mempertahankan sesi lama yang sudah nonaktif');

select throws_ok(
  $$select public.save_ots_registration('fa000000-0000-0000-0000-0000000000a1', (select order_id from public.orders where source = 'ots' and name = 'Budi Edit'), 'Budi', '0812', 'SESA', '392', 'S3', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$,
  'DF011', 'INVALID_ARGUMENT', 'edit tidak boleh pindah ke sesi nonaktif lain');

select * from finish();
rollback;
