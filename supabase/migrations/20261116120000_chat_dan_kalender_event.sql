-- ============================================================================
-- A79 — Chat Internal + Kalender Event (permintaan pengguna 16 November 2026)
-- ============================================================================
--
-- 1. Advertiser Notes dihapus total. Panel Notes berubah menjadi CHAT murni
--    antar user: tanpa tanggal/deadline/lokasi/status dan tanpa ringkasan
--    order/spend. Satu thread = satu pasangan user (1:1).
--    Pengirim memilih ROLE lalu "Semua [Role]" atau satu nama. Kiriman ke
--    "Semua" di-fan-out menjadi satu pesan per penerima, sehingga tiap
--    penerima melihat percakapan dengan namanya sendiri.
--
-- 2. Kalender Event: jadwal Seminar / Webinar / Workshop per produk.
--    Field: produk, jenis acara, tanggal, jam mulai, lokasi/platform.
-- ============================================================================
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 79 $$;

-- ---------------------------------------------------------------------------
-- 1. Hapus fitur Advertiser Notes lama (keputusan pengguna: hapus total)
-- ---------------------------------------------------------------------------
drop function if exists public.advertiser_notes_page(uuid, jsonb);
drop function if exists public.save_advertiser_note(uuid, uuid, text, text, text, text, text, timestamptz, text, date, timestamptz, text);
drop function if exists public.archive_advertiser_note(uuid, uuid);
drop table if exists public.advertiser_notes;

delete from public.app_permissions
 where key in ('operasional.advertiser_notes', 'action.manage_advertiser_notes');

-- `can_read_configuration` masih menyebut izin notes yang sudah tidak ada.
create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'action.ots','operasional.report_spend','operasional.resume_batch',
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Izin baru (otomatis muncul di checklist Konfigurasi Role)
-- ---------------------------------------------------------------------------
insert into public.app_permissions (key, name, module, description, sort_order)
values
  ('operasional.chat', 'Chat Internal', 'operasional', 'Membuka panel chat dan membaca percakapan milik sendiri', 8),
  ('operasional.event_calendar', 'Kalender Event', 'operasional', 'Melihat jadwal Seminar, Webinar, dan Workshop', 9),
  ('action.send_chat', 'Kirim Chat', 'aksi', 'Mengirim pesan ke satu pengguna atau semua anggota role', 44),
  ('action.manage_event_calendar', 'Kelola Kalender Event', 'aksi', 'Membuat, mengubah, dan menghapus jadwal event', 46)
on conflict (key) do update
  set name = excluded.name,
      module = excluded.module,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- Chat tersedia untuk semua role (dan tetap bisa dicabut di checklist).
insert into public.app_role_permissions (role_id, permission_key)
select r.id, k
from public.app_roles r
cross join unnest(array['operasional.chat', 'action.send_chat', 'operasional.event_calendar']) k
on conflict (role_id, permission_key) do nothing;

-- Kalender: semua role boleh melihat; hanya Manajer + Admin default boleh mengelola.
insert into public.app_role_permissions (role_id, permission_key)
select r, 'action.manage_event_calendar'
from unnest(array['manajer', 'admin']) r
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Tabel chat 1:1
-- ---------------------------------------------------------------------------
create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users (id) on delete cascade,
  user_b uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- Pasangan selalu diurutkan supaya satu pasangan hanya punya satu thread.
  constraint chat_threads_pair_order check (user_a < user_b),
  constraint chat_threads_pair_unique unique (user_a, user_b)
);
create index chat_threads_user_a_idx on public.chat_threads (user_a, last_message_at desc);
create index chat_threads_user_b_idx on public.chat_threads (user_b, last_message_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint chat_messages_body_check check (btrim(body) <> '' and length(body) <= 2000)
);
create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at);
create index chat_messages_unread_idx on public.chat_messages (thread_id) where read_at is null;

-- Browser tidak membaca/menulis langsung: semua lewat Worker (service_role).
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
revoke all on table public.chat_threads, public.chat_messages from public, anon, authenticated;
grant all on table public.chat_threads, public.chat_messages to service_role;

