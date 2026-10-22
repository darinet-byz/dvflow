-- 0037 (A20): role Advertiser = produk yang ditugaskan DAN hanya order berkode pengiklannya.
-- Pimpro tetap level produk (melihat semua pengiklan di produknya).
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 37, 'schema_version mencakup 0037');
select ok(exists(select 1 from public.app_roles where id = 'advertiser'), 'role advertiser ada');
select is((select array_agg(permission_key order by permission_key) from public.app_role_permissions where role_id = 'advertiser'),
  -- A30: ui.field_app khusus pimpro/member, tidak untuk advertiser.
  (select array_agg(permission_key order by permission_key) from public.app_role_permissions where role_id = 'pimpro' and permission_key <> 'ui.field_app'),
  'izin awal advertiser = izin pimpro (tanpa Tampilan Apps Lapangan)');

insert into public.products(id,name,code) values
 ('f5000000-0000-0000-0000-00000000000a','Produk A','AAAA'),
 ('f5000000-0000-0000-0000-00000000000b','Produk B','BBBB');
insert into public.advertisers(id,name,code) values
 ('f5000000-0000-0000-0000-000000000001','Zul','01'),
 ('f5000000-0000-0000-0000-000000000002','Rina','02');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
 ('f5000000-0000-0000-0000-0000000000d1','adv_dev','Dev','test','developer',true,null),
 ('f5000000-0000-0000-0000-0000000000a1','adv_zul','Zul','test','advertiser',false,'f5000000-0000-0000-0000-000000000001'),
 ('f5000000-0000-0000-0000-0000000000a2','adv_all','Zul Semua','test','advertiser',true,'f5000000-0000-0000-0000-000000000001'),
 ('f5000000-0000-0000-0000-0000000000b1','adv_pim','Pimpro A','test','pimpro',false,null);
insert into public.user_product_access(user_id,product_code) values
 ('f5000000-0000-0000-0000-0000000000a1','AAAA'),('f5000000-0000-0000-0000-0000000000b1','AAAA');
-- Izin ekspor & scan untuk uji jalur export/check-in (pimpro bawaan bisa sudah punya).
insert into public.app_role_permissions(role_id,permission_key)
select r, k from unnest(array['advertiser','pimpro']) r, unnest(array['action.export_data','operasional.scan_qr','operasional.order','operasional.presensi','operasional.dashboard','config.report_tax']) k
on conflict do nothing;
insert into public.orders(order_id,product_code,advertiser_code,product_raw,name,event_type,app_status,gross_amount) values
 ('adv-a01','AAAA','01','AAAA01SO1 - S1 - Solo','A01','Seminar Offline','Paid',100),
 ('adv-a02','AAAA','02','AAAA02SO1 - S1 - Solo','A02','Seminar Offline','Paid',200),
 ('adv-b01','BBBB','01','BBBB01SO1 - S1 - Solo','B01','Seminar Offline','Paid',400);
insert into public.attendance_events(order_id,attendance_type,source) values
 ('adv-a01','webinar','webinar_redirect'),('adv-a02','webinar','webinar_redirect'),('adv-b01','webinar','webinar_redirect');

-- Advertiser 01, produk A saja -> hanya adv-a01.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
select is((select array_agg(order_id order by order_id) from public.orders), array['adv-a01'], 'advertiser: tabel orders hanya miliknya');
select is((public.orders_page()->>'total')::int, 1, 'advertiser: orders_page');
select is((public.presensi_page()->>'total')::int, 1, 'advertiser: presensi_page');
select is((public.dashboard_summary()->>'leads')::int, 1, 'advertiser: dashboard');
select is((public.export_orders_page()->>'total')::int, 1, 'advertiser: export order');
select is((public.export_presensi_page()->>'total')::int, 1, 'advertiser: export presensi');
select is((select count(*) from public.attendance_events)::int, 1, 'advertiser: presensi mentah');
select is((public.orders_page(p_advertiser_code => '02')->>'total')::int, 0, 'filter tidak bisa melebarkan scope pengiklan');
select is((select array_agg(code) from public.advertisers), array['01'], 'advertiser: dropdown pengiklan hanya miliknya');

-- Advertiser 01 dengan Semua Produk -> semua order kode 01.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-0000000000a2","app_role":"advertiser"}';
select is((select array_agg(order_id order by order_id) from public.orders), array['adv-a01','adv-b01'], 'advertiser semua produk: semua order kode 01');

-- Pimpro produk A -> semua pengiklan di produk A.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-0000000000b1","app_role":"pimpro"}';
select is((select array_agg(order_id order by order_id) from public.orders), array['adv-a01','adv-a02'], 'pimpro: semua pengiklan di produknya');
select is((select count(*) from public.advertisers)::int >= 2, true, 'pimpro: semua pengiklan tampil');
reset role;

-- Check-in lintas pengiklan ditolak di DB.
select throws_ok($$select public.checkin_seminar('adv-a02','seminar_qr','f5000000-0000-0000-0000-0000000000a1')$$,
  'DF006', 'FORBIDDEN', 'advertiser tidak bisa check-in order pengiklan lain');
select lives_ok($$select public.checkin_seminar('adv-a01','seminar_qr','f5000000-0000-0000-0000-0000000000a1')$$,
  'advertiser check-in order miliknya');

-- Konsistensi role <-> pengiklan.
select throws_ok($$insert into public.users(username,display_name,password_hash,role) values ('adv_x','X','t','advertiser')$$,
  '23514', null, 'advertiser tanpa pengiklan ditolak');
select throws_ok($$insert into public.users(username,display_name,password_hash,role,advertiser_id) values ('adv_y','Y','t','pimpro','f5000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'role lain tidak boleh memegang pengiklan');

-- Provisioning.
select throws_ok($$select public.admin_create_user('f5000000-0000-0000-0000-0000000000d1','adv_new','Baru','password123','advertiser',p_has_all_product_access => true)$$,
  'DF011', 'INVALID_ARGUMENT', 'buat advertiser tanpa pengiklan ditolak');
select is((public.admin_create_user('f5000000-0000-0000-0000-0000000000d1','adv_new','Baru','password123','advertiser',
  p_has_all_product_access => false, p_product_codes => array['AAAA'], p_advertiser_id => 'f5000000-0000-0000-0000-000000000002') ->> 'advertiser_id'),
  'f5000000-0000-0000-0000-000000000002', 'buat advertiser dengan pengiklan');
select is((public.admin_update_user('f5000000-0000-0000-0000-0000000000d1',(select id from public.users where username='adv_new'),'Baru','pimpro',true,
  p_advertiser_id => 'f5000000-0000-0000-0000-000000000002') ->> 'advertiser_id'), null, 'ganti ke pimpro: pengiklan dikosongkan');
select ok(public.master_is_used('advertisers','01',null), 'pengiklan yang dipegang akun dianggap dipakai');
select is(has_function_privilege('anon','public.admin_create_user(uuid,text,text,text,text,text,boolean,boolean,text[],uuid)','execute'), false,
  'admin_create_user tidak bisa dipanggil anon');
select is(has_function_privilege('authenticated','public.admin_update_user(uuid,uuid,text,text,boolean,text,boolean,boolean,text[],uuid)','execute'), false,
  'admin_update_user tidak bisa dipanggil browser');

select * from finish();
rollback;
