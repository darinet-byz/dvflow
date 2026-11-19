-- A82: Citta - DVFLOW AI.
-- Mengunci: role/user sistem, opt-in grup, kolom kota/source, tabel tertutup,
-- konfirmasi atomik (insert + skip duplikat/kategori berubah), larangan hapus
-- event yang punya deadline iklan, snapshot delete, dan satu draft pending per grup.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 82, 'schema_version mencakup 82');

select is((select count(*)::int from public.app_permissions where key = 'config.ai_citta'), 1,
  'izin config.ai_citta ada');
select is((select count(*)::int from public.app_role_permissions
  where permission_key = 'config.ai_citta' and role_id in ('developer','owner')), 2,
  'Developer + Owner default dapat mengatur Citta');

select is((select is_system from public.app_roles where id = 'citta_ai'), true,
  'role citta_ai adalah role sistem');
select is((select is_assignable from public.app_roles where id = 'citta_ai'), false,
  'role citta_ai tidak dapat di-assign');
select is((select is_system from public.users where username = 'citta_ai'), true,
  'user Citta adalah akun sistem');
select is(has_table_privilege('authenticated', 'public.ai_settings', 'select'), false,
  'ai_settings tertutup untuk authenticated');
select is(has_table_privilege('authenticated', 'public.ai_drafts', 'select'), false,
  'ai_drafts tertutup untuk authenticated');
select is(has_table_privilege('authenticated', 'public.ai_runs', 'select'), false,
  'ai_runs tertutup untuk authenticated');
select is(has_table_privilege('authenticated', 'public.wa_ai_inbox', 'select'), false,
  'wa_ai_inbox tertutup untuk authenticated');
select is(has_function_privilege('authenticated', 'public.ai_confirm_draft(uuid,uuid,text,integer[])', 'execute'), false,
  'ai_confirm_draft hanya service_role');
select is(has_function_privilege('service_role', 'public.ai_confirm_draft(uuid,uuid,text,integer[])', 'execute'), true,
  'service_role dapat memanggil ai_confirm_draft');
select is(has_function_privilege('service_role', 'public.ai_cancel_draft(uuid,text)', 'execute'), true,
  'service_role dapat memanggil ai_cancel_draft');

-- Singleton + HTTPS.
select throws_ok($$insert into public.ai_settings(id) values (2)$$, '23514', null,
  'ai_settings singleton');
select throws_ok($$update public.ai_settings set provider_base_url = 'http://x' where id = 1$$, '23514', null,
  'base URL wajib HTTPS');

insert into public.products(id,name,code,active) values
  ('c1000000-0000-0000-0000-000000000001','Citta Test','CITX',true);
insert into public.advertisers(id,name,code,active) values
  ('c1000000-0000-0000-0000-000000000002','Pengiklan Citta','95',true);

insert into public.wa_product_groups(id, product_id, fonnte_group_id)
values ('c1000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','citta-test@g.us');
select is((select ai_enabled from public.wa_product_groups
  where id = 'c1000000-0000-0000-0000-000000000003'), false,
  'ai_enabled default mati');

-- /add: satu item valid, kota tersimpan.
insert into public.ai_drafts (
  id, wa_group_id, member, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'c1000000-0000-0000-0000-000000000010', 'citta-test@g.us', '628111', 'add',
  'c1000000-0000-0000-0000-000000000001', 'CITX', '/add 30 Nov 2026 10.00 Hotel',
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
    'category','Webinar','category_source','explicit',
    'event_date', to_char(current_date + 10, 'YYYY-MM-DD'),
    'start_time','10:00','city','Solo','location','Zoom Test',
    'valid',true,'issues','[]'::jsonb))),
  'AB12', now() + interval '1 hour'
);
select is((public.ai_confirm_draft(
  '00000000-0000-4000-8000-0000000000a1',
  'c1000000-0000-0000-0000-000000000010',
  'citta-test@g.us', null)->>'status'), 'CONFIRMED',
  'add: konfirmasi menyimpan');
select is((select source from public.event_calendar
  where ai_draft_id = 'c1000000-0000-0000-0000-000000000010'), 'ai',
  'add: source = ai');
select is((select city from public.event_calendar
  where ai_draft_id = 'c1000000-0000-0000-0000-000000000010'), 'Solo',
  'add: kota tersimpan');
select is((public.ai_confirm_draft(
  '00000000-0000-4000-8000-0000000000a1',
  'c1000000-0000-0000-0000-000000000010',
  'citta-test@g.us', null)->>'status'), 'NOT_PENDING',
  'konfirmasi kedua tidak menyimpan lagi');

