-- 0036 (A19): jumlah tiket per order disimpan dari webhook; webhook tanpa quantity mempertahankan nilai.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 36, 'schema_version mencakup 0036');

select public.upsert_order_webhook('{"orderId":"q1","rawStatus":"pending","appStatus":"Pending","grossAmount":100000,"productRaw":"X","parse":{"status":"invalid"}}');
select is((select quantity from public.orders where order_id = 'q1'), 1, 'tanpa quantity: default 1');

select public.upsert_order_webhook('{"orderId":"q1","rawStatus":"pending","appStatus":"Pending","grossAmount":300000,"productRaw":"X","parse":{"status":"invalid"},"quantity":3}');
select is((select quantity from public.orders where order_id = 'q1'), 3, 'quantity 3 disimpan');

select public.upsert_order_webhook('{"orderId":"q1","rawStatus":"processing","appStatus":"Paid","grossAmount":300000,"productRaw":"X","parse":{"status":"invalid"},"quantity":null}');
select is((select quantity from public.orders where order_id = 'q1'), 3, 'webhook tanpa quantity: nilai lama dipertahankan');
select is((select app_status from public.orders where order_id = 'q1'), 'Paid', 'status tetap diperbarui');

select throws_ok($$select public.upsert_order_webhook('{"orderId":"q2","rawStatus":"pending","appStatus":"Pending","grossAmount":1,"productRaw":"X","parse":{"status":"invalid"},"quantity":0}')$$,
  'DF014', 'INVALID_PAYLOAD', 'quantity 0 ditolak');
select throws_ok($$select public.upsert_order_webhook('{"orderId":"q2","rawStatus":"pending","appStatus":"Pending","grossAmount":1,"productRaw":"X","parse":{"status":"invalid"},"quantity":-2}')$$,
  'DF014', 'INVALID_PAYLOAD', 'quantity negatif ditolak');
select throws_ok($$select public.upsert_order_webhook('{"orderId":"q2","rawStatus":"pending","appStatus":"Pending","grossAmount":1,"productRaw":"X","parse":{"status":"invalid"},"quantity":1.5}')$$,
  'DF014', 'INVALID_PAYLOAD', 'quantity pecahan ditolak');
select throws_ok($$select public.upsert_order_webhook('{"orderId":"q2","rawStatus":"pending","appStatus":"Pending","grossAmount":1,"productRaw":"X","parse":{"status":"invalid"},"quantity":"3"}')$$,
  'DF014', 'INVALID_PAYLOAD', 'quantity string ditolak (adapter sudah mengonversi)');
select is((select count(*)::int from public.orders where order_id = 'q2'), 0, 'payload ditolak tidak membuat order');

select * from finish();
rollback;