-- ---------------------------------------------------------------------------
-- 4. Daftar penerima: role + user aktif yang boleh chat
-- ---------------------------------------------------------------------------
create or replace function public.chat_recipients(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_roles jsonb;
begin
  if not public.actor_has_permission(p_actor, 'operasional.chat') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'users', u.users
  ) order by r.name), '[]'::jsonb)
  into v_roles
  from public.app_roles r
  join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', us.id,
      'display_name', coalesce(a.name, us.display_name),
      'account_name', us.display_name,
      'is_advertiser', (a.id is not null),
      'advertiser_name', a.name
    ) order by coalesce(a.name, us.display_name)) as users
    from public.users us
    left join public.advertisers a on a.id = us.advertiser_id
    where us.active
      and us.id <> p_actor
      and us.role = r.id
      and (
        us.role in ('developer', 'owner')
        or exists (
          select 1 from public.app_role_permissions rp
          where rp.role_id = us.role and rp.permission_key = 'operasional.chat'
        )
      )
  ) u on u.users is not null
  where r.id in ('developer', 'owner')
     or exists (
       select 1 from public.app_role_permissions rp
       where rp.role_id = r.id and rp.permission_key = 'operasional.chat'
     );

  return jsonb_build_object('roles', v_roles);
end $$;
revoke all on function public.chat_recipients(uuid) from public, anon, authenticated;
grant execute on function public.chat_recipients(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Daftar thread + badge belum dibaca
-- ---------------------------------------------------------------------------
create or replace function public.chat_threads_page(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.actor_has_permission(p_actor, 'operasional.chat') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  with threads as (
    select
      t.id,
      t.last_message_at,
      case when t.user_a = p_actor then t.user_b else t.user_a end as other_id
    from public.chat_threads t
    where t.user_a = p_actor or t.user_b = p_actor
  ),
  enriched as (
    select
      th.id,
      th.other_id,
      th.last_message_at,
      u.display_name,
      u.role,
      r.name as role_name,
      a.name as advertiser_name,
      lm.body as last_message,
      lm.sender_id as last_sender_id,
      lm.created_at as last_message_created_at,
      (
        select count(*) from public.chat_messages cm
        where cm.thread_id = th.id and cm.sender_id <> p_actor and cm.read_at is null
      )::integer as unread
    from threads th
    join public.users u on u.id = th.other_id
    left join public.app_roles r on r.id = u.role
    left join public.advertisers a on a.id = u.advertiser_id
    left join lateral (
      select m.body, m.sender_id, m.created_at
      from public.chat_messages m
      where m.thread_id = th.id
      order by m.created_at desc
      limit 1
    ) lm on true
  )
  select jsonb_build_object(
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'other_user_id', e.other_id,
        'other_name', coalesce(e.advertiser_name, e.display_name),
        'other_account_name', e.display_name,
        'other_role', e.role,
        'other_role_name', e.role_name,
        'other_advertiser_name', e.advertiser_name,
        'last_message', e.last_message,
        'last_sender_id', e.last_sender_id,
        'last_message_at', e.last_message_at,
        'unread', e.unread
      ) order by e.last_message_at desc)
      from enriched e
    ), '[]'::jsonb),
    'unread_total', (
      select coalesce(sum(e.unread), 0)::integer from enriched e
    )
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.chat_threads_page(uuid) from public, anon, authenticated;
grant execute on function public.chat_threads_page(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Isi thread + tandai sudah dibaca
-- ---------------------------------------------------------------------------
create or replace function public.chat_messages_page(p_actor uuid, p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_thread public.chat_threads;
  v_other_id uuid;
  v_result jsonb;
begin
  if not public.actor_has_permission(p_actor, 'operasional.chat') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_thread
    from public.chat_threads t
   where t.id = p_thread_id
     and (t.user_a = p_actor or t.user_b = p_actor);
  if not found then
    raise exception using errcode = 'DF024', message = 'THREAD_NOT_FOUND';
  end if;

  v_other_id := case when v_thread.user_a = p_actor then v_thread.user_b else v_thread.user_a end;

  update public.chat_messages
     set read_at = now()
   where thread_id = p_thread_id
     and sender_id <> p_actor
     and read_at is null;

  select jsonb_build_object(
    'thread', jsonb_build_object(
      'id', v_thread.id,
      'other_user_id', v_other_id,
      'other_name', coalesce(a.name, u.display_name),
      'other_account_name', u.display_name,
      'other_role', u.role,
      'other_role_name', r.name,
      'other_advertiser_name', a.name
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'sender_id', m.sender_id,
        'body', m.body,
        'created_at', m.created_at,
        'mine', (m.sender_id = p_actor)
      ) order by m.created_at asc)
      from public.chat_messages m
      where m.thread_id = p_thread_id
    ), '[]'::jsonb)
  ) into v_result
  from public.users u
  left join public.app_roles r on r.id = u.role
  left join public.advertisers a on a.id = u.advertiser_id
  where u.id = v_other_id;

  return v_result;
