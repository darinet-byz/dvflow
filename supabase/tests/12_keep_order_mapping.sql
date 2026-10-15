-- 0034 (A17): pemetaan order yang sudah valid tidak dihapus oleh webhook berikutnya dengan nama
-- produk yang sama (mis. alias dihapus); nama berbeda dan order baru tetap mengikuti hasil parse.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 34, 'schema_version mencakup 0034');

-- Webhook pertama: nama toko "Nama Toko VIP" dipetakan lewat alias (parse valid).
select is((public.upsert_order_webhook('{"orderId":"km1","rawStatus":"pending","appStatus":"Pending","grossAmount":100000,
  "productRaw":"Nama Toko VIP","parse":{"status":"valid","productCode":"KULI","productName":"Kuliner","advertiserCode":"01",
  "advertiserName":"Zul","eventType":"Seminar Offline","batch":"392","session":"S1","city":"Solo"}}') ->> 'mapping_kept')::boolean,
  false, 'webhook pertama: tidak ada pengunci');

-- Alias dihapus -> webhook Paid membawa nama yang sama tetapi parse invalid.
select is((public.upsert_order_webhook('{"orderId":"km1","rawStatus":"processing","appStatus":"Paid","grossAmount":100000,
  "productRaw":"Nama Toko VIP","parse":{"status":"invalid"}}') ->> 'mapping_kept')::boolean,
  true, 'webhook berikutnya dengan nama sama: pemetaan dikunci');
select is((select product_parse_status from public.orders where order_id = 'km1'), 'valid', 'tetap valid');
select is((select product_code || '|' || event_type || '|' || batch || '|' || session || '|' || city from public.orders where order_id = 'km1'),
  'KULI|Seminar Offline|392|S1|Solo', 'produk/tipe/batch/sesi/kota tidak dikosongkan');
select is((select app_status from public.orders where order_id = 'km1'), 'Paid', 'status tetap diperbarui');

-- Nama produk berbeda: memang produk berganti -> ikut hasil parse (invalid, kolom NULL).
select public.upsert_order_webhook('{"orderId":"km1","rawStatus":"processing","appStatus":"Paid","grossAmount":100000,
  "productRaw":"Produk Lain","parse":{"status":"invalid"}}');
select is((select product_parse_status from public.orders where order_id = 'km1'), 'invalid', 'nama berbeda: di-parse ulang');
select is((select product_code from public.orders where order_id = 'km1'), null, 'nama berbeda: kolom dikosongkan');

-- Order baru dengan nama tanpa alias tetap Unmapped.
select public.upsert_order_webhook('{"orderId":"km2","rawStatus":"pending","appStatus":"Pending","grossAmount":100000,
  "productRaw":"Nama Toko VIP","parse":{"status":"invalid"}}');
select is((select product_parse_status from public.orders where order_id = 'km2'), 'invalid', 'order baru tetap Unmapped');

select * from finish();
rollback;
