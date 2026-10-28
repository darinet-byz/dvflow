-- 0058/0059/0060 (A50/A52/A54): delegasi team.manage, status produk/advertiser,
-- mapping label, Resign/reactivate, dan kebijakan hapus team.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 60, 'schema_version mencakup 0060');

insert into public.products(id,name,code,active,status) values
 ('fc000000-0000-0000-0000-00000000000a','Status Produk A','TSTA',true,'Active'),
 ('fc000000-0000-0000-0000-00000000000b','Status Produk B','TSTB',true,'Active');
insert into public.advertisers(id,name,code,active,status) values
 ('fc000000-0000-0000-0000-000000000001','Status Adv A','91',true,'In-House'),
 ('fc000000-0000-0000-0000-000000000002','Status Adv B','92',true,'In-House');

insert into public.app_roles(id,name,description,is_system) values
 ('team_custom','Team Custom',null,false),
 ('team_high','Team High',null,false);
insert into public.app_role_permissions(role_id,permission_key) values
 ('team_custom','operasional.presensi'),
 ('team_high','config.roles');

insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
 ('fc000000-0000-0000-0000-0000000000d1','tm_dev','Dev','test','developer',true,null),
 ('fc000000-0000-0000-0000-0000000000b1','tm_mgr','Mgr','test','manajer',true,null),
 ('fc000000-0000-0000-0000-0000000000b2','tm_mgr_scoped','Mgr Scoped','test','manajer',false,null),
 ('fc000000-0000-0000-0000-0000000000a1','tm_adv','Adv User','test','advertiser',false,'fc000000-0000-0000-0000-000000000001'),
 ('fc000000-0000-0000-0000-0000000000c1','tm_member','Member','test','member',true,null);
insert into public.user_product_access(user_id,product_code) values
 ('fc000000-0000-0000-0000-0000000000b2','TSTA'),
 ('fc000000-0000-0000-0000-0000000000a1','TSTA');
insert into public.app_role_permissions(role_id,permission_key)
select 'manajer', k from unnest(array['team.manage','operasional.product_status','operasional.advertiser_status','operasional.presensi']) k
on conflict do nothing;

select ok(public.actor_has_permission('fc000000-0000-0000-0000-0000000000b1','team.manage'),
  'manajer: team.manage efektif');
select ok(public.actor_can_assign_role('fc000000-0000-0000-0000-0000000000b1','member'),
  'manajer boleh memberi role member');
select ok(public.actor_can_assign_role('fc000000-0000-0000-0000-0000000000b1','team_custom'),
  'manajer boleh memberi role kustom subset');
select ok(not public.actor_can_assign_role('fc000000-0000-0000-0000-0000000000b1','admin'),
  'manajer tidak boleh memberi role admin');
select ok(not public.actor_can_assign_role('fc000000-0000-0000-0000-0000000000b1','manajer'),
  'manajer tidak boleh memberi role manajer');
select ok(not public.actor_can_assign_role('fc000000-0000-0000-0000-0000000000b1','team_high'),
  'role dengan config.roles tidak dapat diberikan');
select ok(public.actor_can_assign_products('fc000000-0000-0000-0000-0000000000b2',false,array['TSTA']),
  'scoped manajer boleh memberi produk sendiri');
select ok(not public.actor_can_assign_products('fc000000-0000-0000-0000-0000000000b2',false,array['TSTB']),
  'scoped manajer tidak boleh memberi produk lain');
select ok(not public.actor_can_assign_products('fc000000-0000-0000-0000-0000000000b2',true,array[]::text[]),
  'scoped manajer tidak boleh memberi Semua Produk');

-- create user sebagai manajer (superuser memanggil RPC service-only)
select lives_ok($$select public.admin_create_user(
  p_actor_user_id => 'fc000000-0000-0000-0000-0000000000b1',
  p_username => 'tm_new', p_display_name => 'New Member', p_initial_password => 'password123',
  p_role => 'member', p_avatar_emoji => null, p_allow_master => false,
  p_has_all_product_access => true, p_product_codes => '{}'::text[], p_advertiser_id => null)$$,
  'manajer dapat membuat member');
