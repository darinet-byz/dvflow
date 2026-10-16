-- 0040 (A25): Paid per Order ID tanpa dobel (processing -> complete), Jumlah Tiket = total quantity order Paid.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 40, 'schema_version mencakup 0040');
insert into public.users(id,username,display_name,password_hash,role) values ('f8000000-0000-0000-0000-000000000001','tix_dev','Dev','test','developer');
-- Order A: 3 tiket, processing lalu complete (dua webhook, tetap satu order).
select public.upsert_order_webhook('{"orderId":"tix-a","rawStatus":"processing","appStatus":"Paid","grossAmount":300,"productRaw":"X","parse":{"status":"invalid"},"quantity":3}');
select public.upsert_order_webhook('{"orderId":"tix-a","rawStatus":"complete","appStatus":"Paid","grossAmount":300,"productRaw":"X","parse":{"status":"invalid"},"quantity":3}');
-- Order B: 2 tiket Paid. Order C: 4 tiket Pending (bukan tiket terjual).
select public.upsert_order_webhook('{"orderId":"tix-b","rawStatus":"processing","appStatus":"Paid","grossAmount":200,"productRaw":"X","parse":{"status":"invalid"},"quantity":2}');
select public.upsert_order_webhook('{"orderId":"tix-c","rawStatus":"pending","appStatus":"Pending","grossAmount":400,"productRaw":"X","parse":{"status":"invalid"},"quantity":4}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-000000000001","app_role":"developer"}';
select is((public.dashboard_summary(p_search => 'tix-')->>'leads')::int, 3, 'leads = 3 Order ID');
select is((public.dashboard_summary(p_search => 'tix-')->>'paid')::int, 2, 'paid = 2 (processing -> complete tidak dobel)');
select is((public.dashboard_summary(p_search => 'tix-')->>'paid_tickets')::int, 5, 'jumlah tiket = 3 + 2 (Pending tidak dihitung)');
reset role;

select * from finish();
rollback;
