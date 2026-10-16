-- 0037_advertiser_role — A20 (permintaan pengguna 16 Okt 2026): role Advertiser.
-- Seperti Pimpro (produk yang ditugaskan), ditambah: hanya order berkode pengiklan miliknya.
-- Pimpro tetap level produk (melihat semua pengiklan di produknya).
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 37 $$;

-- 1. Role + matriks izin awal = salinan Pimpro saat migrasi (tetap bisa diubah di Konfigurasi Role).
insert into public.app_roles (id, name, description, is_system)
values ('advertiser', 'Advertiser', 'Pengiklan: produk yang ditugaskan, hanya order dengan kode pengiklannya sendiri', true)
on conflict (id) do nothing;
insert into public.app_role_permissions (role_id, permission_key)
select 'advertiser', permission_key from public.app_role_permissions where role_id = 'pimpro'
on conflict (role_id, permission_key) do nothing;

-- 2. Satu akun Advertiser = satu pengiklan (id, bukan teks: pengiklan yang dipegang akun tidak bisa dihapus).
alter table public.users
  add column if not exists advertiser_id uuid references public.advertisers (id) on delete restrict;
alter table public.users
  add constraint users_advertiser_role_check check ((role = 'advertiser') = (advertiser_id is not null));
create index if not exists users_advertiser_idx on public.users (advertiser_id) where advertiser_id is not null;

-- 3. Scope order: produk (seperti sebelumnya) DAN, bila akun memegang pengiklan, kode pengiklan order.
create or replace function public.actor_can_order(p_actor uuid, p_product_code text, p_advertiser_code text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
  select public.actor_can_product(p_actor, p_product_code) and not exists (
    select 1 from public.users u left join public.advertisers a on a.id = u.advertiser_id
    where u.id = p_actor and u.advertiser_id is not null
      and a.code_normalized is distinct from public.normalize_code(p_advertiser_code)
  )
$$;
create or replace function public.can_access_order(p_product_code text, p_advertiser_code text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$ select public.actor_can_order(auth.uid(), p_product_code, p_advertiser_code) $$;
create or replace function public.current_advertiser_id() returns uuid
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$ select advertiser_id from public.users where id = auth.uid() $$;
revoke all on function public.actor_can_order(uuid,text,text), public.can_access_order(text,text), public.current_advertiser_id()
  from public, anon, authenticated;
grant execute on function public.actor_can_order(uuid,text,text) to service_role;
grant execute on function public.can_access_order(text,text), public.current_advertiser_id() to authenticated, service_role;

-- Presensi (attendance_events) memakai exists(orders) sehingga ikut scope ini.
alter policy orders_select_app_users on public.orders using (
  public.can_access_order(product_code, advertiser_code) and (
    public.has_permission('operasional.order') or public.has_permission('operasional.dashboard') or
    public.has_permission('operasional.presensi') or public.has_permission('config.report_tax')
  )
);
-- Akun Advertiser hanya melihat pengiklannya sendiri (dropdown filter, Product Name Generator).
alter policy advertisers_select_app_users on public.advertisers using (
  public.can_read_configuration() and (public.current_advertiser_id() is null or id = public.current_advertiser_id())
);

-- 4. Check-in: QR bukan otorisasi; scope pengiklan dicek ulang di DB.
create or replace function public.checkin_seminar(
  p_order_id text,
  p_source text,
  p_scanner_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_inserted boolean := false;
  v_clicked_at timestamptz;
  v_id uuid;
begin
  if not public.actor_has_permission(p_scanner_user_id, 'operasional.scan_qr') or
    (p_source = 'seminar_manual' and not public.actor_has_permission(p_scanner_user_id, 'action.manual_checkin')) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_source not in ('seminar_qr', 'seminar_manual') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id);
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_order(p_scanner_user_id, v_order.product_code, v_order.advertiser_code) then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if v_order.app_status <> 'Paid' then
    raise exception using errcode = 'DF002', message = 'ORDER_NOT_PAID';
  end if;
  if v_order.event_type is null or v_order.event_type not in ('Seminar Offline', 'Hybrid') then
    raise exception using errcode = 'DF003', message = 'NOT_SEMINAR_ORDER';
  end if;

  insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id)
  values (v_order.order_id, 'seminar', p_source, p_scanner_user_id)
  on conflict (order_id) where attendance_type = 'seminar' do nothing
  returning id, clicked_at into v_id, v_clicked_at;
  v_inserted := found;

  if not v_inserted then
    -- Scan berulang: kembalikan timestamp check-in PERTAMA (01 §13).
    select id, clicked_at into v_id, v_clicked_at
      from public.attendance_events
     where order_id = v_order.order_id
       and attendance_type = 'seminar';
  end if;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'state', case when v_inserted then 'CHECKIN_SUCCESS' else 'ALREADY_CHECKED_IN' end,
    'attendance_id', v_id,
    'clicked_at', v_clicked_at,
    'scanner_user_id', p_scanner_user_id
  );
