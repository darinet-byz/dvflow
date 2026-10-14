-- 0029: schema_version, master_is_used terstruktur, remap persisten, hapus user berhierarki.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 29, 'schema_version menandai migrasi terbaru');
select is(has_function_privilege('anon', 'public.schema_version()', 'execute'), true, 'CI dapat membaca versi skema');

-- Struktur nama kanonik dan key scope.
select is((select advertiser_code from public.master_canonical_parts('KULI01SO392 - ST - Solo')), '01', 'pengiklan di dalam blok kode terbaca');
select is((select type_code from public.master_canonical_parts('KULI01SO392 - ST - Solo')), 'SO', 'tipe di dalam blok kode terbaca');
select is((select count(*) from public.master_canonical_parts('Nama bebas dari toko')), 0::bigint, 'teks non-kanonik tidak menghasilkan kode');
select is((select session_code from public.master_setting_parts('webinar_destination::__scope__::KULI:*:ST')), 'ST', 'sesi dari key scope');
select is((select count(*) from public.master_setting_parts('webinar_destination::__scope__::*:*:*')
  where product_code is not null or session_code is not null), 0::bigint, 'wildcard global tidak mereferensikan kode');

insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('d0000000-0000-0000-0000-000000000001','pa_dev','Dev','test','developer',true),
 ('d0000000-0000-0000-0000-000000000002','pa_master','Master','test','master_admin',true),
 ('d0000000-0000-0000-0000-000000000003','pa_member','Member','test','member',false),
 ('d0000000-0000-0000-0000-000000000004','pa_owner','Owner','test','owner',true);
insert into public.advertisers(id,name,code) values ('a0000000-0000-0000-0000-000000000077','Iklan 77','77');
insert into public.event_types(id,name,code,kind) values ('e0000000-0000-0000-0000-000000000001','Seminar Kota','SK','seminar');

-- Pengiklan/tipe yang hanya dipakai alias tetap terdeteksi; ST tidak salah terdeteksi oleh prefix key.
select is(public.master_is_used('advertisers','77',null), false, 'pengiklan belum dipakai');
insert into public.product_aliases(alias_name,alias_name_normalized,canonical_target) values ('Nama Toko','nama toko','KULI77SK001 - S2 - Solo');
select is(public.master_is_used('advertisers','77',null), true, 'pengiklan di dalam alias terdeteksi');
select is(public.master_is_used('event-types','SK','e0000000-0000-0000-0000-000000000001'), true, 'tipe di dalam alias terdeteksi');
insert into public.app_settings(key,value_text) values ('webinar_destination::__scope__::*:*:S3','https://zoom.us/j/1');
select is(public.master_is_used('sessions','ST',null), false, 'sesi ST tidak salah terdeteksi lewat teks prefix key');
select is(public.master_is_used('sessions','S3',null), true, 'sesi dari key scope terdeteksi');
delete from public.app_settings where key = 'webinar_destination::__scope__::*:*:S3';
delete from public.product_aliases;

-- Remap: hanya order unmapped, dan alias berkunci nama asli tersimpan.
insert into public.orders(order_id,product_raw,product_parse_status,name,app_status,gross_amount) values
 ('pa_inv','Kelas Bisnis Batch Lama','invalid','A','Paid',100);
insert into public.orders(order_id,product_raw,product_parse_status,product_code,name,event_type,app_status,gross_amount) values
 ('pa_ok','KULI01SO1 - S1 - Solo','valid','KULI','B','Seminar Offline','Paid',100);
select lives_ok($$select public.batch_remap_orders(array['pa_inv','pa_ok'],'KULI01SO392 - S1 - Solo',
  '{"product_parse_status":"valid","product_code":"KULI","advertiser_code":"01","event_type":"Seminar Offline","batch":"392","session":"S1","city":"Solo"}'::jsonb,
  false,null,'d0000000-0000-0000-0000-000000000001')$$, 'remap berjalan');
select is((select product_parse_status from public.orders where order_id='pa_inv'), 'valid', 'order unmapped dipetakan');
select is((select batch from public.orders where order_id='pa_ok'), null, 'order yang sudah valid tidak disentuh');
select is((select canonical_target from public.product_aliases where alias_name_normalized='kelas bisnis batch lama'),
  'KULI01SO392 - S1 - Solo', 'alias nama asli tersimpan agar webhook berikutnya konsisten');

-- Hapus user: role penuh hanya oleh Developer, tidak boleh diri sendiri.
select throws_ok($$select public.admin_delete_user('d0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000004')$$,
  'DF006','FORBIDDEN','master_admin tidak dapat menghapus owner');
select throws_ok($$select public.admin_delete_user('d0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002')$$,
  'DF006','FORBIDDEN','tidak dapat menghapus diri sendiri');
select lives_ok($$select public.admin_delete_user('d0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003')$$,
  'master_admin dapat menghapus member');
select lives_ok($$select public.admin_delete_user('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000004')$$,
  'developer dapat menghapus owner');
select is((select count(*) from public.users where id in ('d0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004')), 0::bigint, 'user terhapus');
select is(has_function_privilege('authenticated','public.admin_delete_user(uuid,uuid)','execute'), false, 'browser tidak dapat memanggil hapus user');

select * from finish();
rollback;
