-- ============================================================================
-- 0023_scope_rules_and_crud — Scoped Zoom/Ticket rules & full CRUD support
-- ============================================================================

-- 1. Izinkan key `seminar_ticket::%` di `public.app_settings` selain `webinar_destination::%`
alter table public.app_settings
  drop constraint if exists app_settings_key_allowed,
  drop constraint if exists app_settings_key_not_blank;

alter table public.app_settings
  add constraint app_settings_key_allowed
    check (key like 'webinar_destination::%' or key like 'seminar_ticket::%'),
  add constraint app_settings_key_not_blank
    check (btrim(key) not in ('', 'webinar_destination::', 'seminar_ticket::'));

-- 2. RPC `save_seminar_ticket` untuk menyimpan konfigurasi tiket barcode/QR seminar
create or replace function public.save_seminar_ticket(
  p_actor uuid,
  p_scope_key text,
  p_value_json text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if not exists (select 1 from public.users where id = p_actor and active) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if btrim(coalesce(p_scope_key, '')) = '' or btrim(coalesce(p_value_json, '')) = '' then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  insert into public.app_settings (key, value_text, updated_by)
  values ('seminar_ticket::' || p_scope_key, p_value_json, p_actor)
  on conflict (key) do update
    set value_text = excluded.value_text,
        updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.save_seminar_ticket(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_seminar_ticket(uuid, text, text) to service_role;

-- 3. RPC `admin_update_user` untuk menyunting member di Add Team oleh Master Admin
create or replace function public.admin_update_user(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_display_name text,
  p_role text,
  p_active boolean,
  p_new_password text default null,
  p_allow_master boolean default false
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
begin
  select * into v_actor from public.users where id = p_actor_user_id;
  if not found or not v_actor.active or v_actor.role <> 'master_admin' then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_target from public.users where id = p_target_user_id for update;
  if not found then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_role not in ('master_admin', 'admin', 'staff') or p_active is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  -- Master Admin tidak boleh menonaktifkan atau menurunkan role akunnya sendiri.
  if p_actor_user_id = p_target_user_id and (not p_active or p_role <> 'master_admin') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if p_role = 'master_admin' and v_target.role <> 'master_admin' and not p_allow_master then
    raise exception using errcode = 'DF008', message = 'MASTER_ADMIN_CREATE_FORBIDDEN';
  end if;

  v_display_name := regexp_replace(coalesce(p_display_name, ''), '^\s+|\s+$', '', 'g');
  if v_display_name = '' or length(v_display_name) > 200 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_new_password is not null and p_new_password <> '' then
    if length(p_new_password) < 8 then
      raise exception using errcode = 'DF007', message = 'WEAK_PASSWORD';
    end if;

    update public.users
       set display_name = v_display_name,
           role = p_role,
           active = p_active,
           password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
           password_algo = 'bcrypt'
     where id = v_target.id
     returning * into v_target;

    update public.app_sessions
       set revoked_at = now()
     where user_id = v_target.id
       and revoked_at is null;
  else
    update public.users
       set display_name = v_display_name,
           role = p_role,
           active = p_active
     where id = v_target.id
     returning * into v_target;

    if not p_active then
      update public.app_sessions
         set revoked_at = now()
       where user_id = v_target.id
         and revoked_at is null;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_target.id,
    'user_id', v_target.id,
    'username', v_target.username,
    'display_name', v_target.display_name,
    'role', v_target.role,
    'avatar_emoji', v_target.avatar_emoji,
    'active', v_target.active
  );
end;
$$;

revoke all on function public.admin_update_user(uuid, uuid, text, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_update_user(uuid, uuid, text, text, boolean, text, boolean) to service_role;

-- 4. Sesuaikan FK agar penghapusan permanen fee_rule dan koneksi OrderOnline tidak merusak order historis
alter table public.orders
  drop constraint if exists orders_fee_rule_id_fkey;

alter table public.orders
  add constraint orders_fee_rule_id_fkey
    foreign key (fee_rule_id) references public.payment_fee_rules(id) on delete set null;

alter table public.orderonline_order_sources
  drop constraint if exists orderonline_order_sources_connection_id_fkey;

alter table public.orderonline_order_sources
  add constraint orderonline_order_sources_connection_id_fkey
    foreign key (connection_id) references public.orderonline_connections(id) on delete cascade;

