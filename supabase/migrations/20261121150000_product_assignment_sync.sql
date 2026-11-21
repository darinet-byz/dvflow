-- 20261121150000_product_assignment_sync — A88: penugasan produk harus sinkron.
--
-- Ada dua tempat penugasan produk:
--   1. Add Team  -> user_product_access / has_all_product_access
--   2. Status Produk/Pengiklan -> product_advertisers
-- Sebelum A88 keduanya bisa berbeda. Migrasi ini menyatukan data lama lalu menjaga
-- sinkronisasi dua arah lewat RPC yang sudah ada (semua tulisan lewat backend).
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 86 $$;

-- ---------------------------------------------------------------------------
-- Helper: akses user -> mapping Status Pengiklan
-- ---------------------------------------------------------------------------
create or replace function public.sync_advertiser_product_mapping(p_advertiser_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  -- Jangan hapus mapping historis untuk pengiklan yang tidak punya akun Advertiser.
  if not exists (
    select 1 from public.users where advertiser_id = p_advertiser_id and role = 'advertiser'
  ) then
    return;
  end if;

  delete from public.product_advertisers where advertiser_id = p_advertiser_id;
  insert into public.product_advertisers (product_id, advertiser_id, created_by, updated_by)
  select distinct p.id, p_advertiser_id, p_actor, p_actor
    from public.users u
    join public.user_product_access a on a.user_id = u.id
    join public.products p on p.code = a.product_code
   where u.advertiser_id = p_advertiser_id
     and u.role = 'advertiser'
     and not u.has_all_product_access
  on conflict (product_id, advertiser_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Helper: mapping Status Pengiklan -> akses semua akun Advertiser
-- ---------------------------------------------------------------------------
create or replace function public.sync_advertiser_user_access(p_advertiser_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  -- Untuk role Advertiser, "Semua Produk" tidak dipakai; produk harus eksplisit.
  update public.users
     set has_all_product_access = false,
         updated_at = now()
   where advertiser_id = p_advertiser_id
     and role = 'advertiser'
     and has_all_product_access;

  delete from public.user_product_access
   where user_id in (
     select id from public.users where advertiser_id = p_advertiser_id and role = 'advertiser'
   );

  insert into public.user_product_access (user_id, product_code)
  select u.id, p.code
    from public.users u
    join public.product_advertisers pa on pa.advertiser_id = u.advertiser_id
    join public.products p on p.id = pa.product_id
   where u.advertiser_id = p_advertiser_id
     and u.role = 'advertiser'
  on conflict (user_id, product_code) do nothing;
end $$;

revoke all on function public.sync_advertiser_product_mapping(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sync_advertiser_user_access(uuid) from public, anon, authenticated;
grant execute on function public.sync_advertiser_product_mapping(uuid, uuid) to service_role;
grant execute on function public.sync_advertiser_user_access(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill data lama
-- ---------------------------------------------------------------------------
-- Advertiser dengan "Semua Produk": kosongkan dulu (keputusan pengguna A88).
create temp table _adv_all_access_users on commit drop as
select u.id as user_id, u.advertiser_id
  from public.users u
 where u.role = 'advertiser'
   and u.advertiser_id is not null
   and u.has_all_product_access;

delete from public.user_product_access
 where user_id in (select user_id from _adv_all_access_users);

delete from public.product_advertisers
 where advertiser_id in (select distinct advertiser_id from _adv_all_access_users);

update public.users
   set has_all_product_access = false,
       updated_at = now()
 where id in (select user_id from _adv_all_access_users);

-- Union: akses user -> mapping.
insert into public.product_advertisers (product_id, advertiser_id)
select distinct p.id, u.advertiser_id
  from public.users u
  join public.user_product_access a on a.user_id = u.id
  join public.products p on p.code = a.product_code
 where u.role = 'advertiser'
   and u.advertiser_id is not null
   and not u.has_all_product_access
on conflict (product_id, advertiser_id) do nothing;

-- Union: mapping -> akses semua akun Advertiser.
insert into public.user_product_access (user_id, product_code)
select distinct u.id, p.code
  from public.users u
  join public.product_advertisers pa on pa.advertiser_id = u.advertiser_id
  join public.products p on p.id = pa.product_id
 where u.role = 'advertiser'
   and u.advertiser_id is not null
   and not u.has_all_product_access
on conflict (user_id, product_code) do nothing;

-- ---------------------------------------------------------------------------
-- admin_create_user: Advertiser selalu eksplisit; mapping ikut diperbarui.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_user(
  p_actor_user_id uuid,
  p_username text,
  p_display_name text,
  p_initial_password text,
  p_role text,
  p_avatar_emoji text default null,
  p_allow_master boolean default false,
  p_has_all_product_access boolean default true,
  p_product_codes text[] default '{}'::text[],
  p_advertiser_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_actor public.users;
  v_username text;
  v_display_name text;
  v_new public.users;
  v_code text;
  v_advertiser_id uuid;
  v_has_all boolean;
begin
  select * into v_actor from public.users where id = p_actor_user_id;
  if not found or not v_actor.active or not (
    v_actor.role in ('developer', 'owner') or public.actor_has_permission(v_actor.id, 'team.manage')
  ) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if not exists (select 1 from public.app_roles where id = p_role) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  -- A20: role advertiser wajib memegang tepat satu pengiklan aktif; role lain tidak memegang pengiklan.
  if p_role = 'advertiser' then
    if p_advertiser_id is null or not exists (
      select 1 from public.advertisers a where a.id = p_advertiser_id and a.active
    ) then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;
    v_advertiser_id := p_advertiser_id;
    v_has_all := false;
  else
    v_advertiser_id := null;
    v_has_all := coalesce(p_has_all_product_access, true);
  end if;

  if v_actor.role not in ('developer', 'owner') then
    if not public.actor_can_assign_role(v_actor.id, p_role) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
    if not public.actor_can_assign_products(v_actor.id, v_has_all, p_product_codes) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
  end if;

  if p_role in ('developer', 'owner') and not p_allow_master then
    raise exception using errcode = 'DF008', message = 'MASTER_ADMIN_CREATE_FORBIDDEN';
  end if;

  v_username := regexp_replace(coalesce(p_username, ''), '^\s+|\s+$', '', 'g');
  v_display_name := btrim(coalesce(p_display_name, ''));

  if length(coalesce(p_initial_password, '')) < 8 then
    raise exception using errcode = 'DF007', message = 'WEAK_PASSWORD';
  end if;

  if exists (select 1 from public.users where username_normalized = lower(v_username)) then
    raise exception using errcode = 'DF009', message = 'USERNAME_TAKEN';
  end if;

  insert into public.users (
    username, display_name, password_hash, password_algo, role, avatar_emoji, active,
    has_all_product_access, advertiser_id
  )
  values (
    v_username,
    v_display_name,
    extensions.crypt(p_initial_password, extensions.gen_salt('bf', 12)),
    'bcrypt',
    p_role,
    p_avatar_emoji,
    true,
    v_has_all,
    v_advertiser_id
  )
  returning * into v_new;

  if not v_has_all then
    -- Akun Advertiser baru mewarisi produk yang sudah dipegang pengiklannya.
    if p_role = 'advertiser'
       and (p_product_codes is null or cardinality(p_product_codes) = 0) then
      insert into public.user_product_access (user_id, product_code)
      select v_new.id, p.code
        from public.product_advertisers pa
        join public.products p on p.id = pa.product_id
       where pa.advertiser_id = v_advertiser_id
      on conflict (user_id, product_code) do nothing;
    elsif p_product_codes is not null then
      foreach v_code in array p_product_codes loop
        if exists (select 1 from public.products where code = v_code) then
          insert into public.user_product_access (user_id, product_code)
          values (v_new.id, v_code)
          on conflict (user_id, product_code) do nothing;
        end if;
      end loop;
    end if;
  end if;

  if p_role = 'advertiser' then
    perform public.sync_advertiser_product_mapping(v_advertiser_id, v_actor.id);
  end if;

  return jsonb_build_object(
    'user_id', v_new.id,
    'username', v_new.username,
    'display_name', v_new.display_name,
    'role', v_new.role,
    'avatar_emoji', v_new.avatar_emoji,
    'active', v_new.active,
    'has_all_product_access', v_new.has_all_product_access,
    'advertiser_id', v_new.advertiser_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_update_user: Advertiser selalu eksplisit; mapping ikut diperbarui.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_user(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_display_name text,
  p_role text,
  p_active boolean,
  p_new_password text default null,
  p_allow_master boolean default false,
  p_has_all_product_access boolean default true,
  p_product_codes text[] default '{}'::text[],
  p_advertiser_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_actor public.users;
  v_target public.users;
  v_display_name text;
  v_code text;
  v_advertiser_id uuid;
  v_old_advertiser_id uuid;
  v_has_all boolean;
begin
  select * into v_actor from public.users where id = p_actor_user_id;
  if not found or not v_actor.active or v_actor.role not in ('developer', 'owner') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_target from public.users where id = p_target_user_id;
  if not found then
    raise exception using errcode = 'DF005', message = 'USER_NOT_FOUND';
  end if;
  v_old_advertiser_id := v_target.advertiser_id;

  if not exists (select 1 from public.app_roles where id = p_role) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_role in ('developer', 'owner') and v_target.role not in ('developer', 'owner') and not p_allow_master then
    raise exception using errcode = 'DF008', message = 'MASTER_ADMIN_CREATE_FORBIDDEN';
  end if;

  -- A20: role advertiser wajib memegang tepat satu pengiklan aktif; role lain tidak memegang pengiklan.
  if p_role = 'advertiser' then
    if p_advertiser_id is null or not exists (
      select 1 from public.advertisers a where a.id = p_advertiser_id and (a.active or a.id = v_target.advertiser_id)
    ) then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;
    v_advertiser_id := p_advertiser_id;
    v_has_all := false;
  else
    v_advertiser_id := null;
    v_has_all := coalesce(p_has_all_product_access, true);
  end if;

  v_display_name := btrim(coalesce(p_display_name, ''));
  if v_display_name = '' or length(v_display_name) > 200 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_new_password is not null and p_new_password <> '' then
    if length(p_new_password) < 8 then
      raise exception using errcode = 'DF007', message = 'WEAK_PASSWORD';
    end if;
    update public.users
       set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
           password_algo = 'bcrypt',
           updated_at = now()
     where id = v_target.id;
  end if;

  update public.users
     set display_name = v_display_name,
         role = p_role,
         active = p_active,
         has_all_product_access = v_has_all,
         advertiser_id = v_advertiser_id,
         updated_at = now()
   where id = v_target.id
   returning * into v_target;

  delete from public.user_product_access where user_id = v_target.id;
  if not v_has_all and p_product_codes is not null then
    foreach v_code in array p_product_codes loop
      if exists (select 1 from public.products where code = v_code) then
        insert into public.user_product_access (user_id, product_code)
        values (v_target.id, v_code)
        on conflict (user_id, product_code) do nothing;
      end if;
    end loop;
  end if;

  if v_advertiser_id is not null then
    perform public.sync_advertiser_product_mapping(v_advertiser_id, v_actor.id);
  end if;
  if v_old_advertiser_id is not null and v_old_advertiser_id is distinct from v_advertiser_id then
    perform public.sync_advertiser_product_mapping(v_old_advertiser_id, v_actor.id);
  end if;

  return jsonb_build_object(
    'user_id', v_target.id,
    'username', v_target.username,
    'display_name', v_target.display_name,
    'role', v_target.role,
    'avatar_emoji', v_target.avatar_emoji,
    'active', v_target.active,
    'has_all_product_access', v_target.has_all_product_access,
    'advertiser_id', v_target.advertiser_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Status Produk: mapping berubah -> akses semua akun advertiser ikut berubah
-- ---------------------------------------------------------------------------
create or replace function public.set_product_advertisers(p_product_id uuid, p_advertiser_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products;
  v_old_advertisers uuid[] := '{}'::uuid[];
  v_affected uuid[] := '{}'::uuid[];
  v_id uuid;
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

  select coalesce(array_agg(distinct advertiser_id), '{}'::uuid[])
    into v_old_advertisers
    from public.product_advertisers where product_id = p_product_id;

  delete from public.product_advertisers where product_id = p_product_id;
  insert into public.product_advertisers (product_id, advertiser_id, created_by, updated_by)
  select p_product_id, a.id, v_actor, v_actor
    from public.advertisers a
   where a.id = any(coalesce(p_advertiser_ids, '{}'::uuid[]))
  on conflict (product_id, advertiser_id) do nothing;

  v_affected := v_old_advertisers || coalesce(p_advertiser_ids, '{}'::uuid[]);
  for v_id in select distinct unnest(v_affected) loop
    perform public.sync_advertiser_user_access(v_id);
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name) order by a.code)
      from public.product_advertisers pa
      join public.advertisers a on a.id = pa.advertiser_id
     where pa.product_id = p_product_id
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Status Pengiklan: daftar produk berubah -> akses semua akun advertiser ikut berubah
-- ---------------------------------------------------------------------------
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

  perform public.sync_advertiser_user_access(p_advertiser_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code)
      from public.product_advertisers pa
      join public.products p on p.id = pa.product_id
     where pa.advertiser_id = p_advertiser_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.admin_create_user(uuid,text,text,text,text,text,boolean,boolean,text[],uuid),
  public.admin_update_user(uuid,uuid,text,text,boolean,text,boolean,boolean,text[],uuid),
  public.set_product_advertisers(uuid,uuid[]),
  public.set_advertiser_products(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.admin_create_user(uuid,text,text,text,text,text,boolean,boolean,text[],uuid),
  public.admin_update_user(uuid,uuid,text,text,boolean,text,boolean,boolean,text[],uuid) to service_role;
grant execute on function public.set_product_advertisers(uuid,uuid[]),
  public.set_advertiser_products(uuid,uuid[]) to authenticated;