select throws_ok($$select public.admin_create_user(
  p_actor_user_id => 'fc000000-0000-0000-0000-0000000000b1',
  p_username => 'tm_admin', p_display_name => 'New Admin', p_initial_password => 'password123',
  p_role => 'admin', p_avatar_emoji => null, p_allow_master => false,
  p_has_all_product_access => true, p_product_codes => '{}'::text[], p_advertiser_id => null)$$,
  'DF006', 'FORBIDDEN', 'manajer tidak dapat membuat admin');
select throws_ok($$select public.admin_create_user(
  p_actor_user_id => 'fc000000-0000-0000-0000-0000000000b2',
  p_username => 'tm_all', p_display_name => 'Scoped All', p_initial_password => 'password123',
  p_role => 'member', p_avatar_emoji => null, p_allow_master => false,
  p_has_all_product_access => true, p_product_codes => '{}'::text[], p_advertiser_id => null)$$,
  'DF006', 'FORBIDDEN', 'scoped manajer tidak dapat memberi Semua Produk');
select throws_ok($$select public.admin_create_user(
  p_actor_user_id => 'fc000000-0000-0000-0000-0000000000b2',
  p_username => 'tm_b', p_display_name => 'Scoped B', p_initial_password => 'password123',
  p_role => 'member', p_avatar_emoji => null, p_allow_master => false,
  p_has_all_product_access => false, p_product_codes => array['TSTB'], p_advertiser_id => null)$$,
  'DF006', 'FORBIDDEN', 'scoped manajer tidak dapat memberi produk lain');
select lives_ok($$select public.admin_create_user(
  p_actor_user_id => 'fc000000-0000-0000-0000-0000000000b2',
  p_username => 'tm_a', p_display_name => 'Scoped A', p_initial_password => 'password123',
  p_role => 'member', p_avatar_emoji => null, p_allow_master => false,
  p_has_all_product_access => false, p_product_codes => array['TSTA'], p_advertiser_id => null)$$,
  'scoped manajer dapat memberi produk sendiri');
select throws_ok($$select public.admin_update_user(
  p_actor_user_id => 'fc000000-0000-0000-0000-0000000000b1',
  p_target_user_id => 'fc000000-0000-0000-0000-0000000000c1',
  p_display_name => 'Member', p_role => 'member', p_active => true,
  p_new_password => null, p_allow_master => false,
  p_has_all_product_access => true, p_product_codes => '{}'::text[], p_advertiser_id => null)$$,
  'DF006', 'FORBIDDEN', 'manajer tidak dapat mengedit user');
select throws_ok($$select public.admin_delete_user(
  'fc000000-0000-0000-0000-0000000000b1','fc000000-0000-0000-0000-0000000000c1')$$,
  'DF006', 'FORBIDDEN', 'manajer tidak dapat menghapus user');

-- username unik termasuk nonaktif
select throws_ok($$select public.admin_create_user(
  p_actor_user_id => 'fc000000-0000-0000-0000-0000000000d1',
  p_username => 'TM_MGR', p_display_name => 'Duplicate', p_initial_password => 'password123',
  p_role => 'member', p_avatar_emoji => null, p_allow_master => false,
  p_has_all_product_access => true, p_product_codes => '{}'::text[], p_advertiser_id => null)$$,
  'DF009', 'USERNAME_TAKEN', 'username sama (case-insensitive) ditolak');
update public.users set active = false where id = 'fc000000-0000-0000-0000-0000000000c1';
select throws_ok($$select public.admin_create_user(
  p_actor_user_id => 'fc000000-0000-0000-0000-0000000000d1',
  p_username => 'TM_MEMBER', p_display_name => 'Duplicate Inactive', p_initial_password => 'password123',
  p_role => 'member', p_avatar_emoji => null, p_allow_master => false,
  p_has_all_product_access => true, p_product_codes => '{}'::text[], p_advertiser_id => null)$$,
  'DF009', 'USERNAME_TAKEN', 'username milik user nonaktif tetap ditolak');

-- status produk + mapping
set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-0000000000b2","app_role":"manajer"}';
select lives_ok($$select public.set_product_status('fc000000-0000-0000-0000-00000000000a','On-Hold')$$,
  'scoped manajer dapat mengubah status produknya');
