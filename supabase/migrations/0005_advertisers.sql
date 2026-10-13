-- ============================================================================
-- 0005_advertisers — 02 §5 + A5
-- ============================================================================

create table public.advertisers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  code_normalized text generated always as (public.normalize_code(code)) stored not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertisers_code_normalized_key unique (code_normalized),
  constraint advertisers_name_not_blank check (btrim(name) <> ''),
  constraint advertisers_code_not_blank check (btrim(code) <> '')
);

create trigger advertisers_set_updated_at
  before update on public.advertisers
  for each row execute function public.set_updated_at();
