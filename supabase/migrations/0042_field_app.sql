-- 0042_field_app — A30 (keputusan pengguna 17 Okt 2026): "Tampilan Apps Lapangan" di HP.
-- Izin ui.field_app hanya boleh dimiliki pimpro, staff, member (default dicentang, bisa dilepas di
-- Konfigurasi Role). Role lain (termasuk master) tidak pernah mendapatkannya dan tetap memakai tampilan web.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 42 $$;

insert into public.app_permissions (key, name, module, description, sort_order)
values ('ui.field_app', 'Tampilan Apps Lapangan', 'tampilan',
        'Di HP memakai tampilan aplikasi lapangan (tab bawah: Presensi, OTS, Scan, Cari Peserta, Akun)', 50)
on conflict (key) do nothing;

insert into public.app_role_permissions (role_id, permission_key)
select r, 'ui.field_app' from unnest(array['pimpro', 'staff', 'member']) r
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- Role master mendapat semua izin lewat seed/save; izin ini tidak untuk mereka.
delete from public.app_role_permissions where permission_key = 'ui.field_app' and role_id not in ('pimpro', 'staff', 'member');

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
  if 'ui.field_app' = any(p_permissions) and p_role not in ('pimpro', 'staff', 'member') then
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
  if p_role in ('developer','owner','master_admin') then
    insert into public.app_role_permissions select p_role, key from public.app_permissions where key <> 'ui.field_app';
  else
    insert into public.app_role_permissions select p_role, k from (select distinct unnest(p_permissions) k) keys;
  end if;
  return to_jsonb(v_role);
end $function$;
