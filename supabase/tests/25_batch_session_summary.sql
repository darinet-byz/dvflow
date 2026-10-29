-- 0049 (A39): Resume Batch — tiket Paid (sum quantity) per sesi + kota dalam satu batch,
-- gabungan semua pengiklan + OTS, dengan rincian per pengiklan; scope produk/pengiklan tetap berlaku.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 64, 'schema_version mencakup 0064');
select ok(exists(select 1 from public.app_role_permissions where role_id = 'manajer' and permission_key = 'operasional.dashboard'),
  'manajer punya izin Dashboard bawaan');
select ok(not exists(select 1 from public.app_permissions where key = 'operasional.resume_batch'),
  'izin Resume Batch sudah dilebur ke Dashboard (A59)');

insert into public.products(id,name,code) values
 ('f9000000-0000-0000-0000-00000000000a','Produk A','AAAA'),
 ('f9000000-0000-0000-0000-00000000000b','Produk B','BBBB');
insert into public.advertisers(id,name,code) values
 ('f9000000-0000-0000-0000-000000000001','Zul','91'),
 ('f9000000-0000-0000-0000-000000000002','Rina','92');
insert into public.app_roles(id,name,description,is_system) values ('batch_viewer','Viewer Batch',null,false);
insert into public.app_role_permissions(role_id,permission_key) values ('batch_viewer','operasional.dashboard');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
 ('f9000000-0000-0000-0000-0000000000a1','rb_zul','Zul','test','advertiser',true,'f9000000-0000-0000-0000-000000000001'),
 ('f9000000-0000-0000-0000-0000000000c1','rb_view','Viewer','test','batch_viewer',true,null),
 ('f9000000-0000-0000-0000-0000000000c2','rb_view_b','Viewer B','test','batch_viewer',false,null),
 ('f9000000-0000-0000-0000-0000000000e1','rb_member','Member','test','member',true,null);
insert into public.user_product_access(user_id,product_code) values ('f9000000-0000-0000-0000-0000000000c2','BBBB');

-- Batch 058 (= 58, A33). S1 Solo: Zul 2+1 tiket, Rina 4, OTS 1. S2 Semarang: Zul 3. S10 Solo: Rina 1.
insert into public.orders(order_id,product_code,advertiser_code,batch,session,city,product_raw,product_parse_status,name,event_type,app_status,quantity,source) values
 ('rb-1','AAAA','91','58','S1','Solo','r','valid','O1','Seminar Offline','Paid',2,'orderonline'),
 ('rb-2','AAAA','91','058','S1','SOLO','r','valid','O2','Seminar Offline','Paid',1,'orderonline'),
 ('rb-3','AAAA','92','58','S1','Solo','r','valid','O3','Seminar Offline','Paid',4,'orderonline'),
 ('rb-4','AAAA',null,'58','S1','Solo','r','valid','O4','Seminar Offline','Paid',1,'ots'),
 ('rb-5','AAAA','91','58','S2','Semarang','r','valid','O5','Seminar Offline','Paid',3,'orderonline'),
 ('rb-6','AAAA','92','58','S10','Solo','r','valid','O6','Seminar Offline','Paid',1,'orderonline'),
 -- Tidak dihitung: Pending, Cancelled, batch lain, produk lain, parse invalid.
 ('rb-7','AAAA','91','58','S1','Solo','r','valid','O7','Seminar Offline','Pending',5,'orderonline'),
 ('rb-8','AAAA','91','58','S1','Solo','r','valid','O8','Seminar Offline','Cancelled',5,'orderonline'),
 ('rb-9','AAAA','91','59','S1','Solo','r','valid','O9','Seminar Offline','Paid',5,'orderonline'),
 ('rb-10','BBBB','91','58','S1','Solo','r','valid','O10','Seminar Offline','Paid',5,'orderonline'),
 ('rb-11','AAAA',null,'58',null,null,'r','invalid','O11',null,'Paid',5,'orderonline');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000c1","app_role":"batch_viewer"}';
create temp table r on commit drop as select public.batch_session_summary('aaaa','0058',null) as v;
select is((select v->'summary' from r), '{"tickets":12,"sessions":3}'::jsonb, 'total tiket Paid & jumlah sesi');
select is((select jsonb_agg(concat_ws(' ', lower(x->>'city'), x->>'session')) from r, jsonb_array_elements(v->'rows') x),
  '["semarang S2","solo S1","solo S10"]'::jsonb, 'urut per kota (abjad), lalu S1, S2, S10 (0050)');
select is((select (x->>'tickets')::int from r, jsonb_array_elements(v->'rows') x where x->>'session' = 'S1'), 8,
  'S1 Solo: sum quantity, kota tidak membedakan huruf');
select is((select x->'advertisers' from r, jsonb_array_elements(v->'rows') x where x->>'session' = 'S1'),
  '[{"advertiser_code":"92","advertiser_name":null,"ots":false,"tickets":4},{"advertiser_code":"91","advertiser_name":null,"ots":false,"tickets":3},{"advertiser_code":null,"advertiser_name":null,"ots":true,"tickets":1}]'::jsonb,
  'S1: rincian per pengiklan + OTS');
select is((public.batch_session_summary('AAAA','58','Webinar Online')->'summary'->>'tickets')::int, 0, 'filter jenis acara');
select throws_ok($$select public.batch_session_summary('AAAA','',null)$$, 'DF011', 'INVALID_ARGUMENT', 'batch wajib');

-- Viewer produk B saja: produk A tidak terlihat.
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000c2","app_role":"batch_viewer"}';
select is((public.batch_session_summary('AAAA','58',null)->'summary'->>'tickets')::int, 0, 'viewer produk B: produk A tidak terlihat');
-- A44: advertiser Semua Produk melihat semua pengiklan + OTS di produk itu (produk dikontrol bersama).
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
select is((public.batch_session_summary('AAAA','58',null)->'summary'), '{"tickets":12,"sessions":3}'::jsonb, 'advertiser: semua pengiklan di produknya');
-- Tanpa izin.
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-0000000000e1","app_role":"member"}';
select throws_ok($$select public.batch_session_summary('AAAA','58',null)$$, 'DF006', 'FORBIDDEN', 'tanpa izin ditolak');
reset role;

select is(has_function_privilege('anon','public.batch_session_summary(text,text,text)','execute'), false,
  'batch_session_summary tidak bisa dipanggil anon');

select * from finish();
rollback;
