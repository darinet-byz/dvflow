-- ============================================================================
-- 02_webhook_upsert — idempotensi & validasi ingestion (C01–C14)
-- ============================================================================
-- Catatan cakupan: M01 ("dua webhook identik bersamaan -> satu baris")
-- TIDAK dapat dibuktikan di sini karena pgTAP berjalan pada satu sesi. Yang
-- diuji adalah mekanismenya (UPSERT berbasis unique `order_id`) lewat
-- pengulangan, ditambah satu pengujian dua sesi terpisah di
-- `03_seminar_checkin.sql` untuk pola lock yang sama.

begin;

-- pgtap sudah dipasang CLI di schema `extensions`; jangan dibuat di `public`
-- (lihat catatan platform di supabase/tests/README.md).
set local search_path = public, extensions, pg_catalog;

select no_plan();

-- ---------------------------------------------------------------------------
-- C01: webhook pertama -> tepat satu baris
-- ---------------------------------------------------------------------------
select is(
  (select public.upsert_order_webhook(jsonb_build_object(
     'orderId', '100001',
     'customerName', 'Budi',
     'phone', '+628111',
     'email', 'budi@example.com',
     'productRaw', 'KM01SO392 - S1 - Solo',
     'rawStatus', 'pending',
     'appStatus', 'Pending',
     'paymentMethod', 'bank_transfer',
     'paymentIdentifier', 'Bank  Transfer',
     'grossAmount', 300000,
     'sourceCreatedAt', '2026-09-15 02:31:33',
     'parse', jsonb_build_object(
       'status', 'valid',
       'productCode', 'KM', 'productName', 'Kuliner Masteri',
       'advertiserCode', '01', 'advertiserName', 'Zul',
       'eventType', 'Seminar Offline',
       'batch', '392', 'session', 'S1', 'city', 'Solo'
     )
   )
  ) ->> 'action'),
  'inserted',
  'C01 webhook pertama melaporkan action=inserted'
);

select is((select count(*) from public.orders where order_id = '100001'), 1::bigint,
  'C01 tepat satu baris Master Order');

select is((select payment_identifier_normalized from public.orders where order_id = '100001'),
  'bank transfer',
  'identifier dinormalisasi (trim + collapse spasi + lowercase) di database');

-- ---------------------------------------------------------------------------
-- C02 / C14: webhook yang sama diulang 10x -> tetap satu baris
-- ---------------------------------------------------------------------------
do $$
declare
  i integer;
  v_action text;
begin
  for i in 1..10 loop
    v_action := public.upsert_order_webhook(jsonb_build_object(
      'orderId', '100001',
      'rawStatus', 'pending',
      'appStatus', 'Pending',
      'grossAmount', 300000
    )) ->> 'action';

    if v_action <> 'updated' then
      raise exception 'pengulangan ke-% melaporkan action=%', i, v_action;
    end if;
  end loop;
end
$$;

select is((select count(*) from public.orders where order_id = '100001'), 1::bigint,
  'C02 webhook yang sama diulang 10x tetap satu baris');

-- A7: `null` berarti "tidak disebutkan" — data lama tidak boleh terhapus.
select is((select name from public.orders where order_id = '100001'), 'Budi',
  'A7 nama yang sudah ada tidak terhapus oleh webhook parsial');
select is((select product_raw from public.orders where order_id = '100001'), 'KM01SO392 - S1 - Solo',
  'A7 product_raw yang sudah ada tidak terhapus oleh webhook parsial');
select is((select city from public.orders where order_id = '100001'), 'Solo',
  'A7 hasil parsing lama tidak terhapus oleh webhook tanpa blok parse');

-- ---------------------------------------------------------------------------
-- C03–C06: pemetaan status (dipetakan Worker; SQL menyimpan hasilnya)
-- ---------------------------------------------------------------------------
select is(
  (select public.upsert_order_webhook(jsonb_build_object(
     'orderId', '100002', 'rawStatus', 'processing', 'appStatus', 'Paid', 'grossAmount', 50000)) ->> 'action'),
  'inserted', 'C04 processing -> Paid tersimpan sebagai order baru');
select is((select app_status from public.orders where order_id = '100002'), 'Paid',
  'C04 app_status = Paid');

