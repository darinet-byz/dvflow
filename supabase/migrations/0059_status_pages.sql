-- 0059_status_pages — A51/A52 (permintaan pengguna 28 Okt 2026).
-- Dua halaman status baru:
--   * Status Produk: Active / In-Active / On-Hold / Upcoming.
--   * Status Advertiser: In-House / Freelance / Intern / Resign.
-- Mapping produk-pengiklan disimpan di tabel khusus dan HANYA menjadi label;
-- tidak mempengaruhi akses, order, report, RLS, atau filter mana pun.
-- Resign menutup akses akun login advertiser; status aktif kembali membuka akses.
-- Tidak ada data order/report yang dihapus.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 59 $$;

-- 1. Status produk -----------------------------------------------------------
alter table public.products
  add column if not exists status text not null default 'Active'
  check (status in ('Active', 'In-Active', 'On-Hold', 'Upcoming'));
update public.products
   set status = 'In-Active'
 where active = false and status = 'Active';

-- 2. Status advertiser -------------------------------------------------------
alter table public.advertisers
  add column if not exists status text not null default 'In-House'
  check (status in ('In-House', 'Freelance', 'Intern', 'Resign'));

-- 3. Izin menu ---------------------------------------------------------------
insert into public.app_permissions (key, name, module, description, sort_order)
values
  ('operasional.product_status', 'Status Produk', 'operasional',
   'Melihat status semua produk dan mengubah status/mapping pengiklan', 10),
  ('operasional.advertiser_status', 'Status Pengiklan', 'operasional',
   'Melihat status semua pengiklan dan mengubah status/mapping produk', 11)
on conflict (key) do nothing;

insert into public.app_role_permissions (role_id, permission_key)
select r, k
  from unnest(array['manajer', 'admin']) r
  cross join unnest(array['operasional.product_status', 'operasional.advertiser_status']) k
 where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- Status pages membaca dropdown produk/pengiklan dari tabel konfigurasi.
create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'action.ots','operasional.report_spend','operasional.resume_batch','operasional.analytics',
    'operasional.product_status','operasional.advertiser_status',
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;

-- 4. Mapping label produk-pengiklan -----------------------------------------
create table if not exists public.product_advertisers (
  product_id uuid not null references public.products (id) on delete cascade,
  advertiser_id uuid not null references public.advertisers (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  primary key (product_id, advertiser_id)
);
alter table public.product_advertisers enable row level security;
revoke all on table public.product_advertisers from anon, authenticated;
grant all on table public.product_advertisers to service_role;

-- Isi awal dari histori order + report spend (label saja).
insert into public.product_advertisers (product_id, advertiser_id)
select distinct p.id, a.id
  from public.orders o
  join public.products p on p.code_normalized = public.normalize_code(o.product_code)
  join public.advertisers a on a.code_normalized = public.normalize_code(o.advertiser_code)
 where o.product_parse_status = 'valid'
   and o.advertiser_code is not null
on conflict (product_id, advertiser_id) do nothing;

insert into public.product_advertisers (product_id, advertiser_id)
select distinct r.product_id, r.advertiser_id
  from public.ad_spend_reports r
on conflict (product_id, advertiser_id) do nothing;

-- 5. Daftar status -----------------------------------------------------------
create or replace function public.product_status_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if not public.has_permission('operasional.product_status') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(row_json order by sort_key, product_name), '[]'::jsonb)
    into v_result
    from (
      select p.name as product_name,
             case p.status
               when 'Active' then 1
               when 'Upcoming' then 2
               when 'On-Hold' then 3
               else 4
             end as sort_key,
             jsonb_build_object(
               'id', p.id,
               'code', p.code,
               'name', p.name,
               'status', p.status,
               'active', p.active,
               'advertisers', coalesce((
                 select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name) order by a.code)
                   from public.product_advertisers pa
                   join public.advertisers a on a.id = pa.advertiser_id
                  where pa.product_id = p.id
               ), '[]'::jsonb)
             ) as row_json
        from public.products p
       where public.actor_can_product(v_actor, p.code)
    ) rows;

  return v_result;
end $$;

create or replace function public.advertiser_status_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if not public.has_permission('operasional.advertiser_status') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(row_json order by sort_key, advertiser_name), '[]'::jsonb)
    into v_result
    from (
      select a.name as advertiser_name,
             case a.status
               when 'In-House' then 1
               when 'Freelance' then 2
               when 'Intern' then 3
               else 4
             end as sort_key,
             jsonb_build_object(
               'id', a.id,
               'code', a.code,
               'name', a.name,
               'status', a.status,
               'active', a.active,
               'products', coalesce((
                 select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code)
                   from public.product_advertisers pa
                   join public.products p on p.id = pa.product_id
                  where pa.advertiser_id = a.id
                    and public.actor_can_product(v_actor, p.code)
               ), '[]'::jsonb)
             ) as row_json
        from public.advertisers a
    ) rows;

  return v_result;
