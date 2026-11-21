-- 20261121120000_ad_spend_cards — A87 (permintaan pengguna 21 Nov 2026): Card Report Iklan.
--
-- Satu card = satu kombinasi pengiklan + produk + batch + jenis acara. Baris budget tetap
-- disimpan di `ad_spend_reports` (satu baris = satu budget + PPN), sehingga seluruh laporan
-- lain yang sudah membaca tabel itu (Performa, Kalender Iklan, WA Bot, status) tidak berubah.
-- Halaman Report Spend membaca card, menjumlahkan semua baris, dan menghitung order sekali.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 85 $$;

-- ---------------------------------------------------------------------------
-- 1. Card (header)
-- ---------------------------------------------------------------------------
create table public.ad_spend_cards (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  batch text not null,
  event_type text,
  name text not null,
  status text not null default 'berjalan' check (status in ('berjalan', 'selesai')),
  -- Rentang tanggal tampilan. Untuk card berisi budget, RPC memakai min/max baris.
  -- Kolom ini wajib terisi untuk template dari order yang belum punya baris budget.
  date_from date,
  date_to date,
  finished_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_spend_cards_batch_normalized check (btrim(batch) <> '' and batch = public.normalize_batch(batch)),
  constraint ad_spend_cards_batch_length check (length(batch) <= 32),
  constraint ad_spend_cards_event_type_check
    check (event_type is null or event_type in ('Seminar Offline', 'Webinar Online', 'Hybrid')),
  constraint ad_spend_cards_name_length check (length(btrim(name)) between 1 and 120),
  constraint ad_spend_cards_date_range check (date_from is null or date_to is null or date_to >= date_from),
  -- Status Selesai selalu punya waktu selesai; Berjalan tidak.
  constraint ad_spend_cards_finished check ((status = 'selesai') = (finished_at is not null))
);

-- Satu card per pengiklan + produk + batch + jenis acara. `nulls not distinct` membuat
-- report lama tanpa jenis acara tetap punya satu card sendiri.
create unique index ad_spend_cards_scope_key
  on public.ad_spend_cards (advertiser_id, product_id, batch, event_type) nulls not distinct;
create index ad_spend_cards_status_idx on public.ad_spend_cards (status, updated_at desc);
create trigger ad_spend_cards_set_updated_at
  before update on public.ad_spend_cards
  for each row execute function public.set_updated_at();

alter table public.ad_spend_cards enable row level security;
revoke all on table public.ad_spend_cards from anon, authenticated;
grant all on table public.ad_spend_cards to service_role;
grant select on table public.ad_spend_cards to authenticated;
create policy ad_spend_cards_select_app_users on public.ad_spend_cards for select to authenticated using (
  public.has_permission('operasional.report_spend')
  and exists (select 1 from public.products p where p.id = product_id and public.can_access_product(p.code))
);

-- Baris budget menempel ke card. Nullable selama migrasi; trigger di bawah selalu mengisinya.
alter table public.ad_spend_reports
  add column card_id uuid references public.ad_spend_cards (id) on delete cascade;
create index ad_spend_reports_card_idx on public.ad_spend_reports (card_id, date_from, date_to);

-- ---------------------------------------------------------------------------
-- 2. Izin baru
-- ---------------------------------------------------------------------------
insert into public.app_permissions (key, name, module, description, sort_order)
values
  ('action.manage_spend', 'Kelola Card Report Iklan', 'aksi',
   'Mengubah, menandai selesai, membuka lagi, dan menghapus Card Report Iklan semua pengiklan di produk yang diakses', 45)
on conflict (key) do update
  set name = excluded.name,
      module = excluded.module,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- Manajer boleh melihat laporan spend dan mengelola card; owner/developer sudah otomatis penuh
-- lewat actor_has_permission, tetapi tetap dicatat pada matriks role agar terlihat di UI.
insert into public.app_role_permissions (role_id, permission_key)
select r, k
  from unnest(array['manajer', 'owner', 'developer']) r
  cross join unnest(array['operasional.report_spend', 'action.manage_spend']) k
 where exists (select 1 from public.app_roles a where a.id = r)
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Migrasi data lama: card per batch, 2 batch terakhir per produk + jenis acara
-- ---------------------------------------------------------------------------
-- Aktivitas batch = tanggal report terakhir ATAU tanggal order terakhir (WIB).
create temp table _ad_spend_active_batches on commit drop as
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
     -- OTS bukan iklan: pendaftaran meja tidak boleh membuat template/card.
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

