-- 0041 (A29) + 0045 (A34): pendaftaran OTS = order baru Paid + langsung hadir;
-- bisa diedit/dihapus; quantity & harga per tiket; webhook tidak menimpanya.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 45, 'schema_version mencakup 0045');
insert into public.products(id,name,code) values ('f9000000-0000-0000-0000-00000000000a','Produk OTS','OTSA'),('f9000000-0000-0000-0000-00000000000b','Produk Lain','OTSB');
insert into public.app_roles(id,name) values ('ots_gate','Gate OTS'),('ots_none','Tanpa OTS'),('ots_only','Hanya OTS');
insert into public.app_role_permissions(role_id,permission_key) values ('ots_gate','action.ots'),('ots_gate','operasional.dashboard'),('ots_gate','operasional.presensi'),('ots_only','action.ots');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('f9000000-0000-0000-0000-0000000000a1','ots_gate','Gate','test','ots_gate',false),
 ('f9000000-0000-0000-0000-0000000000a2','ots_none','None','test','ots_none',true),
 ('f9000000-0000-0000-0000-0000000000a3','ots_only','Only','test','ots_only',false),
 ('f9000000-0000-0000-0000-0000000000d1','ots_dev','Dev','test','developer',true);
insert into public.user_product_access(user_id,product_code) values
 ('f9000000-0000-0000-0000-0000000000a1','OTSA'),
 ('f9000000-0000-0000-0000-0000000000a3','OTSA');

select ok(exists(select 1 from public.app_role_permissions where role_id = 'admin' and permission_key = 'action.ots'), 'izin OTS diberikan ke admin');

-- A34/0046: role yang hanya punya action.ots tetap bisa memuat produk & sesi untuk form.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a3","app_role":"ots_only"}';
select is((select count(*)::int from public.products), 1, 'role hanya action.ots membaca produk dalam scope');
select ok((select count(*) from public.sessions_config) > 0, 'role hanya action.ots membaca sesi');
reset role;

-- Buat dengan form baru: 2 tiket x 150.000. p_amount sengaja 0 untuk membuktikan
-- server menghitung total dari harga satuan x quantity, bukan mempercayai total browser.
select is((public.save_ots_registration(
  'f9000000-0000-0000-0000-0000000000a1', null, 'Budi OTS', '0812', 'otsa', '392', 's1', 'Solo',
  'Seminar Offline', 0, 'ots_tunai', 2, 150000
)->>'action'), 'created', 'OTS dibuat');
select is((select count(*)::int from public.orders where source = 'ots' and name = 'Budi OTS'), 1, 'satu order OTS');
select is((select order_id ~ '^OTS-[0-9]{6}$' from public.orders where name = 'Budi OTS'), true, 'Order ID berbentuk OTS-000001');
select is((select app_status || '|' || quantity || '|' || gross_amount || '|' || net_amount || '|' || tax_amount || '|' || platform_fee_amount || '|' || payment_method
  from public.orders where name = 'Budi OTS'), 'Paid|2|300000.00|300000.00|0.00|0.00|ots_tunai', 'Paid, 2 tiket, total 300.000, tanpa potongan');
select is((select count(*)::int from public.attendance_events e join public.orders o using (order_id) where o.name = 'Budi OTS'), 2, 'langsung hadir: 2 baris untuk 2 tiket');
select is((select bool_and(e.source = 'seminar_ots') from public.attendance_events e join public.orders o using (order_id) where o.name = 'Budi OTS'), true, 'sumber presensi OTS');
select is((select ots_collected_by::text from public.orders where name = 'Budi OTS'), 'f9000000-0000-0000-0000-0000000000a1', 'petugas tercatat');

-- Edit: 3 tiket x 100.000, batch 058 -> 58, sesi/kota berubah.
select is((public.save_ots_registration(
  'f9000000-0000-0000-0000-0000000000a1', (select order_id from public.orders where name = 'Budi OTS'),
  'Budi Santoso', '0813', 'OTSA', '058', 's2', 'Bandung', 'Seminar Offline', 0, 'ots_qris', 3, 100000
)->>'action'), 'updated', 'OTS diedit');
select is((select gross_amount || '|' || net_amount || '|' || quantity || '|' || payment_method || '|' || name || '|' || batch || '|' || session || '|' || city
  from public.orders where source = 'ots' and product_code = 'OTSA'), '300000.00|300000.00|3|ots_qris|Budi Santoso|58|S2|Bandung', 'total, qty, metode, nama, batch/sesi/kota berubah');
select is((select count(*)::int from public.attendance_events e join public.orders o using (order_id) where o.source = 'ots'), 3, 'edit menambah baris tiket yang belum tercatat');

