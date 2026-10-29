-- 0063_reschedule_and_refund — A58 (permintaan pengguna 29 Okt 2026).
--
-- Dua fitur operasional:
--   * Refund: status order ke-4 `Refund` (penuh per order). Order otomatis keluar dari
--     Paid/tiket/omzet/akses peserta karena semua laporan uang memfilter `app_status = 'Paid'`.
--     Riwayat refund disimpan di `order_refunds` dan bisa dibatalkan dengan audit.
--   * Reschedule: peserta pindah batch/sesi/kota. Kolom asal (batch/session/city) TETAP
--     dipakai untuk atribusi penjualan/iklan; kolom `event_*` + generated `effective_*`
--     dipakai oleh Presensi, tiket/QR/Zoom, scanner, dan Resume Batch. Webhook tidak
--     pernah menimpa `event_*`, sehingga reschedule tidak hilang saat OrderOnline
--     mengirim update berikutnya.
--
-- Refund TIDAK menghapus order atau attendance. Reschedule TIDAK mengubah omzet.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 63 $$;

-- ---------------------------------------------------------------------------
-- 1. Status Refund + kolom acara efektif
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_app_status_check;
alter table public.orders
  add constraint orders_app_status_check
  check (app_status in ('Pending', 'Paid', 'Cancelled', 'Refund'));

alter table public.orders
  add column if not exists event_batch text,
  add column if not exists event_session text,
  add column if not exists event_city text;

-- Generated columns: satu definisi "acara efektif" untuk semua pembaca.
alter table public.orders
  add column if not exists effective_batch text
    generated always as (coalesce(event_batch, batch)) stored,
  add column if not exists effective_session text
    generated always as (coalesce(event_session, session)) stored,
  add column if not exists effective_city text
    generated always as (coalesce(event_city, city)) stored;

create index if not exists idx_orders_effective_batch
  on public.orders (public.normalize_batch(effective_batch));
create index if not exists idx_orders_effective_session
  on public.orders (effective_session);
create index if not exists idx_orders_effective_city
  on public.orders (lower(btrim(effective_city)));

