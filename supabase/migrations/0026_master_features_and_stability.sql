-- ============================================================================
-- 0026_master_features_and_stability
-- 1. Fitur Reset Data (Developer Only dengan 2x Verifikasi)
-- 2. Retensi 90 Hari Order Unmapped (Evergreen)
-- 3. Retensi Sesi 48 Jam & Purge
-- 4. Seed 9 Sesi Paten (ST, S1 - S8)
-- ============================================================================

-- 1. Verifikasi Password Developer (Bcrypt di Postgres)
create or replace function public.verify_developer_password(p_user_id uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash
  from public.users
  where id = p_user_id
    and role = 'developer'
    and active = true;

  if not found or v_hash is null then
    return false;
  end if;

  return extensions.crypt(coalesce(p_password, ''), v_hash) = v_hash;
end;
$$;

revoke all on function public.verify_developer_password(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_developer_password(uuid, text) to service_role;

-- 2. RPC developer_reset_data untuk eksekusi atomik penghapusan data
create or replace function public.developer_reset_data(p_scopes text[], p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_is_dev boolean;
  v_res jsonb := '{}'::jsonb;
  v_count int;
begin
  -- Perlindungan mutlak: hanya role 'developer' aktif
  select (role = 'developer' and active = true) into v_is_dev
  from public.users
  where id = p_actor_id;

  if not coalesce(v_is_dev, false) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN: Hanya role developer yang diizinkan mereset data';
  end if;

  -- 1. Hapus Semua Orders & Data Presensi
  if 'orders_all' = any(p_scopes) or 'all_test_data' = any(p_scopes) then
    delete from public.attendance_events;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{attendance_events}', to_jsonb(v_count));

    delete from public.orderonline_order_sources;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orderonline_order_sources}', to_jsonb(v_count));

    delete from public.orders;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orders}', to_jsonb(v_count));
  elsif 'orders_unmapped' = any(p_scopes) then
    delete from public.attendance_events
    where order_id in (select order_id from public.orders where product_parse_status = 'invalid');
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{attendance_events}', to_jsonb(v_count));

    delete from public.orderonline_order_sources
    where order_id in (select order_id from public.orders where product_parse_status = 'invalid');
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orderonline_order_sources}', to_jsonb(v_count));

    delete from public.orders
    where product_parse_status = 'invalid';
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orders_unmapped}', to_jsonb(v_count));
  end if;

  -- 2. Hapus Webhook Logs
  if 'webhook_logs' = any(p_scopes) or 'all_test_data' = any(p_scopes) then
    delete from public.webhook_logs;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{webhook_logs}', to_jsonb(v_count));
  end if;

  -- 3. Hapus Kamus Alias Produk
  if 'product_aliases' = any(p_scopes) or 'all_test_data' = any(p_scopes) then
    delete from public.product_aliases;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{product_aliases}', to_jsonb(v_count));
  end if;

  -- 4. Hapus Koneksi OrderOnline
  if 'connections' = any(p_scopes) or 'all_test_data' = any(p_scopes) then
    delete from public.orderonline_order_sources;
    update public.orders set connection_id = null;
    delete from public.orderonline_connections;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orderonline_connections}', to_jsonb(v_count));
  end if;

  -- 5. Hapus Master Konfigurasi Produk & Event (Opsional)
  if 'products_master' = any(p_scopes) then
    delete from public.webinar_destinations;
    delete from public.seminar_tickets;
    delete from public.payment_fee_rules;
    delete from public.products;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{products}', to_jsonb(v_count));
    delete from public.advertisers;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{advertisers}', to_jsonb(v_count));
    delete from public.event_types;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{event_types}', to_jsonb(v_count));
  end if;

  return jsonb_build_object('success', true, 'deleted', v_res);
end;
$$;

revoke all on function public.developer_reset_data(text[], uuid) from public, anon, authenticated;
grant execute on function public.developer_reset_data(text[], uuid) to service_role;

-- 3. Retensi 90 Hari Order Unmapped
create or replace function public.purge_expired_unmapped_orders(p_retention_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_deleted_attendance int := 0;
  v_deleted_sources int := 0;
  v_deleted_orders int := 0;
  v_cutoff timestamptz := now() - (p_retention_days || ' days')::interval;
begin
  delete from public.attendance_events
  where order_id in (
    select order_id from public.orders
    where product_parse_status = 'invalid'
      and created_at < v_cutoff
  );
  get diagnostics v_deleted_attendance = row_count;

  delete from public.orderonline_order_sources
  where order_id in (
    select order_id from public.orders
    where product_parse_status = 'invalid'
      and created_at < v_cutoff
  );
  get diagnostics v_deleted_sources = row_count;

  delete from public.orders
  where product_parse_status = 'invalid'
    and created_at < v_cutoff;
  get diagnostics v_deleted_orders = row_count;

  return jsonb_build_object(
    'cutoff', v_cutoff,
    'deleted_orders', v_deleted_orders,
    'deleted_attendance', v_deleted_attendance,
    'deleted_sources', v_deleted_sources
  );
end;
$$;

revoke all on function public.purge_expired_unmapped_orders(int) from public, anon, authenticated;
grant execute on function public.purge_expired_unmapped_orders(int) to service_role;

-- Indeks partial untuk unmapped orders
create index if not exists idx_orders_unmapped_created_at
  on public.orders (created_at desc)
  where product_parse_status = 'invalid';

-- 4. Retensi Sesi Kedaluwarsa
create or replace function public.purge_expired_sessions()
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_deleted int := 0;
begin
  delete from public.app_sessions
  where expires_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_sessions() from public, anon, authenticated;
grant execute on function public.purge_expired_sessions() to service_role;

-- 5. Seed 9 Sesi Paten (ST, S1 - S8)
insert into public.sessions_config (name, code, active)
values
  ('Sesi Tunggal', 'ST', true),
  ('Sesi 1', 'S1', true),
  ('Sesi 2', 'S2', true),
  ('Sesi 3', 'S3', true),
  ('Sesi 4', 'S4', true),
  ('Sesi 5', 'S5', true),
  ('Sesi 6', 'S6', true),
  ('Sesi 7', 'S7', true),
  ('Sesi 8', 'S8', true)
on conflict (code_normalized) do update
  set active = true,
      name = excluded.name,
      updated_at = now();

-- 6. Jadwal Cron (bila pg_cron tersedia)
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'pg_cron tidak tersedia: job retensi unmapped orders TIDAK dijadwalkan secara otomatis.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'dvflow_unmapped_orders_retention') then
    perform cron.unschedule('dvflow_unmapped_orders_retention');
  end if;

  perform cron.schedule(
    'dvflow_unmapped_orders_retention',
    '45 3 * * *',
    $cron$select public.purge_expired_unmapped_orders(90);$cron$
  );
end
$$;

