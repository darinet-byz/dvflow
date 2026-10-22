-- 0047 (A36): role legacy master_admin/staff dihapus; ID-nya tidak lagi berarti akses penuh.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 47, 'schema_version mencakup 0047');
select ok(not exists(select 1 from public.app_roles where id in ('master_admin', 'staff')), 'role legacy sudah tidak ada');
select ok(not exists(select 1 from public.app_role_permissions where role_id in ('master_admin', 'staff')), 'izin role legacy ikut terhapus');
select throws_ok($$insert into public.users(username,display_name,password_hash,role) values ('lr_x','X','test','staff')$$,
  '23503', null, 'user baru tidak bisa memakai role legacy');

insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('a3600000-0000-0000-0000-000000000001','lr_dev','Dev','test','developer',true),
 ('a3600000-0000-0000-0000-000000000002','lr_fake','Fake','test','member',false);

-- Role kustom ber-ID master_admin hanya mendapat izin yang dicentang, bukan akses penuh.
select lives_ok($$select public.save_role_permissions('a3600000-0000-0000-0000-000000000001','master_admin',array['operasional.scan_qr'],true,'Tiruan')$$,
  'role kustom ber-ID master_admin bisa dibuat');
update public.users set role = 'master_admin' where id = 'a3600000-0000-0000-0000-000000000002';
select is(public.actor_has_permission('a3600000-0000-0000-0000-000000000002','operasional.scan_qr'), true, 'izin yang dicentang berlaku');
select is(public.actor_has_permission('a3600000-0000-0000-0000-000000000002','config.tax'), false, 'tidak mendapat akses penuh');
select is(public.actor_can_product('a3600000-0000-0000-0000-000000000002','AAAA'), false, 'tidak mendapat semua produk');
select throws_ok($$select public.admin_delete_user('a3600000-0000-0000-0000-000000000002','a3600000-0000-0000-0000-000000000001')$$,
  'DF006', 'FORBIDDEN', 'tidak dapat mengelola tim');

select * from finish();
rollback;