select is((select status from public.products where id = 'fc000000-0000-0000-0000-00000000000a'), 'On-Hold',
  'status produk tersimpan');
select is((select active from public.products where id = 'fc000000-0000-0000-0000-00000000000a'), false,
  'On-Hold menonaktifkan produk');
select throws_ok($$select public.set_product_status('fc000000-0000-0000-0000-00000000000b','On-Hold')$$,
  'DF006', 'FORBIDDEN', 'scoped manajer tidak dapat mengubah produk lain');
select lives_ok($$select public.set_product_advertisers(
  'fc000000-0000-0000-0000-00000000000a',
  array['fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-000000000002']::uuid[])$$,
  'mapping pengiklan dapat disimpan');
reset role;
select is((select count(*)::int from public.product_advertisers where product_id = 'fc000000-0000-0000-0000-00000000000a'), 2,
  'mapping tersimpan dua pengiklan');

-- advertiser status: Resign menutup akses + sesi, aktif kembali membuka akses
insert into public.app_sessions(user_id,token_hash,expires_at) values
 ('fc000000-0000-0000-0000-0000000000a1','tm-token-hash', now() + interval '1 day');
set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-0000000000b1","app_role":"manajer"}';
select lives_ok($$select public.set_advertiser_status('fc000000-0000-0000-0000-000000000001','Resign')$$,
  'manajer all-product dapat set Resign');
reset role;
select is((select active from public.advertisers where id = 'fc000000-0000-0000-0000-000000000001'), false,
  'advertiser Resign nonaktif');
select is((select active from public.users where id = 'fc000000-0000-0000-0000-0000000000a1'), false,
  'akun advertiser ikut nonaktif');
select is((select count(*)::int from public.app_sessions where user_id = 'fc000000-0000-0000-0000-0000000000a1'), 0,
  'sesi advertiser dicabut');
set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-0000000000b1","app_role":"manajer"}';
select lives_ok($$select public.set_advertiser_status('fc000000-0000-0000-0000-000000000001','In-House')$$,
  'status kembali aktif');
reset role;
select is((select active from public.users where id = 'fc000000-0000-0000-0000-0000000000a1'), true,
  'akun advertiser aktif kembali');
set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-0000000000b2","app_role":"manajer"}';
select throws_ok($$select public.set_advertiser_status('fc000000-0000-0000-0000-000000000001','Resign')$$,
  'DF006', 'FORBIDDEN', 'scoped manajer tidak dapat set status advertiser');

-- hapus team: tanpa data boleh, dengan data ditolak
reset role;
select lives_ok($$select public.admin_delete_user(
  'fc000000-0000-0000-0000-0000000000d1','fc000000-0000-0000-0000-0000000000c1')$$,
  'user tanpa data boleh dihapus');
select throws_ok($$select public.admin_delete_user(
  'fc000000-0000-0000-0000-0000000000d1','fc000000-0000-0000-0000-0000000000a1')$$,
  'DF018', 'USER_HAS_DATA', 'akun advertiser tidak boleh dihapus');
insert into public.ad_spend_reports(advertiser_id,product_id,batch,date_from,date_to,spend,created_by) values
 ('fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-00000000000a','100','2026-09-01','2026-09-30',1000,
  'fc000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.admin_delete_user(
  'fc000000-0000-0000-0000-0000000000d1','fc000000-0000-0000-0000-0000000000b1')$$,
  'DF018', 'USER_HAS_DATA', 'user dengan report tidak boleh dihapus');

-- save_role_permissions: config.roles tetap master-only
select throws_ok($$select public.save_role_permissions(
  'fc000000-0000-0000-0000-0000000000d1','manajer',array['config.roles'])$$,
  'DF011', 'INVALID_PERMISSION', 'config.roles tidak dapat diberikan ke manajer');
select lives_ok($$select public.save_role_permissions(
  'fc000000-0000-0000-0000-0000000000d1','manajer',array['team.manage','operasional.product_status'])$$,
  'team.manage dapat diberikan ke manajer');

select * from finish();
rollback;