select is(
  (select public.upsert_order_webhook(jsonb_build_object(
     'orderId', '100003', 'rawStatus', 'complete', 'appStatus', 'Paid', 'grossAmount', 50000)) ->> 'action'),
  'inserted', 'C05 complete -> Paid');
select is((select app_status from public.orders where order_id = '100003'), 'Paid',
  'C05 app_status = Paid');

select is(
  (select public.upsert_order_webhook(jsonb_build_object(
     'orderId', '100004', 'rawStatus', 'cancelled', 'appStatus', 'Cancelled', 'grossAmount', 50000)) ->> 'action'),
  'inserted', 'C06 cancelled -> Cancelled');
select is((select app_status from public.orders where order_id = '100004'), 'Cancelled',
  'C06 app_status = Cancelled');

select is((select raw_status from public.orders where order_id = '100002'), 'processing',
  'raw_status asli provider disimpan untuk audit');

-- ---------------------------------------------------------------------------
-- C07: status tak dikenal tidak pernah dipetakan diam-diam.
--
-- Pembagian tanggung jawabnya: PEMETAAN raw_status -> app_status (termasuk
-- menolak status tak dikenal dengan 422 UNSUPPORTED_ORDER_STATUS) ada di Worker,
-- yang belum dibangun (P3/P4). Di layer database yang dapat diuji sekarang:
-- app_status hanya boleh dari daftar tertutup, dan raw_status disimpan apa
-- adanya sehingga tidak ada pemetaan yang dikarang di sini.
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'orderId', '100005', 'rawStatus', 'pending', 'appStatus', 'Refunded', 'grossAmount', 1000))$q$,
  'DF014', 'INVALID_PAYLOAD', 'C07 app_status karangan ditolak');

select lives_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'orderId', '100005', 'rawStatus', 'refunded', 'appStatus', 'Pending', 'grossAmount', 1000))$q$,
  'C07 database menerima raw_status tak dikenal apa adanya (penolakan ada di Worker)');

select is((select raw_status from public.orders where order_id = '100005'), 'refunded',
  'C07 raw_status mentah disimpan apa adanya, tanpa pemetaan karangan');

select is((select app_status from public.orders where order_id = '100005'), 'Pending',
  'C07 app_status hanya berisi nilai yang dikirim Worker, bukan hasil tebakan SQL');

-- ---------------------------------------------------------------------------
-- C08: order ID hilang -> ditolak
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', 1000))$q$,
  'DF014', 'INVALID_PAYLOAD', 'C08 payload tanpa order ID ditolak');

select throws_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'orderId', '   ', 'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', 1000))$q$,
  'DF014', 'INVALID_PAYLOAD', 'C08 order ID kosong ditolak');

-- ---------------------------------------------------------------------------
-- C09: gross amount tidak masuk akal -> ditolak
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'orderId', '100006', 'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', 'abc'))$q$,
  'DF014', 'INVALID_PAYLOAD', 'C09 gross non-numerik ditolak');

select throws_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'orderId', '100006', 'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', -1))$q$,
  'DF014', 'INVALID_PAYLOAD', 'C09 gross negatif ditolak');

select throws_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'orderId', '100006', 'rawStatus', 'pending', 'appStatus', 'Pending'))$q$,
  'DF014', 'INVALID_PAYLOAD', 'C09 gross hilang ditolak');

-- ---------------------------------------------------------------------------
-- C10 / C12: parse invalid -> order tetap tersimpan, product_raw dipertahankan
-- ---------------------------------------------------------------------------
select is(
  (select public.upsert_order_webhook(jsonb_build_object(
     'orderId', '100007',
     'customerName', 'Siti',
     'productRaw', 'TIDAK-SESUAI-FORMAT',
     'rawStatus', 'pending',
     'appStatus', 'Pending',
     'grossAmount', 20000,
     'parse', jsonb_build_object('status', 'invalid')
   )) ->> 'action'),
  'inserted',
  'C10 order dengan produk tidak valid tetap diterima');

select is((select product_parse_status from public.orders where order_id = '100007'), 'invalid',
  'C10 product_parse_status = invalid');
select is((select product_raw from public.orders where order_id = '100007'), 'TIDAK-SESUAI-FORMAT',
  'C12 product_raw dipertahankan apa adanya');
