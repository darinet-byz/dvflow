-- A84: deadline Kalender Iklan otomatis dari konfirmasi Citta.
-- Mengunci: H-21/H-14, batch/pengiklan opsional dengan penanda belum lengkap,
-- baris manual tidak ditimpa, dan halaman Kalender Iklan membawa flag incomplete.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 84, 'schema_version mencakup 84');

select is((select is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'ad_calendar' and column_name = 'advertiser_id'),
  'YES', 'advertiser_id boleh kosong untuk baris belum lengkap');
select is((select count(*)::int from information_schema.columns
  where table_schema = 'public' and table_name = 'ad_calendar'
    and column_name in ('source', 'ai_draft_id')), 2,
  'ad_calendar punya source dan ai_draft_id');
select is((select count(*)::int from pg_indexes
  where schemaname = 'public' and indexname = 'ad_calendar_incomplete_idx'), 1,
  'indeks bantu baris belum lengkap ada');
select is(has_function_privilege('authenticated',
  'public.ai_confirm_draft(uuid,uuid,text,integer[])', 'execute'), false,
  'ai_confirm_draft tetap hanya service_role');

insert into public.products(id, name, code, active) values
  ('a8400000-0000-0000-0000-000000000001', 'Produk A84', 'AQZX', true);
insert into public.advertisers(id, name, code, active) values
  ('a8400000-0000-0000-0000-000000000002', 'Pengiklan A84', '96', true);
insert into public.product_advertisers(product_id, advertiser_id) values
  ('a8400000-0000-0000-0000-000000000001', 'a8400000-0000-0000-0000-000000000002');
insert into public.users(id, username, display_name, password_hash, role, has_all_product_access) values
  ('a8400000-0000-0000-0000-0000000000c1', 'a84_mgr', 'Manajer A84', 'test', 'manajer', true);

-- 1) Batch + pengiklan disebut: H-21 dari event paling awal.
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'a8400000-0000-0000-0000-000000000010', 'a84@g.us', 'add',
  'a8400000-0000-0000-0000-000000000001', 'AQZX', '/add batch 61 untuk 96',
  jsonb_build_object(
    'batch', '61',
    'advertiser_codes', jsonb_build_array('96'),
    'items', jsonb_build_array(
      jsonb_build_object('category','Webinar','event_date',to_char(current_date + 30,'YYYY-MM-DD'),
        'start_time','10:00','city','Solo','location','Zoom A','valid',true),
      jsonb_build_object('category','Webinar','event_date',to_char(current_date + 40,'YYYY-MM-DD'),
        'start_time','10:00','city','Solo','location','Zoom B','valid',true))),
  'A841', now() + interval '1 hour'
);

create temp table a84_confirm on commit drop as
  select public.ai_confirm_draft(
    '00000000-0000-4000-8000-0000000000a1',
    'a8400000-0000-0000-0000-000000000010',
    'a84@g.us', null) as v;

select is((select v->>'status' from a84_confirm), 'CONFIRMED', 'add: konfirmasi berhasil');
select is((select (v->>'saved')::int from a84_confirm), 2, 'add: dua event tersimpan');
select is((select (v->>'ad_calendar_saved')::int from a84_confirm), 1, 'add: satu deadline iklan dibuat');
select is((select v->>'ad_calendar_incomplete' from a84_confirm), 'false', 'add: data lengkap');
select is((select v->>'ad_batch' from a84_confirm), '61', 'add: batch tersimpan');
select is((select v->>'ad_deadline_rule' from a84_confirm), 'H-21', 'add: aturan H-21 dipakai');
select is((select v->>'ad_deadline_date' from a84_confirm), (current_date + 9)::text,
  'add: deadline = event paling awal - 21 hari');
select is((select advertiser_id from public.ad_calendar
  where ai_draft_id = 'a8400000-0000-0000-0000-000000000010'),
  'a8400000-0000-0000-0000-000000000002'::uuid, 'add: pengiklan tersimpan');
select is((select source from public.ad_calendar
  where ai_draft_id = 'a8400000-0000-0000-0000-000000000010'), 'ai', 'add: source = ai');
select is((select event_id from public.ad_calendar
  where ai_draft_id = 'a8400000-0000-0000-0000-000000000010'),
  (select id from public.event_calendar
    where ai_draft_id = 'a8400000-0000-0000-0000-000000000010'
    order by event_date, start_time limit 1),
  'add: event_id memakai event paling awal');

