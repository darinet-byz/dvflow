begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into public.app_roles(id,name) values ('gate_custom','Gate');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
 ('dddddddd-dddd-dddd-dddd-dddddddddddd','auditdev','Developer','test','developer',false),
 ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','auditgate','Gate','test','gate_custom',false);
insert into public.products(id,name,code) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Produk A','AAAA'),
 ('aaaaaaaa-0000-0000-0000-000000000002','Produk B','BBBB');
insert into public.user_product_access(user_id,product_code) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','AAAA');
insert into public.app_role_permissions(role_id,permission_key)
select 'gate_custom',key from public.app_permissions where key in
 ('operasional.order','operasional.presensi','operasional.dashboard','operasional.scan_qr','config.report_tax','config.zoom','config.tiket');
insert into public.orders(order_id,product_code,product_raw,name,event_type,app_status,gross_amount) values
 ('rbac001','AAAA','AAAA01SO1 - S1 - Solo','A','Seminar Offline','Paid',100),
 ('rbac002','BBBB','BBBB01SO1 - S1 - Solo','B','Seminar Offline','Paid',500);
insert into public.attendance_events(order_id,attendance_type,source) values
 ('rbac001','webinar','webinar_redirect'),('rbac002','webinar','webinar_redirect');

set local role authenticated;
-- A stale or forged role claim cannot elevate the current database user.
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","app_role":"developer"}';
select is(public.app_role(),'gate_custom','role comes from database');
select is((select count(*) from public.orders),1::bigint,'direct REST order reads are scoped');
select is((select count(*) from public.attendance_events),1::bigint,'attendance reads are scoped');
select is((select count(*) from public.products),1::bigint,'product options are scoped');
select is((public.orders_page()->>'total')::int,1,'order page scoped');
select is((public.presensi_page()->>'total')::int,1,'presensi page scoped');
select is((public.dashboard_summary()->>'leads')::int,1,'dashboard scoped');
select is((public.orders_page(p_product_code=>'BBBB')->>'total')::int,0,'query cannot widen product access');
select throws_ok('select public.export_orders_page()','DF006','FORBIDDEN','export requires action permission');
select is(has_function_privilege('authenticated','public.save_role_permissions(uuid,text,text[],boolean,text,text)','execute'),false,'browser cannot invoke service RPC with someone else actor');
reset role;

insert into public.app_role_permissions values ('gate_custom','action.export_data');
set local role authenticated;
select is((public.export_orders_page()->>'total')::int,1,'export respects scope after grant');
select is((public.export_presensi_page()->>'total')::int,1,'attendance export respects scope');
reset role;
delete from public.app_role_permissions where role_id='gate_custom' and permission_key='operasional.order';
set local role authenticated;
select throws_ok('select public.orders_page()','DF006','FORBIDDEN','revocation applies without new JWT');
reset role;