end $$;

-- 6. Ubah status -------------------------------------------------------------
create or replace function public.set_product_status(p_product_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products;
begin
  if not public.has_permission('operasional.product_status') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_status not in ('Active', 'In-Active', 'On-Hold', 'Upcoming') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if not public.actor_can_product(v_actor, v_product.code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  update public.products
     set status = p_status,
         active = (p_status = 'Active'),
         updated_at = now()
   where id = p_product_id
  returning * into v_product;

  return to_jsonb(v_product);
end $$;

create or replace function public.set_advertiser_status(p_advertiser_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor public.users;
  v_advertiser public.advertisers;
begin
  if not public.has_permission('operasional.advertiser_status') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select * into v_actor from public.users where id = auth.uid();
  if not found or not v_actor.active or v_actor.role = 'advertiser' or not (
    v_actor.role in ('developer', 'owner') or v_actor.has_all_product_access
  ) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_status not in ('In-House', 'Freelance', 'Intern', 'Resign') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_advertiser from public.advertisers where id = p_advertiser_id for update;
  if not found then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  update public.advertisers
     set status = p_status,
         active = (p_status <> 'Resign'),
         updated_at = now()
   where id = p_advertiser_id
  returning * into v_advertiser;

  if p_status = 'Resign' then
    update public.users
       set active = false,
           updated_at = now()
     where advertiser_id = p_advertiser_id;
    delete from public.app_sessions
     where user_id in (select id from public.users where advertiser_id = p_advertiser_id);
  else
    -- Permintaan pengguna: status aktif kembali langsung membuka akses akun.
    update public.users
       set active = true,
           updated_at = now()
     where advertiser_id = p_advertiser_id;
  end if;

  return to_jsonb(v_advertiser);
end $$;

-- 7. Ubah mapping (label saja) ----------------------------------------------
create or replace function public.set_product_advertisers(p_product_id uuid, p_advertiser_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products;
begin
  if not public.has_permission('operasional.product_status') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if not public.actor_can_product(v_actor, v_product.code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  delete from public.product_advertisers where product_id = p_product_id;
  insert into public.product_advertisers (product_id, advertiser_id, created_by, updated_by)
  select p_product_id, a.id, v_actor, v_actor
    from public.advertisers a
   where a.id = any(coalesce(p_advertiser_ids, '{}'::uuid[]))
  on conflict (product_id, advertiser_id) do nothing;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name) order by a.code)
      from public.product_advertisers pa
      join public.advertisers a on a.id = pa.advertiser_id
     where pa.product_id = p_product_id
  ), '[]'::jsonb);
end $$;

create or replace function public.set_advertiser_products(p_advertiser_id uuid, p_product_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor public.users;
  v_advertiser public.advertisers;
begin
  if not public.has_permission('operasional.advertiser_status') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select * into v_actor from public.users where id = auth.uid();
  if not found or not v_actor.active or v_actor.role = 'advertiser' or not (
    v_actor.role in ('developer', 'owner') or v_actor.has_all_product_access
  ) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select * into v_advertiser from public.advertisers where id = p_advertiser_id for update;
  if not found then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  delete from public.product_advertisers where advertiser_id = p_advertiser_id;
  insert into public.product_advertisers (product_id, advertiser_id, created_by, updated_by)
  select p.id, p_advertiser_id, v_actor.id, v_actor.id
    from public.products p
   where p.id = any(coalesce(p_product_ids, '{}'::uuid[]))
     and public.actor_can_product(v_actor.id, p.code)
  on conflict (product_id, advertiser_id) do nothing;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code)
      from public.product_advertisers pa
      join public.products p on p.id = pa.product_id
     where pa.advertiser_id = p_advertiser_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.product_status_list() from public, anon, authenticated;
revoke all on function public.advertiser_status_list() from public, anon, authenticated;
revoke all on function public.set_product_status(uuid,text) from public, anon, authenticated;
revoke all on function public.set_advertiser_status(uuid,text) from public, anon, authenticated;
revoke all on function public.set_product_advertisers(uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.set_advertiser_products(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.product_status_list() to authenticated;
grant execute on function public.advertiser_status_list() to authenticated;
grant execute on function public.set_product_status(uuid,text) to authenticated;
grant execute on function public.set_advertiser_status(uuid,text) to authenticated;
grant execute on function public.set_product_advertisers(uuid,uuid[]) to authenticated;
grant execute on function public.set_advertiser_products(uuid,uuid[]) to authenticated;
