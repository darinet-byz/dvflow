-- 20261119140000_citta_ai_grup — A82 (permintaan pengguna 19 Nov 2026).
--
-- Citta - DVFLOW AI bekerja HANYA dari grup WhatsApp produk. Produk diambil
-- dari `wa_product_groups` (bukan dari teks pesan), sehingga tidak perlu
-- mengenali pengirim. Perintah yang dikenali hanya `/add` dan `/delete`;
-- pesan lain tidak pernah memanggil AI.
--
-- Yang ditambahkan:
--   1) role + user sistem Citta (tidak bisa login, tidak muncul di Add Team);
--   2) `wa_product_groups.ai_enabled` (opt-in per grup, default mati);
--   3) `event_calendar.city`, `source`, `ai_draft_id`;
--   4) pengaturan AI (key terenkripsi), draft, audit run, dan inbox dedupe;
--   5) izin `config.ai_citta` (Developer/Owner).
--
-- Tidak ada data lama yang diubah selain kolom baru dengan default aman.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 82 $$;

-- ---------------------------------------------------------------------------
-- 1. Role + user sistem Citta
-- ---------------------------------------------------------------------------
alter table public.app_roles
  add column if not exists is_assignable boolean not null default true;

insert into public.app_roles (id, name, description, is_system, is_assignable)
values (
  'citta_ai',
  'Citta AI (sistem)',
  'Akun sistem untuk Citta - DVFLOW AI. Tidak bisa login dan tidak bisa di-assign ke pengguna.',
  true,
  false
)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      is_system = true,
      is_assignable = false,
      updated_at = now();

alter table public.users
  add column if not exists is_system boolean not null default false;

insert into public.users (
  id, username, display_name, password_hash, password_algo, role,
  active, has_all_product_access, is_system
)
select
  '00000000-0000-4000-8000-0000000000a1'::uuid,
  'citta_ai',
  'Citta - DVFLOW AI',
  '!system-account-no-login',
  'system',
  'citta_ai',
  true,
  true,
  true
where not exists (
  select 1 from public.users where username_normalized = 'citta_ai'
);

-- ---------------------------------------------------------------------------
-- 2. Izin pengaturan Citta
-- ---------------------------------------------------------------------------
insert into public.app_permissions (key, name, module, description, sort_order)
values (
  'config.ai_citta',
  'Citta AI',
  'konfigurasi',
  'Mengatur API key LLM, model, kill switch, dan melihat audit Citta',
  45
)
on conflict (key) do update
  set name = excluded.name,
      module = excluded.module,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into public.app_role_permissions (role_id, permission_key)
select r, 'config.ai_citta'
from unnest(array['developer', 'owner']) r
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Opt-in per grup produk
-- ---------------------------------------------------------------------------
alter table public.wa_product_groups
  add column if not exists ai_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- 4. Kalender Event: kota + jejak AI
-- ---------------------------------------------------------------------------
alter table public.event_calendar
  add column if not exists city text;

alter table public.event_calendar
  add column if not exists source text not null default 'manual';

alter table public.event_calendar
  add column if not exists ai_draft_id uuid;

alter table public.event_calendar
  drop constraint if exists event_calendar_city_length;
alter table public.event_calendar
  add constraint event_calendar_city_length check (city is null or length(city) <= 80);

alter table public.event_calendar
  drop constraint if exists event_calendar_source_check;
alter table public.event_calendar
  add constraint event_calendar_source_check check (source in ('manual', 'ai'));

create index if not exists event_calendar_ai_draft_idx
  on public.event_calendar (ai_draft_id)
  where ai_draft_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Pengaturan AI (singleton)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_settings (
  id integer primary key default 1,
  enabled boolean not null default false,
  provider_base_url text not null default 'https://api.deepseek.com',
  model text not null default 'deepseek-flash',
  api_key_encrypted text,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint ai_settings_singleton check (id = 1),
  constraint ai_settings_base_url_check check (provider_base_url like 'https://%'),
  constraint ai_settings_model_check check (btrim(model) <> '' and length(model) <= 80)
);

insert into public.ai_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.ai_settings enable row level security;
revoke all on table public.ai_settings from public, anon, authenticated;
grant all on table public.ai_settings to service_role;