-- Card dari report lama. Nilai report (tanggal, spend, pajak) tidak disentuh; hanya dibungkus.
insert into public.ad_spend_cards (
  advertiser_id, product_id, batch, event_type, name, status, date_from, date_to,
  finished_at, created_by, updated_by, created_at, updated_at
)
select r.advertiser_id, r.product_id, r.batch, r.event_type,
       left(coalesce(p.name, p.code) || ' · Batch ' || r.batch || coalesce(' · ' || r.event_type, ''), 120),
       case when ab.product_id is null then 'selesai' else 'berjalan' end,
       r.date_from, r.date_to,
       case when ab.product_id is null then now() else null end,
       r.created_by, r.updated_by, r.created_at, r.updated_at
  from (
    select r.advertiser_id, r.product_id, r.batch, r.event_type,
           (array_agg(r.created_by order by r.created_at))[1] as created_by,
           (array_agg(r.updated_by order by r.updated_at desc))[1] as updated_by,
           min(r.created_at) as created_at,
           max(r.updated_at) as updated_at,
           min(r.date_from) as date_from,
           max(r.date_to) as date_to
      from public.ad_spend_reports r
     group by r.advertiser_id, r.product_id, r.batch, r.event_type
  ) r
  join public.products p on p.id = r.product_id
  left join _ad_spend_active_batches ab
    on ab.product_id = r.product_id
   and ab.batch = r.batch
   and ab.event_type is not distinct from r.event_type
on conflict do nothing;

update public.ad_spend_reports r
   set card_id = c.id
  from public.ad_spend_cards c
 where c.advertiser_id = r.advertiser_id
   and c.product_id = r.product_id
   and c.batch = r.batch
   and c.event_type is not distinct from r.event_type
   and r.card_id is null;

-- Batch 2 terakhir yang punya order tetapi belum punya report: card template + satu baris
-- budget 0 supaya card langsung punya rentang tanggal dan bisa diisi pengiklan.
create temp table _ad_spend_active_order_scopes on commit drop as
with order_dated as (
  select a.id as advertiser_id,
         p.id as product_id,
         public.normalize_batch(o.batch) as batch,
         o.event_type,
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
         min(order_date) as first_date,
         max(order_date) as last_date
    from order_dated
   group by advertiser_id, product_id, batch, event_type
)
select os.advertiser_id, os.product_id, os.batch, os.event_type, os.first_date, os.last_date
  from order_scopes os
  join _ad_spend_active_batches ab
    on ab.product_id = os.product_id
   and ab.batch = os.batch
   and ab.event_type = os.event_type
 where not exists (
   select 1 from public.ad_spend_cards c
    where c.advertiser_id = os.advertiser_id
      and c.product_id = os.product_id
      and c.batch = os.batch
      and c.event_type is not distinct from os.event_type
 );

insert into public.ad_spend_cards (
  advertiser_id, product_id, batch, event_type, name, status, date_from, date_to,
  finished_at, created_by, updated_by, created_at, updated_at
)
select os.advertiser_id, os.product_id, os.batch, os.event_type,
       left(coalesce(p.name, p.code) || ' · Batch ' || os.batch || ' · ' || os.event_type, 120),
       'berjalan', os.first_date, os.last_date, null, null, null, now(), now()
  from _ad_spend_active_order_scopes os
  join public.products p on p.id = os.product_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Trigger kompatibilitas: baris report yang ditulis tanpa card_id (jalur lama/tes)
--    otomatis menemukan atau membuat card untuk scope-nya.
-- ---------------------------------------------------------------------------
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
      left(coalesce(v_name, 'Batch ' || new.batch), 120), 'selesai', new.date_from, new.date_to,
      now(), new.created_by, new.updated_by
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

  -- Jalur lama boleh memindahkan satu baris ke scope lain; card lama yang jadi kosong
  -- tidak boleh tertinggal sebagai card tanpa isi.
  if tg_op = 'UPDATE' and old.card_id is not null and old.card_id is distinct from new.card_id then
    delete from public.ad_spend_cards
     where id = old.card_id
       and not exists (select 1 from public.ad_spend_reports r where r.card_id = old.card_id);
  end if;

  return new;
