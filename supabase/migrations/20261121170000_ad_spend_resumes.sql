-- 20261121170000_ad_spend_resumes — A88: resume snapshot, draft 3 bulan, CRUD laporan harian.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 88 $$;

-- ---------------------------------------------------------------------------
-- Resume: snapshot yang tetap ada setelah card + laporan harian dihapus.
-- ---------------------------------------------------------------------------
create table public.ad_spend_resumes (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.ad_spend_cards (id) on delete set null,
  advertiser_id uuid references public.advertisers (id) on delete set null,
  advertiser_code text not null,
  advertiser_name text not null,
  product_code text not null,
  product_name text not null,
  batch text not null,
  event_type text,
  name text not null,
  date_from date not null,
  date_to date not null,
  spend numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_spend numeric(14,2) not null default 0,
  leads integer not null default 0,
  paid integer not null default 0,
  tickets integer not null default 0,
  omzet numeric(18,2) not null default 0,
  finished_at timestamptz not null,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_spend_resumes_date_range check (date_to >= date_from)
);
create unique index ad_spend_resumes_card_key on public.ad_spend_resumes (card_id);
create index ad_spend_resumes_period_idx on public.ad_spend_resumes (date_from, date_to);
create index ad_spend_resumes_frozen_idx on public.ad_spend_resumes (frozen_at, finished_at);
create trigger ad_spend_resumes_set_updated_at
  before update on public.ad_spend_resumes
  for each row execute function public.set_updated_at();

alter table public.ad_spend_resumes enable row level security;
revoke all on table public.ad_spend_resumes from anon, authenticated;
grant all on table public.ad_spend_resumes to service_role;
grant select on table public.ad_spend_resumes to authenticated;
create policy ad_spend_resumes_select_app_users on public.ad_spend_resumes for select to authenticated using (
  public.has_permission('operasional.report_spend')
  and public.can_access_product(product_code)
);

