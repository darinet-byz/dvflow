-- 0043 (A31): filter Kota & Batch tidak membedakan huruf besar/kecil maupun spasi tepi.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 43, 'schema_version mencakup 0043');
insert into public.users(id,username,display_name,password_hash,role) values ('fb000000-0000-0000-0000-000000000001','ci_dev','Dev','test','developer');
insert into public.orders(order_id,product_code,name,event_type,app_status,gross_amount,batch,city,payment_method) values
 ('ci-1','AAAA','Solo A','Seminar Offline','Paid',100,'58A','Solo','bank_transfer'),
 ('ci-2','AAAA','Kudus B','Seminar Offline','Paid',100,'58A','Kudus','bank_transfer');
insert into public.attendance_events(order_id,attendance_type,source) values ('ci-1','seminar','seminar_qr');

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-000000000001","app_role":"developer"}';
select is((public.orders_page(p_city => 'Solo')->>'total')::int, 1, 'Solo');
select is((public.orders_page(p_city => 'solo')->>'total')::int, 1, 'solo');
select is((public.orders_page(p_city => ' SOLO ')->>'total')::int, 1, 'SOLO dengan spasi');
select is((public.orders_page(p_city => 'Sol')->>'total')::int, 0, 'tetap sama persis (bukan sebagian)');
select is((public.orders_page(p_batch => '58a')->>'total')::int, 2, 'batch 58a = 58A');
select is((public.orders_page(p_batch => '58a', p_city => 'kudus')->>'total')::int, 1, 'gabungan filter');
select is((public.export_orders_page(p_city => 'solo')->>'total')::int, 1, 'export order ikut');
select is((public.presensi_page(p_city => 'solo')->>'total')::int, 1, 'presensi ikut');
select is((public.export_presensi_page(p_city => 'solo')->>'total')::int, 1, 'export presensi ikut');
select is((public.dashboard_summary(p_city => 'solo')->>'leads')::int, 1, 'dashboard ikut');
select is((public.presensi_summary(p_city => 'SOLO')->>'sudah_hadir')::int, 1, 'ringkasan presensi ikut');
select is((public.tax_report('city', p_city => 'solo')->'summary'->>'transactions')::int, 1, 'report tax ikut');
reset role;

select * from finish();
rollback;