-- Ikut laporan
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"ots_gate"}';
select is((public.dashboard_summary(p_product_code => 'OTSA')->>'paid')::int, 1, 'dashboard: OTS = Paid');
select is((public.dashboard_summary(p_product_code => 'OTSA')->>'paid_tickets')::int, 3, 'dashboard: 3 tiket dari quantity');
select is((public.dashboard_summary(p_product_code => 'OTSA')->>'gross_amount')::numeric, 300000::numeric, 'dashboard: gross OTS');
select is((public.presensi_summary(p_product_code => 'OTSA')->>'sudah_hadir')::int, 3, 'presensi: hadir dihitung per tiket');
reset role;

-- Kompatibilitas aplikasi lama: 11 argumen, tanpa quantity/unit price.
select is((public.save_ots_registration(
  'f9000000-0000-0000-0000-0000000000a1', null, 'Budi Lama', '0812', 'OTSA', '392', 'S1', 'Solo',
  'Seminar Offline', 150000, 'ots_tunai'
)->>'action'), 'created', 'pemanggil lama tetap bisa membuat OTS');
select is((select quantity || '|' || gross_amount from public.orders where name = 'Budi Lama'), '1|150000.00', 'pemanggil lama: 1 tiket, total dari p_amount');

-- Ditolak
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a2', null, 'X', '0812', 'OTSA', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$, 'DF006', 'FORBIDDEN', 'tanpa izin OTS');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSB', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$, 'DF006', 'FORBIDDEN', 'produk di luar scope');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', null, 'OTSA', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$, 'DF011', 'INVALID_ARGUMENT', 'No HP wajib untuk form baru');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSA', null, 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$, 'DF011', 'INVALID_ARGUMENT', 'batch wajib untuk form baru');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSA', '392', null, 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$, 'DF011', 'INVALID_ARGUMENT', 'sesi wajib untuk form baru');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSA', '392', 'S1', null, 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$, 'DF011', 'INVALID_ARGUMENT', 'kota wajib untuk form baru');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSA', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 0, 150000)$$, 'DF011', 'INVALID_ARGUMENT', 'quantity 0');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSA', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 101, 150000)$$, 'DF011', 'INVALID_ARGUMENT', 'quantity 101');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSA', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 0)$$, 'DF011', 'INVALID_ARGUMENT', 'harga 0');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSA', '392', 'S1', 'Solo', 'Webinar Online', 0, 'ots_tunai', 1, 150000)$$, 'DF011', 'INVALID_ARGUMENT', 'webinar bukan OTS');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', '0812', 'OTSA', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'cash', 1, 150000)$$, 'DF011', 'INVALID_ARGUMENT', 'metode tidak dikenal');
insert into public.orders(order_id,product_code,name,event_type,app_status,gross_amount) values ('MTIX-1','OTSA','Online','Seminar Offline','Pending',150000);
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', 'MTIX-1', 'X', '0812', 'OTSA', '392', 'S1', 'Solo', 'Seminar Offline', 0, 'ots_tunai', 1, 150000)$$, 'DF001', 'ORDER_NOT_FOUND', 'order OrderOnline tidak bisa diedit lewat OTS');
select throws_ok($$select public.upsert_order_webhook(jsonb_build_object('orderId', (select order_id from public.orders where source = 'ots' limit 1), 'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', 1, 'productRaw', 'X', 'parse', jsonb_build_object('status', 'invalid')))$$,
  'DF014', 'INVALID_PAYLOAD', 'webhook tidak bisa menimpa order OTS');
select throws_ok($$insert into public.orderonline_connections(name, slug, active, webhook_secret_encrypted, webhook_secret_hash) values ('X', 'OTS', true, 'x', 'y')$$, '23514', null, 'kode toko OTS dicadangkan');

-- Hapus
select throws_ok($$select public.delete_ots_registration('f9000000-0000-0000-0000-0000000000a1', (select order_id from public.orders where source = 'ots' limit 1))$$, 'DF006', 'FORBIDDEN', 'hapus butuh izin hapus');
select is((public.delete_ots_registration('f9000000-0000-0000-0000-0000000000d1', (select order_id from public.orders where name = 'Budi Lama'))->>'deleted')::boolean, true, 'developer menghapus OTS lama');
select is((public.delete_ots_registration('f9000000-0000-0000-0000-0000000000d1', (select order_id from public.orders where name = 'Budi Santoso'))->>'deleted')::boolean, true, 'developer menghapus OTS baru');
select is((select count(*)::int from public.orders where source = 'ots'), 0, 'order OTS terhapus');
select throws_ok($$select public.delete_ots_registration('f9000000-0000-0000-0000-0000000000d1', 'MTIX-1')$$, 'DF001', 'ORDER_NOT_FOUND', 'order OrderOnline tidak bisa dihapus');

select * from finish();
rollback;