-- ---------------------------------------------------------------------------
-- 6. Draft: preview -> konfirmasi -> simpan/hapus
-- ---------------------------------------------------------------------------
create table if not exists public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  wa_group_id text not null,
  member text,
  command text not null,
  product_id uuid not null references public.products (id) on delete cascade,
  product_code text not null,
  raw_text text not null,
  payload jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  code text not null,
  revision integer not null default 1,
  created_ids uuid[] not null default '{}',
  deleted_ids uuid[] not null default '{}',
  deleted_snapshot jsonb,
  model text,
  error text,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_drafts_command_check check (command in ('add', 'delete')),
  constraint ai_drafts_status_check
    check (status in ('pending', 'confirmed', 'cancelled', 'expired', 'failed')),
  constraint ai_drafts_raw_text_check check (btrim(raw_text) <> '' and length(raw_text) <= 8000),
  constraint ai_drafts_code_check check (code ~ '^[A-Z0-9]{4}$')
);

create index if not exists ai_drafts_group_idx on public.ai_drafts (wa_group_id, created_at desc);
create index if not exists ai_drafts_status_idx on public.ai_drafts (status, expires_at);
create unique index if not exists ai_drafts_one_pending_per_group
  on public.ai_drafts (wa_group_id)
  where status = 'pending';

alter table public.ai_drafts enable row level security;
revoke all on table public.ai_drafts from public, anon, authenticated;
grant all on table public.ai_drafts to service_role;

-- ---------------------------------------------------------------------------
-- 7. Audit panggilan AI + dedupe webhook
-- ---------------------------------------------------------------------------
create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  wa_group_id text not null,
  member text,
  command text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  status text not null,
  error text,
  created_at timestamptz not null default now(),
  constraint ai_runs_command_check check (command in ('add', 'delete')),
  constraint ai_runs_status_check check (status in ('ok', 'invalid_json', 'failed'))
);

create index if not exists ai_runs_created_idx on public.ai_runs (created_at desc);

alter table public.ai_runs enable row level security;
revoke all on table public.ai_runs from public, anon, authenticated;
grant all on table public.ai_runs to service_role;

create table if not exists public.wa_ai_inbox (
  id uuid primary key default gen_random_uuid(),
  inbox_id text not null unique,
  group_id text not null,
  member text,
  command text not null,
  received_at timestamptz not null default now(),
  constraint wa_ai_inbox_command_check check (command in ('add', 'delete', 'confirm', 'cancel'))
);

create index if not exists wa_ai_inbox_received_idx on public.wa_ai_inbox (received_at desc);

alter table public.wa_ai_inbox enable row level security;
revoke all on table public.wa_ai_inbox from public, anon, authenticated;
grant all on table public.wa_ai_inbox to service_role;