select is((select event_type from public.orders where order_id = '100007'), null::text,
  'C10 event_type tidak dapat dipastikan -> NULL (akses acara nanti ditolak)');
select is((select product_code from public.orders where order_id = '100007'), null::text,
  'C10 field normalized yang tidak pasti -> NULL');

-- ---------------------------------------------------------------------------
-- C13: transisi pertama ke Paid mengisi paid_at; Paid berulang tidak menggesernya
-- ---------------------------------------------------------------------------
select isnt((select paid_at from public.orders where order_id = '100002'), null::timestamptz,
  'C13 paid_at terisi saat order pertama kali Paid');

select is(
  (select public.upsert_order_webhook(jsonb_build_object(
     'orderId', '100003', 'rawStatus', 'processing', 'appStatus', 'Paid', 'grossAmount', 50000)) ->> 'action'),
  'updated', 'C14 Paid berulang tetap order yang sama');

-- Bandingkan paid_at sebelum/sesudah pengulangan.
do $$
declare
  v_before timestamptz;
  v_after timestamptz;
begin
  select paid_at into v_before from public.orders where order_id = '100002';

  perform public.upsert_order_webhook(jsonb_build_object(
    'orderId', '100002', 'rawStatus', 'complete', 'appStatus', 'Paid', 'grossAmount', 50000));

  select paid_at into v_after from public.orders where order_id = '100002';

  if v_before is distinct from v_after then
    raise exception 'paid_at bergeser pada webhook Paid berulang';
  end if;
end
$$;

select pass('C13 paid_at tidak bergeser pada webhook Paid berulang');

-- rawStatus tetap diperbarui walau app_status sama (terakhir menang, STATE.md O1).
select is((select raw_status from public.orders where order_id = '100002'), 'complete',
  'raw_status mengikuti webhook terakhir');

-- ---------------------------------------------------------------------------
-- created_at tidak pernah bergeser (timestamp terima lokal pertama)
-- ---------------------------------------------------------------------------
do $$
declare
  v_before timestamptz;
  v_after timestamptz;
begin
  select created_at into v_before from public.orders where order_id = '100001';
  perform public.upsert_order_webhook(jsonb_build_object(
    'orderId', '100001', 'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', 300000));
  select created_at into v_after from public.orders where order_id = '100001';
  if v_before is distinct from v_after then
    raise exception 'created_at bergeser pada webhook berulang';
  end if;
end
$$;

select pass('created_at tidak bergeser pada webhook berulang');

-- ---------------------------------------------------------------------------
-- payload bukan objek JSON -> ditolak
-- ---------------------------------------------------------------------------
select throws_ok('select public.upsert_order_webhook(null::jsonb)',
  'DF014', 'INVALID_PAYLOAD', 'payload null ditolak');
select throws_ok('select public.upsert_order_webhook(''[]''::jsonb)',
  'DF014', 'INVALID_PAYLOAD', 'payload array ditolak');

-- ---------------------------------------------------------------------------
-- productRaw dikirim tanpa blok parse -> kontrak dilanggar
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$select public.upsert_order_webhook(jsonb_build_object(
       'orderId', '100008', 'rawStatus', 'pending', 'appStatus', 'Pending',
       'grossAmount', 1000, 'productRaw', 'KM01SO392 - S1 - Solo'))$q$,
  'DF014', 'INVALID_PAYLOAD', 'productRaw tanpa hasil parsing ditolak');

-- ---------------------------------------------------------------------------
-- batch tetap string: '001' tidak kehilangan leading zero (D05)
-- ---------------------------------------------------------------------------
select public.upsert_order_webhook(jsonb_build_object(
  'orderId', '100009', 'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', 1000,
  'productRaw', 'KM01SO001 - ST - Solo',
  'parse', jsonb_build_object(
    'status', 'valid', 'productCode', 'KM', 'productName', 'Kuliner Masteri',
    'advertiserCode', '01', 'advertiserName', 'Zul',
    'eventType', 'Seminar Offline', 'batch', '001', 'session', 'ST', 'city', 'Solo')));

select is((select batch from public.orders where order_id = '100009'), '001',
  'D05 batch disimpan sebagai string, leading zero tidak hilang');

select * from finish();
rollback;
