-- ============================================================================
-- 0025_product_aliases_and_multi_connection
-- Fitur Multi-Webhook (10+ Toko OO Anti-Collision) & Kamus Alias Produk Transisi
-- ============================================================================

-- 1. Tambah kolom slug (kode toko maks 4 karakter kapital) pada orderonline_connections
alter table public.orderonline_connections
  add column if not exists slug text;

-- Beri slug default untuk koneksi yang belum memiliki slug
with unassigned as (
  select id, row_number() over (order by created_at asc) as rn
  from public.orderonline_connections
  where slug is null or btrim(slug) = ''
)
update public.orderonline_connections c
set slug = 'TK' || u.rn
from unassigned u
where c.id = u.id;

alter table public.orderonline_connections
  drop constraint if exists orderonline_connections_slug_check,
  drop constraint if exists orderonline_connections_slug_key;

alter table public.orderonline_connections
  alter column slug set not null,
  add constraint orderonline_connections_slug_check check (slug ~ '^[A-Z0-9]{1,4}$'),
  add constraint orderonline_connections_slug_key unique (slug);

-- 2. Tambah kolom raw_order_id dan connection_id pada tabel orders
alter table public.orders
  add column if not exists raw_order_id text,
  add column if not exists connection_id uuid references public.orderonline_connections(id) on delete set null;

create index if not exists idx_orders_raw_order_id on public.orders (raw_order_id);
create index if not exists idx_orders_connection_id on public.orders (connection_id);

-- 3. Perbarui orderonline_order_sources: Primary Key komposit (order_id, connection_id)
alter table public.orderonline_order_sources
  drop constraint if exists orderonline_order_sources_pkey;

alter table public.orderonline_order_sources
  add primary key (order_id, connection_id);

-- 4. Perbarui RPC upsert_connected_order dengan namespace slug koneksi
create or replace function public.upsert_connected_order(p_connection_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_conn record;
  v_raw_order_id text;
  v_effective_order_id text;
  v_modified_payload jsonb;
  v_result jsonb;
begin
  select id, name, slug into v_conn
    from public.orderonline_connections
   where id = p_connection_id and active
   for share;
  if not found then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;

  v_raw_order_id := nullif(btrim(p_payload->>'orderId'), '');
  if v_raw_order_id is null then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  -- Terapkan namespace kode toko bila belum diawali prefix kode
  if v_conn.slug is not null and v_raw_order_id not like (v_conn.slug || '-%') then
    v_effective_order_id := v_conn.slug || '-' || v_raw_order_id;
  else
    v_effective_order_id := v_raw_order_id;
  end if;

  v_modified_payload := jsonb_set(p_payload, '{orderId}', to_jsonb(v_effective_order_id));

  insert into public.orderonline_order_sources(order_id, connection_id)
    values (v_effective_order_id, p_connection_id)
    on conflict do nothing;

  select public.upsert_order_webhook(v_modified_payload) into v_result;

  update public.orders
     set raw_order_id = v_raw_order_id,
         connection_id = p_connection_id
   where order_id = v_effective_order_id;

  update public.orderonline_connections set last_received_at = now() where id = p_connection_id;
  return v_result;
end;
$$;
revoke all on function public.upsert_connected_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_connected_order(uuid, jsonb) to service_role;

-- 5. Tabel Kamus Alias Produk
create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_name text not null check (length(btrim(alias_name)) between 1 and 200),
  alias_name_normalized text not null,
  canonical_target text not null check (length(btrim(canonical_target)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  constraint product_aliases_alias_name_normalized_key unique (alias_name_normalized)
);

create index if not exists idx_product_aliases_normalized on public.product_aliases (alias_name_normalized);

alter table public.product_aliases enable row level security;
revoke all on public.product_aliases from public, anon;
grant select on public.product_aliases to authenticated;
grant all on public.product_aliases to service_role;

-- 6. RPC batch_remap_orders
create or replace function public.batch_remap_orders(
  p_order_ids text[],
  p_canonical_target text,
  p_parsed jsonb,
  p_save_alias boolean default false,
  p_alias_name text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null or array_length(p_order_ids, 1) = 0 then
    raise exception using errcode = 'DF011', message = 'EMPTY_ORDER_IDS';
  end if;
  if p_canonical_target is null or btrim(p_canonical_target) = '' then
    raise exception using errcode = 'DF011', message = 'INVALID_CANONICAL_TARGET';
  end if;
  if p_parsed is null or p_parsed->>'product_parse_status' <> 'valid' then
    raise exception using errcode = 'DF011', message = 'CANONICAL_TARGET_NOT_VALID';
  end if;

  update public.orders
     set product_raw = coalesce(nullif(btrim(product_raw), ''), p_canonical_target),
         product_parse_status = 'valid',
         product_code = p_parsed->>'product_code',
         product_name = p_parsed->>'product_name',
         advertiser_code = p_parsed->>'advertiser_code',
         advertiser_name = p_parsed->>'advertiser_name',
         event_type = p_parsed->>'event_type',
         batch = p_parsed->>'batch',
         session = p_parsed->>'session',
         city = p_parsed->>'city',
         updated_at = now()
   where order_id = any(p_order_ids);

  get diagnostics v_count = row_count;

  if p_save_alias and p_alias_name is not null and btrim(p_alias_name) <> '' then
    insert into public.product_aliases (alias_name, alias_name_normalized, canonical_target, created_by)
    values (
      btrim(p_alias_name),
      lower(btrim(p_alias_name)),
      btrim(p_canonical_target),
      p_actor_id
    )
    on conflict (alias_name_normalized) do update
      set canonical_target = excluded.canonical_target,
          updated_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'updated_count', v_count,
    'alias_saved', p_save_alias and p_alias_name is not null and btrim(p_alias_name) <> ''
  );
end;
$$;
revoke all on function public.batch_remap_orders(text[], text, jsonb, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.batch_remap_orders(text[], text, jsonb, boolean, text, uuid) to service_role;

-- 7. Seed Permission Baru
insert into public.app_permissions (key, name, module, description, sort_order)
values
  ('operasional.order_unmapped', 'Order Unmapped', 'operasional', 'Melihat dan memetakan order dengan nama produk tidak standar', 6),
  ('config.alias_produk', 'Alias Produk', 'konfigurasi', 'Mengatur kamus alias nama produk OrderOnline ke DVFLOW', 17)
on conflict (key) do update
  set name = excluded.name,
      module = excluded.module,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into public.app_role_permissions (role_id, permission_key)
select r.id, p.key
from public.app_roles r
cross join public.app_permissions p
where r.id in ('developer', 'owner', 'master_admin', 'manajer', 'admin')
  and p.key in ('operasional.order_unmapped', 'config.alias_produk')
on conflict (role_id, permission_key) do nothing;

