-- ============================================================================
-- 0002_users — 02 §2 + AMENDMENTS A2 (kolom kredensial bcrypt) + A5 (kolom normalized generated)
-- ============================================================================

create table public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  -- A5: dihitung database, sehingga tidak mungkin ditulis tidak konsisten.
  username_normalized text generated always as (lower(regexp_replace(username, '^\s+|\s+$', '', 'g'))) stored not null,
  display_name text not null,
  -- A2: bcrypt menyimpan salt + cost di dalam string hash, jadi tidak ada kolom terpisah.
  password_hash text not null,
  password_algo text not null default 'bcrypt',
  role text not null,
  avatar_emoji text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_username_normalized_key unique (username_normalized),
  constraint users_role_check check (role in ('master_admin', 'admin', 'staff')),
  constraint users_username_not_blank check (btrim(username) <> ''),
  -- Tanpa spasi di dalam username: aturan "case-insensitive + unik" (01 §4) hanya
  -- bermakna bila spasi tidak bisa menyamarkan username yang sama.
  constraint users_username_format check (username !~ '\s' and length(username) <= 64),
  constraint users_display_name_not_blank check (btrim(display_name) <> '')
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();
