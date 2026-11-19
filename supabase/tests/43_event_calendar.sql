-- A79: kalender event + pembersihan Advertiser Notes lama.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 79, 'schema_version mencakup 79');

-- ---------------------------------------------------------------------------
-- Notes lama dihapus total
-- ---------------------------------------------------------------------------
select is((select count(*)::int from information_schema.tables
  where table_schema = 'public' and table_name = 'advertiser_notes'), 0,
  'tabel advertiser_notes sudah tidak ada');
select is((select count(*)::int from public.app_permissions
  where key in ('operasional.advertiser_notes','action.manage_advertiser_notes')), 0,
  'izin notes lama sudah tidak ada');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('advertiser_notes_page','save_advertiser_note','archive_advertiser_note')), 0,
  'RPC notes lama sudah tidak ada');

-- ---------------------------------------------------------------------------
-- Izin kalender
-- ---------------------------------------------------------------------------
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
  ('ee000000-0000-0000-0000-0000000000a1','evc_mgr','Manajer Kalender','test','manajer',true),
  ('ee000000-0000-0000-0000-0000000000a4','evc_member','Member Kalender','test','member',false);

select is((select count(*)::int from public.app_role_permissions
  where permission_key = 'operasional.event_calendar'),
  (select count(*)::int from public.app_roles where is_assignable), 'semua role dapat melihat kalender');
select is((select count(*)::int from public.app_role_permissions
  where permission_key = 'action.manage_event_calendar' and role_id in ('manajer','admin')), 2,
  'Manajer + Admin default dapat mengelola');
select is(public.actor_has_permission('ee000000-0000-0000-0000-0000000000a1','action.manage_event_calendar'),
  true, 'manajer lolos izin kelola');
select is(public.actor_has_permission('ee000000-0000-0000-0000-0000000000a4','action.manage_event_calendar'),
  false, 'member tidak lolos izin kelola');

-- Tabel hanya untuk service_role.
select is(has_table_privilege('authenticated', 'public.event_calendar', 'select'), false,
  'event_calendar tertutup untuk authenticated');
select is(has_table_privilege('authenticated', 'public.event_calendar', 'insert'), false,
  'event_calendar tidak dapat ditulis browser');

-- ---------------------------------------------------------------------------
-- Batasan tabel
-- ---------------------------------------------------------------------------
insert into public.products(id,name,code,active) values
  ('ee000000-0000-0000-0000-0000000000b1','Produk Kalender','EVCX',true);

insert into public.event_calendar(product_code,category,event_date,start_time,location) values
  ('EVCX','Seminar','2026-11-20','10:00','Hotel Solo');

select is((select count(*)::int from public.event_calendar where product_code='EVCX'), 1,
  'event valid tersimpan');
select is((select start_time::text from public.event_calendar where product_code='EVCX'), '10:00:00',
  'jam mulai tersimpan sebagai time');

select throws_ok($$insert into public.event_calendar(product_code,category,event_date,start_time,location)
  values ('EVCX','Hybrid','2026-11-21','10:00','Zoom')$$,
  '23514', null, 'jenis acara hanya Seminar/Webinar/Workshop');
select throws_ok($$insert into public.event_calendar(product_code,category,event_date,start_time,location)
  values ('EVCX','Webinar','2026-11-21','10:00','   ')$$,
  '23514', null, 'lokasi tidak boleh kosong');
select throws_ok($$insert into public.event_calendar(product_code,category,event_date,start_time,location)
  values ('EVCX','Webinar','2026-11-21','10:00',repeat('x',201))$$,
  '23514', null, 'lokasi maksimal 200 karakter');
select throws_ok($$insert into public.event_calendar(product_code,category,event_date,start_time,location)
  values ('TIDAK_ADA','Webinar','2026-11-21','10:00','Zoom')$$,
  '23503', null, 'produk harus ada');

-- Ganti kode produk: event ikut (on update cascade), hapus produk ditolak (restrict).
update public.products set code='EVCC' where code='EVCX';
select is((select product_code from public.event_calendar where location='Hotel Solo'), 'EVCC',
  'kode produk pada event ikut berubah');
select throws_ok($$delete from public.products where code='EVCC'$$,
  '23503', null, 'produk yang dipakai event tidak boleh dihapus');

select * from finish();
rollback;
