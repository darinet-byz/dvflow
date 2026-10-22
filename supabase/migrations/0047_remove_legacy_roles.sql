-- 0047_remove_legacy_roles — A36 (keputusan pengguna 22 Okt 2026): role legacy dihapus.
--   master_admin ("Admin Master (Legacy)") -> owner  (akses identik: penuh, tanpa Reset Data)
--   staff        ("Staff (Legacy)")        -> member (ikut checklist izin Member yang sekarang)
-- ID legacy juga dihapus dari daftar role penuh yang di-hardcode. Tanpa itu, role kustom baru
-- ber-ID `master_admin` akan otomatis mendapat akses penuh.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 47 $$;

-- Jejak di log migrasi: siapa yang dipindah dan izin apa yang berubah bagi eks-Staff.
do $$
declare v_master integer; v_staff integer; v_lost text; v_gained text;
begin
  select count(*) into v_master from public.users where role = 'master_admin';
  select count(*) into v_staff from public.users where role = 'staff';
  select string_agg(permission_key, ', ' order by permission_key) into v_lost
    from public.app_role_permissions s where s.role_id = 'staff'
     and not exists (select 1 from public.app_role_permissions m where m.role_id = 'member' and m.permission_key = s.permission_key);
  select string_agg(permission_key, ', ' order by permission_key) into v_gained
    from public.app_role_permissions m where m.role_id = 'member'
     and not exists (select 1 from public.app_role_permissions s where s.role_id = 'staff' and s.permission_key = m.permission_key);
  raise notice 'A36: % user master_admin -> owner, % user staff -> member', v_master, v_staff;
  raise notice 'A36: izin staff yang tidak dimiliki member: %', coalesce(v_lost, '(tidak ada)');
  raise notice 'A36: izin member yang tidak dimiliki staff: %', coalesce(v_gained, '(tidak ada)');
end $$;

-- Penugasan produk per-user (user_product_access, has_all_product_access) tidak disentuh.
-- Sesi tetap valid: role dibaca ulang dari database pada request berikutnya (0027).
update public.users set role = 'owner', updated_at = now() where role = 'master_admin';
update public.users set role = 'member', updated_at = now() where role = 'staff';

-- app_role_permissions ikut terhapus (FK cascade, 0024). FK users.role ... on delete restrict
-- menggagalkan migrasi bila masih ada user yang memegang role ini.
delete from public.app_roles where id in ('master_admin', 'staff');

create or replace function public.actor_has_permission(p_actor uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.users u where u.id = p_actor and u.active and (
      u.role in ('developer', 'owner') or (
        p_key not in ('config.roles', 'team.manage') and exists (
          select 1 from public.app_role_permissions p where p.role_id = u.role and p.permission_key = p_key
        )
      )
    )
  )
$$;

create or replace function public.actor_can_product(p_actor uuid, p_code text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.users u where u.id = p_actor and u.active and (
      u.role in ('developer', 'owner') or u.has_all_product_access or exists (
        select 1 from public.user_product_access a
        where a.user_id = u.id and public.normalize_code(a.product_code) = public.normalize_code(p_code)
      )
    )
  )
$$;

