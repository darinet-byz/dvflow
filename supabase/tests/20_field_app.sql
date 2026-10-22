-- 0042 (A30) / 0047 (A36): izin Tampilan Apps Lapangan hanya untuk pimpro/member.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 42, 'schema_version mencakup 0042');
select ok(exists(select 1 from public.app_permissions where key = 'ui.field_app' and module = 'tampilan'), 'izin ada');
select is((select array_agg(role_id order by role_id) from public.app_role_permissions where permission_key = 'ui.field_app'),
  array['member','pimpro'], 'default: hanya pimpro, member');

insert into public.users(id,username,display_name,password_hash,role) values ('fa000000-0000-0000-0000-000000000001','fa_dev','Dev','test','developer');
insert into public.app_roles(id,name) values ('panitia','Panitia');

select throws_ok($$select public.save_role_permissions('fa000000-0000-0000-0000-000000000001','admin',array['operasional.scan_qr','ui.field_app'])$$,
  'DF011', 'INVALID_PERMISSION', 'admin tidak boleh');
select throws_ok($$select public.save_role_permissions('fa000000-0000-0000-0000-000000000001','panitia',array['ui.field_app'])$$,
  'DF011', 'INVALID_PERMISSION', 'role kustom tidak boleh');
select lives_ok($$select public.save_role_permissions('fa000000-0000-0000-0000-000000000001','member',array['operasional.scan_qr'])$$, 'member: izin bisa dilepas');
select ok(not exists(select 1 from public.app_role_permissions where role_id = 'member' and permission_key = 'ui.field_app'), 'member tanpa tampilan lapangan');
select lives_ok($$select public.save_role_permissions('fa000000-0000-0000-0000-000000000001','member',array['operasional.scan_qr','ui.field_app'])$$, 'member: bisa dicentang lagi');
select lives_ok($$select public.save_role_permissions('fa000000-0000-0000-0000-000000000001','owner',array[]::text[])$$, 'simpan owner');
select ok(not exists(select 1 from public.app_role_permissions where role_id = 'owner' and permission_key = 'ui.field_app'), 'master tidak pernah mendapat izin ini');

select * from finish();
rollback;
