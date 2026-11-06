begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();
insert into public.products(id,name,code) values ('fc000000-0000-0000-0000-000000000001','Source test','SRCT');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('fc000000-0000-0000-0000-000000000002','source_dev','Source operator','test','developer',true);
insert into public.orders(order_id,name,phone,product_code,product_name,product_parse_status,event_type,batch,session,city,app_status,quantity,gross_amount,source,ots_collected_by,created_at,paid_at,payment_method) values
 ('src-online','Online','0812-345','SRCT','Source test','valid','Seminar Offline','100','S1','Solo','Paid',10,1000000,'orderonline',null,now(),now(),'bank_transfer'),
 ('OTS-999901','OTS','+62 812345','SRCT','Source test','valid','Seminar Offline','100','S1','Solo','Paid',3,450000,'ots','fc000000-0000-0000-0000-000000000002',now(),now(),'ots_tunai'),
 ('OTS-999902','OTS second','0812999','SRCT','Source test','valid','Seminar Offline','100','S2','Solo','Paid',2,200000,'ots','fc000000-0000-0000-0000-000000000002',now(),now(),'ots_qris');
insert into public.attendance_events(order_id,attendance_type,source,ticket_no)
 select 'src-online','seminar','seminar_manual',n from generate_series(1,6) n;
insert into public.attendance_events(order_id,attendance_type,source,ticket_no)
 select 'OTS-999901','seminar','seminar_ots',n from generate_series(1,3) n;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fc000000-0000-0000-0000-000000000002","role":"authenticated","app_user_id":"fc000000-0000-0000-0000-000000000002","app_role":"developer"}',true);
select is((public.dashboard_summary(p_product_code=>'SRCT',p_session=>'S1',p_source=>'orderonline')->>'paid_tickets')::int,10,'Online stays at ten tickets');
select is((public.dashboard_summary(p_product_code=>'SRCT',p_session=>'S1',p_source=>'orderonline')->>'sudah_hadir')::int,6,'Online stays at six attendees');
select is((public.dashboard_summary(p_product_code=>'SRCT',p_session=>'S1',p_source=>'orderonline')->>'attendance_rate')::numeric,0.6::numeric,'Online attendance remains 60 percent');
select is((public.dashboard_summary(p_product_code=>'SRCT',p_session=>'S1',p_source=>'ots')->>'paid_tickets')::int,3,'OTS has three tickets');
select is((public.dashboard_summary(p_product_code=>'SRCT',p_session=>'S1')->>'paid_tickets')::int,13,'Legacy omitted source remains combined');
select is((public.dashboard_summary(p_product_code=>'SRCT',p_session=>'S1',p_source=>'')->>'sudah_hadir')::int,9,'Combined nine attendees');
select is((public.dashboard_summary(p_product_code=>'SRCT',p_session=>'S1')->>'attendance_rate')::numeric,0.6923::numeric,'Combined ratio is weighted');
select is((public.dashboard_summary(p_product_code=>'SRCT',p_source=>'ots',p_advertiser_code=>'SOMEONE')->>'paid_tickets')::int,0,'Advertiser filter never ignored for OTS');
select throws_ok($$select public.dashboard_summary(p_source=>'invalid')$$,'DF011','INVALID_SOURCE','Invalid source rejected');
select is((public.orders_page(p_product_code=>'SRCT',p_source=>'ots')->>'total')::int,2,'Order filter before pagination');
select is(public.orders_page(p_product_code=>'SRCT',p_source=>'ots')->'rows'->0->>'source','ots','Order response includes source');
select is((public.export_orders_page(p_product_code=>'SRCT',p_source=>'ots')->>'total')::int,2,'Export respects source');
select is((public.presensi_page(p_product_code=>'SRCT',p_source=>'orderonline')->>'total')::int,1,'Attendance list respects source');
select is(public.presensi_page(p_product_code=>'SRCT',p_source=>'ots')->'rows'->0->>'source','ots','Attendance response includes source');
select is((public.export_presensi_page(p_product_code=>'SRCT',p_source=>'orderonline')->>'total')::int,1,'Attendance export respects source');
select is((public.presensi_summary(p_product_code=>'SRCT',p_source=>'orderonline')->>'sudah_hadir')::int,6,'Attendance summary respects source');
select is((public.tax_report(p_dimension=>'product',p_product_code=>'SRCT',p_source=>'ots')->'summary'->>'gross_amount')::numeric,650000::numeric,'Tax report respects source');
select is((public.dashboard_session_summary(p_product_code=>'SRCT',p_batch=>'100',p_source=>'orderonline')->'summary'->>'tickets')::int,10,'Session summary respects source');
select lives_ok($$select public.refund_page(p_source=>'ots')$$,'Refund filter compatible');
select lives_ok($$select public.export_refund_page(p_source=>'ots')$$,'Refund export filter compatible');
reset role;
select is((public.ots_registrations_page('fc000000-0000-0000-0000-000000000002','{"page":1,"pageSize":1}') -> 'summary' ->> 'tickets')::int,5,'OTS totals cover all pages');
select is((public.ots_registrations_page('fc000000-0000-0000-0000-000000000002','{"page":2,"pageSize":1}') -> 'summary' ->> 'gross_amount')::numeric,650000::numeric,'OTS second page preserves total');
select is((public.ots_registrations_page('fc000000-0000-0000-0000-000000000002','{"page":1,"pageSize":1,"method":"ots_qris"}') ->> 'total')::int,1,'Method filter applies to count');
select is(public.ots_registrations_page('fc000000-0000-0000-0000-000000000002','{"page":1,"pageSize":1}')->'rows'->0->>'collected_by','Source operator','Collector available to OTS readers');
select is(jsonb_array_length(public.ots_duplicate_candidates('fc000000-0000-0000-0000-000000000002','62812345','SRCT','100','S1','solo')->'rows'),2,'Normalized phone matches Online and OTS');
select is(jsonb_array_length(public.ots_duplicate_candidates('fc000000-0000-0000-0000-000000000002','62812345','SRCT','100','S2','solo')->'rows'),0,'Different session is not a duplicate');
select throws_ok($$select public.ots_registrations_page('fc000000-0000-0000-0000-000000000099','{"page":1,"pageSize":1}')$$,'DF006','FORBIDDEN','Unknown actor denied');
insert into public.app_roles(id,name) values ('ots_scoped64','OTS scoped');
insert into public.app_role_permissions(role_id,permission_key) values
 ('ots_scoped64','action.ots'),('ots_scoped64','operasional.dashboard');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('fc000000-0000-0000-0000-000000000003','ots_scoped64','Scoped operator','test','ots_scoped64',false);
