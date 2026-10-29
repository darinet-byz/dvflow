-- 0063 (A58): Reschedule & Refund.
-- Mengunci:
--   * Refund = status order ke-4, penuh, dapat dibatalkan dengan audit;
--   * order refund keluar dari seluruh laporan Paid dan masuk halaman Order Refund;
--   * reschedule hanya menggeser acara efektif (bukan omzet/atribusi penjualan);
--   * reschedule hanya sebelum presensi, bukan OTS, dan tidak ditimpa webhook;
--   * status Presensi: Reschedule sampai check-in, lalu Hadir; Refund selalu Refund;
--   * izin dan RLS.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 63, 'schema_version mencakup 0063');

insert into public.app_roles(id, name, description, is_system)
values ('rr_none', 'RR None', null, false)
on conflict (id) do nothing;
insert into public.users(id, username, display_name, password_hash, role, has_all_product_access)
values
  ('fa000000-0000-0000-0000-000000000001', 'rr_dev', 'RR Dev', 'test', 'developer', true),
  ('fa000000-0000-0000-0000-000000000002', 'rr_member', 'RR Member', 'test', 'rr_none', true);

insert into public.orders(
  order_id, name, phone, product_code, product_name, advertiser_code, advertiser_name,
  event_type, batch, session, city, product_raw, product_parse_status, app_status,
  gross_amount, quantity, payment_method, payment_identifier, payment_identifier_normalized,
  created_at, paid_at
) values
  ('rr-a', 'Peserta A', '0811', 'RRA', 'Produk A', 'RRA', 'Iklan A',
   'Seminar Offline', '100', 'S1', 'Solo', 'RRA RRA SO 100 - S1 - Solo', 'valid', 'Paid',
   300000, 2, 'bank_transfer', 'bank_transfer', 'bank_transfer', now(), now()),
  ('rr-b', 'Peserta B', '0812', 'RRB', 'Produk B', 'RRA', 'Iklan A',
   'Seminar Offline', '100', 'S1', 'Solo', 'RRB RRA SO 100 - S1 - Solo', 'valid', 'Paid',
   200000, 1, 'bank_transfer', 'bank_transfer', 'bank_transfer', now(), now()),
  ('rr-c', 'Peserta C', '0813', 'RRB', 'Produk B', 'RRA', 'Iklan A',
   'Seminar Offline', '100', 'S1', 'Solo', 'RRB RRA SO 100 - S1 - Solo', 'valid', 'Paid',
   150000, 1, 'bank_transfer', 'bank_transfer', 'bank_transfer', now(), now()),
  ('rr-pending', 'Peserta Pending', '0814', 'RRB', 'Produk B', 'RRA', 'Iklan A',
   'Seminar Offline', '100', 'S1', 'Solo', 'RRB RRA SO 100 - S1 - Solo', 'valid', 'Pending',
   100000, 1, 'bank_transfer', 'bank_transfer', 'bank_transfer', now(), null),
  ('rr-ots', 'Peserta OTS', '0815', 'RRB', 'Produk B', null, null,
   'Seminar Offline', '100', 'S1', 'Solo', 'RRB 100 - S1 - Solo (OTS)', 'valid', 'Paid',
   100000, 1, 'ots_tunai', 'ots_tunai', 'ots_tunai', now(), now());

update public.orders set source = 'ots' where order_id = 'rr-ots';

