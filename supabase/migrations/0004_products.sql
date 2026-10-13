-- ============================================================================
-- 0004_products — 02 §4 + A5
-- ============================================================================
--
-- Konfigurasi produk TIDAK PERNAH di-hardcode (CLAUDE.md §4). Tabel ini satu-
-- satunya sumber kode produk yang dikenali parser.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  code_normalized text generated always as (public.normalize_code(code)) stored not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_code_normalized_key unique (code_normalized),
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_code_not_blank check (btrim(code) <> '')
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();
