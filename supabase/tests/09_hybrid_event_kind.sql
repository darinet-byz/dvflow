-- 0030: jenis acara Hybrid — satu order untuk check-in di lokasi DAN link Zoom.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 30, 'schema_version mencakup 0030');

insert into public.users(id,username,display_name,password_hash,role) values
 ('f0000000-0000-0000-0000-000000000001','hy_dev','Dev','test','developer');

select lives_ok($$insert into public.event_types(name,code,kind) values ('Workshop Hybrid','HY','hybrid')$$, 'kind hybrid diterima');
select throws_ok($$insert into public.event_types(name,code,kind) values ('Salah','ZZ','campuran')$$, '23514', null, 'kind lain tetap ditolak');

insert into public.orders(order_id,product_raw,product_parse_status,name,event_type,app_status,gross_amount) values
 ('hy1','KULI01HY1 - S1 - Solo','valid','Hybrid A','Hybrid','Paid',100),
 ('wo1','KULI01WO1 - S1 - Solo','valid','Webinar A','Webinar Online','Paid',100);

select is((public.checkin_seminar('hy1','seminar_qr','f0000000-0000-0000-0000-000000000001')->>'state'), 'CHECKIN_SUCCESS', 'order Hybrid dapat check-in di lokasi');
select is((public.checkin_seminar('hy1','seminar_qr','f0000000-0000-0000-0000-000000000001')->>'state'), 'ALREADY_CHECKED_IN', 'check-in Hybrid tetap idempoten');
select throws_ok($$select public.checkin_seminar('wo1','seminar_qr','f0000000-0000-0000-0000-000000000001')$$, 'DF003', 'NOT_SEMINAR_ORDER', 'Webinar Online tetap tidak bisa check-in');

select lives_ok($$insert into public.attendance_events(order_id,attendance_type,source) values ('hy1','webinar','webinar_redirect'),('hy1','webinar','webinar_redirect')$$, 'order Hybrid juga mencatat klik Zoom');
select is((select count(*) from public.attendance_events where order_id='hy1'), 3::bigint, 'satu check-in + dua klik Zoom pada order yang sama');

select * from finish();
rollback;