-- rr-c sudah punya presensi seminar: reschedule harus ditolak, refund tetap boleh.
insert into public.attendance_events(order_id, attendance_type, source, scanner_user_id)
values ('rr-c', 'seminar', 'seminar_qr', 'fa000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Reschedule
-- ---------------------------------------------------------------------------
select public.reschedule_order(
  'fa000000-0000-0000-0000-000000000001', 'rr-a', null, 'S2', 'Bandung', 'pindah kota'
);
select is((select event_session from public.orders where order_id = 'rr-a'), 'S2', 'reschedule: sesi tujuan tersimpan');
select is((select event_city from public.orders where order_id = 'rr-a'), 'Bandung', 'reschedule: kota tujuan tersimpan');
select is((select event_batch from public.orders where order_id = 'rr-a'), null, 'reschedule: batch tidak berubah -> override null');
select is((select effective_session from public.orders where order_id = 'rr-a'), 'S2', 'reschedule: effective_session dihitung');
select is((select effective_city from public.orders where order_id = 'rr-a'), 'Bandung', 'reschedule: effective_city dihitung');
select is((select count(*)::int from public.order_reschedules where order_id = 'rr-a'), 1, 'reschedule: satu baris riwayat');
select is((select actor_name from public.order_reschedules where order_id = 'rr-a'), 'RR Dev', 'reschedule: aktor dicatat');

-- Webhook berikutnya tidak boleh menimpa override.
select public.upsert_order_webhook('{
  "orderId":"rr-a","rawStatus":"complete","appStatus":"Paid","grossAmount":300000,
  "productRaw":"RRA RRA SO 100 - S1 - Solo",
  "parse":{"status":"valid","productCode":"RRA","productName":"Produk A",
           "advertiserCode":"RRA","advertiserName":"Iklan A","eventType":"Seminar Offline",
           "batch":"100","session":"S1","city":"Solo"}
}');
select is((select event_session from public.orders where order_id = 'rr-a'), 'S2', 'webhook: override sesi tidak ditimpa');
select is((select effective_city from public.orders where order_id = 'rr-a'), 'Bandung', 'webhook: acara efektif tetap tujuan');
select is((select city from public.orders where order_id = 'rr-a'), 'Solo', 'webhook: data asal tetap dari provider');

-- Reschedule kembali ke acara asal -> override bersih, status kembali Belum Hadir.
select public.reschedule_order(
  'fa000000-0000-0000-0000-000000000001', 'rr-b', null, 'S2', 'Bandung', 'pindah dulu'
);
select public.reschedule_order(
  'fa000000-0000-0000-0000-000000000001', 'rr-b', null, 'S1', 'Solo', 'kembali'
);
select is((select event_session from public.orders where order_id = 'rr-b'), null, 'reschedule balik: override sesi bersih');
select is((select event_city from public.orders where order_id = 'rr-b'), null, 'reschedule balik: override kota bersih');
select is((select count(*)::int from public.order_reschedules where order_id = 'rr-b'), 2, 'reschedule balik: kedua langkah tercatat');

-- Presensi & laporan operasional memakai acara efektif.
set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-000000000001","app_role":"developer"}';
select is((public.presensi_page(p_search => 'rr-a')->'rows'->0->>'attendance_status'), 'Reschedule', 'presensi: status Reschedule sebelum check-in');
select is((public.presensi_page(p_search => 'rr-a')->'rows'->0->>'session'), 'S2', 'presensi: sesi efektif');
select is((public.presensi_page(p_search => 'rr-a', p_city => 'Bandung')->'total')::int, 1, 'presensi: filter kota tujuan menemukan peserta');
select is((public.presensi_page(p_search => 'rr-a', p_city => 'Solo')->'total')::int, 0, 'presensi: filter kota asal tidak menemukan peserta');
select is((public.presensi_page(p_attendance_status => 'Reschedule')->'total')::int >= 1, true, 'presensi: filter Reschedule valid');
select is((public.presensi_summary(p_search => 'rr-a', p_city => 'Bandung')->>'paid')::int, 1, 'presensi_summary: filter memakai acara efektif');
select is((public.dashboard_summary(p_search => 'rr-a', p_city => 'Bandung')->>'paid')::int, 0, 'dashboard: omzet/atribusi tetap di acara asal');
select is((public.dashboard_summary(p_search => 'rr-a', p_city => 'Solo')->>'paid')::int, 1, 'dashboard: acara asal tetap menghitung order');
select is((public.orders_page(p_search => 'rr-a')->'rows'->0->>'rescheduled')::boolean, true, 'orders_page: menandai rescheduled');
select is((public.orders_page(p_search => 'rr-a')->'rows'->0->>'session'), 'S1', 'orders_page: menampilkan sesi asal');
select is((public.batch_session_summary('RRA', '100')->'summary'->>'tickets')::int, 2, 'resume batch: tiket pindah ke acara efektif');
select is((public.batch_session_summary('RRA', '100')->'rows'->0->>'session'), 'S2', 'resume batch: sesi efektif');
select is((public.batch_session_summary('RRA', '100')->'rows'->0->>'city'), 'Bandung', 'resume batch: kota efektif');

reset role;

-- Setelah check-in di tujuan, status menjadi Hadir dan reschedule berikutnya ditolak.
insert into public.attendance_events(order_id, attendance_type, source, scanner_user_id)
values ('rr-a', 'seminar', 'seminar_qr', 'fa000000-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-000000000001","app_role":"developer"}';
select is((public.presensi_page(p_search => 'rr-a')->'rows'->0->>'attendance_status'), 'Hadir', 'presensi: reschedule menjadi Hadir setelah check-in');
reset role;

select throws_ok(
  $$select public.reschedule_order('fa000000-0000-0000-0000-000000000001', 'rr-a', null, 'S2', 'Bandung', null)$$,
  'DF019', 'ORDER_ALREADY_CHECKED_IN', 'reschedule: ditolak setelah ada presensi'
);
select throws_ok(
  $$select public.reschedule_order('fa000000-0000-0000-0000-000000000001', 'rr-c', null, 'S2', 'Bandung', null)$$,
  'DF019', 'ORDER_ALREADY_CHECKED_IN', 'reschedule: ditolak untuk peserta yang sudah check-in'
);
select throws_ok(
  $$select public.reschedule_order('fa000000-0000-0000-0000-000000000001', 'rr-ots', null, 'S2', 'Bandung', null)$$,
  'DF022', 'RESCHEDULE_NOT_ALLOWED', 'reschedule: order OTS ditolak'
);
select throws_ok(
  $$select public.reschedule_order('fa000000-0000-0000-0000-000000000001', 'rr-pending', null, 'S2', 'Bandung', null)$$,
  'DF002', 'ORDER_NOT_PAID', 'reschedule: order Pending ditolak'
);
select throws_ok(
  $$select public.reschedule_order('fa000000-0000-0000-0000-000000000001', 'rr-b', null, 'S99', 'Medan', null)$$,
  'DF011', 'INVALID_ARGUMENT', 'reschedule: sesi tidak terdaftar ditolak'
);

-- ---------------------------------------------------------------------------
-- Refund
-- ---------------------------------------------------------------------------
select public.refund_order('fa000000-0000-0000-0000-000000000001', 'rr-c', 'peserta membatalkan');
select is((select app_status from public.orders where order_id = 'rr-c'), 'Refund', 'refund: status order Refund');
select is((select amount from public.order_refunds where order_id = 'rr-c' and reverted_at is null), 150000::numeric, 'refund: nominal penuh = gross');
select throws_ok(
  $$select public.refund_order('fa000000-0000-0000-0000-000000000001', 'rr-c', 'lagi')$$,
  'DF020', 'ORDER_ALREADY_REFUNDED', 'refund: duplikat ditolak'
);
select throws_ok(
  $$select public.refund_order('fa000000-0000-0000-0000-000000000001', 'rr-pending', 'batal')$$,
  'DF002', 'ORDER_NOT_PAID', 'refund: order Pending ditolak'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-000000000001","app_role":"developer"}';
select is((public.presensi_page(p_search => 'rr-c')->'rows'->0->>'attendance_status'), 'Refund', 'presensi: status Refund');
select is((public.presensi_page(p_attendance_status => 'Refund')->'total')::int, 1, 'presensi: filter Refund');
select is((public.presensi_summary(p_search => 'rr-c')->>'paid')::int, 0, 'presensi_summary: refund tidak dihitung Paid');
select is((public.dashboard_summary(p_search => 'rr-c')->>'paid')::int, 0, 'dashboard: refund tidak dihitung Paid');
select is((public.dashboard_summary(p_search => 'rr-c')->>'gross_amount')::numeric, 0::numeric, 'dashboard: omzet refund dikeluarkan');
select is((public.dashboard_summary(p_search => 'rr-c')->>'paid_tickets')::int, 0, 'dashboard: jumlah tiket refund dikeluarkan');
select is((public.tax_report('payment_method', p_search => 'rr-c')->'summary'->>'transactions')::int, 0, 'tax report: refund dikeluarkan');
select is((public.orders_page(p_search => 'rr-c', p_app_status => 'Refund')->'total')::int, 1, 'orders_page: filter status Refund');
select is((public.refund_page(p_search => 'rr-c')->'summary'->>'total')::int, 1, 'refund_page: satu order refund');
select is((public.refund_page(p_search => 'rr-c')->'summary'->>'tickets')::int, 1, 'refund_page: tiket refund');
select is((public.refund_page(p_search => 'rr-c')->'summary'->>'amount')::numeric, 150000::numeric, 'refund_page: nominal refund');
reset role;

-- Webhook saat refund tidak boleh membatalkan status Refund; status provider terakhir disimpan.
select public.upsert_order_webhook('{
  "orderId":"rr-c","rawStatus":"cancelled","appStatus":"Cancelled","grossAmount":150000,
  "productRaw":"RRB RRA SO 100 - S1 - Solo",
  "parse":{"status":"valid","productCode":"RRB","productName":"Produk B",
           "advertiserCode":"RRA","advertiserName":"Iklan A","eventType":"Seminar Offline",
           "batch":"100","session":"S1","city":"Solo"}
}');
select is((select app_status from public.orders where order_id = 'rr-c'), 'Refund', 'webhook: Refund tidak dibatalkan');
select is((select previous_status from public.order_refunds where order_id = 'rr-c' and reverted_at is null), 'Cancelled', 'webhook: status provider terakhir dicatat');

select public.cancel_refund('fa000000-0000-0000-0000-000000000001', 'rr-c', 'ternyata tidak jadi refund');
select is((select app_status from public.orders where order_id = 'rr-c'), 'Cancelled', 'cancel refund: kembali ke status provider terakhir');
select is((select count(*)::int from public.order_refunds where order_id = 'rr-c' and reverted_at is null), 0, 'cancel refund: tidak ada refund aktif');
select is((select count(*)::int from public.order_refunds where order_id = 'rr-c' and reverted_at is not null), 1, 'cancel refund: audit tetap tersimpan');
select throws_ok(
  $$select public.cancel_refund('fa000000-0000-0000-0000-000000000001', 'rr-c', 'lagi')$$,
  'DF021', 'ORDER_NOT_REFUNDED', 'cancel refund: tanpa refund aktif ditolak'
);

-- Provider mengirim Paid lagi, lalu refund kedua dibatalkan -> kembali ke Paid.
select public.upsert_order_webhook('{
  "orderId":"rr-c","rawStatus":"complete","appStatus":"Paid","grossAmount":150000,
  "productRaw":"RRB RRA SO 100 - S1 - Solo",
  "parse":{"status":"valid","productCode":"RRB","productName":"Produk B",
           "advertiserCode":"RRA","advertiserName":"Iklan A","eventType":"Seminar Offline",
           "batch":"100","session":"S1","city":"Solo"}
}');
select public.refund_order('fa000000-0000-0000-0000-000000000001', 'rr-c', 'refund kedua');
select public.cancel_refund('fa000000-0000-0000-0000-000000000001', 'rr-c', 'batal refund kedua');
select is((select app_status from public.orders where order_id = 'rr-c'), 'Paid', 'cancel refund kedua: kembali ke Paid');

-- ---------------------------------------------------------------------------
-- Izin & RLS
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.reschedule_order('fa000000-0000-0000-0000-000000000002', 'rr-b', null, 'S2', 'Bandung', null)$$,
  'DF006', 'FORBIDDEN', 'reschedule: butuh action.reschedule'
);
select throws_ok(
  $$select public.refund_order('fa000000-0000-0000-0000-000000000002', 'rr-b', 'x')$$,
  'DF006', 'FORBIDDEN', 'refund: butuh action.refund'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-000000000002","app_role":"rr_none"}';
select is((select count(*)::int from public.order_refunds), 0, 'RLS: order_refunds tertutup tanpa izin Order Refund');
select is((select count(*)::int from public.order_reschedules), 0, 'RLS: order_reschedules tertutup tanpa izin Presensi/Order');
select throws_ok(
  $$select public.refund_page()$$,
  'DF006', 'FORBIDDEN', 'refund_page: butuh izin Order Refund'
);
reset role;

select * from finish();
rollback;
