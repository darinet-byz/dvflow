-- A79: chat internal — thread 1:1, fan-out "Semua [Role]", badge belum dibaca.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 79, 'schema_version mencakup 79');

-- Tabel chat hanya untuk service_role.
select is(has_table_privilege('authenticated', 'public.chat_threads', 'select'), false,
  'chat_threads tertutup untuk authenticated');
select is(has_table_privilege('authenticated', 'public.chat_messages', 'insert'), false,
  'chat_messages tertutup untuk authenticated');
select is(has_function_privilege('authenticated',
  'public.send_chat_message(uuid,text,uuid,boolean,text)', 'execute'), false,
  'RPC kirim chat hanya untuk service_role');

insert into public.advertisers(id,name,code,active) values
  ('aa000000-0000-0000-0000-0000000000d1','Pengiklan Satu','91',true),
  ('aa000000-0000-0000-0000-0000000000d2','Pengiklan Dua','92',true);

insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
  ('aa000000-0000-0000-0000-0000000000a1','chat_mgr','Manajer Chat','test','manajer',true,null),
  ('aa000000-0000-0000-0000-0000000000a2','chat_adv1','Akun Satu','test','advertiser',false,'aa000000-0000-0000-0000-0000000000d1'),
  ('aa000000-0000-0000-0000-0000000000a3','chat_adv2','Akun Dua','test','advertiser',false,'aa000000-0000-0000-0000-0000000000d2'),
  ('aa000000-0000-0000-0000-0000000000a4','chat_member','Member Chat','test','member',false,null);

-- ---------------------------------------------------------------------------
-- Daftar penerima: role + nama pengiklan
-- ---------------------------------------------------------------------------
select is((select count(*)::int from jsonb_array_elements(
  public.chat_recipients('aa000000-0000-0000-0000-0000000000a1')->'roles') r
  where r->>'id' = 'advertiser'), 1, 'role advertiser muncul sekali');
select is((select count(*)::int from jsonb_array_elements(
  public.chat_recipients('aa000000-0000-0000-0000-0000000000a1')->'roles') r,
  jsonb_array_elements(r->'users') u where r->>'id' = 'advertiser'), 2,
  'dua akun pengiklan muncul');
select is((select bool_and(u->>'display_name' in ('Pengiklan Satu','Pengiklan Dua')) from jsonb_array_elements(
  public.chat_recipients('aa000000-0000-0000-0000-0000000000a1')->'roles') r,
  jsonb_array_elements(r->'users') u where r->>'id' = 'advertiser'), true,
  'akun advertiser memakai nama pengiklan');

-- ---------------------------------------------------------------------------
-- Kirim ke semua anggota role = fan-out 1:1, bukan satu thread grup
-- ---------------------------------------------------------------------------
select is((public.send_chat_message(
  'aa000000-0000-0000-0000-0000000000a1', 'advertiser', null, true, 'Halo semua'
)->>'sent')::int, 2, 'fan-out mengirim ke dua penerima');
select is((select count(*)::int from public.chat_threads), 2, 'dua thread 1:1');
select is((select count(*)::int from public.chat_messages), 2, 'dua pesan terpisah');

-- Kirim lagi ke satu orang yang sudah punya thread: thread dipakai ulang.
select is((public.send_chat_message(
  'aa000000-0000-0000-0000-0000000000a1', 'advertiser',
  'aa000000-0000-0000-0000-0000000000a2', false, 'Halo satu'
)->>'sent')::int, 1, 'kirim ke satu penerima');
select is((select count(*)::int from public.chat_threads), 2, 'thread tidak dobel untuk pasangan yang sama');
select is((select count(*)::int from public.chat_messages), 3, 'pesan bertambah satu');

create temp table a79_thread on commit drop as
select t.id
  from public.chat_threads t
 where t.user_a = least('aa000000-0000-0000-0000-0000000000a1'::uuid, 'aa000000-0000-0000-0000-0000000000a2'::uuid)
   and t.user_b = greatest('aa000000-0000-0000-0000-0000000000a1'::uuid, 'aa000000-0000-0000-0000-0000000000a2'::uuid);

-- ---------------------------------------------------------------------------
-- Badge dan isi thread
-- ---------------------------------------------------------------------------
select is((public.chat_threads_page('aa000000-0000-0000-0000-0000000000a2')->>'unread_total')::int,
  2, 'pengiklan punya dua pesan belum dibaca');
