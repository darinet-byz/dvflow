-- 0060_team_delete_policy — A54 (permintaan pengguna 28 Okt 2026).
-- Hapus permanen hanya boleh untuk user yang belum punya data historis.
-- User yang punya data (advertiser, report, scan, alias, OTS, settings) harus
-- dinonaktifkan agar atribusi dan histori tetap utuh.
-- Deaktivasi user selalu mencabut seluruh refresh session.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 60 $$;

create or replace function public.user_has_business_data(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select
    exists (select 1 from public.users u where u.id = p_user_id and u.advertiser_id is not null)
    or exists (select 1 from public.ad_spend_reports r where r.created_by = p_user_id or r.updated_by = p_user_id)
    or exists (select 1 from public.attendance_events e where e.scanner_user_id = p_user_id)
    or exists (select 1 from public.product_aliases a where a.created_by = p_user_id)
    or exists (select 1 from public.orders o where o.ots_collected_by = p_user_id)
    or exists (select 1 from public.app_settings s where s.updated_by = p_user_id)
$$;

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
  if public.user_has_business_data(p_target) then
    raise exception using errcode = 'DF018', message = 'USER_HAS_DATA';
  end if;
  delete from public.users where id = p_target;
end $$;

-- Setiap user yang dinonaktifkan (soft delete, Resign, edit manual) langsung
-- kehilangan refresh session. Access JWT lama tetap ditolak oleh is_app_user().
create or replace function public.users_revoke_sessions_on_disable() returns trigger
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
begin
  if NEW.active = false and (TG_OP = 'INSERT' or OLD.active = true) then
    delete from public.app_sessions where user_id = NEW.id;
  end if;
  return NEW;
end $$;

drop trigger if exists users_revoke_sessions_on_disable on public.users;
create trigger users_revoke_sessions_on_disable
  after update of active on public.users
  for each row execute function public.users_revoke_sessions_on_disable();

revoke all on function public.user_has_business_data(uuid) from public, anon, authenticated;
grant execute on function public.user_has_business_data(uuid) to service_role;

revoke all on function public.admin_delete_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_user(uuid, uuid) to service_role;