end $$;
revoke all on function public.ad_spend_reports_set_card() from public, anon, authenticated;

create trigger ad_spend_reports_set_card
  before insert or update of advertiser_id, product_id, batch, event_type, card_id on public.ad_spend_reports
  for each row execute function public.ad_spend_reports_set_card();

-- ---------------------------------------------------------------------------
-- 5. Tulis card: header + semua baris budget secara atomik
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
  v_can_manage boolean := public.actor_has_permission(p_actor, 'action.manage_spend');
  v_product public.products;
  v_card public.ad_spend_cards;
  v_existing public.ad_spend_cards;
  v_batch text;
  v_event_type text;
  v_name text;
  v_status text;
  v_item jsonb;
  v_line_id uuid;
  v_new_id uuid;
  v_keep uuid[] := array[]::uuid[];
  v_from date;
  v_to date;
  v_spend numeric;
  v_tax numeric;
  v_count integer;
begin
  select u.advertiser_id into v_own_advertiser
    from public.users u
   where u.id = p_actor and u.active;

  if p_spends is null or jsonb_typeof(p_spends) <> 'array' then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  v_count := jsonb_array_length(p_spends);
  if v_count < 1 or v_count > 20 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_card_id is null then
    -- Buat card: tetap hanya akun advertiser (pengiklan berasal dari akun, bukan body).
    if v_own_advertiser is null or not public.actor_has_permission(p_actor, 'action.input_spend') then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
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
  else
    select * into v_card from public.ad_spend_cards where id = p_card_id for update;
    if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
    if not (v_can_manage or (
      v_own_advertiser is not null
      and v_own_advertiser = v_card.advertiser_id
      and public.actor_has_permission(p_actor, 'action.input_spend')
    )) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
    select * into v_product from public.products where id = v_card.product_id;
    if not found or not public.actor_can_product(p_actor, v_product.code) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;

    -- Scope card terkunci setelah dibuat: koreksi batch/jenis acara dilakukan dengan card baru.
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
    v_status := nullif(btrim(coalesce(p_status, '')), '');
    if v_status is null then v_status := v_card.status; end if;
    if v_status not in ('berjalan', 'selesai') then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;

    update public.ad_spend_cards
       set name = v_name,
           status = v_status,
           finished_at = case
             when v_status = 'selesai' then coalesce(v_card.finished_at, now())
             else null
           end,
           updated_by = p_actor
     where id = v_card.id
     returning * into v_card;
  end if;

  for v_item in select value from jsonb_array_elements(p_spends) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'date_from', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_item->>'date_to', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;

    v_from := (v_item->>'date_from')::date;
    v_to := (v_item->>'date_to')::date;
    v_spend := (v_item->>'spend')::numeric;
    v_tax := (v_item->>'tax_percent')::numeric;
    if v_to < v_from
       or v_spend is null or v_spend < 0 or v_spend > 9999999999
       or v_tax is null or v_tax < 0 or v_tax > 100 then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;

    v_line_id := nullif(v_item->>'id', '')::uuid;
    if v_line_id is not null then
      if v_line_id = any(v_keep) then
        raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
      end if;
      update public.ad_spend_reports
         set date_from = v_from,
             date_to = v_to,
             spend = round(v_spend, 2),
             tax_percent = round(v_tax, 2),
             updated_by = p_actor
       where id = v_line_id and card_id = v_card.id
       returning id into v_new_id;
      if v_new_id is null then
        raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND';
      end if;
      v_keep := v_keep || v_new_id;
    else
      insert into public.ad_spend_reports (
        advertiser_id, product_id, batch, event_type, date_from, date_to, spend, tax_percent, card_id, created_by, updated_by
      )
      values (
        v_card.advertiser_id, v_card.product_id, v_card.batch, v_card.event_type,
        v_from, v_to, round(v_spend, 2), round(v_tax, 2), v_card.id, p_actor, p_actor
      )
      returning id into v_new_id;
      v_keep := v_keep || v_new_id;
    end if;
  end loop;

  delete from public.ad_spend_reports
   where card_id = v_card.id and not (id = any(v_keep));

  -- Rentang card mengikuti baris budget; template dari order yang belum punya baris
  -- tetap memakai rentang order sampai pengiklan mengisi budget pertama.
  if v_count > 0 then
    update public.ad_spend_cards
       set date_from = (select min(l.date_from) from public.ad_spend_reports l where l.card_id = v_card.id),
           date_to = (select max(l.date_to) from public.ad_spend_reports l where l.card_id = v_card.id)
     where id = v_card.id
     returning * into v_card;
  end if;

  return jsonb_build_object(
    'action', case when p_card_id is null then 'created' else 'updated' end,
    'id', v_card.id,
    'name', v_card.name,
    'status', v_card.status,
    'spends', v_count
  );