select is((select e->>'other_name' from jsonb_array_elements(
  public.chat_threads_page('aa000000-0000-0000-0000-0000000000a2')->'threads') e limit 1),
  'Manajer Chat', 'nama lawan bicara tampil');
select is((select e->>'other_account_name' from jsonb_array_elements(
  public.chat_threads_page('aa000000-0000-0000-0000-0000000000a2')->'threads') e limit 1),
  'Manajer Chat', 'nama akun internal tampil');

select is(jsonb_array_length(public.chat_messages_page(
  'aa000000-0000-0000-0000-0000000000a2', (select id from a79_thread))->'messages'),
  2, 'isi thread berisi dua pesan');
select is((public.chat_threads_page('aa000000-0000-0000-0000-0000000000a2')->>'unread_total')::int,
  0, 'membuka thread menandai sudah dibaca');

-- Pengirim melihat dua percakapan terpisah, bukan "Semua Advertiser".
select is(jsonb_array_length(public.chat_threads_page(
  'aa000000-0000-0000-0000-0000000000a1')->'threads'), 2,
  'pengirim melihat satu thread per penerima');

-- ---------------------------------------------------------------------------
-- Penolakan
-- ---------------------------------------------------------------------------
select throws_ok(
  format('select public.chat_messages_page(%L::uuid, %L::uuid)',
    'aa000000-0000-0000-0000-0000000000a3', (select id from a79_thread)),
  'DF024', 'THREAD_NOT_FOUND', 'user di luar thread tidak bisa membaca');

select throws_ok(
  format('select public.send_chat_message(%L::uuid, %L, null, true, %L)',
    'aa000000-0000-0000-0000-0000000000a1', 'advertiser', '   '),
  'DF011', 'INVALID_MESSAGE', 'pesan kosong ditolak');
select throws_ok(
  format('select public.send_chat_message(%L::uuid, %L, null, true, %L)',
    'aa000000-0000-0000-0000-0000000000a1', 'tidak_ada', 'Halo'),
  'DF011', 'INVALID_ROLE', 'role tidak dikenal ditolak');
select throws_ok(
  format('select public.send_chat_message(%L::uuid, %L, %L::uuid, false, %L)',
    'aa000000-0000-0000-0000-0000000000a1', 'advertiser',
    'aa000000-0000-0000-0000-0000000000a1', 'Halo'),
  'DF011', 'INVALID_RECIPIENT', 'kirim ke diri sendiri ditolak');
select throws_ok(
  format('select public.send_chat_message(%L::uuid, %L, %L::uuid, false, %L)',
    'aa000000-0000-0000-0000-0000000000a1', 'advertiser',
    'aa000000-0000-0000-0000-0000000000a4', 'Halo'),
  'DF011', 'INVALID_RECIPIENT', 'penerima di role lain ditolak');

delete from public.app_role_permissions
 where role_id = 'member' and permission_key = 'action.send_chat';
select throws_ok(
  format('select public.send_chat_message(%L::uuid, %L, %L::uuid, false, %L)',
    'aa000000-0000-0000-0000-0000000000a4', 'advertiser',
    'aa000000-0000-0000-0000-0000000000a2', 'Halo'),
  'DF006', 'FORBIDDEN', 'tanpa izin kirim ditolak');

-- ---------------------------------------------------------------------------
-- Batasan tabel
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.chat_messages(thread_id,sender_id,body)
  values ('00000000-0000-0000-0000-000000000000','aa000000-0000-0000-0000-0000000000a1','Halo')$$,
  '23503', null, 'thread harus ada');

select throws_ok(
  format($$insert into public.chat_messages(thread_id,sender_id,body) values (%L::uuid,%L::uuid,%L)$$,
    (select id from a79_thread), 'aa000000-0000-0000-0000-0000000000a1', '   '),
  '23514', null, 'pesan kosong ditolak constraint');

select throws_ok(
  format($$insert into public.chat_messages(thread_id,sender_id,body) values (%L::uuid,%L::uuid,%L)$$,
    (select id from a79_thread), 'aa000000-0000-0000-0000-0000000000a1', repeat('x', 2001)),
  '23514', null, 'pesan lebih dari 2000 karakter ditolak');

select throws_ok($$insert into public.chat_threads(user_a,user_b)
  values ('bb000000-0000-0000-0000-000000000002','bb000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'pasangan thread harus terurut');

select * from finish();
rollback;
