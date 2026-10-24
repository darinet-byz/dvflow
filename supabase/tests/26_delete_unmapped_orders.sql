-- 0051 (A40): hapus massal Order Unmapped — hanya order yang masih invalid, presensi ikut terhapus,
-- butuh izin halaman + hapus + akses semua produk, tidak bisa dipanggil dari browser.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 51, 'schema_version mencakup 0051');

insert into public.app_roles(id,name,description,is_system) values
 ('unm_full','Unmapped Penuh',null,false),
 ('unm_nodel','Unmapped Tanpa Hapus',null,false);
insert into public.app_role_permissions(role_id,permission_key) values
 ('unm_full','operasional.order_unmapped'),('unm_full','action.delete_master'),
 ('unm_nodel','operasional.order_unmapped');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('fa000000-0000-0000-0000-0000000000a1','du_full','Full','test','unm_full',true),
 ('fa000000-0000-0000-0000-0000000000a2','du_scoped','Scoped','test','unm_full',false),
 ('fa000000-0000-0000-0000-0000000000a3','du_nodel','NoDel','test','unm_nodel',true);

insert into public.orders(order_id,product_raw,product_parse_status,name,app_status,product_code,event_type) values
 ('du-1','Produk Lama','invalid','O1','Paid',null,null),
 ('du-2','Produk Lama','invalid','O2','Pending',null,null),
 ('du-3','KM01SO392 - S1 - Solo','valid','O3','Paid','KM','Seminar Offline');
insert into public.attendance_events (order_id, attendance_type, source) values ('du-1','webinar','webinar_redirect');

select throws_ok($$select public.delete_unmapped_orders('fa000000-0000-0000-0000-0000000000a3', array['du-1'])$$,
  'DF006', 'FORBIDDEN', 'tanpa izin hapus ditolak');
select throws_ok($$select public.delete_unmapped_orders('fa000000-0000-0000-0000-0000000000a2', array['du-1'])$$,
  'DF006', 'FORBIDDEN', 'tanpa akses semua produk ditolak');
select throws_ok($$select public.delete_unmapped_orders('fa000000-0000-0000-0000-0000000000a1', array[]::text[])$$,
  'DF011', 'INVALID_ARGUMENT', 'daftar kosong ditolak');

select is(public.delete_unmapped_orders('fa000000-0000-0000-0000-0000000000a1', array['du-1','du-2','du-3','tidak-ada']),
  '{"deleted_count":2,"skipped_count":2}'::jsonb, 'order invalid terhapus; valid & tidak dikenal dilewati');
select is((select count(*) from public.orders where order_id in ('du-1','du-2'))::int, 0, 'order unmapped terhapus');
select is((select count(*) from public.attendance_events where order_id = 'du-1')::int, 0, 'presensinya ikut terhapus');
select is((select count(*) from public.orders where order_id = 'du-3')::int, 1, 'order ter-mapping tidak pernah dihapus');

select is(has_function_privilege('authenticated','public.delete_unmapped_orders(uuid,text[])','execute'), false,
  'delete_unmapped_orders tidak bisa dipanggil browser');
select is(has_function_privilege('anon','public.delete_unmapped_orders(uuid,text[])','execute'), false,
  'delete_unmapped_orders tidak bisa dipanggil anon');

select * from finish();
rollback;