-- 2) H-21 sudah lewat: pakai H-14 (meski H-14 juga sudah lewat).
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'a8400000-0000-0000-0000-000000000011', 'a84@g.us', 'add',
  'a8400000-0000-0000-0000-000000000001', 'AQZX', '/add batch 62 untuk 96',
  jsonb_build_object(
    'batch', '62',
    'advertiser_codes', jsonb_build_array('96'),
    'items', jsonb_build_array(
      jsonb_build_object('category','Webinar','event_date',to_char(current_date + 10,'YYYY-MM-DD'),
        'start_time','10:00','city','Solo','location','Zoom C','valid',true))),
  'A842', now() + interval '1 hour'
);

create temp table a84_confirm_h14 on commit drop as
  select public.ai_confirm_draft(
    '00000000-0000-4000-8000-0000000000a1',
    'a8400000-0000-0000-0000-000000000011',
    'a84@g.us', null) as v;

select is((select v->>'ad_deadline_rule' from a84_confirm_h14), 'H-14', 'add: H-21 lewat -> H-14');
select is((select v->>'ad_deadline_date' from a84_confirm_h14), (current_date - 4)::text,
  'add: deadline H-14 = event - 14 hari');

-- 3) Batch/pengiklan tidak disebut: tetap disimpan, ditandai belum lengkap.
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'a8400000-0000-0000-0000-000000000012', 'a84@g.us', 'add',
  'a8400000-0000-0000-0000-000000000001', 'AQZX', '/add jadwal tanpa batch',
  jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('category','Webinar','event_date',to_char(current_date + 25,'YYYY-MM-DD'),
        'start_time','10:00','city','Solo','location','Zoom D','valid',true))),
  'A843', now() + interval '1 hour'
);

create temp table a84_confirm_incomplete on commit drop as
  select public.ai_confirm_draft(
    '00000000-0000-4000-8000-0000000000a1',
    'a8400000-0000-0000-0000-000000000012',
    'a84@g.us', null) as v;

select is((select (v->>'ad_calendar_saved')::int from a84_confirm_incomplete), 1,
  'incomplete: baris tetap dibuat');
select is((select v->>'ad_calendar_incomplete' from a84_confirm_incomplete), 'true',
  'incomplete: ditandai belum lengkap');
select is((select advertiser_id from public.ad_calendar
  where ai_draft_id = 'a8400000-0000-0000-0000-000000000012'), null::uuid,
  'incomplete: advertiser_id kosong');
select is((select batch from public.ad_calendar
  where ai_draft_id = 'a8400000-0000-0000-0000-000000000012'), '?',
  'incomplete: batch = ?');

-- 3b) Dua batch berbeda yang sama-sama tidak menyebut batch tetap menjadi dua baris.
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'a8400000-0000-0000-0000-000000000014', 'a84@g.us', 'add',
  'a8400000-0000-0000-0000-000000000001', 'AQZX', '/add jadwal tanpa batch lagi',
  jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('category','Webinar','event_date',to_char(current_date + 28,'YYYY-MM-DD'),
        'start_time','10:00','city','Solo','location','Zoom F','valid',true))),
  'A845', now() + interval '1 hour'
);

create temp table a84_confirm_incomplete2 on commit drop as
  select public.ai_confirm_draft(
    '00000000-0000-4000-8000-0000000000a1',
    'a8400000-0000-0000-0000-000000000014',
    'a84@g.us', null) as v;

select is((select (v->>'ad_calendar_saved')::int from a84_confirm_incomplete2), 1,
  'incomplete kedua: baris tetap dibuat');
select is((select count(*)::int from public.ad_calendar
  where product_code = 'AQZX' and advertiser_id is null and batch = '?'), 2,
  'incomplete: dua baris ? terpisah, tidak saling menimpa');

-- 4) Baris manual tidak ditimpa Citta.
insert into public.ad_calendar (
  advertiser_id, product_code, batch, deadline_date, source
) values (
  'a8400000-0000-0000-0000-000000000002', 'AQZX', '63', current_date + 5, 'manual'
);
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'a8400000-0000-0000-0000-000000000013', 'a84@g.us', 'add',
  'a8400000-0000-0000-0000-000000000001', 'AQZX', '/add batch 63 untuk 96',
  jsonb_build_object(
    'batch', '63',
    'advertiser_codes', jsonb_build_array('96'),
    'items', jsonb_build_array(
      jsonb_build_object('category','Webinar','event_date',to_char(current_date + 35,'YYYY-MM-DD'),
        'start_time','10:00','city','Solo','location','Zoom E','valid',true))),
  'A844', now() + interval '1 hour'
);