select throws_ok($$select public.checkin_seminar('rbac002','seminar_qr','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
 'DF006','FORBIDDEN','SQL check-in rejects cross-product ticket');
select throws_ok($$select public.checkin_seminar('rbac001','seminar_manual','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
 'DF006','FORBIDDEN','manual check-in requires separate permission');
select lives_ok($$select public.checkin_seminar('rbac001','seminar_qr','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
 'allowed QR check-in succeeds');
select throws_ok($$select public.save_webinar_destination('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','__scope__::*:*:*','https://zoom.us/j/1')$$,
 'DF006','FORBIDDEN','scoped actor cannot write global Zoom');
select lives_ok($$select public.save_webinar_destination('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','__scope__::AAAA:*:*','https://zoom.us/j/1')$$,
 'scoped actor can write own Zoom');
select throws_ok($$select public.save_seminar_ticket('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','__scope__::BBBB:*:*','{}')$$,
 'DF006','FORBIDDEN','ticket scope enforced in SQL');

select throws_ok($$select public.save_role_permissions('dddddddd-dddd-dddd-dddd-dddddddddddd','gate_custom',array['invalid.key'])$$,
 'DF011','INVALID_PERMISSION','invalid permission rejected atomically');
select ok(exists(select 1 from public.app_role_permissions where role_id='gate_custom' and permission_key='operasional.scan_qr'),
 'old permissions survive failed replacement');
select throws_ok($$select public.save_role_permissions('dddddddd-dddd-dddd-dddd-dddddddddddd','bad_role',array['invalid.key'],true,'Bad role')$$,
 'DF011','INVALID_PERMISSION','invalid role creation rejected');
select ok(not exists(select 1 from public.app_roles where id='bad_role'),'no half-created role');

-- A valid catalog key can still fail during INSERT: DELETE must roll back too.
alter table public.app_role_permissions add constraint audit_insert_failure check(permission_key <> 'operasional.generator') not valid;
select throws_ok($$select public.save_role_permissions('dddddddd-dddd-dddd-dddd-dddddddddddd','gate_custom',array['operasional.generator'])$$,
 '23514',null,'mid-replacement storage failure rolls back');
select ok(exists(select 1 from public.app_role_permissions where role_id='gate_custom' and permission_key='operasional.scan_qr'),
 'permissions survive an insertion failure after deletion');
alter table public.app_role_permissions drop constraint audit_insert_failure;

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","app_role":"member"}';
select is((select count(*) from public.orders),2::bigint,'developer sees all products despite scoped flag and stale claim');
select ok(public.has_permission('config.produk'),'developer has config access');
reset role;
update public.users set active=false where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","app_role":"developer"}';
select is((select count(*) from public.orders),0::bigint,'disabled actor sees no rows');
select throws_ok('select public.dashboard_summary()','DF006','FORBIDDEN','disabled actor cannot use RPC');
reset role;

select throws_ok($$insert into public.products(name,code) values('Bad','ABC')$$,'23514',null,'product must be four letters');
select throws_ok($$insert into public.advertisers(name,code) values('Bad','1')$$,'23514',null,'advertiser must be two digits');
select throws_ok($$insert into public.event_types(name,code,kind) values('Bad','S1','seminar')$$,'23514',null,'type must be two letters');
select throws_ok($$insert into public.sessions_config(name,code) values('Bad','S9')$$,'23514',null,'session must be canonical');
select throws_ok($$insert into public.products(name,code) values('', 'EMPT')$$,'23514',null,'master name cannot be empty');
select throws_ok($$insert into public.products(name,code) values(repeat('x',201), 'LONG')$$,'23514',null,'master name cannot exceed 200 characters');
select throws_ok($$insert into public.event_types(name,code,kind) values('Bad','ZZ','other')$$,'23514',null,'type kind is mandatory and constrained');
insert into public.products(name,code,active) values(' Normalized ', ' nrml ', false);
select is((select code from public.products where code='NRML'),'NRML','database normalizes code and whitespace');
select throws_ok($$insert into public.products(name,code) values('Duplicate','NRML')$$,'23505',null,'inactive master code remains unique');
delete from public.products where code='NRML';
select throws_ok($$update public.products set code='CCCC' where code='AAAA'$$,'DF015','MASTER_IN_USE','used code cannot be changed');
select throws_ok($$select public.delete_config_master('dddddddd-dddd-dddd-dddd-dddddddddddd','products','aaaaaaaa-0000-0000-0000-000000000001')$$,
 'DF015','MASTER_IN_USE','used product cannot be permanently deleted');
select throws_ok($$select public.reset_product_configuration('dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
 'DF015','TRANSACTIONS_DEPEND_ON_CONFIGURATION','cleanup refuses existing transactions');
select is((select count(*) from public.products),2::bigint,'failed cleanup keeps master rows');
select is((select count(*) from public.orders),2::bigint,'failed cleanup keeps orders');

-- Empty disposable fixtures only: prove the narrow reset and rollback.
delete from public.attendance_events; delete from public.orders;
insert into public.payment_fee_rules(name,identifier,fee_type,fee_value) values('Keep','keep','flat',100);
savepoint before_reset;
select lives_ok($$select public.reset_product_configuration('dddddddd-dddd-dddd-dddd-dddddddddddd')$$,'clean reset succeeds');
select is((select count(*) from public.products),0::bigint,'products emptied');
select is((select count(*) from public.sessions_config),9::bigint,'nine sessions seeded');
select is((select count(*) from public.event_types where code in ('SO','WO')),2::bigint,'canonical event types re-seeded');
select is((select count(*) from public.payment_fee_rules where identifier='keep'),1::bigint,'tax preserved');
select is((select has_all_product_access from public.users where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),false,'scoped user not elevated');
rollback to before_reset;
select is((select count(*) from public.products),2::bigint,'rollback restores configuration');
select * from finish();
rollback;
