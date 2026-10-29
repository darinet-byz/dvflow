-- 0044 (A33): nol di depan batch diabaikan; nol tengah/belakang berarti; kode pengiklan tidak tersentuh.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 44, 'schema_version mencakup 0044');
select is(array(select public.normalize_batch(x) from unnest(array['058','0058','00058','508','580','100','101','0','000',' 058a ']) x),
  array['58','58','58','508','580','100','101','0','0','58A'], 'normalize_batch sesuai contoh pengguna');
select is(public.normalize_batch(null), null, 'null tetap null');

insert into public.users(id,username,display_name,password_hash,role) values ('fc000000-0000-0000-0000-000000000001','nb_dev','Dev','test','developer');
insert into public.orders(order_id,product_code,advertiser_code,name,event_type,app_status,gross_amount,batch,city) values
 ('nb-1','AAAA','01','Batch 58','Seminar Offline','Paid',100,'58','Solo'),
 ('nb-2','AAAA','02','Batch 508','Seminar Offline','Paid',100,'508','Solo'),
 ('nb-3','AAAA','01','Batch 100','Seminar Offline','Paid',100,'100','Solo');

set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000001","app_role":"developer"}';
select is((public.orders_page(p_batch => '058')->>'total')::int, 1, 'filter 058 = 58');
select is((public.orders_page(p_batch => '0058')->>'total')::int, 1, 'filter 0058 = 58');
select is((public.orders_page(p_batch => '58')->>'total')::int, 1, 'filter 58');
select is((public.orders_page(p_batch => '508')->>'total')::int, 1, '508 tetap 508 (bukan 58)');
select is((public.orders_page(p_batch => '0100')->>'total')::int, 1, '0100 = 100; nol belakang berarti');
select is((public.orders_page(p_batch => '10')->>'total')::int, 0, '10 bukan 100');
select is((public.orders_page(p_advertiser_code => '01')->>'total')::int, 2, 'filter pengiklan 01 tetap utuh (bukan 1)');
select is((public.orders_page(p_advertiser_code => '1')->>'total')::int, 0, 'pengiklan 1 tidak sama dengan 01');
select is((public.export_orders_page(p_batch => '058')->>'total')::int, 1, 'export order ikut');
select is((public.presensi_page(p_batch => '058')->>'total')::int, 1, 'presensi ikut');
select is((public.export_presensi_page(p_batch => '058')->>'total')::int, 1, 'export presensi ikut');
select is((public.dashboard_summary(p_batch => '058')->>'leads')::int, 1, 'dashboard ikut');
select is((public.presensi_summary(p_batch => '058')->>'paid_tickets')::int, 1, 'ringkasan presensi ikut');
select is((public.tax_report('batch', p_batch => '058')->'summary'->>'transactions')::int, 1, 'report tax ikut');
reset role;

select * from finish();
rollback;
