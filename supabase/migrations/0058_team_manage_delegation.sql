-- 0058_team_manage_delegation — A50 (permintaan pengguna 28 Okt 2026).
-- `team.manage` sekarang benar-benar dapat didelegasikan ke role non-master (mis. Manajer).
-- Batasnya:
--   * hanya boleh menambah anggota baru (create + list);
--   * tidak boleh membuat Owner/Developer/Manajer/Admin;
--   * hanya boleh memberikan produk yang ia sendiri pegang;
--   * edit/hapus akun dan Konfigurasi Role tetap Developer/Owner.
-- `config.roles` tetap master-only.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 58 $$;

-- team.manage tidak lagi dikecualikan; config.roles tetap khusus Developer/Owner.
create or replace function public.actor_has_permission(p_actor uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.users u where u.id = p_actor and u.active and (
      u.role in ('developer', 'owner') or (
        p_key <> 'config.roles' and exists (
          select 1 from public.app_role_permissions p where p.role_id = u.role and p.permission_key = p_key
        )
      )
    )
  )
$$;

-- Role yang boleh diberikan oleh pemegang team.manage:
-- standar Member/Pimpro/Advertiser + role kustom yang permission-nya subset dari actor.
-- Owner/Developer/Manajer/Admin diblokir eksplisit.
create or replace function public.actor_can_assign_role(p_actor uuid, p_role text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.users u
     where u.id = p_actor
       and u.active
       and exists (select 1 from public.app_roles r where r.id = p_role)
       and (
         u.role in ('developer', 'owner')
         or (
           public.actor_has_permission(p_actor, 'team.manage')
           and p_role not in ('developer', 'owner', 'manajer', 'admin')
           and not exists (
             select 1 from public.app_role_permissions tr
              where tr.role_id = p_role
                and tr.permission_key in ('config.roles', 'team.manage')
           )
           and not exists (
             select 1 from public.app_role_permissions tr
              where tr.role_id = p_role
                and tr.permission_key not in ('ui.field_app', 'action.input_spend')
                and not exists (
                  select 1 from public.app_role_permissions ar
                   where ar.role_id = u.role and ar.permission_key = tr.permission_key
                )
           )
         )
       )
  )
$$;

-- Produk yang boleh diberikan: hanya yang dapat diakses aktor.
-- "Semua Produk" hanya boleh jika aktor memang punya akses semua produk.
create or replace function public.actor_can_assign_products(p_actor uuid, p_all boolean, p_codes text[]) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.users u
     where u.id = p_actor
       and u.active
       and (
         u.role in ('developer', 'owner')
         or (
           public.actor_has_permission(p_actor, 'team.manage')
           and (
             (coalesce(p_all, true) and u.has_all_product_access)
             or (
               not coalesce(p_all, true)
               and not exists (
                 select 1 from unnest(coalesce(p_codes, '{}'::text[])) c
                  where not public.actor_can_product(p_actor, c)
               )
             )
           )
         )
       )
  )
$$;

-- admin_create_user: master ATAU pemegang team.manage, dengan batas role/produk.
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
  if not found or not v_actor.active or not (
    v_actor.role in ('developer', 'owner') or public.actor_has_permission(v_actor.id, 'team.manage')
  ) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if not exists (select 1 from public.app_roles where id = p_role) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if v_actor.role not in ('developer', 'owner') then
    if not public.actor_can_assign_role(v_actor.id, p_role) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
    if not public.actor_can_assign_products(
      v_actor.id,
      coalesce(p_has_all_product_access, true),
      p_product_codes
    ) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
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

-- save_role_permissions: team.manage boleh; config.roles tetap master-only.
create or replace function public.save_role_permissions(
  p_actor uuid,
  p_role text,
  p_permissions text[],
  p_create boolean default false,
  p_name text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_role public.app_roles;
begin
  if not public.actor_has_permission(p_actor, 'config.roles') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_permissions is null or exists (
    select 1 from unnest(p_permissions) k where k is null or not exists (select 1 from public.app_permissions p where p.key = k)
  ) then raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION'; end if;
  if 'ui.field_app' = any(p_permissions) and p_role not in ('pimpro', 'member') then
    raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION';
  end if;
  if 'action.input_spend' = any(p_permissions) and p_role <> 'advertiser' then
    raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION';
  end if;
  if p_role not in ('developer', 'owner') and 'config.roles' = any(p_permissions) then
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
  if p_role in ('developer','owner') then
    insert into public.app_role_permissions
    select p_role, key from public.app_permissions
     where key not in ('ui.field_app', 'action.input_spend');
  else
    insert into public.app_role_permissions select p_role, k from (select distinct unnest(p_permissions) k) keys;
  end if;
  return to_jsonb(v_role);
end $$;

update public.app_permissions
   set description = 'Melihat, menambah anggota tim, dan mengatur akses produk. Edit/hapus akun dan Konfigurasi Role tetap Developer/Owner.'
 where key = 'team.manage';

update public.app_permissions
   set description = 'Mengatur peran pengguna dan checklist hak akses. Khusus Developer/Owner.'
 where key = 'config.roles';

revoke all on function public.actor_can_assign_role(uuid,text),
  public.actor_can_assign_products(uuid,boolean,text[]) from public, anon, authenticated;
grant execute on function public.actor_can_assign_role(uuid,text),
  public.actor_can_assign_products(uuid,boolean,text[]) to service_role;

revoke all on function public.admin_create_user(uuid,text,text,text,text,text,boolean,boolean,text[],uuid)
  from public, anon, authenticated;
grant execute on function public.admin_create_user(uuid,text,text,text,text,text,boolean,boolean,text[],uuid)
  to service_role;

revoke all on function public.save_role_permissions(uuid,text,text[],boolean,text,text)
  from public, anon, authenticated;
grant execute on function public.save_role_permissions(uuid,text,text[],boolean,text,text)
  to service_role;
