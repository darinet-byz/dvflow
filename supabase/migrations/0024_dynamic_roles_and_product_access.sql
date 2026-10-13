-- ============================================================================
-- 0024_dynamic_roles_and_product_access — Fitur 2.0 Dynamic RBAC & Scoped Products
-- ============================================================================

-- 1. Tabel master role dinamis
create table if not exists public.app_roles (
  id text primary key,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Tabel kamus master permissions
create table if not exists public.app_permissions (
  key text primary key,
  name text not null,
  module text not null,
  description text,
  sort_order integer not null default 0
);

-- 3. Tabel relasi role dan permission (many-to-many checklist)
create table if not exists public.app_role_permissions (
  role_id text not null references public.app_roles (id) on update cascade on delete cascade,
  permission_key text not null references public.app_permissions (key) on update cascade on delete cascade,
  primary key (role_id, permission_key)
);

create index if not exists app_role_permissions_role_idx on public.app_role_permissions (role_id);

-- 3.5. Pastikan kolom code pada tabel products memiliki constraint unik untuk relasi foreign key
alter table public.products
  drop constraint if exists products_code_key,
  add constraint products_code_key unique (code);

-- 4. Tabel relasi user dan produk yang diizinkan (product-level scoping)
create table if not exists public.user_product_access (
  user_id uuid not null references public.users (id) on delete cascade,
  product_code text not null references public.products (code) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_code)
);

create index if not exists user_product_access_user_idx on public.user_product_access (user_id);

-- 5. Seed data master roles (6 role standar + 2 legacy compatibility)
insert into public.app_roles (id, name, description, is_system)
values
  ('developer', 'Developer', 'Akses penuh ke seluruh sistem, log teknis, dan konfigurasi', true),
  ('owner', 'Owner', 'Pemilik bisnis dengan hak akses menyeluruh ke seluruh data dan laporan', true),
  ('manajer', 'Manajer', 'Pengelola operasional, order, presensi, dan konfigurasi acara', true),
  ('admin', 'Admin', 'Administrasi harian acara, order, presensi, scan QR, dan tautan acara', true),
  ('pimpro', 'Pimpro', 'Pimpinan proyek dengan akses data terbatas pada produk yang ditugaskan', true),
  ('member', 'Member', 'Operator registrasi dan presensi lapangan pada produk yang ditugaskan', true),
  ('master_admin', 'Admin Master (Legacy)', 'Role legacy setara Owner/Developer', true),
  ('staff', 'Staff (Legacy)', 'Role legacy setara Member', true)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      is_system = excluded.is_system,
      updated_at = now();

-- 6. Seed kamus master permissions (~17 granular keys)
insert into public.app_permissions (key, name, module, description, sort_order)
values
  -- Operasional
  ('operasional.scan_qr', 'Scan QR Tiket', 'operasional', 'Memindai QR tiket peserta di gate seminar', 1),
  ('operasional.dashboard', 'Dashboard Resume', 'operasional', 'Melihat omzet, KPI leads, dan grafik kehadiran', 2),
  ('operasional.order', 'Data Order', 'operasional', 'Melihat dan memfilter transaksi order peserta', 3),
  ('operasional.presensi', 'Presensi Acara', 'operasional', 'Melihat daftar riwayat kehadiran peserta T1-T10', 4),
  ('operasional.generator', 'Product Name Generator', 'operasional', 'Membuat format nama produk iklan terstandar', 5),

  -- Konfigurasi
  ('config.produk', 'Konfigurasi Produk', 'konfigurasi', 'Mengelola data produk, sesi, dan pengiklan', 10),
  ('config.tax', 'Konfigurasi Tax & Fee', 'konfigurasi', 'Mengelola aturan potongan fee pembayaran', 11),
  ('config.report_tax', 'Report Tax', 'konfigurasi', 'Membuka laporan rekapitulasi pajak dan fee', 12),
  ('config.zoom', 'Konfigurasi Link Zoom', 'konfigurasi', 'Mengatur tautan redirect Zoom webinar', 13),
  ('config.tiket', 'Konfigurasi Tiket Seminar', 'konfigurasi', 'Mengatur jadwal, venue, dan tiket QR seminar', 14),
  ('config.integrasi', 'API & Webhook', 'konfigurasi', 'Mengelola webhook dan integrasi OrderOnline', 15),
  ('config.roles', 'Konfigurasi Role & Permission', 'konfigurasi', 'Mengatur peran pengguna dan checklist hak akses', 16),

  -- Account / Team
  ('team.manage', 'Manajemen Tim', 'team', 'Melihat, menambah, mengedit, dan menghapus akun tim', 20),
  ('account.profile', 'Profil & Password', 'account', 'Melihat profil dan mengubah kata sandi sendiri', 30),

  -- Aksi Khusus
  ('action.export_data', 'Export Data Order & Presensi', 'aksi', 'Mengunduh rekapan data dalam format CSV/Excel', 40),
  ('action.manual_checkin', 'Manual Check-in', 'aksi', 'Melakukan check-in manual tanpa kamera', 41),
  ('action.delete_master', 'Hapus Data Master', 'aksi', 'Menghapus baris konfigurasi pada tabel master', 42)