-- ---------------------------------------------------------------------------
-- Izin edit card (advertiser pemilik atau action.manage_spend)
-- ---------------------------------------------------------------------------
create or replace function public.ad_spend_actor_can_edit_card(p_actor uuid, p_card_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_card public.ad_spend_cards;
  v_own_advertiser uuid;
  v_product_code text;
begin
  select * into v_card from public.ad_spend_cards where id = p_card_id;
  if not found then return false; end if;
  select u.advertiser_id into v_own_advertiser
    from public.users u
   where u.id = p_actor and u.active;
  if not (
    public.actor_has_permission(p_actor, 'action.manage_spend')
    or (
      v_own_advertiser is not null
      and v_own_advertiser = v_card.advertiser_id
      and public.actor_has_permission(p_actor, 'action.input_spend')
    )
  ) then
    return false;
  end if;
  select p.code into v_product_code from public.products p where p.id = v_card.product_id;
  return v_product_code is not null and public.actor_can_product(p_actor, v_product_code);
end $$;
revoke all on function public.ad_spend_actor_can_edit_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ad_spend_actor_can_edit_card(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Hitung ulang snapshot resume dari laporan harian + order
-- ---------------------------------------------------------------------------
create or replace function public.refresh_ad_spend_resume(p_card_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_card public.ad_spend_cards;
  v_product public.products;
  v_advertiser public.advertisers;
  v_date_from date;
  v_date_to date;
  v_spend numeric(18,2);
  v_tax numeric(18,2);
  v_leads integer;
  v_paid integer;
  v_tickets integer;
  v_omzet numeric(18,2);
begin
  select * into v_card from public.ad_spend_cards where id = p_card_id;
  if not found then return; end if;
  select * into v_product from public.products where id = v_card.product_id;
  select * into v_advertiser from public.advertisers where id = v_card.advertiser_id;
  if v_product.id is null or v_advertiser.id is null then return; end if;

  select min(e.date_from), max(e.date_to)
    into v_date_from, v_date_to
    from public.ad_spend_report_entries e
   where e.card_id = p_card_id;
  if v_date_from is null then return; end if;

  select coalesce(sum(r.spend), 0)::numeric(18,2),
         coalesce(sum(round(r.spend * r.tax_percent / 100, 2)), 0)::numeric(18,2)
    into v_spend, v_tax
    from public.ad_spend_reports r
   where r.card_id = p_card_id;

  with ranges as (
    select e.date_from, e.date_to
      from public.ad_spend_report_entries e
     where e.card_id = p_card_id
    union all
    select r.date_from, r.date_to
      from public.ad_spend_reports r
     where r.card_id = p_card_id and r.entry_id is null
  ),
  matched as (
    select o.order_id, o.app_status, o.quantity, o.gross_amount
      from ranges r
      join public.orders o
        on public.normalize_code(o.product_code) = public.normalize_code(v_product.code)
       and public.normalize_code(o.advertiser_code) = public.normalize_code(v_advertiser.code)
       and public.normalize_batch(o.batch) = v_card.batch
       and coalesce(o.source_created_at, o.created_at) >= (r.date_from::timestamp at time zone 'Asia/Jakarta')
       and coalesce(o.source_created_at, o.created_at) < ((r.date_to + 1)::timestamp at time zone 'Asia/Jakarta')
       and (v_card.event_type is null or o.event_type = v_card.event_type)
  ),
  distinct_orders as (
    select distinct on (order_id) order_id, app_status, quantity, gross_amount
      from matched
     order by order_id
  )
  select count(*)::int,
         count(*) filter (where app_status = 'Paid')::int,
         coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int,
         coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2)
    into v_leads, v_paid, v_tickets, v_omzet
    from distinct_orders;

  insert into public.ad_spend_resumes (
    card_id, advertiser_id, advertiser_code, advertiser_name,
    product_code, product_name, batch, event_type, name,
    date_from, date_to, spend, tax_amount, total_spend,
    leads, paid, tickets, omzet, finished_at, frozen_at
  )
  values (
    v_card.id, v_card.advertiser_id, v_advertiser.code, v_advertiser.name,
    v_product.code, v_product.name, v_card.batch, v_card.event_type, v_card.name,
    v_date_from, v_date_to, v_spend, v_tax, v_spend + v_tax,
    v_leads, v_paid, v_tickets, v_omzet, coalesce(v_card.finished_at, now()), null
  )
  on conflict (card_id) do update
    set advertiser_id = excluded.advertiser_id,
        advertiser_code = excluded.advertiser_code,
        advertiser_name = excluded.advertiser_name,
        product_code = excluded.product_code,
        product_name = excluded.product_name,
        batch = excluded.batch,
        event_type = excluded.event_type,
        name = excluded.name,
        date_from = excluded.date_from,
        date_to = excluded.date_to,
        spend = excluded.spend,
        tax_amount = excluded.tax_amount,
        total_spend = excluded.total_spend,
        leads = excluded.leads,
        paid = excluded.paid,
        tickets = excluded.tickets,
        omzet = excluded.omzet,
        finished_at = excluded.finished_at,
        frozen_at = null,
        updated_at = now();
end $$;
revoke all on function public.refresh_ad_spend_resume(uuid) from public, anon, authenticated;
grant execute on function public.refresh_ad_spend_resume(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Selesai / Aktifkan
-- ---------------------------------------------------------------------------
create or replace function public.finish_ad_spend_card(p_actor uuid, p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_card public.ad_spend_cards;
begin
  select * into v_card from public.ad_spend_cards where id = p_card_id for update;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  if not public.ad_spend_actor_can_edit_card(p_actor, p_card_id) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_card.status = 'selesai' then
    return jsonb_build_object('action', 'already', 'id', v_card.id, 'status', 'selesai');
  end if;
  if not exists (select 1 from public.ad_spend_report_entries where card_id = p_card_id) then
    raise exception using errcode = 'DF029', message = 'AD_SPEND_NO_REPORTS';
  end if;

  update public.ad_spend_cards
     set status = 'selesai', finished_at = now(), updated_by = p_actor
   where id = p_card_id;
  perform public.refresh_ad_spend_resume(p_card_id);
  return jsonb_build_object('action', 'finished', 'id', p_card_id, 'status', 'selesai');
end $$;

create or replace function public.activate_ad_spend_card(p_actor uuid, p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_card public.ad_spend_cards;
begin
  select * into v_card from public.ad_spend_cards where id = p_card_id for update;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  if not public.ad_spend_actor_can_edit_card(p_actor, p_card_id) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_card.status = 'berjalan' then
    return jsonb_build_object('action', 'already', 'id', v_card.id, 'status', 'berjalan');
  end if;

  delete from public.ad_spend_resumes where card_id = p_card_id;
  update public.ad_spend_cards
     set status = 'berjalan', finished_at = null, updated_by = p_actor
   where id = p_card_id;
  return jsonb_build_object('action', 'activated', 'id', p_card_id, 'status', 'berjalan');
end $$;

-- ---------------------------------------------------------------------------
-- CRUD laporan harian
-- ---------------------------------------------------------------------------
create or replace function public.save_ad_spend_entry(
  p_actor uuid,
  p_entry_id uuid,
  p_card_id uuid,
  p_date_from date,
  p_date_to date,
  p_spends jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_card public.ad_spend_cards;
  v_entry public.ad_spend_report_entries;
  v_item jsonb;
  v_line_id uuid;
  v_new_id uuid;
  v_keep uuid[] := array[]::uuid[];
  v_spend numeric;
  v_tax numeric;
  v_count integer;
  v_card_id uuid;
begin
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if p_spends is null or jsonb_typeof(p_spends) <> 'array' then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  v_count := jsonb_array_length(p_spends);
  if v_count < 1 or v_count > 20 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_entry_id is null then
    v_card_id := p_card_id;
  else
    select * into v_entry from public.ad_spend_report_entries where id = p_entry_id for update;
    if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
    v_card_id := v_entry.card_id;
  end if;
  if v_card_id is null then raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT'; end if;

  select * into v_card from public.ad_spend_cards where id = v_card_id for update;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  if not public.ad_spend_actor_can_edit_card(p_actor, v_card_id) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_card.status <> 'berjalan' then
    raise exception using errcode = 'DF027', message = 'AD_SPEND_CARD_ARCHIVED';
  end if;

  if exists (
    select 1 from public.ad_spend_report_entries e
     where e.card_id = v_card_id
       and (p_entry_id is null or e.id <> p_entry_id)
       and daterange(e.date_from, e.date_to, '[]') && daterange(p_date_from, p_date_to, '[]')
  ) then
    raise exception using errcode = 'DF028', message = 'AD_SPEND_ENTRY_OVERLAP';
  end if;

  if p_entry_id is null then
    insert into public.ad_spend_report_entries (
      card_id, date_from, date_to, created_by, updated_by
    )
    values (v_card_id, p_date_from, p_date_to, p_actor, p_actor)
    returning * into v_entry;
  else
    update public.ad_spend_report_entries
       set date_from = p_date_from, date_to = p_date_to, updated_by = p_actor
     where id = p_entry_id
     returning * into v_entry;
  end if;

  for v_item in select value from jsonb_array_elements(p_spends) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;
    v_spend := (v_item->>'spend')::numeric;
    v_tax := (v_item->>'tax_percent')::numeric;
    if v_spend is null or v_spend < 0 or v_spend > 9999999999
       or v_tax is null or v_tax < 0 or v_tax > 100 then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;
    v_line_id := nullif(v_item->>'id', '')::uuid;
    if v_line_id is not null then
      if v_line_id = any(v_keep) then
        raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
      end if;
      update public.ad_spend_reports
         set card_id = v_card_id,
             entry_id = v_entry.id,
             date_from = p_date_from,
             date_to = p_date_to,
             spend = round(v_spend, 2),
             tax_percent = round(v_tax, 2),
             updated_by = p_actor
       where id = v_line_id and entry_id = v_entry.id
       returning id into v_new_id;
      if v_new_id is null then
        raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND';
      end if;
      v_keep := v_keep || v_new_id;
    else
      insert into public.ad_spend_reports (
        advertiser_id, product_id, batch, event_type, date_from, date_to,
        spend, tax_percent, card_id, entry_id, created_by, updated_by
      )
      values (
        v_card.advertiser_id, v_card.product_id, v_card.batch, v_card.event_type,
        p_date_from, p_date_to, round(v_spend, 2), round(v_tax, 2),
        v_card_id, v_entry.id, p_actor, p_actor
      )
      returning id into v_new_id;
      v_keep := v_keep || v_new_id;
    end if;
  end loop;

  delete from public.ad_spend_reports
   where entry_id = v_entry.id and id <> all(v_keep);

  update public.ad_spend_cards
     set date_from = (select min(e.date_from) from public.ad_spend_report_entries e where e.card_id = v_card_id),
         date_to = (select max(e.date_to) from public.ad_spend_report_entries e where e.card_id = v_card_id)
   where id = v_card_id;

  return jsonb_build_object(
    'action', case when p_entry_id is null then 'created' else 'updated' end,
    'id', v_entry.id,
    'card_id', v_card_id,
    'date_from', v_entry.date_from,
    'date_to', v_entry.date_to,
    'spends', v_count
  );
end $$;

create or replace function public.delete_ad_spend_entry(p_actor uuid, p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_entry public.ad_spend_report_entries;
  v_card public.ad_spend_cards;
begin
  select * into v_entry from public.ad_spend_report_entries where id = p_entry_id for update;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  select * into v_card from public.ad_spend_cards where id = v_entry.card_id for update;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  if not public.ad_spend_actor_can_edit_card(p_actor, v_card.id) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_card.status <> 'berjalan' then
    raise exception using errcode = 'DF027', message = 'AD_SPEND_CARD_ARCHIVED';
  end if;

  delete from public.ad_spend_report_entries where id = p_entry_id;

  update public.ad_spend_cards
     set date_from = (select min(e.date_from) from public.ad_spend_report_entries e where e.card_id = v_card.id),
         date_to = (select max(e.date_to) from public.ad_spend_report_entries e where e.card_id = v_card.id)
   where id = v_card.id;

  return jsonb_build_object('id', p_entry_id, 'deleted', true);
end $$;

-- ---------------------------------------------------------------------------
-- Card: setting saja; p_spends/p_status dipertahankan di signature untuk
-- kompatibilitas tetapi tidak dipakai.
-- ---------------------------------------------------------------------------
create or replace function public.save_ad_spend_card(
  p_actor uuid,
  p_card_id uuid,
  p_name text,
  p_product_code text,
  p_batch text,
  p_event_type text,
  p_status text,
  p_spends jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_own_advertiser uuid;
  v_product public.products;
  v_card public.ad_spend_cards;
  v_existing public.ad_spend_cards;
  v_batch text;
  v_event_type text;
  v_name text;
begin
  if p_card_id is null then
    v_own_advertiser := public.ad_spend_actor_advertiser(p_actor);
    v_batch := public.normalize_batch(nullif(btrim(coalesce(p_batch, '')), ''));
    v_event_type := nullif(btrim(coalesce(p_event_type, '')), '');
    if v_batch is null or length(v_batch) > 32
       or v_event_type is null or v_event_type not in ('Seminar Offline', 'Webinar Online', 'Hybrid') then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;
    select * into v_product from public.products
     where code_normalized = public.normalize_code(p_product_code) and active;
    if not found then raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT'; end if;
    if not public.actor_can_product(p_actor, v_product.code) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      'ad_spend_card:' || v_own_advertiser || ':' || v_product.id || ':' || v_batch || ':' || v_event_type, 0
    ));
    select * into v_existing from public.ad_spend_cards
     where advertiser_id = v_own_advertiser
       and product_id = v_product.id
       and batch = v_batch
       and event_type = v_event_type;
    if found then
      return jsonb_build_object(
        'action', 'existing', 'id', v_existing.id, 'name', v_existing.name, 'status', v_existing.status
      );
    end if;

    v_name := nullif(btrim(coalesce(p_name, '')), '');
    if v_name is null then
      v_name := left(v_product.name || ' · Batch ' || v_batch || ' · ' || v_event_type, 120);
    end if;
    if length(v_name) > 120 then raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT'; end if;

    insert into public.ad_spend_cards (
      advertiser_id, product_id, batch, event_type, name, status, finished_at, created_by, updated_by
    )
    values (v_own_advertiser, v_product.id, v_batch, v_event_type, v_name, 'berjalan', null, p_actor, p_actor)
    returning * into v_card;

    return jsonb_build_object('action', 'created', 'id', v_card.id, 'name', v_card.name, 'status', v_card.status);
  end if;

  select * into v_card from public.ad_spend_cards where id = p_card_id for update;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  if not public.ad_spend_actor_can_edit_card(p_actor, p_card_id) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_card.status <> 'berjalan' then
    raise exception using errcode = 'DF027', message = 'AD_SPEND_CARD_ARCHIVED';
  end if;
  select * into v_product from public.products where id = v_card.product_id;
  if not found then raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT'; end if;

  if p_product_code is not null and public.normalize_code(p_product_code) <> v_product.code_normalized then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if p_batch is not null and public.normalize_batch(btrim(p_batch)) <> v_card.batch then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if p_event_type is not null and nullif(btrim(p_event_type), '') is distinct from v_card.event_type then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then v_name := v_card.name; end if;
  if length(v_name) > 120 then raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT'; end if;

  update public.ad_spend_cards
     set name = v_name, updated_by = p_actor
   where id = p_card_id
   returning * into v_card;

  return jsonb_build_object(
    'action', 'updated', 'id', v_card.id, 'name', v_card.name, 'status', v_card.status
  );
end $$;

create or replace function public.delete_ad_spend_card(p_actor uuid, p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_card public.ad_spend_cards;
begin
  select * into v_card from public.ad_spend_cards where id = p_card_id for update;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  if not public.ad_spend_actor_can_edit_card(p_actor, p_card_id) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_card.status <> 'berjalan' then
    raise exception using errcode = 'DF027', message = 'AD_SPEND_CARD_ARCHIVED';
  end if;
  delete from public.ad_spend_resumes where card_id = p_card_id;
  delete from public.ad_spend_cards where id = p_card_id;
  return jsonb_build_object('id', p_card_id, 'deleted', true);
end $$;

-- ---------------------------------------------------------------------------
-- Jalur lama: hapus satu baris budget + bersihkan entry/card kosong
-- ---------------------------------------------------------------------------
create or replace function public.delete_ad_spend_report(p_actor uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_advertiser uuid := public.ad_spend_actor_advertiser(p_actor);
  v_card_id uuid;
  v_entry_id uuid;
  v_card_status text;
begin
  select c.status into v_card_status
    from public.ad_spend_reports r
    join public.ad_spend_cards c on c.id = r.card_id
   where r.id = p_id and r.advertiser_id = v_advertiser;
  if v_card_status = 'selesai' then
    raise exception using errcode = 'DF027', message = 'AD_SPEND_CARD_ARCHIVED';
  end if;

  delete from public.ad_spend_reports
   where id = p_id and advertiser_id = v_advertiser
   returning card_id, entry_id into v_card_id, v_entry_id;
  if not found then
    raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND';
  end if;

  if v_entry_id is not null
     and not exists (select 1 from public.ad_spend_reports where entry_id = v_entry_id) then
    delete from public.ad_spend_report_entries where id = v_entry_id;
  end if;
  if v_card_id is not null
     and not exists (select 1 from public.ad_spend_report_entries where card_id = v_card_id) then
    delete from public.ad_spend_cards where id = v_card_id;
  end if;

  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

-- ---------------------------------------------------------------------------
-- Blokir perubahan baris budget pada card yang sudah Selesai.
-- ---------------------------------------------------------------------------
create or replace function public.ad_spend_reports_block_finished() returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_card_id uuid := coalesce(new.card_id, old.card_id);
  v_status text;
begin
  if v_card_id is null then return new; end if;
  select status into v_status from public.ad_spend_cards where id = v_card_id;
  if v_status = 'selesai' then
    raise exception using errcode = 'DF027', message = 'AD_SPEND_CARD_ARCHIVED';
  end if;
  return new;
end $$;
revoke all on function public.ad_spend_reports_block_finished() from public, anon, authenticated;
create trigger ad_spend_reports_block_finished
  before insert or update on public.ad_spend_reports
  for each row execute function public.ad_spend_reports_block_finished();

-- Trigger card lama: card baru dari jalur lama dibuat Berjalan, bukan Selesai.
create or replace function public.ad_spend_reports_set_card() returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_card public.ad_spend_cards;
  v_name text;
begin
  if new.card_id is not null then
    select * into v_card from public.ad_spend_cards where id = new.card_id;
    if found
       and v_card.advertiser_id = new.advertiser_id
       and v_card.product_id = new.product_id
       and v_card.batch = new.batch
       and v_card.event_type is not distinct from new.event_type then
      return new;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ad_spend_card:' || new.advertiser_id || ':' || new.product_id || ':' || new.batch || ':' || coalesce(new.event_type, ''), 0
  ));

  select * into v_card
    from public.ad_spend_cards
   where advertiser_id = new.advertiser_id
     and product_id = new.product_id
     and batch = new.batch
     and event_type is not distinct from new.event_type;

  if found and v_card.status = 'selesai' then
    raise exception using errcode = 'DF027', message = 'AD_SPEND_CARD_ARCHIVED';
  end if;

  if not found then
    select coalesce(p.name, p.code) || ' · Batch ' || new.batch || coalesce(' · ' || new.event_type, '')
      into v_name
      from public.products p
     where p.id = new.product_id;

    insert into public.ad_spend_cards (
      advertiser_id, product_id, batch, event_type, name, status, date_from, date_to,
      finished_at, created_by, updated_by
    )
    values (
      new.advertiser_id, new.product_id, new.batch, new.event_type,
      left(coalesce(v_name, 'Batch ' || new.batch), 120), 'berjalan', new.date_from, new.date_to,
      null, new.created_by, new.updated_by
    )
    on conflict do nothing
    returning * into v_card;

    if not found then
      select * into v_card
        from public.ad_spend_cards
       where advertiser_id = new.advertiser_id
         and product_id = new.product_id
         and batch = new.batch
         and event_type is not distinct from new.event_type;
    end if;
  end if;

  new.card_id := v_card.id;

  if tg_op = 'UPDATE' and old.card_id is not null and old.card_id is distinct from new.card_id then
    delete from public.ad_spend_cards
     where id = old.card_id
       and not exists (select 1 from public.ad_spend_reports r where r.card_id = old.card_id);
  end if;

  return new;
end $$;
revoke all on function public.ad_spend_reports_set_card() from public, anon, authenticated;

revoke all on function public.finish_ad_spend_card(uuid, uuid),
  public.activate_ad_spend_card(uuid, uuid),
  public.save_ad_spend_entry(uuid, uuid, uuid, date, date, jsonb),
  public.delete_ad_spend_entry(uuid, uuid),
  public.save_ad_spend_card(uuid, uuid, text, text, text, text, text, jsonb),
  public.delete_ad_spend_card(uuid, uuid),
  public.delete_ad_spend_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_ad_spend_card(uuid, uuid),
  public.activate_ad_spend_card(uuid, uuid),
  public.save_ad_spend_entry(uuid, uuid, uuid, date, date, jsonb),
  public.delete_ad_spend_entry(uuid, uuid),
  public.save_ad_spend_card(uuid, uuid, text, text, text, text, text, jsonb),
  public.delete_ad_spend_card(uuid, uuid),
  public.delete_ad_spend_report(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Retensi draft 3 bulan: card + laporan harian dihapus, resume dibekukan.
-- ---------------------------------------------------------------------------
create or replace function public.purge_ad_spend_drafts()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_ids uuid[] := '{}'::uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[])
    into v_ids
    from (
      select id
        from public.ad_spend_cards
       where status = 'selesai'
         and finished_at is not null
         and finished_at < now() - interval '3 months'
       for update
    ) x;

  if cardinality(v_ids) = 0 then return 0; end if;

  update public.ad_spend_resumes
     set frozen_at = coalesce(frozen_at, now()),
         updated_at = now()
   where card_id = any(v_ids);

  delete from public.ad_spend_cards where id = any(v_ids);
  return cardinality(v_ids);
end $$;
revoke all on function public.purge_ad_spend_drafts() from public, anon, authenticated;
grant execute on function public.purge_ad_spend_drafts() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'dvflow_ad_spend_purge') then
      perform cron.unschedule('dvflow_ad_spend_purge');
    end if;
    perform cron.schedule(
      'dvflow_ad_spend_purge',
      '0 19 * * *',
      $cron$select public.purge_ad_spend_drafts()$cron$
    );
  else
    raise warning 'pg_cron tidak tersedia: purge draft Report Spend TIDAK dijadwalkan.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill resume untuk card yang sudah Selesai
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.ad_spend_cards where status = 'selesai' loop
    perform public.refresh_ad_spend_resume(v_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Transisi satu kali: card untuk 2 batch terakhir per produk + jenis acara,
-- hanya advertiser yang memegang produk DAN punya report/lead di batch itu.
-- ---------------------------------------------------------------------------
create temp table _a88_active_batches on commit drop as
with report_activity as (
  select r.product_id, r.batch, r.event_type, max(r.date_to) as activity_date
    from public.ad_spend_reports r
   group by r.product_id, r.batch, r.event_type
),
order_dated as (
  select p.id as product_id,
         public.normalize_batch(o.batch) as batch,
         o.event_type,
         (coalesce(o.source_created_at, o.created_at) at time zone 'Asia/Jakarta')::date as order_date
    from public.orders o
    join public.products p on p.code_normalized = public.normalize_code(o.product_code)
   where o.product_parse_status = 'valid'
     and o.advertiser_code is not null
     and o.batch is not null
     and coalesce(o.source, 'orderonline') <> 'ots'
),
order_activity as (
  select product_id, batch, event_type, max(order_date) as activity_date
    from order_dated
   group by product_id, batch, event_type
),
batch_activity as (
  select product_id, batch, event_type, max(activity_date) as activity_date
    from (select * from report_activity union all select * from order_activity) a
   group by product_id, batch, event_type
),
ranked as (
  select product_id, batch, event_type,
         row_number() over (
           partition by product_id, event_type
           order by activity_date desc, batch desc
         ) as rn
    from batch_activity
)
select product_id, batch, event_type
  from ranked
 where rn <= 2;

create temp table _a88_transition_scopes on commit drop as
with report_scopes as (
  select r.advertiser_id, r.product_id, r.batch, r.event_type,
         min(r.date_from) as report_from, max(r.date_to) as report_to
    from public.ad_spend_reports r
   where r.event_type is not null
   group by r.advertiser_id, r.product_id, r.batch, r.event_type
),
order_dated as (
  select a.id as advertiser_id, p.id as product_id,
         public.normalize_batch(o.batch) as batch, o.event_type,
         (coalesce(o.source_created_at, o.created_at) at time zone 'Asia/Jakarta')::date as order_date
    from public.orders o
    join public.products p on p.code_normalized = public.normalize_code(o.product_code)
    join public.advertisers a on a.code_normalized = public.normalize_code(o.advertiser_code)
   where o.product_parse_status = 'valid'
     and o.advertiser_code is not null
     and o.batch is not null
     and o.event_type is not null
     and coalesce(o.source, 'orderonline') <> 'ots'
),
order_scopes as (
  select advertiser_id, product_id, batch, event_type,
         min(order_date) as order_from, max(order_date) as order_to
    from order_dated
   group by advertiser_id, product_id, batch, event_type
),
scopes as (
  select coalesce(r.advertiser_id, o.advertiser_id) as advertiser_id,
         coalesce(r.product_id, o.product_id) as product_id,
         coalesce(r.batch, o.batch) as batch,
         coalesce(r.event_type, o.event_type) as event_type,
         least(r.report_from, o.order_from) as date_from,
         greatest(r.report_to, o.order_to) as date_to
    from report_scopes r
    full join order_scopes o
      on o.advertiser_id = r.advertiser_id
     and o.product_id = r.product_id
     and o.batch = r.batch
     and o.event_type = r.event_type
)
select s.*
  from scopes s
  join _a88_active_batches b
    on b.product_id = s.product_id
   and b.batch = s.batch
   and b.event_type = s.event_type
  join public.product_advertisers pa
    on pa.product_id = s.product_id
   and pa.advertiser_id = s.advertiser_id
 where s.date_from is not null
   and s.date_to is not null
   and not exists (
     select 1 from public.ad_spend_cards c
      where c.advertiser_id = s.advertiser_id
        and c.product_id = s.product_id
        and c.batch = s.batch
        and c.event_type = s.event_type
   );

insert into public.ad_spend_cards (
  advertiser_id, product_id, batch, event_type, name, status,
  date_from, date_to, finished_at, created_at, updated_at
)
select s.advertiser_id, s.product_id, s.batch, s.event_type,
       left(coalesce(p.name, p.code) || ' · Batch ' || s.batch || ' · ' || s.event_type, 120),
       'berjalan', s.date_from, s.date_to, null, now(), now()
  from _a88_transition_scopes s
  join public.products p on p.id = s.product_id
on conflict do nothing;