insert into public.user_product_access(user_id,product_code) values ('fc000000-0000-0000-0000-000000000003','SRCT');
insert into public.products(id,name,code) values ('fc000000-0000-0000-0000-000000000004','Hidden','HIDE');
insert into public.orders(order_id,name,phone,product_code,product_parse_status,event_type,batch,session,city,app_status,quantity,gross_amount,source)
 values ('OTS-999903','Hidden person','0812345','HIDE','valid','Seminar Offline','100','S1','Solo','Paid',9,900000,'ots');
select is((public.ots_registrations_page('fc000000-0000-0000-0000-000000000003','{"page":1,"pageSize":50}')->>'total')::int,2,'OTS-only reader sees only assigned product');
select is(jsonb_array_length(public.ots_duplicate_candidates('fc000000-0000-0000-0000-000000000003','0812345','HIDE','100','S1','Solo')->'rows'),0,'Duplicate lookup does not expose inaccessible product');
select is(public.ots_registrations_page('fc000000-0000-0000-0000-000000000003','{"page":1,"pageSize":50}')->'rows'->0->>'collected_by','Source operator','OTS-only reader can see collector without Presensi permission');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fc000000-0000-0000-0000-000000000003","role":"authenticated","app_user_id":"fc000000-0000-0000-0000-000000000003","app_role":"ots_scoped64"}',true);
select is((public.dashboard_summary(p_source=>'ots')->>'paid_tickets')::int,5,'Source selector cannot expand product scope');
-- Jangan memanggil fungsi dengan EXECUTE dicabut: PG 17.6 Supabase lokal segfault (STATE.md K63).
select is(has_function_privilege('authenticated','public.ots_registrations_page(uuid,jsonb)','execute'), false,
  'Browser cannot call service-only OTS RPC');
reset role;
select * from finish();
rollback;