-- Duplikat: produk + tanggal + jam + lokasi yang sama dilewati.
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'c1000000-0000-0000-0000-000000000011', 'citta-test@g.us', 'add',
  'c1000000-0000-0000-0000-000000000001', 'CITX', '/add duplikat',
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
    'category','Webinar','event_date', to_char(current_date + 10, 'YYYY-MM-DD'),
    'start_time','10:00','city','Solo','location','Zoom Test','valid',true))),
  'AB13', now() + interval '1 hour'
);
select is((public.ai_confirm_draft(
  '00000000-0000-4000-8000-0000000000a1',
  'c1000000-0000-0000-0000-000000000011',
  'citta-test@g.us', null)->>'saved')::int, 0,
  'add: duplikat dilewati');

-- Hapus: event tanpa deadline iklan.
insert into public.event_calendar(id, product_code, category, event_date, start_time, location, city)
values ('c1000000-0000-0000-0000-000000000020','CITX','Webinar', current_date + 12,'11:00','Zoom Hapus','Solo');
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'c1000000-0000-0000-0000-000000000012', 'citta-test@g.us', 'delete',
  'c1000000-0000-0000-0000-000000000001', 'CITX', '/delete 12 hari',
  jsonb_build_object('candidates', jsonb_build_array(jsonb_build_object(
    'id','c1000000-0000-0000-0000-000000000020','category','Webinar',
    'event_date', to_char(current_date + 12, 'YYYY-MM-DD'),'start_time','11:00',
    'location','Zoom Hapus','city','Solo'))),
  'CD34', now() + interval '1 hour'
);
select is((public.ai_confirm_draft(
  '00000000-0000-4000-8000-0000000000a1',
  'c1000000-0000-0000-0000-000000000012',
  'citta-test@g.us', null)->>'saved')::int, 1,
  'delete: satu event dihapus');
select is((select count(*)::int from public.event_calendar
  where id = 'c1000000-0000-0000-0000-000000000020'), 0,
  'delete: event hilang');
select is(jsonb_array_length((select deleted_snapshot from public.ai_drafts
  where id = 'c1000000-0000-0000-0000-000000000012')), 1,
  'delete: snapshot disimpan');

-- Hapus: event yang punya deadline iklan ditolak.
insert into public.event_calendar(id, product_code, category, event_date, start_time, location, city)
values ('c1000000-0000-0000-0000-000000000021','CITX','Webinar', current_date + 13,'11:00','Zoom Iklan','Solo');
insert into public.ad_calendar(event_id, advertiser_id, product_code, batch, deadline_date)
values ('c1000000-0000-0000-0000-000000000021','c1000000-0000-0000-0000-000000000002','CITX','1', current_date + 5);
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'c1000000-0000-0000-0000-000000000013', 'citta-test@g.us', 'delete',
  'c1000000-0000-0000-0000-000000000001', 'CITX', '/delete iklan',
  jsonb_build_object('candidates', jsonb_build_array(jsonb_build_object(
    'id','c1000000-0000-0000-0000-000000000021','category','Webinar',
    'event_date', to_char(current_date + 13, 'YYYY-MM-DD'),'start_time','11:00',
    'location','Zoom Iklan','city','Solo'))),
  'CD35', now() + interval '1 hour'
);
select is((public.ai_confirm_draft(
  '00000000-0000-4000-8000-0000000000a1',
  'c1000000-0000-0000-0000-000000000013',
  'citta-test@g.us', null)->>'saved')::int, 0,
  'delete: event ber-ad-calendar dilewati');
select is((select count(*)::int from public.event_calendar
  where id = 'c1000000-0000-0000-0000-000000000021'), 1,
  'delete: event ber-ad-calendar tetap ada');

-- Batal.
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'c1000000-0000-0000-0000-000000000014', 'citta-test@g.us', 'add',
  'c1000000-0000-0000-0000-000000000001', 'CITX', '/add batal',
  '{"items":[]}'::jsonb, 'EF56', now() + interval '1 hour'
);
select is((public.ai_cancel_draft(
  'c1000000-0000-0000-0000-000000000014', 'citta-test@g.us')->>'status'), 'CANCELLED',
  'batal mengubah status');
select is((select status from public.ai_drafts
  where id = 'c1000000-0000-0000-0000-000000000014'), 'cancelled',
  'batal tersimpan');

-- Satu pending per grup.
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'c1000000-0000-0000-0000-000000000015', 'dup@g.us', 'add',
  'c1000000-0000-0000-0000-000000000001', 'CITX', '/add satu',
  '{"items":[]}'::jsonb, 'GH78', now() + interval '1 hour'
);
select throws_ok($$
  insert into public.ai_drafts (wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at)
  values ('dup@g.us','add','c1000000-0000-0000-0000-000000000001','CITX','/add dua',
          '{"items":[]}'::jsonb,'GH79', now() + interval '1 hour')
$$, '23505', null, 'satu draft pending per grup');

select * from finish();
rollback;
