-- 0038 (A23): ringkasan kehadiran untuk role yang hanya punya izin Presensi, tanpa angka keuangan.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 38, 'schema_version mencakup 0038');
insert into public.app_roles(id,name) values ('presensi_only','Presensi Saja');
insert into public.app_role_permissions(role_id,permission_key) values ('presensi_only','operasional.presensi');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('f6000000-0000-0000-0000-000000000001','pres_only','Presensi','test','presensi_only',true);
insert into public.orders(order_id,product_code,name,event_type,app_status,gross_amount) values
 ('ps1','AAAA','A','Seminar Offline','Paid',100),('ps2','AAAA','B','Seminar Offline','Paid',100),('ps3','AAAA','C','Seminar Offline','Pending',100);
insert into public.attendance_events(order_id,attendance_type,source) values ('ps1','seminar','seminar_qr');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f6000000-0000-0000-0000-000000000001","app_role":"presensi_only"}';
select is(public.presensi_summary(), '{"paid_tickets":2,"sudah_hadir":1,"belum_hadir":1,"attendance_rate":0.5000}'::jsonb,
  'izin Presensi saja: ringkasan kehadiran tersedia');
select ok(not (public.presensi_summary() ? 'gross_amount'), 'tanpa angka keuangan');
select throws_ok('select public.dashboard_summary()', 'DF006', 'FORBIDDEN', 'dashboard_summary tetap butuh izin Dashboard');
reset role;
delete from public.app_role_permissions where role_id = 'presensi_only';
set local role authenticated;
select throws_ok('select public.presensi_summary()', 'DF006', 'FORBIDDEN', 'tanpa izin Presensi ditolak');
reset role;
select is(has_function_privilege('anon','public.presensi_summary(text,date,date,text,text,text,text,text,text)','execute'), false, 'anon tidak bisa');

select * from finish();
rollback;