end $$;

create or replace function public.delete_ad_spend_card(p_actor uuid, p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_own_advertiser uuid;
  v_can_manage boolean := public.actor_has_permission(p_actor, 'action.manage_spend');
  v_card public.ad_spend_cards;
  v_product_code text;
begin
  select * into v_card from public.ad_spend_cards where id = p_card_id for update;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  select u.advertiser_id into v_own_advertiser from public.users u where u.id = p_actor and u.active;
  if not (v_can_manage or (
    v_own_advertiser is not null
    and v_own_advertiser = v_card.advertiser_id
    and public.actor_has_permission(p_actor, 'action.input_spend')
  )) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select code into v_product_code from public.products where id = v_card.product_id;
  if v_product_code is null or not public.actor_can_product(p_actor, v_product_code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  delete from public.ad_spend_cards where id = p_card_id;
  return jsonb_build_object('id', p_card_id, 'deleted', true);
end $$;

-- Jalur lama (hapus satu baris budget). Card yang menjadi kosong ikut dibersihkan supaya
-- tidak muncul sebagai "card tanpa isi" di halaman.
create or replace function public.delete_ad_spend_report(p_actor uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_advertiser uuid := public.ad_spend_actor_advertiser(p_actor);
  v_card_id uuid;
begin
  delete from public.ad_spend_reports
   where id = p_id and advertiser_id = v_advertiser
   returning card_id into v_card_id;
  if not found then
    raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND';
  end if;
  if v_card_id is not null and not exists (
    select 1 from public.ad_spend_reports where card_id = v_card_id
  ) then
    delete from public.ad_spend_cards where id = v_card_id;
  end if;
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

revoke all on function public.delete_ad_spend_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_ad_spend_report(uuid, uuid) to service_role;

revoke all on function public.save_ad_spend_card(uuid, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.delete_ad_spend_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_ad_spend_card(uuid, uuid, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.delete_ad_spend_card(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Baca laporan: satu baris per card, order dihitung sekali per card
-- ---------------------------------------------------------------------------
create or replace function public.ad_spend_report(
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_batch text default null,
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
  v_own_advertiser uuid;
  v_can_manage boolean;
  v_result jsonb;
begin
  if not public.has_permission('operasional.report_spend') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select advertiser_id into v_own_advertiser from public.users where id = v_actor;
  v_can_manage := public.has_permission('action.manage_spend');

  with card_base as (
    select c.id, c.name, c.status, c.batch, c.event_type,
           c.advertiser_id, c.product_id, c.created_at, c.finished_at,
           c.date_from, c.date_to,
           p.code as product_code, p.name as product_name,
           a.code as advertiser_code, a.name as advertiser_name
      from public.ad_spend_cards c
      join public.products p on p.id = c.product_id
      join public.advertisers a on a.id = c.advertiser_id
     where public.actor_can_product(v_actor, p.code)
       and (p_product_code is null or p.code_normalized = public.normalize_code(p_product_code))
       and (p_advertiser_code is null or a.code_normalized = public.normalize_code(p_advertiser_code))
       and (p_batch is null or btrim(p_batch) = '' or c.batch = public.normalize_batch(btrim(p_batch)))
       and (p_event_type is null or btrim(p_event_type) = '' or c.event_type = btrim(p_event_type))
       and (
         exists (
           select 1 from public.ad_spend_reports l
            where l.card_id = c.id
              and (p_date_from is null or l.date_to >= p_date_from)
              and (p_date_to is null or l.date_from <= p_date_to)
         )
         or (
           -- Template dari order belum punya baris budget; rentang card yang dipakai.
           not exists (select 1 from public.ad_spend_reports l where l.card_id = c.id)
           and c.date_from is not null and c.date_to is not null
           and (p_date_from is null or c.date_to >= p_date_from)
           and (p_date_to is null or c.date_from <= p_date_to)
         )
       )
       -- Card Selesai yang kosong (mis. baris terakhirnya dihapus lewat jalur lama) tidak ditampilkan.
       and (c.status = 'berjalan' or exists (select 1 from public.ad_spend_reports l where l.card_id = c.id))
  ),
  card_totals as (
    select cb.id, cb.name, cb.status, cb.batch, cb.event_type,
           cb.advertiser_id, cb.product_id, cb.created_at, cb.finished_at,
           cb.product_code, cb.product_name, cb.advertiser_code, cb.advertiser_name,
           coalesce(min(l.date_from), cb.date_from) as date_from,
           coalesce(max(l.date_to), cb.date_to) as date_to,
           coalesce(sum(l.spend), 0)::numeric(18,2) as spend,
           coalesce(sum(round(l.spend * l.tax_percent / 100, 2)), 0)::numeric(18,2) as tax_amount
      from card_base cb
      left join public.ad_spend_reports l on l.card_id = cb.id
     group by cb.id, cb.name, cb.status, cb.batch, cb.event_type,
              cb.advertiser_id, cb.product_id, cb.created_at, cb.finished_at,
              cb.date_from, cb.date_to,
              cb.product_code, cb.product_name, cb.advertiser_code, cb.advertiser_name
  ),
  ranges as (
    -- Card berisi budget: satu rentang per baris (order di hari jeda tidak ikut).
    -- Card template tanpa baris budget: rentang card dari order.
    select ct.id as card_id, l.date_from, l.date_to
      from card_totals ct
      join public.ad_spend_reports l on l.card_id = ct.id
    union all
    select ct.id, ct.date_from, ct.date_to
      from card_totals ct
     where not exists (select 1 from public.ad_spend_reports l where l.card_id = ct.id)
       and ct.date_from is not null and ct.date_to is not null
  ),
  matched as (
    -- Satu baris per (card, order). Banyak baris budget dalam card yang menutupi order
    -- yang sama tetap dihitung sekali oleh per_card di bawah.
    select ct.id as card_id, o.order_id, o.app_status, o.gross_amount,
           o.quantity, o.session, o.city, o.event_type,
           ct.product_code, ct.product_name, ct.batch, ct.event_type as report_event_type,
           ct.advertiser_code, ct.advertiser_name
      from card_totals ct
      join ranges r on r.card_id = ct.id
      join public.orders o
        on public.normalize_code(o.product_code) = public.normalize_code(ct.product_code)
       and public.normalize_code(o.advertiser_code) = public.normalize_code(ct.advertiser_code)
       and public.normalize_batch(o.batch) = ct.batch
       and coalesce(o.source_created_at, o.created_at) >= (r.date_from::timestamp at time zone 'Asia/Jakarta')
       and coalesce(o.source_created_at, o.created_at) < ((r.date_to + 1)::timestamp at time zone 'Asia/Jakarta')
       and (ct.event_type is null or o.event_type = ct.event_type)
  ),
  per_card as (
    select d.card_id,
           count(*)::int as leads,
           count(*) filter (where d.app_status = 'Paid')::int as paid,
           coalesce(sum(d.quantity) filter (where d.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(d.gross_amount) filter (where d.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from (
        select distinct on (card_id, order_id)
               card_id, order_id, app_status, gross_amount, quantity
          from matched
         order by card_id, order_id
      ) d
     group by d.card_id
  ),
  card_rows as (
    select ct.*,
           coalesce(pc.leads, 0) as leads,
           coalesce(pc.paid, 0) as paid,
           coalesce(pc.tickets, 0) as tickets,
           coalesce(pc.omzet, 0)::numeric(18,2) as omzet
      from card_totals ct
      left join per_card pc on pc.card_id = ct.id
  ),
  distinct_orders as (
    select distinct on (order_id)
           order_id, app_status, gross_amount, quantity, session, city, event_type,
           product_code, product_name, batch, report_event_type,
           advertiser_code, advertiser_name
      from matched
     order by order_id
  ),
  session_cells as (
    select upper(btrim(session)) as session_key, lower(btrim(city)) as city_key, event_type,
           public.normalize_code(advertiser_code) as advertiser_key,
           max(session) as session, max(city) as city,
           max(advertiser_code) as advertiser_code, max(advertiser_name) as advertiser_name,
           sum(quantity)::int as tickets
      from distinct_orders
     where app_status = 'Paid'
     group by upper(btrim(session)), lower(btrim(city)), event_type, public.normalize_code(advertiser_code)
  ),
  session_rows as (
    select session_key, city_key, event_type, max(session) as session, max(city) as city, sum(tickets)::int as tickets
      from session_cells
     group by session_key, city_key, event_type
  ),
  session_advertisers as (
    select advertiser_key, max(advertiser_code) as advertiser_code, max(advertiser_name) as advertiser_name,
           sum(tickets)::int as tickets
      from session_cells
     group by advertiser_key
  ),
  comparison_spend as (
    select public.normalize_code(ct.product_code) as product_key,
           max(ct.product_code) as product_code,
           max(ct.product_name) as product_name,
           ct.batch,
           ct.event_type,
           public.normalize_code(ct.advertiser_code) as advertiser_key,
           max(ct.advertiser_code) as advertiser_code,
           max(ct.advertiser_name) as advertiser_name,
           sum(ct.spend)::numeric(18,2) as spend,
           sum(ct.tax_amount)::numeric(18,2) as tax_amount
      from card_rows ct
     group by public.normalize_code(ct.product_code), ct.batch, ct.event_type, public.normalize_code(ct.advertiser_code)
  ),
  comparison_orders as (
    select public.normalize_code(d.product_code) as product_key,
           d.batch,
           d.report_event_type as event_type,
           public.normalize_code(d.advertiser_code) as advertiser_key,
           count(d.order_id)::int as leads,
           count(d.order_id) filter (where d.app_status = 'Paid')::int as paid,
           coalesce(sum(d.quantity) filter (where d.app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(d.gross_amount) filter (where d.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from distinct_orders d
     group by public.normalize_code(d.product_code), d.batch, d.report_event_type, public.normalize_code(d.advertiser_code)
  ),
  comparison as (
    select s.product_code, s.product_name, s.batch, s.event_type, s.advertiser_code, s.advertiser_name,
           s.spend, s.tax_amount,
           (s.spend + s.tax_amount)::numeric(18,2) as total_spend,
           coalesce(o.leads, 0) as leads,
           coalesce(o.paid, 0) as paid,
           coalesce(o.tickets, 0) as tickets,
           coalesce(o.omzet, 0)::numeric(18,2) as omzet
      from comparison_spend s
      left join comparison_orders o
        on o.product_key = s.product_key
       and o.batch = s.batch
       and o.event_type is not distinct from s.event_type
       and o.advertiser_key = s.advertiser_key
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'reports', (select count(*) from card_rows),
      'spend', (select coalesce(sum(spend), 0) from card_rows),
      'tax_amount', (select coalesce(sum(tax_amount), 0) from card_rows),
      'total_spend', (select coalesce(sum(spend + tax_amount), 0) from card_rows),
      'leads', (select count(*) from distinct_orders),
      'paid', (select count(*) from distinct_orders where app_status = 'Paid'),
      'omzet', (select coalesce(sum(gross_amount), 0) from distinct_orders where app_status = 'Paid')
    ),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cr.id,
        'name', cr.name,
        'status', cr.status,
        'date_from', cr.date_from,
        'date_to', cr.date_to,
        'product_code', cr.product_code,
        'product_name', cr.product_name,
        'advertiser_code', cr.advertiser_code,
        'advertiser_name', cr.advertiser_name,
        'batch', cr.batch,
        'event_type', cr.event_type,
        'spend', cr.spend,
        'tax_amount', cr.tax_amount,
        'tax_percent', case when cr.spend > 0 then round(cr.tax_amount / cr.spend * 100, 2) else 0 end,
        'total_spend', cr.spend + cr.tax_amount,
        'leads', cr.leads,
        'paid', cr.paid,
        'tickets', cr.tickets,
        'omzet', cr.omzet,
        'own', v_own_advertiser is not null and cr.advertiser_id = v_own_advertiser,
        'can_edit', v_can_manage or (v_own_advertiser is not null and cr.advertiser_id = v_own_advertiser),
        'spends', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id,
            'date_from', l.date_from,
            'date_to', l.date_to,
            'spend', l.spend,
            'tax_percent', l.tax_percent,
            'tax_amount', round(l.spend * l.tax_percent / 100, 2)
          ) order by l.date_from, l.created_at, l.id)
            from public.ad_spend_reports l
           where l.card_id = cr.id
        ), '[]'::jsonb)
      ) order by cr.date_to desc nulls last, cr.date_from desc nulls last, cr.product_name, cr.batch, cr.created_at desc)
      from card_rows cr
     where cr.status = 'berjalan'
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cr.id,
        'name', cr.name,
        'status', cr.status,
        'date_from', cr.date_from,
        'date_to', cr.date_to,
        'product_code', cr.product_code,
        'product_name', cr.product_name,
        'advertiser_code', cr.advertiser_code,
        'advertiser_name', cr.advertiser_name,
        'batch', cr.batch,
        'event_type', cr.event_type,
        'spend', cr.spend,
        'tax_amount', cr.tax_amount,
        'tax_percent', case when cr.spend > 0 then round(cr.tax_amount / cr.spend * 100, 2) else 0 end,
        'total_spend', cr.spend + cr.tax_amount,
        'leads', cr.leads,
        'paid', cr.paid,
        'tickets', cr.tickets,
        'omzet', cr.omzet,
        'own', v_own_advertiser is not null and cr.advertiser_id = v_own_advertiser,
        'can_edit', v_can_manage or (v_own_advertiser is not null and cr.advertiser_id = v_own_advertiser),
        'spends', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id,
            'date_from', l.date_from,
            'date_to', l.date_to,
            'spend', l.spend,
            'tax_percent', l.tax_percent,
            'tax_amount', round(l.spend * l.tax_percent / 100, 2)
          ) order by l.date_from, l.created_at, l.id)
            from public.ad_spend_reports l
           where l.card_id = cr.id
        ), '[]'::jsonb)
      ) order by cr.date_to desc nulls last, cr.date_from desc nulls last, cr.product_name, cr.batch, cr.created_at desc)
      from card_rows cr
     where cr.status = 'selesai'
    ), '[]'::jsonb),
    'sessions', jsonb_build_object(
      'tickets', (select coalesce(sum(tickets), 0) from session_rows),
      'advertisers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'advertiser_code', sa.advertiser_code,
          'advertiser_name', sa.advertiser_name,
          'tickets', sa.tickets
        ) order by sa.advertiser_key)
        from session_advertisers sa
      ), '[]'::jsonb),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'session', s.session,
          'city', s.city,
          'event_type', s.event_type,
          'tickets', s.tickets,
          'advertisers', (
            select jsonb_agg(jsonb_build_object('advertiser_code', c.advertiser_code, 'tickets', c.tickets) order by c.advertiser_key)
              from session_cells c
             where c.session_key is not distinct from s.session_key
               and c.city_key is not distinct from s.city_key
               and c.event_type is not distinct from s.event_type
          )
        ) order by s.city_key nulls last, nullif(regexp_replace(s.session_key, '\D', '', 'g'), '')::bigint nulls last, s.session_key nulls last)
        from session_rows s
      ), '[]'::jsonb)
    ),
    'comparison', jsonb_build_object(
      'totals', jsonb_build_object(
        'spend', (select coalesce(sum(spend), 0) from comparison),
        'tax_amount', (select coalesce(sum(tax_amount), 0) from comparison),
        'total_spend', (select coalesce(sum(total_spend), 0) from comparison),
        'leads', (select coalesce(sum(leads), 0) from comparison),
        'paid', (select coalesce(sum(paid), 0) from comparison),
        'tickets', (select coalesce(sum(tickets), 0) from comparison),
        'omzet', (select coalesce(sum(omzet), 0) from comparison)
      ),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_code', c.product_code,
          'product_name', c.product_name,
          'batch', c.batch,
          'event_type', c.event_type,
          'advertiser_code', c.advertiser_code,
          'advertiser_name', c.advertiser_name,
          'spend', c.spend,
          'tax_amount', c.tax_amount,
          'total_spend', c.total_spend,
          'leads', c.leads,
          'paid', c.paid,
          'tickets', c.tickets,
          'omzet', c.omzet
        ) order by c.tickets desc, c.omzet desc, c.advertiser_name)
        from comparison c
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.ad_spend_report(date, date, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ad_spend_report(date, date, text, text, text, text) to authenticated;