-- ---------------------------------------------------------------------------
-- 8. Konfirmasi atomik
-- ---------------------------------------------------------------------------
create or replace function public.ai_confirm_draft(
  p_actor uuid,
  p_draft_id uuid,
  p_group_id text,
  p_selection integer[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_draft public.ai_drafts;
  v_item jsonb;
  v_idx integer;
  v_saved integer := 0;
  v_skipped integer := 0;
  v_created uuid[] := '{}';
  v_deleted uuid[] := '{}';
  v_id uuid;
  v_event public.event_calendar;
begin
  if not exists (select 1 from public.users where id = p_actor and is_system) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_draft
    from public.ai_drafts
   where id = p_draft_id
     for update;

  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_draft.wa_group_id is distinct from p_group_id then
    return jsonb_build_object('status', 'WRONG_GROUP');
  end if;
  if v_draft.status <> 'pending' then
    return jsonb_build_object('status', 'NOT_PENDING');
  end if;
  if v_draft.expires_at <= now() then
    update public.ai_drafts set status = 'expired' where id = v_draft.id;
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  if v_draft.command = 'add' then
    if not exists (
      select 1 from public.products where code = v_draft.product_code and active
    ) then
      update public.ai_drafts
         set status = 'failed', error = 'PRODUCT_INACTIVE'
       where id = v_draft.id;
      return jsonb_build_object('status', 'FAILED', 'reason', 'PRODUCT_INACTIVE');
    end if;

    for v_idx in 1..jsonb_array_length(coalesce(v_draft.payload -> 'items', '[]'::jsonb)) loop
      if p_selection is not null and array_length(p_selection, 1) is not null
         and not (v_idx = any (p_selection)) then
        continue;
      end if;

      v_item := v_draft.payload -> 'items' -> (v_idx - 1);
      if coalesce((v_item ->> 'valid')::boolean, false) is false then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Revalidasi saat konfirmasi: katalog bisa berubah sejak preview.
      if coalesce(v_item ->> 'category', '') not in ('Seminar', 'Webinar', 'Workshop')
         or coalesce(btrim(v_item ->> 'location'), '') = ''
         or length(coalesce(v_item ->> 'location', '')) > 200
         or coalesce(v_item ->> 'event_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
         or (v_item ->> 'event_date')::date < (now() at time zone 'Asia/Jakarta')::date
         or coalesce(v_item ->> 'start_time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
         or length(coalesce(v_item ->> 'city', '')) > 80 then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if exists (
        select 1 from public.event_calendar e
         where e.product_code = v_draft.product_code
           and e.event_date = (v_item ->> 'event_date')::date
           and e.start_time = ((v_item ->> 'start_time') || ':00')::time
           and lower(e.location) = lower(v_item ->> 'location')
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.event_calendar (
        product_code, category, event_date, start_time, location, city,
        source, ai_draft_id, created_by, updated_by
      ) values (
        v_draft.product_code,
        v_item ->> 'category',
        (v_item ->> 'event_date')::date,
        ((v_item ->> 'start_time') || ':00')::time,
        btrim(v_item ->> 'location'),
        nullif(btrim(v_item ->> 'city'), ''),
        'ai',
        v_draft.id,
        p_actor,
        p_actor
      )
      returning id into v_id;

      v_created := array_append(v_created, v_id);
      v_saved := v_saved + 1;
    end loop;
  elsif v_draft.command = 'delete' then
    for v_idx in 1..jsonb_array_length(coalesce(v_draft.payload -> 'candidates', '[]'::jsonb)) loop
      if p_selection is not null and array_length(p_selection, 1) is not null
         and not (v_idx = any (p_selection)) then
        continue;
      end if;

      v_item := v_draft.payload -> 'candidates' -> (v_idx - 1);

      select * into v_event
        from public.event_calendar
       where id = (v_item ->> 'id')::uuid
         and product_code = v_draft.product_code
         for update;

      if not found then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- FK ad_calendar ON DELETE SET NULL akan meninggalkan deadline tanpa event.
      if exists (select 1 from public.ad_calendar ac where ac.event_id = v_event.id) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      update public.ai_drafts
         set deleted_snapshot = coalesce(deleted_snapshot, '[]'::jsonb)
             || jsonb_build_array(to_jsonb(v_event))
       where id = v_draft.id;

      delete from public.event_calendar where id = v_event.id;
      v_deleted := array_append(v_deleted, v_event.id);
      v_saved := v_saved + 1;
    end loop;
  end if;

  update public.ai_drafts
     set status = case when v_saved > 0 then 'confirmed' else 'failed' end,
         created_ids = v_created,
         deleted_ids = v_deleted,
         confirmed_at = now(),
         error = case when v_saved = 0 then 'NO_ROW_SAVED' else null end
   where id = v_draft.id;

  return jsonb_build_object(
    'status', case when v_saved > 0 then 'CONFIRMED' else 'FAILED' end,
    'saved', v_saved,
    'skipped', v_skipped,
    'created_ids', to_jsonb(v_created),
    'deleted_ids', to_jsonb(v_deleted)
  );
end $$;

revoke all on function public.ai_confirm_draft(uuid, uuid, text, integer[]) from public, anon, authenticated;
grant execute on function public.ai_confirm_draft(uuid, uuid, text, integer[]) to service_role;

create or replace function public.ai_cancel_draft(
  p_draft_id uuid,
  p_group_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_draft public.ai_drafts;
begin
  select * into v_draft
    from public.ai_drafts
   where id = p_draft_id
     for update;

  if not found then return jsonb_build_object('status', 'NOT_FOUND'); end if;
  if v_draft.wa_group_id is distinct from p_group_id then
    return jsonb_build_object('status', 'WRONG_GROUP');
  end if;
  if v_draft.status <> 'pending' then
    return jsonb_build_object('status', 'NOT_PENDING');
  end if;

  update public.ai_drafts set status = 'cancelled' where id = v_draft.id;
  return jsonb_build_object('status', 'CANCELLED');
end $$;

revoke all on function public.ai_cancel_draft(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_cancel_draft(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Retensi 30 hari untuk audit AI + inbox (PII pelaku grup)
-- ---------------------------------------------------------------------------
create or replace function public.ai_retention() returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  delete from public.ai_runs where created_at < now() - interval '30 days';
  delete from public.wa_ai_inbox where received_at < now() - interval '30 days';
  delete from public.ai_drafts
   where created_at < now() - interval '90 days'
     and status <> 'pending';
end $$;

revoke all on function public.ai_retention() from public, anon, authenticated;
grant execute on function public.ai_retention() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'dvflow_ai_retention') then
      perform cron.unschedule('dvflow_ai_retention');
    end if;
    perform cron.schedule(
      'dvflow_ai_retention',
      '23 3 * * *',
      $cron$select public.ai_retention()$cron$
    );
  else
    raise warning 'pg_cron tidak tersedia: retensi ai_runs/wa_ai_inbox TIDAK dijadwalkan.';
  end if;
end $$;

