-- Advertiser Notes + saran batch dari data order (permintaan pengguna 6 November 2026).
--
-- * `recent_batches` hanya memberi SARAN 3 batch terbaru untuk sebuah produk (opsional per
--   pengiklan). Batch tetap boleh diketik bebas; fungsi ini tidak mengubah filter mana pun.
-- * `advertiser_notes` adalah papan tugas manajer untuk pengiklan. Satu note = satu event
--   (pengiklan + produk + batch opsional). Ringkasan order/report spend dihitung live,
--   tidak ada duplikasi data.
-- * Catatan hanya untuk manajer ke atas dan akun Advertiser pemilik note. Akun Advertiser
--   lain di produk yang sama tidak melihat catatan ini.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 69 $$;

-- ---------------------------------------------------------------------------
-- 1. Izin
-- ---------------------------------------------------------------------------
insert into public.app_permissions (key, name, module, description, sort_order)
values
  ('operasional.advertiser_notes', 'Advertiser Notes', 'operasional', 'Melihat catatan event dan deadline iklan dari manajer', 9),
  ('action.manage_advertiser_notes', 'Kelola Advertiser Notes', 'aksi', 'Membuat, mengedit, dan mengarsipkan catatan event pengiklan', 45)
on conflict (key) do nothing;

insert into public.app_role_permissions (role_id, permission_key)
select r, k
from unnest(array['manajer', 'admin', 'advertiser']) r
cross join unnest(array['operasional.advertiser_notes']) k
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

insert into public.app_role_permissions (role_id, permission_key)
select r, 'action.manage_advertiser_notes'
from unnest(array['manajer', 'admin']) r
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- Dropdown produk/pengiklan di panel Notes dibaca lewat RLS tabel konfigurasi.
create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'action.ots','operasional.report_spend','operasional.resume_batch','operasional.advertiser_notes',
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Saran batch: maksimal 3 batch terbaru untuk produk + pengiklan
-- ---------------------------------------------------------------------------
create or replace function public.recent_batches(
  p_product_code text,
  p_advertiser_code text default null,
  p_limit integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 3), 1), 10);
  v_product_key text := nullif(public.normalize_code(p_product_code), '');
  v_advertiser_key text := nullif(public.normalize_code(p_advertiser_code), '');
  v_result jsonb;