on conflict (key) do update
  set name = excluded.name,
      module = excluded.module,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- 7. Seed default matriks role permissions
-- Developer, Owner, Master Admin: Seluruh permission
insert into public.app_role_permissions (role_id, permission_key)
select r.id, p.key
from public.app_roles r
cross join public.app_permissions p
where r.id in ('developer', 'owner', 'master_admin')
on conflict (role_id, permission_key) do nothing;

-- Manajer: Operasional, Produk, Zoom, Tiket, Profil, Export, Manual Checkin
insert into public.app_role_permissions (role_id, permission_key)
select 'manajer', p.key
from public.app_permissions p
where p.key in (
  'operasional.scan_qr', 'operasional.dashboard', 'operasional.order', 'operasional.presensi', 'operasional.generator',
  'config.produk', 'config.zoom', 'config.tiket',
  'account.profile', 'action.export_data', 'action.manual_checkin'
)
on conflict (role_id, permission_key) do nothing;

-- Admin: Operasional, Zoom, Tiket, Profil, Export, Manual Checkin
insert into public.app_role_permissions (role_id, permission_key)
select 'admin', p.key
from public.app_permissions p
where p.key in (
  'operasional.scan_qr', 'operasional.dashboard', 'operasional.order', 'operasional.presensi', 'operasional.generator',
  'config.zoom', 'config.tiket',
  'account.profile', 'action.export_data', 'action.manual_checkin'
)
on conflict (role_id, permission_key) do nothing;

-- Pimpro: Operasional (scoped produk), Profil, Export, Manual Checkin
insert into public.app_role_permissions (role_id, permission_key)
select 'pimpro', p.key
from public.app_permissions p
where p.key in (
  'operasional.scan_qr', 'operasional.dashboard', 'operasional.order', 'operasional.presensi', 'operasional.generator',
  'account.profile', 'action.export_data', 'action.manual_checkin'
)
on conflict (role_id, permission_key) do nothing;

-- Member & Staff: Scan QR, Presensi (scoped produk), Profil, Manual Checkin
insert into public.app_role_permissions (role_id, permission_key)
select r.id, p.key
from public.app_roles r
cross join public.app_permissions p
where r.id in ('member', 'staff')
  and p.key in ('operasional.scan_qr', 'operasional.presensi', 'account.profile', 'action.manual_checkin')
on conflict (role_id, permission_key) do nothing;

-- 8. Penyesuaian kolom dan constraint di tabel `public.users`
alter table public.users
  add column if not exists has_all_product_access boolean not null default true;

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  drop constraint if exists users_role_fkey;

alter table public.users
  add constraint users_role_fkey
    foreign key (role) references public.app_roles (id)
    on update cascade on delete restrict;

-- 9. Grants & RLS untuk tabel-tabel baru
alter table public.app_roles enable row level security;
alter table public.app_permissions enable row level security;
alter table public.app_role_permissions enable row level security;
alter table public.user_product_access enable row level security;

revoke all on table public.app_roles from anon, authenticated;
revoke all on table public.app_permissions from anon, authenticated;
revoke all on table public.app_role_permissions from anon, authenticated;
revoke all on table public.user_product_access from anon, authenticated;

grant select on public.app_roles to authenticated;
grant select on public.app_permissions to authenticated;
grant select on public.app_role_permissions to authenticated;
grant select on public.user_product_access to authenticated;

grant all on table public.app_roles to service_role;
grant all on table public.app_permissions to service_role;
grant all on table public.app_role_permissions to service_role;
grant all on table public.user_product_access to service_role;

create policy app_roles_select_policy on public.app_roles for select to authenticated using (true);
create policy app_permissions_select_policy on public.app_permissions for select to authenticated using (true);
create policy app_role_permissions_select_policy on public.app_role_permissions for select to authenticated using (true);
create policy user_product_access_select_policy on public.user_product_access for select to authenticated using (true);

-- 10. RPC admin_create_user diperbarui untuk role dinamis dan product scoping
create or replace function public.admin_create_user(
  p_actor_user_id uuid,
  p_username text,
  p_display_name text,
  p_initial_password text,
  p_role text,
  p_avatar_emoji text default null,
  p_allow_master boolean default false,
  p_has_all_product_access boolean default true,
  p_product_codes text[] default '{}'::text[]
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
    has_all_product_access
  )
  values (
    v_username,
    v_display_name,
    extensions.crypt(p_initial_password, extensions.gen_salt('bf', 12)),
    'bcrypt',
    p_role,
    p_avatar_emoji,
    true,
    coalesce(p_has_all_product_access, true)
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
    'has_all_product_access', v_new.has_all_product_access
  );
end;
$$;

-- 11. RPC admin_update_user diperbarui untuk role dinamis dan product scoping
create or replace function public.admin_update_user(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_display_name text,
  p_role text,
  p_active boolean,
  p_new_password text default null,
  p_allow_master boolean default false,
  p_has_all_product_access boolean default true,
  p_product_codes text[] default '{}'::text[]
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
    'has_all_product_access', v_target.has_all_product_access
  );
end;
$$;
