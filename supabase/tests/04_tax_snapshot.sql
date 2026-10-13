-- ============================================================================
-- 04_tax_snapshot — perhitungan & snapshot tax (E01–E10, M03)
-- ============================================================================
-- Angka yang dipakai sama persis dengan packages/shared/test/tax.test.ts
-- (E01 flat 4000 pada gross 300000 -> 4000; E02 percentage 0.7 -> 2100).
-- Inilah uji paritas SQL <-> TypeScript: dua implementasi, satu angka.

begin;

-- pgtap sudah dipasang CLI di schema `extensions`; jangan dibuat di `public`
-- (lihat catatan platform di supabase/tests/README.md).
set local search_path = public, extensions, pg_catalog;

select no_plan();

-- ---------------------------------------------------------------------------
-- Fixture fee rule
-- ---------------------------------------------------------------------------
-- Test ini mandiri: buang fee rule yang tidak direferensikan order mana pun
-- (yaitu isi seed.sql) supaya tidak bertabrakan dengan fixture di bawah dan
-- supaya angka E01/E02 tidak bergantung pada isi seed.
delete from public.payment_fee_rules r
 where not exists (select 1 from public.orders o where o.fee_rule_id = r.id);

insert into public.payment_fee_rules (name, identifier, fee_type, fee_value)
values ('Admin Transfer 4000', 'Bank  Transfer', 'flat', 4000),
       ('Fee QRIS 0.7%', 'qris', 'percentage', 0.7),
       ('Rule Nonaktif', 'va bca', 'flat', 6500);

update public.payment_fee_rules set active = false where name = 'Rule Nonaktif';

-- ---------------------------------------------------------------------------
-- E01: flat 4000 pada gross 300000
-- ---------------------------------------------------------------------------
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300001', 'rawStatus', 'pending', 'appStatus', 'Pending',
  'grossAmount', 300000, 'paymentIdentifier', 'bank transfer'));

select is((select tax_amount from public.orders where order_id = '300001'), 4000.00::numeric,
  'E01 flat 4000 -> tax 4000');
select is((select net_amount from public.orders where order_id = '300001'), 296000.00::numeric,
  'E01 net = 296000');
select is((select tax_mapping_status from public.orders where order_id = '300001'), 'mapped',
  'E01 tax_mapping_status = mapped');
select is((select fee_rule_name_snapshot from public.orders where order_id = '300001'), 'Admin Transfer 4000',
  'E01 nama rule disimpan sebagai snapshot');
select is((select fee_type_snapshot from public.orders where order_id = '300001'), 'flat',
  'E01 tipe fee disimpan sebagai snapshot');
select is((select fee_value_snapshot from public.orders where order_id = '300001'), 4000::numeric,
  'E01 nilai fee disimpan sebagai snapshot');

-- E04: pencocokan exact atas identifier yang sudah dinormalisasi
-- (identifier dikirim dengan spasi ganda + huruf besar).
select is((select tax_amount from public.orders where order_id = '300001'), 4000.00::numeric,
  'E04 identifier cocok walau beda huruf besar/kecil dan spasi ganda');

-- ---------------------------------------------------------------------------
-- E02: percentage 0.7 pada gross 300000 -> 2100
-- ---------------------------------------------------------------------------
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300002', 'rawStatus', 'pending', 'appStatus', 'Pending',
  'grossAmount', 300000, 'paymentIdentifier', 'QRIS'));

select is((select tax_amount from public.orders where order_id = '300002'), 2100.00::numeric,
  'E02 percentage 0.7 -> tax 2100');
select is((select net_amount from public.orders where order_id = '300002'), 297900.00::numeric,
  'E02 net = 297900');
select is((select fee_rule_name_snapshot from public.orders where order_id = '300002'), 'Fee QRIS 0.7%',
  'E02 snapshot menunjuk rule percentage');

-- ---------------------------------------------------------------------------
-- E03: rule nonaktif tidak pernah dipakai
-- ---------------------------------------------------------------------------
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300003', 'rawStatus', 'pending', 'appStatus', 'Pending',
  'grossAmount', 100000, 'paymentIdentifier', 'VA BCA'));

select is((select tax_mapping_status from public.orders where order_id = '300003'), 'unmapped',
  'E03 rule nonaktif diabaikan');

