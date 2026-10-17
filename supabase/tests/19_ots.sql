-- 0041 (A29): pendaftaran OTS = order baru Paid + langsung hadir; bisa diedit/dihapus; webhook tidak menimpanya.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 41, 'schema_version mencakup 0041');
insert into public.products(id,name,code) values ('f9000000-0000-0000-0000-00000000000a','Produk OTS','OTSA'),('f9000000-0000-0000-0000-00000000000b','Produk Lain','OTSB');
insert into public.app_roles(id,name) values ('ots_gate','Gate OTS'),('ots_none','Tanpa OTS');
insert into public.app_role_permissions(role_id,permission_key) values ('ots_gate','action.ots'),('ots_gate','operasional.dashboard'),('ots_gate','operasional.presensi');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('f9000000-0000-0000-0000-0000000000a1','ots_gate','Gate','test','ots_gate',false),
 ('f9000000-0000-0000-0000-0000000000a2','ots_none','None','test','ots_none',true),
 ('f9000000-0000-0000-0000-0000000000d1','ots_dev','Dev','test','developer',true);
insert into public.user_product_access(user_id,product_code) values ('f9000000-0000-0000-0000-0000000000a1','OTSA');

select ok(exists(select 1 from public.app_role_permissions where role_id = 'admin' and permission_key = 'action.ots'), 'izin OTS diberikan ke admin');

-- Buat
select is((public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'Budi OTS', '0812', 'otsa', '392', 's1', 'Solo', 'Seminar Offline', 150000, 'ots_tunai')->>'action'), 'created', 'OTS dibuat');
select is((select count(*)::int from public.orders where source = 'ots' and name = 'Budi OTS'), 1, 'satu order OTS');
select is((select order_id ~ '^OTS-[0-9]{6}$' from public.orders where name = 'Budi OTS'), true, 'Order ID berbentuk OTS-000001');
select is((select app_status || '|' || quantity || '|' || gross_amount || '|' || net_amount || '|' || tax_amount || '|' || platform_fee_amount || '|' || payment_method
  from public.orders where name = 'Budi OTS'), 'Paid|1|150000.00|150000.00|0.00|0.00|ots_tunai', 'Paid, 1 tiket, tanpa potongan');
select is((select e.source from public.attendance_events e join public.orders o using (order_id) where o.name = 'Budi OTS'), 'seminar_ots', 'langsung hadir');
select is((select ots_collected_by::text from public.orders where name = 'Budi OTS'), 'f9000000-0000-0000-0000-0000000000a1', 'petugas tercatat');

-- Edit
select is((public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', (select order_id from public.orders where name = 'Budi OTS'),
  'Budi Santoso', null, 'OTSA', '392', 'S1', 'Solo', 'Seminar Offline', 175000, 'ots_qris')->>'action'), 'updated', 'OTS diedit');
select is((select gross_amount || '|' || payment_method || '|' || name from public.orders where source = 'ots' and product_code = 'OTSA'), '175000.00|ots_qris|Budi Santoso', 'nominal, metode, nama berubah');
select is((select count(*)::int from public.attendance_events e join public.orders o using (order_id) where o.source = 'ots'), 1, 'edit tidak menambah presensi');

-- Ditolak
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a2', null, 'X', null, 'OTSA', null, null, null, 'Seminar Offline', 1, 'ots_tunai')$$, 'DF006', 'FORBIDDEN', 'tanpa izin OTS');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', null, 'OTSB', null, null, null, 'Seminar Offline', 1, 'ots_tunai')$$, 'DF006', 'FORBIDDEN', 'produk di luar scope');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', null, 'OTSA', null, null, null, 'Seminar Offline', 0, 'ots_tunai')$$, 'DF011', 'INVALID_ARGUMENT', 'nominal 0');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', null, 'OTSA', null, null, null, 'Webinar Online', 1, 'ots_tunai')$$, 'DF011', 'INVALID_ARGUMENT', 'webinar bukan OTS');
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', null, 'X', null, 'OTSA', null, null, null, 'Seminar Offline', 1, 'cash')$$, 'DF011', 'INVALID_ARGUMENT', 'metode tidak dikenal');
insert into public.orders(order_id,product_code,name,event_type,app_status,gross_amount) values ('MTIX-1','OTSA','Online','Seminar Offline','Pending',150000);
select throws_ok($$select public.save_ots_registration('f9000000-0000-0000-0000-0000000000a1', 'MTIX-1', 'X', null, 'OTSA', null, null, null, 'Seminar Offline', 1, 'ots_tunai')$$, 'DF001', 'ORDER_NOT_FOUND', 'order OrderOnline tidak bisa diedit lewat OTS');
select throws_ok($$select public.upsert_order_webhook(jsonb_build_object('orderId', (select order_id from public.orders where source = 'ots' limit 1), 'rawStatus', 'pending', 'appStatus', 'Pending', 'grossAmount', 1, 'productRaw', 'X', 'parse', jsonb_build_object('status', 'invalid')))$$,
  'DF014', 'INVALID_PAYLOAD', 'webhook tidak bisa menimpa order OTS');
select throws_ok($$insert into public.orderonline_connections(name, slug, active, webhook_secret_encrypted, webhook_secret_hash) values ('X', 'OTS', true, 'x', 'y')$$, '23514', null, 'kode toko OTS dicadangkan');

-- Ikut laporan
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"ots_gate"}';
select is((public.dashboard_summary(p_product_code => 'OTSA')->>'paid')::int, 1, 'dashboard: OTS = Paid');
select is((public.dashboard_summary(p_product_code => 'OTSA')->>'paid_tickets')::int, 1, 'dashboard: 1 tiket');
select is((public.dashboard_summary(p_product_code => 'OTSA')->>'gross_amount')::numeric, 175000::numeric, 'dashboard: gross OTS');
select is((public.presensi_summary(p_product_code => 'OTSA')->>'sudah_hadir')::int, 1, 'presensi: hadir');
reset role;

-- Hapus
select throws_ok($$select public.delete_ots_registration('f9000000-0000-0000-0000-0000000000a1', (select order_id from public.orders where source = 'ots' limit 1))$$, 'DF006', 'FORBIDDEN', 'hapus butuh izin hapus');
select is((public.delete_ots_registration('f9000000-0000-0000-0000-0000000000d1', (select order_id from public.orders where source = 'ots' limit 1))->>'deleted')::boolean, true, 'developer menghapus');
select is((select count(*)::int from public.orders where source = 'ots'), 0, 'order OTS terhapus');
select throws_ok($$select public.delete_ots_registration('f9000000-0000-0000-0000-0000000000d1', 'MTIX-1')$$, 'DF001', 'ORDER_NOT_FOUND', 'order OrderOnline tidak bisa dihapus');

select * from finish();
rollback;