end;
$$;

-- 5. Pengiklan yang dipegang akun tidak boleh dihapus/diganti kodenya.
create or replace function public.master_is_used(p_resource text, p_code text, p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  with refs as (
    -- Order: kolom hasil parse + nama kanonik di product_raw.
    select o.product_code, o.advertiser_code, null::text as type_code, o.session as session_code, o.fee_rule_id
      from public.orders o
    union all
    select p.product_code, p.advertiser_code, p.type_code, p.session_code, null
      from public.orders o, public.master_canonical_parts(o.product_raw) p
    union all
    select p.product_code, p.advertiser_code, p.type_code, p.session_code, null
      from public.product_aliases a, public.master_canonical_parts(a.canonical_target) p
    union all
    select p.product_code, p.advertiser_code, p.type_code, p.session_code, null
      from public.app_settings s, public.master_setting_parts(s.key) p
      where s.key like 'webinar_destination::%' or s.key like 'seminar_ticket::%'
    union all
    select u.product_code, null, null, null, null from public.user_product_access u
    union all
    -- A20: pengiklan yang dipegang akun Advertiser.
    select null, a.code, null, null, null from public.users u join public.advertisers a on a.id = u.advertiser_id
  )
  select exists (
    select 1 from refs r where case p_resource
      when 'products' then public.normalize_code(r.product_code) = public.normalize_code(p_code)
      when 'advertisers' then public.normalize_code(r.advertiser_code) = public.normalize_code(p_code)
      when 'event-types' then public.normalize_code(r.type_code) = public.normalize_code(p_code)
      when 'sessions' then public.normalize_code(r.session_code) = public.normalize_code(p_code)
      when 'payment-fee-rules' then r.fee_rule_id = p_id
      else true end
  )
$$;

-- 6. Provisioning akun. Versi 0024 dihapus: selain tanpa pengiklan, ia masih bisa dieksekusi PUBLIC.
drop function if exists public.admin_create_user(uuid,text,text,text,text,text,boolean,boolean,text[]);
drop function if exists public.admin_update_user(uuid,uuid,text,text,boolean,text,boolean,boolean,text[]);

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
  if not found or not v_actor.active or v_actor.role not in ('master_admin', 'developer', 'owner') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if not exists (select 1 from public.app_roles where id = p_role) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_role in ('master_admin', 'developer', 'owner') and not p_allow_master then
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
  if not found or not v_actor.active or v_actor.role not in ('master_admin', 'developer', 'owner') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_target from public.users where id = p_target_user_id;
  if not found then
    raise exception using errcode = 'DF005', message = 'USER_NOT_FOUND';
  end if;

  if not exists (select 1 from public.app_roles where id = p_role) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_role in ('master_admin', 'developer', 'owner') and v_target.role not in ('master_admin', 'developer', 'owner') and not p_allow_master then
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
