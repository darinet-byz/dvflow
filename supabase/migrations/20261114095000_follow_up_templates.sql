-- ============================================================================
-- A76 — Follow Up Manual via WhatsApp (14 November 2026)
-- ============================================================================
--
-- Fitur ini TIDAK memakai gateway: operator membuka WhatsApp miliknya sendiri
-- lewat `https://api.whatsapp.com/send`, lalu pesan masih bisa diedit di
-- WhatsApp sebelum dikirim. Aplikasi hanya menyimpan template dan penanda
-- "bubble sudah dipakai".
--
-- Template: per PRODUK x JENIS ACARA (event type), 4 bubble F1-F4, dipakai
-- bersama oleh semua pimpro/advertiser yang membuka produk itu. Event type
-- dipakai (bukan nama `orders.event_type`) supaya Workshop (kind hybrid) tidak
-- tercampur dengan jenis lain.
--
-- Penanda: satu baris per (order, slot) — bukan riwayat. Warna bubble di modal
-- diambil dari sini; isi pesan tidak disimpan.
-- ============================================================================
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 78 $$;

-- ---------------------------------------------------------------------------
-- 1. Template Follow Up per produk x jenis acara
-- ---------------------------------------------------------------------------
create table public.follow_up_templates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  event_type_id uuid not null references public.event_types (id) on delete cascade,
  slot smallint not null,
  body text not null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint follow_up_templates_slot_check check (slot between 1 and 4),
  constraint follow_up_templates_body_not_blank check (btrim(body) <> ''),
  constraint follow_up_templates_body_length check (length(body) <= 2000),
  constraint follow_up_templates_unique unique (product_id, event_type_id, slot)
);

create trigger follow_up_templates_set_updated_at
  before update on public.follow_up_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Penanda bubble sudah dipakai per order
-- ---------------------------------------------------------------------------
create table public.order_follow_up_marks (
  order_id text not null references public.orders (order_id) on delete cascade,
  slot smallint not null,
  used_at timestamptz not null default now(),
  used_by uuid references public.users (id) on delete set null,
  used_by_name text,
  primary key (order_id, slot),
  constraint order_follow_up_marks_slot_check check (slot between 1 and 4)
);

-- Browser tidak membaca/menulis tabel ini langsung: semua lewat API (service_role)
-- supaya cakupan produk/pengiklan diperiksa di satu tempat.
alter table public.follow_up_templates enable row level security;
alter table public.order_follow_up_marks enable row level security;
revoke all on table public.follow_up_templates, public.order_follow_up_marks from public, anon, authenticated;
grant all on table public.follow_up_templates, public.order_follow_up_marks to service_role;

-- ---------------------------------------------------------------------------
-- 3. Simpan 4 slot sekaligus (atomik). Body kosong = hapus slot.
-- ---------------------------------------------------------------------------
create or replace function public.save_follow_up_templates(
  p_actor uuid,
  p_product_code text,
  p_event_type_code text,
  p_slots jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_product public.products;
  v_event public.event_types;
  v_body text;
  v_slot smallint;
begin
  if not public.actor_has_permission(p_actor, 'operasional.order') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_product from public.products
   where public.normalize_code(code) = public.normalize_code(p_product_code);
  if not found then
    raise exception using errcode = 'DF011', message = 'INVALID_PRODUCT';
  end if;
  if not public.actor_can_product(p_actor, v_product.code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_event from public.event_types
   where public.normalize_code(code) = public.normalize_code(p_event_type_code);
  if not found then
    raise exception using errcode = 'DF011', message = 'INVALID_EVENT_TYPE';
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'object' then
    raise exception using errcode = 'DF011', message = 'INVALID_SLOTS';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_slots) k where k not in ('1', '2', '3', '4')
  ) then
    raise exception using errcode = 'DF011', message = 'INVALID_SLOTS';
  end if;

  for v_slot in 1..4 loop
    v_body := btrim(coalesce(p_slots ->> (v_slot::text), ''));
    if v_body = '' then
      delete from public.follow_up_templates
       where product_id = v_product.id and event_type_id = v_event.id and slot = v_slot;
    else
      if length(v_body) > 2000 then
        raise exception using errcode = 'DF011', message = 'INVALID_TEMPLATE_LENGTH';
      end if;
      insert into public.follow_up_templates (product_id, event_type_id, slot, body, updated_by)
      values (v_product.id, v_event.id, v_slot, v_body, p_actor)
      on conflict (product_id, event_type_id, slot) do update
        set body = excluded.body,
            updated_by = excluded.updated_by,
            updated_at = now();
    end if;
  end loop;

  return jsonb_build_object('saved', true);
end;
$$;
revoke all on function public.save_follow_up_templates(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_follow_up_templates(uuid,text,text,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Tandai satu bubble sudah dipakai untuk satu order (upsert, bukan riwayat).
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_follow_up(
  p_actor uuid,
  p_order_id text,
  p_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_used_at timestamptz := clock_timestamp();
  v_name text;
begin
  if not public.actor_has_permission(p_actor, 'operasional.order') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_slot is null or p_slot < 1 or p_slot > 4 then
    raise exception using errcode = 'DF011', message = 'INVALID_SLOT';
  end if;

  select * into v_order from public.orders where order_id = p_order_id;
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_order(p_actor, v_order.product_code, v_order.advertiser_code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select display_name into v_name from public.users where id = p_actor;

  insert into public.order_follow_up_marks (order_id, slot, used_at, used_by, used_by_name)
  values (p_order_id, p_slot::smallint, v_used_at, p_actor, v_name)
  on conflict (order_id, slot) do update
    set used_at = excluded.used_at,
        used_by = excluded.used_by,
        used_by_name = excluded.used_by_name;

  return jsonb_build_object(
    'order_id', p_order_id,
    'slot', p_slot,
    'used_at', v_used_at,
    'used_by_name', v_name
  );
end;
$$;
revoke all on function public.mark_order_follow_up(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.mark_order_follow_up(uuid,text,integer) to service_role;