-- ---------------------------------------------------------------------------
-- 2. Riwayat reschedule (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.order_reschedules (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders (order_id) on delete restrict,
  from_batch text,
  from_session text,
  from_city text,
  to_batch text,
  to_session text,
  to_city text,
  reason text check (reason is null or length(btrim(reason)) <= 300),
  actor_id uuid references public.users (id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_reschedules_order
  on public.order_reschedules (order_id, created_at desc);

alter table public.order_reschedules enable row level security;
revoke all on table public.order_reschedules from anon, authenticated;
grant select on table public.order_reschedules to authenticated;
grant all on table public.order_reschedules to service_role;

create policy order_reschedules_select_app_users
  on public.order_reschedules for select to authenticated
  using (
    (public.has_permission('operasional.presensi')
     or public.has_permission('operasional.order')
     or public.has_permission('operasional.order_refund'))
    and exists (
      select 1 from public.orders o where o.order_id = order_reschedules.order_id
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Refund (satu refund aktif per order)
-- ---------------------------------------------------------------------------
create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders (order_id) on delete restrict,
  amount numeric(18, 2) not null check (amount >= 0),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  -- Status provider terakhir sebelum/selama refund. Dipakai untuk mengembalikan order
  -- ke status yang benar saat refund dibatalkan.
  previous_status text not null default 'Paid'
    check (previous_status in ('Pending', 'Paid', 'Cancelled')),
  refunded_at timestamptz not null default now(),
  refunded_by uuid references public.users (id) on delete set null,
  refunded_by_name text,
  reverted_at timestamptz,
  reverted_by uuid references public.users (id) on delete set null,
  reverted_by_name text,
  revert_reason text check (revert_reason is null or length(btrim(revert_reason)) <= 500)
);

create unique index if not exists order_refunds_active_unique
  on public.order_refunds (order_id)
  where reverted_at is null;
create index if not exists idx_order_refunds_refunded_at
  on public.order_refunds (refunded_at desc);

alter table public.order_refunds enable row level security;
revoke all on table public.order_refunds from anon, authenticated;
grant select on table public.order_refunds to authenticated;
grant all on table public.order_refunds to service_role;

create policy order_refunds_select_app_users
  on public.order_refunds for select to authenticated
  using (
    public.has_permission('operasional.order_refund')
    and exists (
      select 1 from public.orders o where o.order_id = order_refunds.order_id
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Izin menu/aksi
-- ---------------------------------------------------------------------------
insert into public.app_permissions (key, name, module, description, sort_order)
values
  ('operasional.order_refund', 'Order Refund', 'operasional',
   'Melihat daftar order refund, tiket, dan nominal refund', 9),
  ('action.reschedule', 'Reschedule Peserta', 'aksi',
   'Memindahkan peserta Paid ke batch/sesi/kota lain sebelum check-in', 44),
  ('action.refund', 'Refund Order', 'aksi',
   'Menandai order Paid sebagai Refund dan membatalkan refund dengan audit', 45)
on conflict (key) do nothing;

insert into public.app_role_permissions (role_id, permission_key)
select r, k
  from unnest(array['manajer', 'admin']) r
  cross join unnest(array[
    'operasional.order_refund', 'action.reschedule', 'action.refund'
  ]) k
 where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- Halaman Order Refund membaca dropdown produk/pengiklan/sesi lewat RLS.
create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'action.ots','operasional.report_spend','operasional.resume_batch','operasional.analytics',
    'operasional.order_refund','operasional.product_status','operasional.advertiser_status',
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;

-- Halaman Order Refund perlu membaca orders. Cakupan produk/pengiklan tetap dari
-- can_access_order; permission halaman ditambahkan ke policy yang sama.
alter policy orders_select_app_users on public.orders using (
  public.can_access_order(product_code, advertiser_code) and (
    public.has_permission('operasional.order') or public.has_permission('operasional.dashboard') or
    public.has_permission('operasional.presensi') or public.has_permission('operasional.order_refund') or
    public.has_permission('config.report_tax')
  )
);

-- ---------------------------------------------------------------------------
-- 5. RPC tulis: reschedule, refund, batalkan refund
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_order(
  p_actor uuid,
  p_order_id text,
  p_batch text,
  p_session text,
  p_city text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_from_batch text;
  v_from_session text;
  v_from_city text;
  v_to_batch text;
  v_to_session text;
  v_to_city text;
begin
  if not public.actor_has_permission(p_actor, 'action.reschedule') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_order_id is null or btrim(p_order_id) = '' or length(btrim(p_order_id)) > 64 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if v_reason is not null and length(v_reason) > 300 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id) for update;
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_order(p_actor, v_order.product_code, v_order.advertiser_code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_order.source = 'ots' then
    raise exception using errcode = 'DF022', message = 'RESCHEDULE_NOT_ALLOWED';
  end if;
  if v_order.app_status <> 'Paid' then
    raise exception using errcode = 'DF002', message = 'ORDER_NOT_PAID';
  end if;
  if v_order.product_parse_status <> 'valid' or v_order.event_type is null then
    raise exception using errcode = 'DF022', message = 'RESCHEDULE_NOT_ALLOWED';
  end if;
  -- Seminar maupun webinar: presensi apa pun berarti peserta sudah menikmati acara lama.
  if exists (select 1 from public.attendance_events e where e.order_id = v_order.order_id) then
    raise exception using errcode = 'DF019', message = 'ORDER_ALREADY_CHECKED_IN';
  end if;

  v_from_batch := coalesce(v_order.event_batch, v_order.batch);
  v_from_session := coalesce(v_order.event_session, v_order.session);
  v_from_city := coalesce(v_order.event_city, v_order.city);

  v_to_session := nullif(upper(btrim(coalesce(p_session, ''))), '');
  v_to_city := nullif(btrim(coalesce(p_city, '')), '');
  v_to_batch := public.normalize_batch(nullif(btrim(coalesce(p_batch, '')), ''));
  if v_to_batch is null then
    v_to_batch := v_from_batch;
  end if;

  if v_to_session is null or v_to_city is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if length(v_to_city) > 100 or (v_to_batch is not null and v_to_batch !~ '^[A-Z0-9]{1,32}$') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if not exists (
    select 1 from public.sessions_config
     where code_normalized = public.normalize_code(v_to_session) and active
  ) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  -- Tidak ada perubahan: tolak supaya riwayat tidak penuh baris kosong.
  if v_to_batch is not distinct from v_from_batch
     and public.normalize_code(v_to_session) = public.normalize_code(v_from_session)
     and lower(btrim(v_to_city)) = lower(btrim(coalesce(v_from_city, ''))) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  insert into public.order_reschedules (
    order_id, from_batch, from_session, from_city,
    to_batch, to_session, to_city, reason, actor_id, actor_name
  ) values (
    v_order.order_id, v_from_batch, v_from_session, v_from_city,
    v_to_batch, v_to_session, v_to_city, v_reason, p_actor,
    (select display_name from public.users where id = p_actor)
  );

  -- Simpan hanya field yang benar-benar berubah. Jika peserta kembali ke acara asal,
  -- override menjadi NULL dan status kembali "Belum Hadir"; riwayat tetap tersimpan.
  update public.orders set
    event_batch = case
      when v_to_batch is not distinct from batch then null else v_to_batch end,
    event_session = case
      when public.normalize_code(v_to_session) = public.normalize_code(session) then null else v_to_session end,
    event_city = case
      when lower(btrim(v_to_city)) = lower(btrim(coalesce(city, ''))) then null else v_to_city end
  where order_id = v_order.order_id;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'from_batch', v_from_batch,
    'from_session', v_from_session,
    'from_city', v_from_city,
    'batch', v_to_batch,
    'session', v_to_session,
    'city', v_to_city,
    'rescheduled', (v_to_batch is distinct from v_order.batch
                    or public.normalize_code(v_to_session) is distinct from public.normalize_code(v_order.session)
                    or lower(btrim(v_to_city)) is distinct from lower(btrim(coalesce(v_order.city, ''))))
  );
end;
$$;
revoke all on function public.reschedule_order(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.reschedule_order(uuid, text, text, text, text, text) to service_role;

create or replace function public.refund_order(
  p_actor uuid,
  p_order_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_refund_id uuid;
  v_now timestamptz := now();
begin
  if not public.actor_has_permission(p_actor, 'action.refund') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_order_id is null or btrim(p_order_id) = '' or length(btrim(p_order_id)) > 64 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id) for update;
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_order(p_actor, v_order.product_code, v_order.advertiser_code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_order.app_status = 'Refund'
     or exists (
       select 1 from public.order_refunds r
        where r.order_id = v_order.order_id and r.reverted_at is null
     ) then
    raise exception using errcode = 'DF020', message = 'ORDER_ALREADY_REFUNDED';
  end if;
  if v_order.app_status <> 'Paid' then
    raise exception using errcode = 'DF002', message = 'ORDER_NOT_PAID';
  end if;

  insert into public.order_refunds (
    order_id, amount, reason, previous_status,
    refunded_at, refunded_by, refunded_by_name
  ) values (
    v_order.order_id, v_order.gross_amount, v_reason, v_order.app_status,
    v_now, p_actor, (select display_name from public.users where id = p_actor)
  )
  returning id into v_refund_id;

  update public.orders set app_status = 'Refund' where order_id = v_order.order_id;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'refund_id', v_refund_id,
    'status', 'Refund',
    'amount', v_order.gross_amount,
    'refunded_at', v_now
  );
end;
$$;
revoke all on function public.refund_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.refund_order(uuid, text, text) to service_role;

create or replace function public.cancel_refund(
  p_actor uuid,
  p_order_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_refund public.order_refunds;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
begin
  if not public.actor_has_permission(p_actor, 'action.refund') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_order_id is null or btrim(p_order_id) = '' or length(btrim(p_order_id)) > 64 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id) for update;
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_order(p_actor, v_order.product_code, v_order.advertiser_code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_refund from public.order_refunds
   where order_id = v_order.order_id and reverted_at is null
   for update;
  if not found then
    raise exception using errcode = 'DF021', message = 'ORDER_NOT_REFUNDED';
  end if;

  update public.order_refunds set
    reverted_at = v_now,
    reverted_by = p_actor,
    reverted_by_name = (select display_name from public.users where id = p_actor),
    revert_reason = v_reason
  where id = v_refund.id;

  update public.orders set app_status = v_refund.previous_status
   where order_id = v_order.order_id;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'refund_id', v_refund.id,
    'status', v_refund.previous_status,
    'reverted_at', v_now
  );
end;
$$;
revoke all on function public.cancel_refund(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_refund(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Webhook: hormati Refund, jangan sentuh event_* (A58)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_order_webhook(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_order_id text;
  v_name text;
  v_phone text;
  v_email text;
  v_product_raw text;
  v_raw_status text;
  v_payment_method text;
  v_payment_provider text;
  v_payment_identifier text;
  v_gross numeric(18, 2);
  v_quantity integer;
  v_source_created_at timestamptz;
  v_source_updated_at timestamptz;
  v_app_status text;
  v_provider_status text;
  v_parse jsonb;

  v_existing public.orders;
  v_inserted boolean := false;
  v_action text;

  v_identifier_normalized text;
  v_effective_identifier text;
  v_rule_id uuid;
  v_rule_name text;
  v_rule_type text;
  v_rule_value numeric(18, 4);
  v_has_rule boolean;

  v_recalculate boolean;
  v_tax numeric(18, 2);
  v_net numeric(18, 2);
  v_tax_status text;
  v_snap_id uuid;
  v_snap_name text;
  v_snap_type text;
  v_snap_value numeric(18, 4);
  v_rule_flat numeric(18, 4);
  v_snap_flat numeric(18, 4);
  v_mapping_kept boolean := false;
  v_paid_at timestamptz;

  v_rule_platform boolean;
  v_rule_etax_type text;
  v_rule_etax_value numeric(18, 4);
  v_etax numeric(18, 2);
  v_pf numeric(18, 2);
  v_pf_pct numeric(9, 4);
  v_snap_etax_type text;
  v_snap_etax_value numeric(18, 4);
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  v_order_id := nullif(btrim(p_payload ->> 'orderId'), '');
  v_raw_status := nullif(btrim(p_payload ->> 'rawStatus'), '');
  v_app_status := nullif(btrim(p_payload ->> 'appStatus'), '');

  if v_order_id is null or v_raw_status is null or v_app_status is null then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;
  if length(v_order_id) > 64 or length(v_raw_status) > 32 then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;
  if v_app_status not in ('Pending', 'Paid', 'Cancelled') then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;
  v_provider_status := v_app_status;

  if p_payload ->> 'grossAmount' is null then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;
  begin
    v_gross := round((p_payload ->> 'grossAmount')::numeric, 2);
  exception
    when others then
      raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end;
  if v_gross is null or v_gross < 0 or v_gross > 9999999999999999.99 then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  if jsonb_typeof(p_payload -> 'quantity') = 'number' then
    begin
      v_quantity := (p_payload ->> 'quantity')::integer;
    exception
      when others then
        raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
    end;
    if (p_payload ->> 'quantity')::numeric <> v_quantity or v_quantity < 1 or v_quantity > 10000 then
      raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
    end if;
  elsif coalesce(jsonb_typeof(p_payload -> 'quantity'), 'null') <> 'null' then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  v_name := nullif(btrim(p_payload ->> 'customerName'), '');
  v_phone := nullif(btrim(p_payload ->> 'phone'), '');
  v_email := nullif(btrim(p_payload ->> 'email'), '');
  v_product_raw := nullif(btrim(p_payload ->> 'productRaw'), '');
  v_payment_method := nullif(btrim(p_payload ->> 'paymentMethod'), '');
  v_payment_provider := nullif(btrim(p_payload ->> 'paymentProvider'), '');
  v_payment_identifier := nullif(btrim(p_payload ->> 'paymentIdentifier'), '');

  if length(coalesce(v_name, '')) > 200
     or length(coalesce(v_phone, '')) > 32
     or length(coalesce(v_email, '')) > 200
     or length(coalesce(v_product_raw, '')) > 200
     or length(coalesce(v_payment_method, '')) > 100
     or length(coalesce(v_payment_provider, '')) > 100
     or length(coalesce(v_payment_identifier, '')) > 200 then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  begin
    v_source_created_at := nullif(btrim(p_payload ->> 'sourceCreatedAt'), '')::timestamptz;
    v_source_updated_at := nullif(btrim(p_payload ->> 'sourceUpdatedAt'), '')::timestamptz;
  exception
    when others then
      raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end;

  v_parse := case when jsonb_typeof(p_payload -> 'parse') = 'object' then p_payload -> 'parse' else null end;
  if v_product_raw is not null and v_parse is null then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  insert into public.orders (order_id, app_status, gross_amount, product_parse_status)
  values (v_order_id, v_app_status, v_gross, 'invalid')
  on conflict (order_id) do nothing
  returning true into v_inserted;
  v_inserted := coalesce(v_inserted, false);

  select * into v_existing from public.orders where order_id = v_order_id for update;

  if v_existing.source = 'ots' then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  -- A58: refund adalah keputusan manual. Webhook berikutnya tetap boleh memperbarui
  -- data lain, tetapi tidak boleh membatalkan Refund diam-diam. Status provider terakhir
  -- disimpan di baris refund aktif agar "Batalkan Refund" mengembalikan status yang benar.
  if v_existing.app_status = 'Refund' then
    v_app_status := 'Refund';
    update public.order_refunds
       set previous_status = v_provider_status
     where order_id = v_order_id and reverted_at is null;
  end if;

  if not v_inserted and v_parse is not null and coalesce(v_parse ->> 'status', '') <> 'valid'
     and v_existing.product_parse_status = 'valid'
     and lower(btrim(coalesce(v_product_raw, ''))) = lower(btrim(coalesce(v_existing.product_raw, ''))) then
    v_parse := null;
    v_mapping_kept := true;
  end if;
  v_action := case when v_inserted then 'inserted' else 'updated' end;

  v_identifier_normalized := public.normalize_payment_identifier(v_payment_identifier);
  v_effective_identifier := coalesce(v_identifier_normalized, v_existing.payment_identifier_normalized);

  select r.id, r.name, r.fee_type, r.fee_value, r.platform_fee_applies, r.epayment_tax_type, r.epayment_tax_value, r.fee_flat_value
    into v_rule_id, v_rule_name, v_rule_type, v_rule_value, v_rule_platform, v_rule_etax_type, v_rule_etax_value, v_rule_flat
    from public.payment_fee_rules r
   where r.active
     and r.identifier_normalized = v_effective_identifier
   limit 1;
  v_has_rule := found;

  v_recalculate :=
    v_inserted
    or (v_identifier_normalized is not null
        and v_identifier_normalized is distinct from v_existing.payment_identifier_normalized)
    or (v_gross is distinct from v_existing.gross_amount)
    or (v_existing.tax_mapping_status = 'unmapped' and v_has_rule)
    -- Status yang disimpan (bukan status provider) dipakai di sini: Refund tidak boleh
    -- memicu penulisan ulang snapshot tax/platform fee.
    or (v_app_status = 'Paid' and v_existing.app_status is distinct from 'Paid');

  if v_recalculate then
    if v_has_rule then
      v_tax := public.calc_epayment_fee(v_gross, v_rule_type, v_rule_value, v_rule_flat);
      v_etax := public.calc_epayment_tax_amount(v_tax, v_rule_etax_type, v_rule_etax_value);
      v_pf_pct := case when v_rule_platform then public.platform_fee_percent() else null end;
      -- Platform fee mengikuti status provider: order yang sedang Refund tetap punya
      -- snapshot fee yang benar bila nominalnya berubah.
      v_pf := case when v_rule_platform and v_provider_status = 'Paid' then round(v_gross * v_pf_pct / 100, 2) else 0 end;
      v_net := round(v_gross - v_tax - v_etax - v_pf, 2);
      v_snap_etax_type := v_rule_etax_type;
      v_snap_etax_value := v_rule_etax_value;
      v_tax_status := 'mapped';
      v_snap_id := v_rule_id;
      v_snap_name := v_rule_name;
      v_snap_type := v_rule_type;
      v_snap_value := v_rule_value;
      v_snap_flat := v_rule_flat;
    else
      v_tax := 0;
      v_etax := 0;
      v_pf := 0;
      v_pf_pct := null;
      v_snap_etax_type := null;
      v_snap_etax_value := null;
      v_net := v_gross;
      v_tax_status := 'unmapped';
      v_snap_id := null;
      v_snap_name := null;
      v_snap_type := null;
      v_snap_value := null;
      v_snap_flat := null;
    end if;
  else
    v_tax := v_existing.tax_amount;
    v_etax := v_existing.epayment_tax_amount;
    v_pf := v_existing.platform_fee_amount;
    v_pf_pct := v_existing.platform_fee_percent_snapshot;
    v_snap_etax_type := v_existing.epayment_tax_type_snapshot;
    v_snap_etax_value := v_existing.epayment_tax_value_snapshot;
    v_net := v_existing.net_amount;
    v_tax_status := v_existing.tax_mapping_status;
    v_snap_id := v_existing.fee_rule_id;
    v_snap_name := v_existing.fee_rule_name_snapshot;
    v_snap_type := v_existing.fee_type_snapshot;
    v_snap_value := v_existing.fee_value_snapshot;
    v_snap_flat := v_existing.fee_flat_value_snapshot;
  end if;

  v_paid_at := v_existing.paid_at;
  if v_provider_status = 'Paid' and v_paid_at is null then
    v_paid_at := now();
  end if;

  -- `event_batch/event_session/event_city` SENGAJA tidak ada di SET: override
  -- reschedule tidak boleh ditimpa webhook berikutnya.
  update public.orders set
    name = coalesce(v_name, name),
    phone = coalesce(v_phone, phone),
    email = coalesce(v_email, email),
    product_raw = case when v_parse is not null then v_product_raw else product_raw end,
    product_parse_status = case
      when v_parse is null then product_parse_status
      when v_parse ->> 'status' = 'valid' then 'valid'
      else 'invalid'
    end,
    product_code = case when v_parse is null then product_code else nullif(btrim(v_parse ->> 'productCode'), '') end,
    product_name = case when v_parse is null then product_name else nullif(btrim(v_parse ->> 'productName'), '') end,
    advertiser_code = case when v_parse is null then advertiser_code else nullif(btrim(v_parse ->> 'advertiserCode'), '') end,
    advertiser_name = case when v_parse is null then advertiser_name else nullif(btrim(v_parse ->> 'advertiserName'), '') end,
    event_type = case when v_parse is null then event_type else nullif(btrim(v_parse ->> 'eventType'), '') end,
    batch = case when v_parse is null then batch else nullif(btrim(v_parse ->> 'batch'), '') end,
    session = case when v_parse is null then session else nullif(btrim(v_parse ->> 'session'), '') end,
    city = case when v_parse is null then city else nullif(btrim(v_parse ->> 'city'), '') end,
    raw_status = v_raw_status,
    app_status = v_app_status,
    payment_method = coalesce(v_payment_method, payment_method),
    payment_provider = coalesce(v_payment_provider, payment_provider),
    payment_identifier = coalesce(v_payment_identifier, payment_identifier),
    payment_identifier_normalized = coalesce(v_identifier_normalized, payment_identifier_normalized),
    gross_amount = v_gross,
    quantity = coalesce(v_quantity, quantity),
    tax_amount = v_tax,
    net_amount = v_net,
    tax_mapping_status = v_tax_status,
    fee_rule_id = v_snap_id,
    fee_rule_name_snapshot = v_snap_name,
    fee_type_snapshot = v_snap_type,
    fee_value_snapshot = v_snap_value,
    fee_flat_value_snapshot = v_snap_flat,
    epayment_tax_amount = v_etax,
    epayment_tax_type_snapshot = v_snap_etax_type,
    epayment_tax_value_snapshot = v_snap_etax_value,
    platform_fee_amount = v_pf,
    platform_fee_percent_snapshot = v_pf_pct,
    source_created_at = coalesce(v_source_created_at, source_created_at),
    source_updated_at = coalesce(v_source_updated_at, source_updated_at),
    paid_at = v_paid_at
  where order_id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'action', v_action, 'mapping_kept', v_mapping_kept);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. orders_page / export_orders_page — kolom acara efektif + status Refund
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_page(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_app_status text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_filter text := $q$
      ($1::text is null or (
             o.order_id ilike $1::text
          or o.name      ilike $1::text
          or o.phone     ilike $1::text
          or o.product_raw ilike $1::text
          or o.product_name ilike $1::text
          or o.advertiser_name ilike $1::text
          or o.batch     ilike $1::text
          or o.session   ilike $1::text
          or o.city      ilike $1::text
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
      and ($10::text is null or o.app_status = $10::text)
      and ($11::text is null or lower(btrim(o.payment_method)) = lower(btrim($11::text)))
  $q$;
  v_columns text :=
    'o.id, o.order_id, o.name, o.phone, o.email,
     o.product_raw, o.product_parse_status, o.product_code, o.product_name,
     o.advertiser_code, o.advertiser_name, o.event_type, o.batch, o.session, o.city,
     o.event_batch, o.event_session, o.event_city,
     o.effective_batch, o.effective_session, o.effective_city,
     (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
     exists (select 1 from public.attendance_events e where e.order_id = o.order_id) as has_attendance,
     o.raw_status, o.app_status,
     o.payment_method, o.payment_provider, o.payment_identifier,
     o.gross_amount, o.tax_amount, o.net_amount, o.tax_mapping_status,
     o.epayment_tax_amount, o.platform_fee_amount,
     o.epayment_tax_type_snapshot, o.epayment_tax_value_snapshot, o.platform_fee_percent_snapshot,
     o.fee_rule_name_snapshot, o.fee_type_snapshot, o.fee_value_snapshot,
     o.source_created_at, o.source_updated_at,
     o.created_at, o.paid_at, o.updated_at';
  v_sort_expr text;
  v_search text;
  v_base text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  if not public.has_permission('operasional.order') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;
  if (p_page - 1) * p_page_size >= 500 then
    raise exception using errcode = 'DF011', message = 'PAGE_LIMIT';
  end if;
  if p_app_status is not null and p_app_status not in ('Pending', 'Paid', 'Cancelled', 'Refund') then
    raise exception using errcode = 'DF011', message = 'INVALID_APP_STATUS';
  end if;

  v_sort_expr := case p_sort
    when 'order_id' then 'order_id'
    when 'name' then 'name'
    when 'app_status' then 'app_status'
    when 'gross_amount' then 'gross_amount'
    when 'tax_amount' then 'tax_amount'
    when 'net_amount' then 'net_amount'
    when 'created_at' then 'created_at'
    when 'paid_at' then 'paid_at'
    when 'updated_at' then 'updated_at'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  v_base := format('select %s from public.orders o where %s', v_columns, v_filter);
  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  execute format($q$
    with filtered as (%s),
    counted as (
      select count(*)::int as total,
             count(*) filter (where app_status = 'Paid')::int as paid,
             count(*) filter (where app_status = 'Pending')::int as pending
        from filtered
    ),
    paged as (
      select * from filtered
       order by %s %s nulls last, order_id asc
       limit %s offset %s
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(p)) from paged p), '[]'::jsonb),
      'total', (select total from counted),
      'summary', (select jsonb_build_object('total', total, 'paid', paid, 'pending', pending) from counted)
    )
  $q$, v_base, v_sort_expr, p_sort_dir, v_limit, v_offset)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city, p_app_status, p_payment_method;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.export_orders_page(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_app_status text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_filter text := $q$
      ($1::text is null or (
             o.order_id ilike $1::text
          or o.name      ilike $1::text
          or o.phone     ilike $1::text
          or o.product_raw ilike $1::text
          or o.product_name ilike $1::text
          or o.advertiser_name ilike $1::text
          or o.batch     ilike $1::text
          or o.session   ilike $1::text
          or o.city      ilike $1::text
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
      and ($10::text is null or o.app_status = $10::text)
      and ($11::text is null or lower(btrim(o.payment_method)) = lower(btrim($11::text)))
  $q$;
  v_columns text :=
    'o.id, o.order_id, o.name, o.phone, o.email,
     o.product_raw, o.product_parse_status, o.product_code, o.product_name,
     o.advertiser_code, o.advertiser_name, o.event_type, o.batch, o.session, o.city,
     o.event_batch, o.event_session, o.event_city,
     o.effective_batch, o.effective_session, o.effective_city,
     (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
     exists (select 1 from public.attendance_events e where e.order_id = o.order_id) as has_attendance,
     o.raw_status, o.app_status,
     o.payment_method, o.payment_provider, o.payment_identifier,
     o.gross_amount, o.tax_amount, o.net_amount, o.tax_mapping_status,
     o.epayment_tax_amount, o.platform_fee_amount,
     o.epayment_tax_type_snapshot, o.epayment_tax_value_snapshot, o.platform_fee_percent_snapshot,
     o.fee_rule_name_snapshot, o.fee_type_snapshot, o.fee_value_snapshot,
     o.source_created_at, o.source_updated_at,
     o.created_at, o.paid_at, o.updated_at';
  v_sort_expr text;
  v_search text;
  v_base text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  if not public.has_permission('action.export_data') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.has_permission('operasional.order') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;
  if p_app_status is not null and p_app_status not in ('Pending', 'Paid', 'Cancelled', 'Refund') then
    raise exception using errcode = 'DF011', message = 'INVALID_APP_STATUS';
  end if;

  v_sort_expr := case p_sort
    when 'order_id' then 'order_id'
    when 'name' then 'name'
    when 'app_status' then 'app_status'
    when 'gross_amount' then 'gross_amount'
    when 'tax_amount' then 'tax_amount'
    when 'net_amount' then 'net_amount'
    when 'created_at' then 'created_at'
    when 'paid_at' then 'paid_at'
    when 'updated_at' then 'updated_at'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  v_base := format('select %s from public.orders o where %s', v_columns, v_filter);
  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  execute format($q$
    with filtered as (%s),
    counted as (
      select count(*)::int as total,
             count(*) filter (where app_status = 'Paid')::int as paid,
             count(*) filter (where app_status = 'Pending')::int as pending
        from filtered
    ),
    paged as (
      select * from filtered
       order by %s %s nulls last, order_id asc
       limit %s offset %s
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(p)) from paged p), '[]'::jsonb),
      'total', (select total from counted),
      'summary', (select jsonb_build_object('total', total, 'paid', paid, 'pending', pending) from counted)
    )
  $q$, v_base, v_sort_expr, p_sort_dir, v_limit, v_offset)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city, p_app_status, p_payment_method;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Presensi: acara efektif + status Reschedule/Refund
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presensi_page(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_attendance_status text DEFAULT NULL::text, p_sort text DEFAULT 'latest_activity'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_filter text := $q$
      ($1::text is null or (
             o.order_id ilike $1::text
          or o.name      ilike $1::text
          or o.phone     ilike $1::text
          or o.product_raw ilike $1::text
          or o.product_name ilike $1::text
          or o.advertiser_name ilike $1::text
          or o.batch     ilike $1::text
          or o.session   ilike $1::text
          or o.city      ilike $1::text
          or o.effective_batch ilike $1::text
          or o.effective_session ilike $1::text
          or o.effective_city ilike $1::text
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.effective_batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.effective_session = $8::text)
      and ($9::text is null or lower(btrim(o.effective_city)) = lower(btrim($9::text)))
  $q$;
  v_search text;
  v_base text;
  v_classified text;
  v_paged text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;
  if (p_page - 1) * p_page_size >= 500 then
    raise exception using errcode = 'DF011', message = 'PAGE_LIMIT';
  end if;

  if p_attendance_status is not null
     and p_attendance_status not in ('Hadir', 'Belum Hadir', 'Reschedule', 'Refund', 'Pending', 'Cancelled') then
    raise exception using errcode = 'DF011', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  v_sort_expr := case p_sort
    when 'order_id' then 't.order_id'
    when 'name' then 't.name'
    when 'total_activity' then 't.total_activity'
    when 'latest_activity' then 't.latest_activity_sort'
    when 'product_name' then 't.product_name'
    when 'batch' then 't.batch'
    when 'session' then 't.session'
    when 'city' then 't.city'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  v_base :=
    'select o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type,
            o.effective_batch as batch, o.effective_session as session, o.effective_city as city,
            o.batch as original_batch, o.session as original_session, o.city as original_city,
            (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
            o.product_parse_status, o.app_status, o.gross_amount, o.quantity,
            o.created_at, o.paid_at, o.updated_at,
            a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.timestamps
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity,
                max(e.clicked_at) as latest_activity,
                (array_agg(e.clicked_at order by e.clicked_at desc))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where ' || v_filter;

  v_classified :=
    'select t.*,
            case
              when t.app_status = ''Refund'' then ''Refund''
              when t.app_status <> ''Paid'' then t.app_status
              when t.rescheduled and t.total_activity = 0 then ''Reschedule''
              when t.total_activity > 0 then ''Hadir''
              else ''Belum Hadir''
            end as attendance_status
       from (' || v_base || ') t';

  execute format('select count(*) from (%s) c where ($10::text is null or c.attendance_status = $10::text)', v_classified)
    into v_total
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  v_paged := format(
    'select t.* from (%s) t where ($10::text is null or t.attendance_status = $10::text) order by %s %s nulls last, t.order_id asc limit %s offset %s',
    v_classified, v_sort_expr, p_sort_dir, v_limit, v_offset
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from (%s) p', v_paged)
    into v_rows
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.export_presensi_page(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_attendance_status text DEFAULT NULL::text, p_sort text DEFAULT 'latest_activity'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_filter text := $q$
      ($1::text is null or (
             o.order_id ilike $1::text
          or o.name      ilike $1::text
          or o.phone     ilike $1::text
          or o.product_raw ilike $1::text
          or o.product_name ilike $1::text
          or o.advertiser_name ilike $1::text
          or o.batch     ilike $1::text
          or o.session   ilike $1::text
          or o.city      ilike $1::text
          or o.effective_batch ilike $1::text
          or o.effective_session ilike $1::text
          or o.effective_city ilike $1::text
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.effective_batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.effective_session = $8::text)
      and ($9::text is null or lower(btrim(o.effective_city)) = lower(btrim($9::text)))
  $q$;
  v_search text;
  v_base text;
  v_classified text;
  v_paged text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  if not public.has_permission('action.export_data') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;

  if p_attendance_status is not null
     and p_attendance_status not in ('Hadir', 'Belum Hadir', 'Reschedule', 'Refund', 'Pending', 'Cancelled') then
    raise exception using errcode = 'DF011', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  v_sort_expr := case p_sort
    when 'order_id' then 't.order_id'
    when 'name' then 't.name'
    when 'total_activity' then 't.total_activity'
    when 'latest_activity' then 't.latest_activity_sort'
    when 'product_name' then 't.product_name'
    when 'batch' then 't.batch'
    when 'session' then 't.session'
    when 'city' then 't.city'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  v_base :=
    'select o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type,
            o.effective_batch as batch, o.effective_session as session, o.effective_city as city,
            o.batch as original_batch, o.session as original_session, o.city as original_city,
            (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
            o.product_parse_status, o.app_status, o.gross_amount, o.quantity,
            o.created_at, o.paid_at, o.updated_at,
            a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.timestamps
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity,
                max(e.clicked_at) as latest_activity,
                (array_agg(e.clicked_at order by e.clicked_at desc))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where ' || v_filter;

  v_classified :=
    'select t.*,
            case
              when t.app_status = ''Refund'' then ''Refund''
              when t.app_status <> ''Paid'' then t.app_status
              when t.rescheduled and t.total_activity = 0 then ''Reschedule''
              when t.total_activity > 0 then ''Hadir''
              else ''Belum Hadir''
            end as attendance_status
       from (' || v_base || ') t';

  execute format('select count(*) from (%s) c where ($10::text is null or c.attendance_status = $10::text)', v_classified)
    into v_total
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  v_paged := format(
    'select t.* from (%s) t where ($10::text is null or t.attendance_status = $10::text) order by %s %s nulls last, t.order_id asc limit %s offset %s',
    v_classified, v_sort_expr, p_sort_dir, v_limit, v_offset
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from (%s) p', v_paged)
    into v_rows
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. presensi_summary: filter memakai acara efektif
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presensi_summary(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_filter text := $q$
      ($1::text is null or (
             o.order_id ilike $1::text
          or o.name      ilike $1::text
          or o.phone     ilike $1::text
          or o.product_raw ilike $1::text
          or o.product_name ilike $1::text
          or o.advertiser_name ilike $1::text
          or o.batch     ilike $1::text
          or o.session   ilike $1::text
          or o.city      ilike $1::text
          or o.effective_batch ilike $1::text
          or o.effective_session ilike $1::text
          or o.effective_city ilike $1::text
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.effective_batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.effective_session = $8::text)
      and ($9::text is null or lower(btrim(o.effective_city)) = lower(btrim($9::text)))
  $q$;
  v_search text;
  v_result jsonb;
begin
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  execute format($q$
    with filtered as (
      select o.app_status,
             exists (
               select 1 from public.attendance_events e where e.order_id = o.order_id
             ) as has_attendance
        from public.orders o
       where %s
    ),
    agg as (
      select
        count(*) filter (where app_status = 'Paid')::int as paid,
        count(*) filter (where app_status = 'Paid' and has_attendance)::int as sudah_hadir
      from filtered
    )
    select jsonb_build_object(
      'paid', a.paid,
      'sudah_hadir', a.sudah_hadir,
      'belum_hadir', a.paid - a.sudah_hadir,
      'attendance_rate', case when a.paid > 0 then round(a.sudah_hadir::numeric / a.paid, 4) else null end
    )
    from agg a
  $q$, v_filter)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Resume Batch: tiket per acara efektif
-- ---------------------------------------------------------------------------
create or replace function public.batch_session_summary(
  p_product_code text,
  p_batch text,
  p_event_type text default null
)
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
  if not public.has_permission('operasional.resume_batch') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(p_product_code, '')), '') is null or nullif(btrim(coalesce(p_batch, '')), '') is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  with paid as (
    select upper(btrim(o.effective_session)) as session_key,
           lower(btrim(o.effective_city)) as city_key,
           o.effective_session as session, o.effective_city as city, o.event_type, o.quantity, o.source,
           public.normalize_code(o.advertiser_code) as advertiser_key,
           o.advertiser_code, o.advertiser_name
      from public.orders o
     where o.app_status = 'Paid'
       and o.product_parse_status = 'valid'
       and public.normalize_code(o.product_code) = public.normalize_code(p_product_code)
       and public.normalize_batch(o.effective_batch) = public.normalize_batch(btrim(p_batch))
       and (nullif(btrim(coalesce(p_event_type, '')), '') is null or o.event_type = btrim(p_event_type))
       and public.actor_can_order(v_actor, o.product_code, o.advertiser_code)
  ),
  per_advertiser as (
    select session_key, city_key, event_type,
           (source = 'ots') as ots,
           max(advertiser_code) as advertiser_code,
           max(advertiser_name) as advertiser_name,
           sum(quantity)::int as tickets
      from paid
     group by session_key, city_key, event_type, (source = 'ots'), advertiser_key
  ),
  per_session as (
    select session_key, city_key, event_type,
           max(session) as session, max(city) as city,
           sum(quantity)::int as tickets
      from paid
     group by session_key, city_key, event_type
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'tickets', (select coalesce(sum(tickets), 0) from per_session),
      'sessions', (select count(*) from per_session)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session', s.session,
        'city', s.city,
        'event_type', s.event_type,
        'tickets', s.tickets,
        'advertisers', (
          select jsonb_agg(jsonb_build_object(
            'advertiser_code', a.advertiser_code,
            'advertiser_name', a.advertiser_name,
            'ots', a.ots,
            'tickets', a.tickets
          ) order by a.tickets desc, a.ots, a.advertiser_code)
            from per_advertiser a
           where a.session_key is not distinct from s.session_key
             and a.city_key is not distinct from s.city_key
             and a.event_type is not distinct from s.event_type
        )
      ) order by s.city_key nulls last, nullif(regexp_replace(s.session_key, '\D', '', 'g'), '')::bigint nulls last, s.session_key nulls last)
      from per_session s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.batch_session_summary(text,text,text) from public, anon, authenticated;
grant execute on function public.batch_session_summary(text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Halaman Order Refund
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_page(
  p_search text DEFAULT NULL::text,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_product_code text DEFAULT NULL::text,
  p_advertiser_code text DEFAULT NULL::text,
  p_event_type text DEFAULT NULL::text,
  p_batch text DEFAULT NULL::text,
  p_session text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_sort text DEFAULT 'refunded_at'::text,
  p_sort_dir text DEFAULT 'desc'::text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_search text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  if not public.has_permission('operasional.order_refund') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;
  if (p_page - 1) * p_page_size >= 500 then
    raise exception using errcode = 'DF011', message = 'PAGE_LIMIT';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  v_sort_expr := case p_sort
    when 'order_id' then 'order_id'
    when 'name' then 'name'
    when 'refunded_at' then 'refunded_at'
    when 'amount' then 'refund_amount'
    when 'product_name' then 'product_name'
    when 'batch' then 'batch'
    when 'session' then 'session'
    when 'city' then 'city'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  execute format($q$
    with base as (
      select o.order_id, o.name, o.phone, o.product_code, o.product_name,
             o.advertiser_code, o.advertiser_name, o.event_type,
             o.batch, o.session, o.city,
             o.event_batch, o.event_session, o.event_city,
             (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
             o.quantity, o.gross_amount,
             r.amount as refund_amount, r.reason as refund_reason,
             r.refunded_at, r.refunded_by_name, r.previous_status
        from public.order_refunds r
        join public.orders o on o.order_id = r.order_id
       where r.reverted_at is null
         and ($1::text is null or (
               o.order_id ilike $1::text
            or o.name ilike $1::text
            or o.phone ilike $1::text
            or o.product_raw ilike $1::text
            or o.product_name ilike $1::text
            or o.advertiser_name ilike $1::text
            or o.batch ilike $1::text
            or o.session ilike $1::text
            or o.city ilike $1::text
            or r.reason ilike $1::text
         ))
         and ($2::date is null or r.refunded_at >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
         and ($3::date is null or r.refunded_at < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
         and ($4::text is null or o.product_code = $4::text)
         and ($5::text is null or o.advertiser_code = $5::text)
         and ($6::text is null or o.event_type = $6::text)
         and ($7::text is null or public.normalize_batch(o.batch) = public.normalize_batch($7::text))
         and ($8::text is null or o.session = $8::text)
         and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
    ),
    counted as (
      select count(*)::int as total,
             coalesce(sum(quantity), 0)::int as tickets,
             coalesce(sum(refund_amount), 0)::numeric(18,2) as amount
        from base
    ),
    paged as (
      select * from base
       order by %s %s nulls last, order_id asc
       limit %s offset %s
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(p)) from paged p), '[]'::jsonb),
      'total', (select total from counted),
      'page', %s,
      'page_size', %s,
      'summary', (select jsonb_build_object('total', total, 'tickets', tickets, 'amount', amount) from counted)
    )
  $q$, v_sort_expr, p_sort_dir, v_limit, v_offset, p_page, p_page_size)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.export_refund_page(
  p_search text DEFAULT NULL::text,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_product_code text DEFAULT NULL::text,
  p_advertiser_code text DEFAULT NULL::text,
  p_event_type text DEFAULT NULL::text,
  p_batch text DEFAULT NULL::text,
  p_session text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_sort text DEFAULT 'refunded_at'::text,
  p_sort_dir text DEFAULT 'desc'::text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_search text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  if not public.has_permission('action.export_data') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if not public.has_permission('operasional.order_refund') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  v_sort_expr := case p_sort
    when 'order_id' then 'order_id'
    when 'name' then 'name'
    when 'refunded_at' then 'refunded_at'
    when 'amount' then 'refund_amount'
    when 'product_name' then 'product_name'
    when 'batch' then 'batch'
    when 'session' then 'session'
    when 'city' then 'city'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  execute format($q$
    with base as (
      select o.order_id, o.name, o.phone, o.product_code, o.product_name,
             o.advertiser_code, o.advertiser_name, o.event_type,
             o.batch, o.session, o.city,
             o.event_batch, o.event_session, o.event_city,
             (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
             o.quantity, o.gross_amount,
             r.amount as refund_amount, r.reason as refund_reason,
             r.refunded_at, r.refunded_by_name, r.previous_status
        from public.order_refunds r
        join public.orders o on o.order_id = r.order_id
       where r.reverted_at is null
         and ($1::text is null or (
               o.order_id ilike $1::text
            or o.name ilike $1::text
            or o.phone ilike $1::text
            or o.product_raw ilike $1::text
            or o.product_name ilike $1::text
            or o.advertiser_name ilike $1::text
            or o.batch ilike $1::text
            or o.session ilike $1::text
            or o.city ilike $1::text
            or r.reason ilike $1::text
         ))
         and ($2::date is null or r.refunded_at >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
         and ($3::date is null or r.refunded_at < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
         and ($4::text is null or o.product_code = $4::text)
         and ($5::text is null or o.advertiser_code = $5::text)
         and ($6::text is null or o.event_type = $6::text)
         and ($7::text is null or public.normalize_batch(o.batch) = public.normalize_batch($7::text))
         and ($8::text is null or o.session = $8::text)
         and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
    ),
    counted as (
      select count(*)::int as total,
             coalesce(sum(quantity), 0)::int as tickets,
             coalesce(sum(refund_amount), 0)::numeric(18,2) as amount
        from base
    ),
    paged as (
      select * from base
       order by %s %s nulls last, order_id asc
       limit %s offset %s
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(p)) from paged p), '[]'::jsonb),
      'total', (select total from counted),
      'page', %s,
      'page_size', %s,
      'summary', (select jsonb_build_object('total', total, 'tickets', tickets, 'amount', amount) from counted)
    )
  $q$, v_sort_expr, p_sort_dir, v_limit, v_offset, p_page, p_page_size)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city;

  return v_result;
end;
$function$;

revoke all on function public.refund_page(text,date,date,text,text,text,text,text,text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.refund_page(text,date,date,text,text,text,text,text,text,text,text,integer,integer) to authenticated;
revoke all on function public.export_refund_page(text,date,date,text,text,text,text,text,text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.export_refund_page(text,date,date,text,text,text,text,text,text,text,text,integer,integer) to authenticated;