begin
  if not (
    public.has_permission('operasional.advertiser_notes') or public.has_permission('operasional.order')
    or public.has_permission('operasional.order_refund') or public.has_permission('operasional.dashboard')
    or public.has_permission('operasional.presensi') or public.has_permission('operasional.report_spend')
    or public.has_permission('operasional.analytics') or public.has_permission('config.report_tax')
    or public.has_permission('action.ots')
  ) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if v_product_key is null then
    return jsonb_build_object('batches', '[]'::jsonb);
  end if;

  with filtered as (
    select
      public.normalize_batch(o.batch) as batch_key,
      o.batch, o.product_code, o.product_name,
      o.advertiser_code, o.advertiser_name,
      o.created_at, o.quantity, o.app_status
    from public.orders o
    where public.actor_can_product(v_actor, o.product_code)
      and o.product_parse_status = 'valid'
      and coalesce(o.source, 'orderonline') = 'orderonline'
      and public.normalize_code(o.product_code) = v_product_key
      and nullif(btrim(o.batch), '') is not null
      and (v_advertiser_key is null or public.normalize_code(o.advertiser_code) = v_advertiser_key)
  ),
  latest as (
    select distinct on (batch_key)
      batch_key, batch, product_code, product_name,
      advertiser_code, advertiser_name, created_at as last_activity
    from filtered
    order by batch_key, created_at desc
  ),
  stats as (
    select
      batch_key,
      count(*)::integer as orders,
      coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::integer as tickets
    from filtered
    group by batch_key
  ),
  result as (
    select
      l.batch, l.product_code, l.product_name,
      l.advertiser_code, l.advertiser_name, l.last_activity,
      s.orders, s.tickets
    from latest l
    join stats s using (batch_key)
    order by l.last_activity desc
    limit v_limit
  )
  select jsonb_build_object(
    'batches',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch', r.batch,
        'product_code', r.product_code,
        'product_name', r.product_name,
        'advertiser_code', r.advertiser_code,
        'advertiser_name', r.advertiser_name,
        'last_activity', r.last_activity,
        'orders', r.orders,
        'tickets', r.tickets
      ) order by r.last_activity desc)
      from result r
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.recent_batches(text,text,integer) from public, anon, authenticated;
grant execute on function public.recent_batches(text,text,integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Tabel Advertiser Notes
-- ---------------------------------------------------------------------------
create table public.advertiser_notes (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  -- Boleh kosong bila batch belum ditentukan. Bila diisi, selalu ternormalisasi (A33).
  batch text,
  title text not null,
  description text,
  event_at timestamptz not null,
  location text,
  -- Awal perhitungan aktivitas order/spend. Default hari ini, bisa dimundurkan manajer.
  monitor_from date not null default ((now() at time zone 'Asia/Jakarta')::date),
  deadline_at timestamptz not null,
  status text not null default 'Draft',
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint advertiser_notes_title_not_blank check (btrim(title) <> '' and length(title) <= 200),
  constraint advertiser_notes_description_length check (description is null or length(description) <= 4000),
  constraint advertiser_notes_location_length check (location is null or length(location) <= 200),
  constraint advertiser_notes_batch_normalized check (
    batch is null or (btrim(batch) <> '' and batch = public.normalize_batch(batch))
  ),
  constraint advertiser_notes_status_check check (status in ('Draft', 'Aktif', 'Selesai', 'Dibatalkan')),
  constraint advertiser_notes_deadline_after_monitor check (
    (deadline_at at time zone 'Asia/Jakarta')::date >= monitor_from
  )
);
create index advertiser_notes_scope_idx on public.advertiser_notes (advertiser_id, product_id, deadline_at);
create index advertiser_notes_deadline_idx on public.advertiser_notes (deadline_at) where archived_at is null;
create index advertiser_notes_status_idx on public.advertiser_notes (status) where archived_at is null;
create trigger advertiser_notes_set_updated_at
  before update on public.advertiser_notes
  for each row execute function public.set_updated_at();

alter table public.advertiser_notes enable row level security;
revoke all on table public.advertiser_notes from anon, authenticated;
grant all on table public.advertiser_notes to service_role;

-- ---------------------------------------------------------------------------
-- 4. Baca daftar note + ringkasan aktivitas live
-- ---------------------------------------------------------------------------
create or replace function public.advertiser_notes_page(p_actor uuid, p_filters jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_own_advertiser uuid;
  v_status text := nullif(btrim(coalesce(p_filters->>'status', '')), '');
  v_advertiser_key text := nullif(public.normalize_code(p_filters->>'advertiser_code'), '');
  v_product_key text := nullif(public.normalize_code(p_filters->>'product_code'), '');
  v_batch_key text := nullif(public.normalize_batch(p_filters->>'batch'), '');
  v_search text := nullif(btrim(coalesce(p_filters->>'q', '')), '');
  v_deadline_from date := nullif(btrim(coalesce(p_filters->>'deadline_from', '')), '')::date;
  v_deadline_to date := nullif(btrim(coalesce(p_filters->>'deadline_to', '')), '')::date;
  v_page integer := greatest(coalesce(nullif(p_filters->>'page', '')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce(nullif(p_filters->>'pageSize', '')::integer, 50), 1), 200);
  v_result jsonb;
begin
  if not public.actor_has_permission(p_actor, 'operasional.advertiser_notes') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select u.advertiser_id into v_own_advertiser from public.users u where u.id = p_actor and u.active;

  with scoped as materialized (
    select
      n.*, p.code as product_code, p.name as product_name,
      a.code as advertiser_code, a.name as advertiser_name,
      u.display_name as created_by_name
    from public.advertiser_notes n
    join public.products p on p.id = n.product_id
    join public.advertisers a on a.id = n.advertiser_id
    left join public.users u on u.id = n.created_by
    where n.archived_at is null
      and public.actor_can_product(p_actor, p.code)
      and (v_own_advertiser is null or (n.advertiser_id = v_own_advertiser and n.status <> 'Draft'))
  ),
  order_activity as (
    select
      s.id as note_id,
      count(o.order_id)::integer as orders,
      count(o.order_id) filter (where o.app_status = 'Paid')::integer as paid,
      coalesce(sum(o.quantity) filter (where o.app_status = 'Paid'), 0)::integer as tickets,
      coalesce(sum(o.gross_amount) filter (where o.app_status = 'Paid'), 0)::numeric(18,2) as omzet,
      max(o.created_at) as last_order_at
    from scoped s
    left join public.orders o
      on public.normalize_code(o.product_code) = public.normalize_code(s.product_code)
     and public.normalize_code(o.advertiser_code) = public.normalize_code(s.advertiser_code)
     and (s.batch is null or public.normalize_batch(o.batch) = s.batch)
     and o.created_at >= (s.monitor_from::timestamp at time zone 'Asia/Jakarta')
     and o.created_at <= s.deadline_at
    group by s.id
  ),
  spend_activity as (
    select
      s.id as note_id,
      count(r.id)::integer as reports,
      coalesce(sum(r.spend + round(r.spend * r.tax_percent / 100, 2)), 0)::numeric(18,2) as total_spend,
      max(r.date_to) as last_spend_date,
      max(r.created_at) as last_spend_input_at
    from scoped s
    left join public.ad_spend_reports r
      on r.advertiser_id = s.advertiser_id
     and r.product_id = s.product_id
     and (s.batch is null or r.batch = s.batch)
     and r.date_from <= (s.deadline_at at time zone 'Asia/Jakarta')::date
     and r.date_to >= s.monitor_from
    group by s.id
  ),
  enriched as materialized (
    select
      s.*,
      coalesce(o.orders, 0) as orders,
      coalesce(o.paid, 0) as paid,
      coalesce(o.tickets, 0) as tickets,
      coalesce(o.omzet, 0) as omzet,
      o.last_order_at,
      coalesce(sp.reports, 0) as spend_reports,
      coalesce(sp.total_spend, 0) as spend_total,
      sp.last_spend_date,
      sp.last_spend_input_at,
      case
        when coalesce(sp.reports, 0) > 0 then 'Spend Masuk'
        when coalesce(o.orders, 0) > 0 then 'Order Masuk, Spend Belum'
        else 'Belum Ada Aktivitas'
      end as activity_status,
      (s.deadline_at < now() and coalesce(sp.reports, 0) = 0) as overdue,
      (s.deadline_at >= now() and s.deadline_at <= now() + interval '3 days' and coalesce(sp.reports, 0) = 0) as due_soon
    from scoped s
    left join order_activity o on o.note_id = s.id
    left join spend_activity sp on sp.note_id = s.id
  ),
  filtered as materialized (
    select e.*
    from enriched e
    where (v_status is null or e.status = v_status)
      and (v_advertiser_key is null or public.normalize_code(e.advertiser_code) = v_advertiser_key)
      and (v_product_key is null or public.normalize_code(e.product_code) = v_product_key)
      and (v_batch_key is null or e.batch = v_batch_key)
      and (v_deadline_from is null or (e.deadline_at at time zone 'Asia/Jakarta')::date >= v_deadline_from)
      and (v_deadline_to is null or (e.deadline_at at time zone 'Asia/Jakarta')::date <= v_deadline_to)
      and (
        v_search is null or position(lower(v_search) in lower(concat_ws(' ',
          e.title, e.description, e.location, e.batch,
          e.product_code, e.product_name, e.advertiser_code, e.advertiser_name
        ))) > 0
      )
  ),
  paged as (
    select e.*
    from filtered e
    order by e.deadline_at asc, e.created_at desc
    limit v_page_size offset ((v_page - 1) * v_page_size)
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'description', p.description,
        'batch', p.batch,
        'event_at', p.event_at,
        'location', p.location,
        'monitor_from', p.monitor_from,
        'deadline_at', p.deadline_at,
        'status', p.status,
        'product_code', p.product_code,
        'product_name', p.product_name,
        'advertiser_code', p.advertiser_code,
        'advertiser_name', p.advertiser_name,
        'created_by_name', p.created_by_name,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'orders', p.orders,
        'paid', p.paid,
        'tickets', p.tickets,
        'omzet', p.omzet,
        'last_order_at', p.last_order_at,
        'spend_reports', p.spend_reports,
        'spend_total', p.spend_total,
        'last_spend_date', p.last_spend_date,
        'last_spend_input_at', p.last_spend_input_at,
        'activity_status', p.activity_status,
        'overdue', p.overdue,
        'due_soon', p.due_soon
      ) order by p.deadline_at asc, p.created_at desc)
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', v_page,
    'pageSize', v_page_size,
    'summary', jsonb_build_object(
      'total', (select count(*) from filtered),
      'active', (select count(*) from filtered where status = 'Aktif'),
      'overdue', (select count(*) from filtered where overdue),
      'due_soon', (select count(*) from filtered where due_soon),
      'spend_missing', (select count(*) from filtered where spend_reports = 0 and status = 'Aktif')
    ),
    'badge', (
      select count(*) from enriched e
      where e.status = 'Aktif' and (e.overdue or e.due_soon)
    )
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.advertiser_notes_page(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.advertiser_notes_page(uuid,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Tulis note (buat/edit) dan arsipkan
-- ---------------------------------------------------------------------------
create or replace function public.save_advertiser_note(
  p_actor uuid,
  p_id uuid,
  p_advertiser_code text,
  p_product_code text,
  p_batch text,
  p_title text,
  p_description text,
  p_event_at timestamptz,
  p_location text,
  p_monitor_from date,
  p_deadline_at timestamptz,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_advertiser public.advertisers;
  v_product public.products;
  v_batch text := nullif(public.normalize_batch(p_batch), '');
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_status text := coalesce(nullif(btrim(p_status), ''), 'Draft');
  v_monitor_from date := coalesce(p_monitor_from, (now() at time zone 'Asia/Jakarta')::date);
  v_existing public.advertiser_notes;
  v_existing_product_code text;
  v_row public.advertiser_notes;
  v_action text;
begin
  if not public.actor_has_permission(p_actor, 'action.manage_advertiser_notes') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_title = '' or length(v_title) > 200 then
    raise exception using errcode = 'DF011', message = 'INVALID_TITLE';
  end if;
  if v_status not in ('Draft', 'Aktif', 'Selesai', 'Dibatalkan') then
    raise exception using errcode = 'DF011', message = 'INVALID_STATUS';
  end if;
  if p_event_at is null or p_deadline_at is null then
    raise exception using errcode = 'DF011', message = 'INVALID_DATE';
  end if;
  if (p_deadline_at at time zone 'Asia/Jakarta')::date < v_monitor_from then
    raise exception using errcode = 'DF011', message = 'INVALID_DATE_RANGE';
  end if;

  select a.* into v_advertiser from public.advertisers a
   where a.code_normalized = public.normalize_code(p_advertiser_code) and a.active;
  if not found then raise exception using errcode = 'DF011', message = 'INVALID_ADVERTISER'; end if;

  select p.* into v_product from public.products p
   where p.code_normalized = public.normalize_code(p_product_code) and p.active;
  if not found then raise exception using errcode = 'DF011', message = 'INVALID_PRODUCT'; end if;
  if not public.actor_can_product(p_actor, v_product.code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if p_id is not null then
    select n.* into v_existing
      from public.advertiser_notes n
     where n.id = p_id and n.archived_at is null
     for update;
    if not found then raise exception using errcode = 'DF023', message = 'ADVERTISER_NOTE_NOT_FOUND'; end if;
    select p.code into v_existing_product_code from public.products p where p.id = v_existing.product_id;
    if not public.actor_can_product(p_actor, v_existing_product_code) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
    update public.advertiser_notes
       set advertiser_id = v_advertiser.id,
           product_id = v_product.id,
           batch = v_batch,
           title = v_title,
           description = v_description,
           event_at = p_event_at,
           location = v_location,
           monitor_from = v_monitor_from,
           deadline_at = p_deadline_at,
           status = v_status,
           updated_by = p_actor
     where id = p_id
     returning * into v_row;
    v_action := 'updated';
  else
    insert into public.advertiser_notes (
      advertiser_id, product_id, batch, title, description, event_at, location,
      monitor_from, deadline_at, status, created_by, updated_by
    ) values (
      v_advertiser.id, v_product.id, v_batch, v_title, v_description, p_event_at, v_location,
      v_monitor_from, p_deadline_at, v_status, p_actor, p_actor
    ) returning * into v_row;
    v_action := 'created';
  end if;

  return jsonb_build_object('action', v_action, 'note', to_jsonb(v_row));
end $$;
revoke all on function public.save_advertiser_note(uuid,uuid,text,text,text,text,text,timestamptz,text,date,timestamptz,text) from public, anon, authenticated;
grant execute on function public.save_advertiser_note(uuid,uuid,text,text,text,text,text,timestamptz,text,date,timestamptz,text) to service_role;

create or replace function public.archive_advertiser_note(p_actor uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_product_code text;
begin
  if not public.actor_has_permission(p_actor, 'action.manage_advertiser_notes') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select p.code into v_product_code
    from public.advertiser_notes n
    join public.products p on p.id = n.product_id
   where n.id = p_id and n.archived_at is null;
  if not found then raise exception using errcode = 'DF023', message = 'ADVERTISER_NOTE_NOT_FOUND'; end if;
  if not public.actor_can_product(p_actor, v_product_code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  update public.advertiser_notes
     set archived_at = now(), updated_by = p_actor
   where id = p_id and archived_at is null;
  return jsonb_build_object('id', p_id, 'archived', true);
end $$;
revoke all on function public.archive_advertiser_note(uuid,uuid) from public, anon, authenticated;
grant execute on function public.archive_advertiser_note(uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Laporan keuangan OTS (agregasi per batch dan per sesi + kota)
-- ---------------------------------------------------------------------------
create or replace function public.ots_finance_report(p_actor uuid, p_filters jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_from date := nullif(btrim(coalesce(p_filters->>'from', '')), '')::date;
  v_to date := nullif(btrim(coalesce(p_filters->>'to', '')), '')::date;
  v_product_key text := nullif(public.normalize_code(p_filters->>'product_code'), '');
  v_advertiser_key text := nullif(public.normalize_code(p_filters->>'advertiser_code'), '');
  v_batch_key text := nullif(public.normalize_batch(p_filters->>'batch'), '');
  v_session text := nullif(btrim(coalesce(p_filters->>'session', '')), '');
  v_city text := nullif(btrim(coalesce(p_filters->>'city', '')), '');
  v_method text := nullif(btrim(coalesce(p_filters->>'method', '')), '');
  v_collector uuid := nullif(btrim(coalesce(p_filters->>'collector', '')), '')::uuid;
  v_result jsonb;
begin
  if not public.actor_has_permission(p_actor, 'action.ots') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  with scoped as materialized (
    select
      o.order_id, o.product_code, o.product_name,
      o.effective_batch as batch, o.effective_session as session, o.effective_city as city,
      o.payment_method, o.quantity, o.gross_amount, o.ots_collected_by, o.created_at,
      least(o.quantity, (
        select count(*) from public.attendance_events e
        where e.order_id = o.order_id and e.attendance_type = 'seminar'
      ))::integer as checked_in_tickets
    from public.orders o
    where o.source = 'ots'
      and o.app_status = 'Paid'
      and public.actor_can_order(p_actor, o.product_code, o.advertiser_code)
      and (v_from is null or o.created_at >= (v_from::timestamp at time zone 'Asia/Jakarta'))
      and (v_to is null or o.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Jakarta'))
      and (v_product_key is null or public.normalize_code(o.product_code) = v_product_key)
      and (v_batch_key is null or public.normalize_batch(o.effective_batch) = v_batch_key)
      and (v_session is null or o.effective_session = v_session)
      and (v_city is null or lower(btrim(o.effective_city)) = lower(btrim(v_city)))
      and (v_method is null or o.payment_method = v_method)
      and (v_collector is null or o.ots_collected_by = v_collector)
      -- OTS tidak punya pengiklan; parameter ini dipertahankan agar bentuk filter
      -- sama dengan halaman lain. Nilai yang tidak cocok menghasilkan kosong.
      and (v_advertiser_key is null or v_advertiser_key = '__OTS__')
  ),
  per_batch as (
    select
      product_code, product_name, batch,
      count(*)::integer as transactions,
      coalesce(sum(quantity), 0)::integer as tickets,
      coalesce(sum(gross_amount), 0)::numeric(18,2) as gross_amount,
      coalesce(sum(gross_amount) filter (where payment_method = 'ots_tunai'), 0)::numeric(18,2) as tunai,
      coalesce(sum(gross_amount) filter (where payment_method = 'ots_transfer'), 0)::numeric(18,2) as transfer,
      coalesce(sum(gross_amount) filter (where payment_method = 'ots_qris'), 0)::numeric(18,2) as qris,
      coalesce(sum(checked_in_tickets), 0)::integer as checked_in_tickets
    from scoped
    group by product_code, product_name, batch
  ),
  per_session as (
    select
      product_code, product_name, batch, session, city,
      count(*)::integer as transactions,
      coalesce(sum(quantity), 0)::integer as tickets,
      coalesce(sum(gross_amount), 0)::numeric(18,2) as gross_amount,
      coalesce(sum(gross_amount) filter (where payment_method = 'ots_tunai'), 0)::numeric(18,2) as tunai,
      coalesce(sum(gross_amount) filter (where payment_method = 'ots_transfer'), 0)::numeric(18,2) as transfer,
      coalesce(sum(gross_amount) filter (where payment_method = 'ots_qris'), 0)::numeric(18,2) as qris,
      coalesce(sum(checked_in_tickets), 0)::integer as checked_in_tickets
    from scoped
    group by product_code, product_name, batch, session, city
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'transactions', (select count(*) from scoped),
      'tickets', (select coalesce(sum(quantity), 0) from scoped),
      'gross_amount', (select coalesce(sum(gross_amount), 0) from scoped),
      'avg_ticket', (
        select case when coalesce(sum(quantity), 0) = 0 then null
          else round(coalesce(sum(gross_amount), 0) / sum(quantity), 2) end
        from scoped
      ),
      'tunai', (select coalesce(sum(gross_amount) filter (where payment_method = 'ots_tunai'), 0) from scoped),
      'transfer', (select coalesce(sum(gross_amount) filter (where payment_method = 'ots_transfer'), 0) from scoped),
      'qris', (select coalesce(sum(gross_amount) filter (where payment_method = 'ots_qris'), 0) from scoped),
      'checked_in_tickets', (select coalesce(sum(checked_in_tickets), 0) from scoped)
    ),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code', b.product_code,
        'product_name', b.product_name,
        'batch', b.batch,
        'transactions', b.transactions,
        'tickets', b.tickets,
        'gross_amount', b.gross_amount,
        'tunai', b.tunai,
        'transfer', b.transfer,
        'qris', b.qris,
        'checked_in_tickets', b.checked_in_tickets
      ) order by b.product_name nulls last, b.batch nulls last)
      from per_batch b
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code', s.product_code,
        'product_name', s.product_name,
        'batch', s.batch,
        'session', s.session,
        'city', s.city,
        'transactions', s.transactions,
        'tickets', s.tickets,
        'gross_amount', s.gross_amount,
        'tunai', s.tunai,
        'transfer', s.transfer,
        'qris', s.qris,
        'checked_in_tickets', s.checked_in_tickets
      ) order by s.product_name nulls last, s.batch nulls last,
        s.city nulls last, nullif(regexp_replace(coalesce(s.session, ''), '\D', '', 'g'), '')::bigint nulls last,
        s.session nulls last)
      from per_session s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.ots_finance_report(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ots_finance_report(uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