-- ---------------------------------------------------------------------------
-- E05: tidak ada mapping -> tax 0, net = gross, unmapped
-- ---------------------------------------------------------------------------
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300004', 'rawStatus', 'pending', 'appStatus', 'Pending',
  'grossAmount', 123456, 'paymentIdentifier', 'metode tidak dikenal'));

select is((select tax_amount from public.orders where order_id = '300004'), 0.00::numeric,
  'E05 tanpa mapping -> tax 0');
select is((select net_amount from public.orders where order_id = '300004'), 123456.00::numeric,
  'E05 tanpa mapping -> net = gross');
select is((select tax_mapping_status from public.orders where order_id = '300004'), 'unmapped',
  'E05 tanpa mapping -> unmapped');

-- E06: tidak ada fuzzy fallback. 'qris ' dengan akhiran aneh tidak dicocokkan.
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300005', 'rawStatus', 'pending', 'appStatus', 'Pending',
  'grossAmount', 50000, 'paymentIdentifier', 'qris bca'));

select is((select tax_mapping_status from public.orders where order_id = '300005'), 'unmapped',
  'E06 identifier yang hanya mirip TIDAK dicocokkan');

-- Identifier kosong juga unmapped.
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300006', 'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', 50000));

select is((select tax_mapping_status from public.orders where order_id = '300006'), 'unmapped',
  'E05 order tanpa identifier tidak dipetakan ke rule mana pun');

-- ---------------------------------------------------------------------------
-- E07: edit rule tidak mengubah order historis
-- ---------------------------------------------------------------------------
update public.payment_fee_rules set fee_value = 9999 where name = 'Admin Transfer 4000';

select is((select tax_amount from public.orders where order_id = '300001'), 4000.00::numeric,
  'E07 tax historis tidak berubah setelah rule diedit');
select is((select fee_value_snapshot from public.orders where order_id = '300001'), 4000::numeric,
  'E07 snapshot historis tidak berubah setelah rule diedit');

-- Order BARU memakai nilai rule terbaru.
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300007', 'rawStatus', 'pending', 'appStatus', 'Pending',
  'grossAmount', 100000, 'paymentIdentifier', 'bank transfer'));

select is((select tax_amount from public.orders where order_id = '300007'), 9999.00::numeric,
  'E07 order baru memakai nilai rule terbaru');

update public.payment_fee_rules set fee_value = 4000 where name = 'Admin Transfer 4000';

-- ---------------------------------------------------------------------------
-- E08: menonaktifkan rule tidak mengubah order historis
-- ---------------------------------------------------------------------------
update public.payment_fee_rules set active = false where name = 'Fee QRIS 0.7%';

select is((select tax_amount from public.orders where order_id = '300002'), 2100.00::numeric,
  'E08 tax historis bertahan setelah rule dinonaktifkan');
select is((select fee_rule_name_snapshot from public.orders where order_id = '300002'), 'Fee QRIS 0.7%',
  'E08 snapshot nama rule bertahan');

update public.payment_fee_rules set active = true where name = 'Fee QRIS 0.7%';

-- ---------------------------------------------------------------------------
-- E09: webhook berulang dengan gross/payment yang sama tidak menulis ulang tax
-- ---------------------------------------------------------------------------
do $$
declare
  v_before_tax numeric;
  v_before_net numeric;
  v_before_snapshot numeric;
begin
  select tax_amount, net_amount, fee_value_snapshot
    into v_before_tax, v_before_net, v_before_snapshot
    from public.orders where order_id = '300001';

  -- webhook parsial: hanya status yang berubah
  perform public.upsert_order_webhook(jsonb_build_object(
    'orderId', '300001', 'rawStatus', 'processing', 'appStatus', 'Paid', 'grossAmount', 300000));

  if (select tax_amount from public.orders where order_id = '300001') is distinct from v_before_tax
     or (select net_amount from public.orders where order_id = '300001') is distinct from v_before_net
     or (select fee_value_snapshot from public.orders where order_id = '300001') is distinct from v_before_snapshot then
    raise exception 'snapshot tax berubah padahal gross dan payment tidak berubah';
  end if;
end
$$;

select pass('E09 webhook berulang tanpa perubahan gross/payment tidak menulis ulang snapshot');

