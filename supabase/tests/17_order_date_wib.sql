-- 0039 (A24): filter tanggal = tanggal order OrderOnline (source_created_at) dalam hari WIB.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 39, 'schema_version mencakup 0039');
insert into public.users(id,username,display_name,password_hash,role) values ('f7000000-0000-0000-0000-000000000001','date_dev','Dev','test','developer');
insert into public.orders(order_id,product_code,name,event_type,app_status,gross_amount,created_at,source_created_at) values
 -- 16 Okt 01:30 WIB = 15 Okt 18:30 UTC (dulu jatuh ke 15 Okt)
 ('d-early','AAAA','Pagi','Seminar Offline','Paid',100,'2026-10-15 18:30:01+00','2026-10-15 18:30:00+00'),
 -- 16 Okt 23:50 WIB = 16 Okt 16:50 UTC
 ('d-late','AAAA','Malam','Seminar Offline','Pending',100,'2026-10-16 16:50:01+00','2026-10-16 16:50:00+00'),
 -- 15 Okt 23:59 WIB = 15 Okt 16:59 UTC (bukan 16 Okt)
 ('d-prev','AAAA','Kemarin','Seminar Offline','Paid',100,'2026-10-15 16:59:01+00','2026-10-15 16:59:00+00'),
 -- dibuat di OrderOnline 12 Okt, baru masuk 16 Okt (sinkron belakangan) -> milik 12 Okt
 ('d-sync','AAAA','Sinkron','Seminar Offline','Paid',100,'2026-10-16 03:16:27+00','2026-10-12 13:32:02+00'),
 -- tanpa source_created_at -> pakai created_at (16 Okt 10:00 WIB)
 ('d-nosrc','AAAA','Tanpa Sumber','Seminar Offline','Pending',100,'2026-10-16 03:00:00+00',null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-000000000001","app_role":"developer"}';
select is((select array_agg(r->>'order_id' order by r->>'order_id') from jsonb_array_elements(
  public.orders_page(p_date_from => '2026-10-16', p_date_to => '2026-10-16')->'rows') r),
  array['d-early','d-late','d-nosrc'], 'orders_page 16 Okt = hari WIB + tanggal order');
select is((public.dashboard_summary(p_date_from => '2026-10-16', p_date_to => '2026-10-16')->>'leads')::int, 3, 'dashboard leads 16 Okt');
select is((public.dashboard_summary(p_date_from => '2026-10-16', p_date_to => '2026-10-16')->>'paid')::int, 1, 'dashboard paid 16 Okt');
select is((public.dashboard_summary(p_date_from => '2026-10-15', p_date_to => '2026-10-15')->>'leads')::int, 1, '15 Okt hanya order 23:59 WIB');
select is((public.dashboard_summary(p_date_from => '2026-10-12', p_date_to => '2026-10-12')->>'leads')::int, 1, 'order sinkron belakangan masuk ke tanggal ordernya');
select is((public.presensi_summary(p_date_from => '2026-10-16', p_date_to => '2026-10-16')->>'paid')::int, 1, 'presensi_summary ikut');
select is((public.presensi_page(p_date_from => '2026-10-16', p_date_to => '2026-10-16')->>'total')::int, 3, 'presensi_page ikut');
reset role;

select * from finish();
rollback;
