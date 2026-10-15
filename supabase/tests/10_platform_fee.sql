-- 0031 (A15): e-payment fee + e-payment fee tax + platform fee; laporan uang hanya Paid.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 31, 'schema_version mencakup 0031');

insert into public.app_settings(key, value_text) values ('fee_setting::platform_fee_percent', '2');
insert into public.payment_fee_rules(name, identifier, fee_type, fee_value, platform_fee_applies, epayment_tax_type, epayment_tax_value) values
  ('VA BCA', 'va_bca', 'flat', 4000, true, 'percentage', 1),
  ('QRIS', 'qris_pf', 'percentage', 0.7, true, null, null),
  ('Bank Transfer', 'transfer_manual', 'flat', 0, false, null, null);

select throws_ok($$insert into public.payment_fee_rules(name, identifier, fee_type, fee_value, epayment_tax_type) values ('X','x1','flat',1,'flat')$$,
  '23514', null, 'tipe e-payment fee tax tanpa nilai ditolak');

-- VA, langsung Paid: 1.000.000 - 4.000 - 40 - 20.000 = 975.960
select public.upsert_order_webhook('{"orderId":"pf1","rawStatus":"processing","appStatus":"Paid","grossAmount":1000000,"paymentIdentifier":"va_bca"}');
select is((select tax_amount from public.orders where order_id='pf1'), 4000.00, 'VA: e-payment fee flat');
select is((select epayment_tax_amount from public.orders where order_id='pf1'), 40.00, 'VA: e-payment fee tax 1% dari e-payment fee');
select is((select platform_fee_amount from public.orders where order_id='pf1'), 20000.00, 'VA: platform fee 2% dari gross');
select is((select net_amount from public.orders where order_id='pf1'), 975960.00, 'VA: net = gross - semua potongan');

-- QRIS: 1.000.000 - 7.000 - 20.000 = 973.000
select public.upsert_order_webhook('{"orderId":"pf2","rawStatus":"complete","appStatus":"Paid","grossAmount":1000000,"paymentIdentifier":"qris_pf"}');
select is((select net_amount from public.orders where order_id='pf2'), 973000.00, 'QRIS: % e-payment fee + platform fee, tanpa PPN');

-- Bank transfer: tanpa platform fee.
select public.upsert_order_webhook('{"orderId":"pf3","rawStatus":"processing","appStatus":"Paid","grossAmount":1000000,"paymentIdentifier":"transfer_manual"}');
select is((select platform_fee_amount from public.orders where order_id='pf3'), 0.00, 'bank transfer tidak kena platform fee');
select is((select net_amount from public.orders where order_id='pf3'), 1000000.00, 'bank transfer: net = gross');

-- Pending: platform fee 0; menjadi Paid -> dihitung dengan tarif saat dibayar.
select public.upsert_order_webhook('{"orderId":"pf4","rawStatus":"pending","appStatus":"Pending","grossAmount":100000,"paymentIdentifier":"qris_pf"}');
select is((select platform_fee_amount from public.orders where order_id='pf4'), 0.00, 'Pending belum kena platform fee');
update public.app_settings set value_text = '3' where key = 'fee_setting::platform_fee_percent';
select public.upsert_order_webhook('{"orderId":"pf4","rawStatus":"processing","appStatus":"Paid","grossAmount":100000,"paymentIdentifier":"qris_pf"}');
select is((select platform_fee_amount from public.orders where order_id='pf4'), 3000.00, 'menjadi Paid: platform fee dihitung dengan tarif saat dibayar');
select is((select platform_fee_percent_snapshot from public.orders where order_id='pf4'), 3.0000, 'tarif platform fee dibekukan sebagai snapshot');

-- Snapshot: mengubah tarif/rule tidak mengubah order yang sudah dihitung.
update public.app_settings set value_text = '5' where key = 'fee_setting::platform_fee_percent';
update public.payment_fee_rules set epayment_tax_value = 50 where identifier = 'va_bca';
select public.upsert_order_webhook('{"orderId":"pf1","rawStatus":"complete","appStatus":"Paid","grossAmount":1000000,"paymentIdentifier":"va_bca"}');
select is((select net_amount from public.orders where order_id='pf1'), 975960.00, 'webhook ulang tanpa perubahan input: snapshot tetap');

-- Laporan uang hanya Paid.
select public.upsert_order_webhook('{"orderId":"pf5","rawStatus":"pending","appStatus":"Pending","grossAmount":777000,"paymentIdentifier":"qris_pf"}');
select public.upsert_order_webhook('{"orderId":"pf6","rawStatus":"cancelled","appStatus":"Cancelled","grossAmount":555000,"paymentIdentifier":"qris_pf"}');
insert into public.users(id,username,display_name,password_hash,role) values ('f1000000-0000-0000-0000-000000000001','pf_dev','Dev','test','developer');
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000001","app_role":"developer"}';
select is((public.tax_report('payment_method')->'summary'->>'gross_amount')::numeric, 3100000::numeric, 'Report Tax: gross hanya dari order Paid');
select is((public.tax_report('payment_method')->'summary'->>'platform_fee_amount')::numeric, 43000::numeric, 'Report Tax: total platform fee');
select is((public.dashboard_summary()->>'gross_amount')::numeric, 3100000::numeric, 'Dashboard: gross hanya order Paid');
select is((public.dashboard_summary()->>'leads')::int, 6, 'Dashboard: leads tetap semua status');
select ok((public.orders_page()->'rows'->0) ? 'platform_fee_amount', 'orders_page menyertakan kolom potongan baru');
reset role;

select * from finish();
rollback;