revoke all on function public.actor_has_permission(uuid,text), public.actor_can_product(uuid,text) from public, anon, authenticated;
grant execute on function public.actor_has_permission(uuid,text), public.actor_can_product(uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.save_role_permissions(p_actor uuid, p_role text, p_permissions text[], p_create boolean DEFAULT false, p_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare v_role public.app_roles;
begin
  if not public.actor_has_permission(p_actor, 'config.roles') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_permissions is null or exists (
    select 1 from unnest(p_permissions) k where k is null or not exists (select 1 from public.app_permissions p where p.key = k)
  ) then raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION'; end if;
  -- A30: Tampilan Apps Lapangan hanya untuk role lapangan.
  if 'ui.field_app' = any(p_permissions) and p_role not in ('pimpro', 'member') then
    raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION';
  end if;
  if p_create then
    if p_role !~ '^[a-z0-9_]{3,32}$' or length(btrim(p_name)) not between 2 and 64 or p_name is null then
      raise exception using errcode = 'DF011', message = 'INVALID_ROLE';
    end if;
    insert into public.app_roles(id,name,description,is_system) values(p_role,btrim(p_name),p_description,false);
  end if;
  select * into v_role from public.app_roles where id = p_role for update;
  if not found then raise exception using errcode = 'DF011', message = 'ROLE_NOT_FOUND'; end if;
  delete from public.app_role_permissions where role_id = p_role;
  -- Full-access system roles cannot accidentally lock themselves out.
  if p_role in ('developer','owner') then
    insert into public.app_role_permissions select p_role, key from public.app_permissions where key <> 'ui.field_app';
  else
    insert into public.app_role_permissions select p_role, k from (select distinct unnest(p_permissions) k) keys;
  end if;
  return to_jsonb(v_role);
end $function$;
revoke all on function public.save_role_permissions(uuid,text,text[],boolean,text,text) from public, anon, authenticated;
grant execute on function public.save_role_permissions(uuid,text,text[],boolean,text,text) to service_role;

-- Role penuh (developer/owner) hanya boleh dihapus Developer; tidak ada
-- yang menghapus akunnya sendiri. Sesi ikut terhapus (FK cascade 0003).
create or replace function public.admin_delete_user(p_actor uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_actor_role text; v_target_role text;
begin
  select role into v_actor_role from public.users where id = p_actor and active;
  if v_actor_role is null or v_actor_role not in ('developer', 'owner') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_target = p_actor then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  select role into v_target_role from public.users where id = p_target for update;
  if v_target_role is null then raise exception using errcode = 'DF005', message = 'USER_NOT_FOUND'; end if;
  if v_target_role in ('developer', 'owner') and v_actor_role <> 'developer' then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  delete from public.users where id = p_target;
end $$;
revoke all on function public.admin_delete_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_user(uuid, uuid) to service_role;

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
begin
  select * into v_actor from public.users where id = p_actor_user_id;
  if not found or not v_actor.active or v_actor.role not in ('developer', 'owner') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if not exists (select 1 from public.app_roles where id = p_role) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_role in ('developer', 'owner') and not p_allow_master then
    raise exception using errcode = 'DF008', message = 'MASTER_ADMIN_CREATE_FORBIDDEN';
  end if;

  -- A20: role advertiser wajib memegang tepat satu pengiklan aktif; role lain tidak memegang pengiklan.
  if p_role = 'advertiser' then
    if p_advertiser_id is null or not exists (
      select 1 from public.advertisers a where a.id = p_advertiser_id and (a.active)
    ) then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;
    v_advertiser_id := p_advertiser_id;
  else
    v_advertiser_id := null;
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
    username,
    display_name,
    password_hash,
    password_algo,
    role,
    avatar_emoji,
    active,
    has_all_product_access,
    advertiser_id
  )
  values (
    v_username,
    v_display_name,
    extensions.crypt(p_initial_password, extensions.gen_salt('bf', 12)),
    'bcrypt',
    p_role,
    p_avatar_emoji,
    true,
    coalesce(p_has_all_product_access, true),
    v_advertiser_id
  )
  returning * into v_new;

  -- Jika akses dibatasi, simpan mapping produk
  if not coalesce(p_has_all_product_access, true) and p_product_codes is not null then
    foreach v_code in array p_product_codes loop
      if exists (select 1 from public.products where code = v_code) then
        insert into public.user_product_access (user_id, product_code)
        values (v_new.id, v_code)
        on conflict (user_id, product_code) do nothing;
      end if;
    end loop;
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
begin
  select * into v_actor from public.users where id = p_actor_user_id;
  if not found or not v_actor.active or v_actor.role not in ('developer', 'owner') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_target from public.users where id = p_target_user_id;
  if not found then
    raise exception using errcode = 'DF005', message = 'USER_NOT_FOUND';
  end if;

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
  else
    v_advertiser_id := null;
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
         has_all_product_access = coalesce(p_has_all_product_access, true),
         advertiser_id = v_advertiser_id,
         updated_at = now()
   where id = v_target.id
   returning * into v_target;

  -- Perbarui relasi produk
  delete from public.user_product_access where user_id = v_target.id;
  if not coalesce(p_has_all_product_access, true) and p_product_codes is not null then
    foreach v_code in array p_product_codes loop
      if exists (select 1 from public.products where code = v_code) then
        insert into public.user_product_access (user_id, product_code)
        values (v_target.id, v_code)
        on conflict (user_id, product_code) do nothing;
      end if;
    end loop;
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

revoke all on function public.admin_create_user(uuid,text,text,text,text,text,boolean,boolean,text[],uuid),
  public.admin_update_user(uuid,uuid,text,text,boolean,text,boolean,boolean,text[],uuid) from public, anon, authenticated;
grant execute on function public.admin_create_user(uuid,text,text,text,text,text,boolean,boolean,text[],uuid),
  public.admin_update_user(uuid,uuid,text,text,boolean,text,boolean,boolean,text[],uuid) to service_role;
