-- 0032 (A16): katalog metode bayar OrderOnline + e-payment fee kombinasi.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 32, 'schema_version mencakup 0032');

select is((select count(*) from public.payment_fee_rules
  where identifier in ('bank_transfer','bca_va','bri_va','bni_va','bsi_va','permata_va','echannel',
                       'gopay','ovo','dana','shopeepay','alfamart','credit_card','instant')), 14::bigint,
  'katalog berisi 14 metode bayar');
select is((select count(*) from public.payment_fee_rules where identifier = 'echannel'), 1::bigint, 'Mandiri = echannel (satu baris)');
select is((select platform_fee_applies from public.payment_fee_rules where identifier = 'bank_transfer'), false, 'bank transfer tidak kena platform fee');
select is((select epayment_tax_value from public.payment_fee_rules where identifier = 'bca_va'), 1.0000, 'VA: e-payment fee tax awal 1%');
select is(public.calc_epayment_fee(100000, 'percentage_flat', 0.7, 1000), 1700.00, 'kombinasi 0,7% + Rp1.000 dari 100.000 = 1.700');

-- Aktifkan VA BCA (kombinasi) + platform fee 2%, lalu webhook instant/bca_va.
insert into public.app_settings(key, value_text) values ('fee_setting::platform_fee_percent', '2')
  on conflict (key) do update set value_text = excluded.value_text;
update public.payment_fee_rules set fee_type = 'percentage_flat', fee_value = 0.7, fee_flat_value = 1000, active = true
 where identifier = 'bca_va';
select public.upsert_order_webhook('{"orderId":"pm1","rawStatus":"processing","appStatus":"Paid","grossAmount":100000,"paymentMethod":"instant","paymentIdentifier":"bca_va"}');
-- 100.000 - 1.700 (fee) - 17 (PPN 1% dari fee) - 2.000 (platform) = 96.283
select is((select tax_amount from public.orders where order_id = 'pm1'), 1700.00, 'e-payment fee kombinasi tersimpan');
select is((select epayment_tax_amount from public.orders where order_id = 'pm1'), 17.00, 'PPN 1% dari e-payment fee');
select is((select net_amount from public.orders where order_id = 'pm1'), 96283.00, 'net VA BCA');
select is((select fee_flat_value_snapshot from public.orders where order_id = 'pm1'), 1000.0000, 'snapshot bagian flat');

-- Channel tidak terbaca -> rule cadangan "instant".
update public.payment_fee_rules set fee_type = 'flat', fee_value = 2500, active = true where identifier = 'instant';
select public.upsert_order_webhook('{"orderId":"pm2","rawStatus":"processing","appStatus":"Paid","grossAmount":100000,"paymentMethod":"instant","paymentIdentifier":"instant"}');
select is((select tax_mapping_status from public.orders where order_id = 'pm2'), 'mapped', 'instant tanpa channel memakai rule cadangan');
select is((select tax_amount from public.orders where order_id = 'pm2'), 2500.00, 'fee rule cadangan diterapkan');

-- Metode yang toggle-nya masih off -> unmapped (tidak dipakai).
select public.upsert_order_webhook('{"orderId":"pm3","rawStatus":"processing","appStatus":"Paid","grossAmount":100000,"paymentMethod":"instant","paymentIdentifier":"ovo"}');
select is((select tax_mapping_status from public.orders where order_id = 'pm3'), 'unmapped', 'metode nonaktif tidak dipakai');

select * from finish();
rollback;
