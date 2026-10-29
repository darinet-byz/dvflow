-- 0064 (A59): Data per Sesi di Dashboard — seluruh filter Dashboard berlaku,
-- produk+batch wajib, hanya Paid/produk valid, refund dikeluarkan, scope pengiklan.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 64, 'schema_version mencakup 0064');

insert into public.app_roles(id,name,description,is_system) values ('dash_viewer','Dashboard Viewer',null,false)
on conflict (id) do nothing;
insert into public.app_role_permissions(role_id,permission_key) values ('dash_viewer','operasional.dashboard')
on conflict do nothing;
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
  ('fb000000-0000-0000-0000-000000000001','ds_view','DS View','test','dash_viewer',true),
  ('fb000000-0000-0000-0000-000000000002','ds_member','DS Member','test','member',true);

insert into public.orders(
  order_id,name,product_code,batch,session,city,product_raw,product_parse_status,
  event_type,app_status,quantity,advertiser_code,advertiser_name,source,created_at
) values
  ('ds-1','Satu','AAAA','58','S1','Solo','r','valid','Seminar Offline','Paid',2,'91','Zul','orderonline','2026-10-01T03:00:00Z'),
  ('ds-2','Dua','AAAA','58','S1','Solo','r','valid','Seminar Offline','Paid',3,'92','Rina','orderonline','2026-10-02T03:00:00Z'),
  ('ds-3','Tiga','AAAA','58','S1','Solo','r','valid','Seminar Offline','Paid',1,'92','Rina','orderonline','2026-10-10T03:00:00Z'),
  ('ds-4','Empat','AAAA','58','S2','Semarang','r','valid','Seminar Offline','Paid',4,'91','Zul','orderonline','2026-10-01T03:00:00Z'),
  ('ds-5','Pending','AAAA','58','S1','Solo','r','valid','Seminar Offline','Pending',9,'91','Zul','orderonline','2026-10-01T03:00:00Z'),
  ('ds-6','Refund','AAAA','58','S1','Solo','r','valid','Seminar Offline','Refund',9,'91','Zul','orderonline','2026-10-01T03:00:00Z'),
  ('ds-7','Batch lain','AAAA','59','S1','Solo','r','valid','Seminar Offline','Paid',99,'91','Zul','orderonline','2026-10-01T03:00:00Z');

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-000000000001","app_role":"dash_viewer"}';

create temp table ds_base on commit drop as
  select public.dashboard_session_summary('AAAA','58') as v;
select is((select v->'summary' from ds_base), '{"tickets":10,"sessions":2}'::jsonb,
  'ringkasan: hanya Paid batch 58, refund/pending/batch lain dikeluarkan');
select is((select jsonb_agg(concat_ws(' ', lower(x->>'city'), x->>'session')) from ds_base, jsonb_array_elements(v->'rows') x),
  '["semarang S2","solo S1"]'::jsonb, 'urut kota lalu sesi');
select is((select (x->>'tickets')::int from ds_base, jsonb_array_elements(v->'rows') x where x->>'session' = 'S1'), 6,
  'S1 Solo: sum quantity');
select is((select x->'advertisers' from ds_base, jsonb_array_elements(v->'rows') x where x->>'session' = 'S1'),
  '[{"advertiser_code":"92","advertiser_name":"Rina","ots":false,"tickets":4},{"advertiser_code":"91","advertiser_name":"Zul","ots":false,"tickets":2}]'::jsonb,
  'S1: rincian per pengiklan');

create temp table ds_date on commit drop as
  select public.dashboard_session_summary('AAAA','58',null,null,'2026-10-01','2026-10-02') as v;
select is((select (v->'summary'->>'tickets')::int from ds_date), 9, 'filter tanggal WIB');

create temp table ds_search on commit drop as
  select public.dashboard_session_summary('AAAA','58',null,'ds-3') as v;
select is((select (v->'summary'->>'tickets')::int from ds_search), 1, 'filter pencarian');
select is((select (v->'summary'->>'sessions')::int from ds_search), 1, 'pencarian hanya menyisakan sesi yang cocok');

create temp table ds_adv on commit drop as
  select public.dashboard_session_summary('AAAA','58',null,null,null,null,'92') as v;
select is((select (v->'summary'->>'tickets')::int from ds_adv), 4, 'filter pengiklan');

create temp table ds_session on commit drop as
  select public.dashboard_session_summary('AAAA','58',null,null,null,null,null,'s2') as v;
select is((select (v->'summary'->>'tickets')::int from ds_session), 4, 'filter sesi (tidak peka huruf)');

create temp table ds_city on commit drop as
  select public.dashboard_session_summary('AAAA','58',null,null,null,null,null,null,'solo') as v;
select is((select (v->'summary'->>'tickets')::int from ds_city), 6, 'filter kota (tidak peka huruf)');

create temp table ds_type on commit drop as
  select public.dashboard_session_summary('AAAA','58','Webinar Online') as v;
select is((select (v->'summary'->>'tickets')::int from ds_type), 0, 'filter jenis acara');

select is((public.batch_session_summary('AAAA','58',null)->'summary'), '{"tickets":10,"sessions":2}'::jsonb,
  'wrapper lama tetap bekerja untuk tab Resume Batch yang masih terbuka');

select throws_ok($$select public.dashboard_session_summary('AAAA','')$$, 'DF011', 'INVALID_ARGUMENT', 'batch wajib');
select throws_ok($$select public.dashboard_session_summary('AAAA','58',null,null,'2026-10-10','2026-10-01')$$,
  'DF011', 'INVALID_ARGUMENT', 'rentang tanggal terbalik ditolak');

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-000000000002","app_role":"member"}';
select throws_ok($$select public.dashboard_session_summary('AAAA','58')$$, 'DF006', 'FORBIDDEN',
  'tanpa izin Dashboard ditolak');
reset role;

select is(has_function_privilege('anon','public.dashboard_session_summary(text,text,text,text,date,date,text,text,text)','execute'), false,
  'dashboard_session_summary tidak bisa dipanggil anon');
select is(has_function_privilege('anon','public.batch_session_summary(text,text,text)','execute'), false,
  'wrapper lama juga tidak bisa dipanggil anon');

select * from finish();
rollback;