-- Gross berubah -> dihitung ulang (bukan retroaktif massal, hanya order ini).
--
-- Webhook di bawah sengaja TIDAK menyebut identifier: webhook parsial seperti
-- ini tidak boleh menghapus pemetaan yang sudah diketahui (A7). Kalau aturan itu
-- hilang, tax akan jatuh menjadi unmapped/0 di sini.
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300001', 'rawStatus', 'processing', 'appStatus', 'Paid', 'grossAmount', 500000));

select is((select tax_mapping_status from public.orders where order_id = '300001'), 'mapped',
  'E09 webhook parsial tanpa identifier tetap mapped (memakai identifier tersimpan)');
select is((select payment_identifier_normalized from public.orders where order_id = '300001'), 'bank transfer',
  'E09 identifier tersimpan tidak terhapus oleh webhook parsial');
select is((select tax_amount from public.orders where order_id = '300001'), 4000.00::numeric,
  'E09 flat tidak berubah saat gross berubah (memang begitu formula flat)');
select is((select net_amount from public.orders where order_id = '300001'), 496000.00::numeric,
  'E09 net dihitung ulang saat gross berubah');

-- ---------------------------------------------------------------------------
-- Order unmapped yang kemudian mendapat rule -> dihitung ulang (01 §12)
-- ---------------------------------------------------------------------------
insert into public.payment_fee_rules (name, identifier, fee_type, fee_value)
values ('Rule Baru VA BCA', 'va bca', 'flat', 6500);

select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '300003', 'rawStatus', 'pending', 'appStatus', 'Pending',
  'grossAmount', 100000, 'paymentIdentifier', 'VA BCA'));

select is((select tax_mapping_status from public.orders where order_id = '300003'), 'mapped',
  'order unmapped dihitung ulang saat rule tersedia');
select is((select tax_amount from public.orders where order_id = '300003'), 6500.00::numeric,
  'order unmapped memakai rule baru');

-- ---------------------------------------------------------------------------
-- E10: identifier aktif duplikat ditolak (unique parsial)
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$insert into public.payment_fee_rules (name, identifier, fee_type, fee_value)
     values ('Duplikat', 'Bank   transfer', 'flat', 1000)$q$,
  '23505', null, 'E10 identifier aktif duplikat ditolak (normalisasi sama)');

-- Tetapi identifier yang sama boleh ada lagi selama rule lama nonaktif.
select lives_ok(
  $q$insert into public.payment_fee_rules (name, identifier, fee_type, fee_value, active)
     values ('Cadangan nonaktif', 'Bank transfer', 'flat', 1000, false)$q$,
  'E10 identifier yang sama boleh ada pada rule nonaktif');

-- ---------------------------------------------------------------------------
-- Paritas aritmetika SQL dengan angka acuan TypeScript (K10)
-- ---------------------------------------------------------------------------
select is(public.calc_tax_amount(300000, 'flat', 4000), 4000.00::numeric,
  'calc_tax_amount: E01');
select is(public.calc_tax_amount(300000, 'percentage', 0.7), 2100.00::numeric,
  'calc_tax_amount: E02');
select is(public.calc_tax_amount(100000, 'percentage', 2.5), 2500.00::numeric,
  'calc_tax_amount: persentase bulat');
-- Pembulatan 2 desimal, setengah ke atas (sepadan roundMoney()).
select is(public.calc_tax_amount(33333, 'percentage', 0.7), 233.33::numeric,
  'calc_tax_amount: pembulatan 2 desimal');

-- ---------------------------------------------------------------------------
-- Normalisasi identifier di SQL sepadan dengan normalizePaymentIdentifier() TS
-- ---------------------------------------------------------------------------
select is(public.normalize_payment_identifier('  Bank   Transfer  '), 'bank transfer',
  'normalize_payment_identifier: trim + collapse + lowercase');
select is(public.normalize_payment_identifier('   '), null::text,
  'normalize_payment_identifier: kosong -> NULL');
select is(public.normalize_payment_identifier(null), null::text,
  'normalize_payment_identifier: NULL -> NULL');
select is(public.normalize_code('  km  '), 'KM',
  'normalize_code: trim + uppercase, spasi tengah dipertahankan');

select * from finish();
rollback;
