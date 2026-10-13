-- ============================================================================
-- 0007_sessions_config — 02 §7 (termasuk seed canonical) + A5
-- ============================================================================
--
-- Nama tabel sengaja `sessions_config`, bukan `sessions`, agar tidak bentrok
-- dengan `app_sessions` (02 §7).

create table public.sessions_config (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  code_normalized text generated always as (public.normalize_code(code)) stored not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_config_code_normalized_key unique (code_normalized),
  constraint sessions_config_name_not_blank check (btrim(name) <> ''),
  constraint sessions_config_code_not_blank check (btrim(code) <> '')
);

create trigger sessions_config_set_updated_at
  before update on public.sessions_config
  for each row execute function public.set_updated_at();

-- Seed canonical sesuai 06 §5 ("Seed only stable config").
insert into public.sessions_config (name, code)
values
  ('Sesi 1', 'S1'),
  ('Sesi 2', 'S2'),
  ('Sesi Tunggal', 'ST')
on conflict (code_normalized) do nothing;