end $$;
revoke all on function public.chat_messages_page(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_messages_page(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Kirim pesan: satu penerima atau semua anggota role (fan-out 1:1)
-- ---------------------------------------------------------------------------
create or replace function public.send_chat_message(
  p_actor uuid,
  p_role_id text,
  p_recipient_id uuid,
  p_all boolean,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_role text := nullif(btrim(coalesce(p_role_id, '')), '');
  v_recipients uuid[];
  v_recipient uuid;
  v_thread uuid;
  v_sent integer := 0;
  v_thread_ids uuid[] := '{}';
begin
  if not public.actor_has_permission(p_actor, 'action.send_chat') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_body = '' or length(v_body) > 2000 then
    raise exception using errcode = 'DF011', message = 'INVALID_MESSAGE';
  end if;
  if v_role is null or not exists (select 1 from public.app_roles where id = v_role) then
    raise exception using errcode = 'DF011', message = 'INVALID_ROLE';
  end if;

  if coalesce(p_all, false) then
    select array_agg(us.id)
      into v_recipients
      from public.users us
     where us.active
       and us.role = v_role
       and us.id <> p_actor
       and (
         us.role in ('developer', 'owner')
         or exists (
           select 1 from public.app_role_permissions rp
           where rp.role_id = us.role and rp.permission_key = 'operasional.chat'
         )
       );
  else
    if p_recipient_id is null then
      raise exception using errcode = 'DF011', message = 'INVALID_RECIPIENT';
    end if;
    if p_recipient_id = p_actor then
      raise exception using errcode = 'DF011', message = 'INVALID_RECIPIENT';
    end if;
    select us.id
      into v_recipient
      from public.users us
     where us.id = p_recipient_id
       and us.active
       and us.role = v_role
       and (
         us.role in ('developer', 'owner')
         or exists (
           select 1 from public.app_role_permissions rp
           where rp.role_id = us.role and rp.permission_key = 'operasional.chat'
         )
       );
    if not found then
      raise exception using errcode = 'DF011', message = 'INVALID_RECIPIENT';
    end if;
    v_recipients := array[v_recipient];
  end if;

  if v_recipients is null or array_length(v_recipients, 1) is null then
    return jsonb_build_object('sent', 0, 'thread_ids', '[]'::jsonb);
  end if;

  foreach v_recipient in array v_recipients loop
    v_thread := null;

    select t.id into v_thread
      from public.chat_threads t
     where t.user_a = least(p_actor, v_recipient)
       and t.user_b = greatest(p_actor, v_recipient);

    if v_thread is null then
      insert into public.chat_threads (user_a, user_b, last_message_at)
      values (least(p_actor, v_recipient), greatest(p_actor, v_recipient), now())
      on conflict (user_a, user_b) do nothing
      returning id into v_thread;

      if v_thread is null then
        select t.id into v_thread
          from public.chat_threads t
         where t.user_a = least(p_actor, v_recipient)
           and t.user_b = greatest(p_actor, v_recipient);
      end if;
    end if;

    insert into public.chat_messages (thread_id, sender_id, body)
    values (v_thread, p_actor, v_body);

    update public.chat_threads
       set last_message_at = now()
     where id = v_thread;

    v_sent := v_sent + 1;
    v_thread_ids := array_append(v_thread_ids, v_thread);
  end loop;

  return jsonb_build_object('sent', v_sent, 'thread_ids', to_jsonb(v_thread_ids));
end $$;
revoke all on function public.send_chat_message(uuid, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Kalender Event
-- ---------------------------------------------------------------------------
create table public.event_calendar (
  id uuid primary key default gen_random_uuid(),
  product_code text not null references public.products (code) on update cascade on delete restrict,
  category text not null,
  event_date date not null,
  start_time time not null,
  location text not null,
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_calendar_category_check check (category in ('Seminar', 'Webinar', 'Workshop')),
  constraint event_calendar_location_check check (btrim(location) <> '' and length(location) <= 200)
);
create index event_calendar_date_idx on public.event_calendar (event_date, start_time);
create trigger event_calendar_set_updated_at
  before update on public.event_calendar
  for each row execute function public.set_updated_at();

-- Baca dan tulis lewat Worker; tabel sendiri tertutup untuk browser.
alter table public.event_calendar enable row level security;
revoke all on table public.event_calendar from public, anon, authenticated;
grant all on table public.event_calendar to service_role;

notify pgrst, 'reload schema';