create temp table a84_confirm_manual on commit drop as
  select public.ai_confirm_draft(
    '00000000-0000-4000-8000-0000000000a1',
    'a8400000-0000-0000-0000-000000000013',
    'a84@g.us', null) as v;

select is((select (v->>'ad_calendar_saved')::int from a84_confirm_manual), 0,
  'manual: tidak ada baris baru');
select is((select (v->>'ad_calendar_skipped')::int from a84_confirm_manual), 1,
  'manual: baris manual dilewati');
select is((select deadline_date from public.ad_calendar
  where advertiser_id = 'a8400000-0000-0000-0000-000000000002' and product_code = 'AQZX' and batch = '63'),
  current_date + 5, 'manual: deadline tidak ditimpa');
select is((select source from public.ad_calendar
  where advertiser_id = 'a8400000-0000-0000-0000-000000000002' and product_code = 'AQZX' and batch = '63'),
  'manual', 'manual: source tetap manual');

-- 5) Halaman Kalender Iklan memuat baris tanpa pengiklan + flag incomplete.
create temp table a84_page on commit drop as
  select public.ad_calendar_page(
    'a8400000-0000-0000-0000-0000000000c1', current_date - 365, current_date + 365) as v;

select is((select count(*)::int from a84_page, jsonb_array_elements(v->'rows') x
  where x->>'product_code' = 'AQZX'), 5, 'page: lima baris AQZX tampil');
select is((select bool_and((x->>'incomplete')::boolean) from a84_page, jsonb_array_elements(v->'rows') x
  where x->>'product_code' = 'AQZX' and x->>'batch' = '?'), true,
  'page: baris tanpa pengiklan ditandai incomplete');
select is((select count(*)::int from a84_page, jsonb_array_elements(v->'rows') x
  where x->>'product_code' = 'AQZX' and x->>'batch' = '?' and x->>'advertiser_code' is null), 2,
  'page: advertiser_code kosong');
select is((select (x->>'incomplete')::boolean from a84_page, jsonb_array_elements(v->'rows') x
  where x->>'product_code' = 'AQZX' and x->>'batch' = '61'), false,
  'page: baris lengkap tidak ditandai incomplete');
select is((select x->>'source' from a84_page, jsonb_array_elements(v->'rows') x
  where x->>'product_code' = 'AQZX' and x->>'batch' = '61'), 'ai',
  'page: source ai ikut dikembalikan');

-- 6) /delete tetap bisa menghapus event yang hanya punya deadline otomatis AI.
insert into public.ai_drafts (
  id, wa_group_id, command, product_id, product_code, raw_text, payload, code, expires_at
) values (
  'a8400000-0000-0000-0000-000000000020', 'a84@g.us', 'delete',
  'a8400000-0000-0000-0000-000000000001', 'AQZX', '/delete event pertama',
  jsonb_build_object('candidates', jsonb_build_array(jsonb_build_object(
    'id', (select id from public.event_calendar
      where ai_draft_id = 'a8400000-0000-0000-0000-000000000010'
      order by event_date, start_time limit 1),
    'category','Webinar',
    'event_date', to_char(current_date + 30,'YYYY-MM-DD'),
    'start_time','10:00',
    'location','Zoom A',
    'city','Solo'))),
  'A846', now() + interval '1 hour'
);

create temp table a84_confirm_delete on commit drop as
  select public.ai_confirm_draft(
    '00000000-0000-4000-8000-0000000000a1',
    'a8400000-0000-0000-0000-000000000020',
    'a84@g.us', null) as v;

select is((select (v->>'saved')::int from a84_confirm_delete), 1,
  'delete: event ber-deadline AI dihapus');
select is((select count(*)::int from public.event_calendar
  where ai_draft_id = 'a8400000-0000-0000-0000-000000000010'), 1,
  'delete: hanya event terpilih yang hilang');
select is((select count(*)::int from public.ad_calendar
  where ai_draft_id = 'a8400000-0000-0000-0000-000000000010'), 0,
  'delete: deadline AI ikut terhapus');

select * from finish();
rollback;
