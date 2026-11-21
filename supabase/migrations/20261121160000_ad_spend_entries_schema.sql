-- 20261121160000_ad_spend_entries_schema — A88: level "Laporan harian" di antara Card dan budget.
--
-- Satu card bisa punya banyak entry (laporan harian). Tiap entry bisa punya banyak baris
-- budget (`ad_spend_reports`) dengan PPN masing-masing. Entry tidak boleh bertumpuk dalam
-- satu card, sehingga order dihitung sekali per laporan.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 87 $$;

create extension if not exists btree_gist;

create table public.ad_spend_report_entries (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.ad_spend_cards (id) on delete cascade,
  date_from date not null,
  date_to date not null,
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_spend_report_entries_date_range check (date_to >= date_from)
);
create index ad_spend_report_entries_card_idx
  on public.ad_spend_report_entries (card_id, date_from, date_to);
create trigger ad_spend_report_entries_set_updated_at
  before update on public.ad_spend_report_entries
  for each row execute function public.set_updated_at();

alter table public.ad_spend_report_entries enable row level security;
revoke all on table public.ad_spend_report_entries from anon, authenticated;
grant all on table public.ad_spend_report_entries to service_role;
grant select on table public.ad_spend_report_entries to authenticated;
create policy ad_spend_report_entries_select_app_users on public.ad_spend_report_entries for select to authenticated using (
  public.has_permission('operasional.report_spend')
  and exists (
    select 1 from public.ad_spend_cards c
    join public.products p on p.id = c.product_id
    where c.id = card_id and public.can_access_product(p.code)
  )
);

alter table public.ad_spend_reports
  add column entry_id uuid references public.ad_spend_report_entries (id) on delete cascade;
create index ad_spend_reports_entry_idx on public.ad_spend_reports (entry_id, date_from, date_to);

-- ---------------------------------------------------------------------------
-- Backfill: baris budget lama -> entry, dikelompokkan per card menurut rentang
-- tanggal yang bertumpuk/bersambung. Baris dengan tanggal sama (2 akun) jadi satu
-- laporan; rentang terpisah tetap menjadi laporan terpisah.
-- ---------------------------------------------------------------------------
create temp table _ad_spend_entry_groups on commit drop as
with ordered as (
  select r.id as line_id, r.card_id, r.date_from, r.date_to,
         r.created_at, r.updated_at, r.created_by, r.updated_by,
         max(r.date_to) over (
           partition by r.card_id
           order by r.date_from, r.date_to, r.id
           rows between unbounded preceding and 1 preceding
         ) as prev_max
    from public.ad_spend_reports r
   where r.card_id is not null
),
grouped as (
  select o.*,
         sum(case when o.prev_max is null or o.date_from > o.prev_max then 1 else 0 end)
           over (
             partition by o.card_id
             order by o.date_from, o.date_to, o.line_id
             rows between unbounded preceding and current row
           ) as grp
    from ordered o
)
select card_id, grp,
       min(date_from) as date_from,
       max(date_to) as date_to,
       min(created_at) as created_at,
       max(updated_at) as updated_at,
       (array_agg(created_by order by created_at, line_id))[1] as created_by,
       (array_agg(updated_by order by updated_at desc, line_id))[1] as updated_by,
       array_agg(line_id) as line_ids
  from grouped
 group by card_id, grp;

create temp table _ad_spend_entry_ids on commit drop as
select gen_random_uuid() as id, card_id, date_from, date_to,
       created_at, updated_at, created_by, updated_by, line_ids
  from _ad_spend_entry_groups;

insert into public.ad_spend_report_entries (
  id, card_id, date_from, date_to, created_by, updated_by, created_at, updated_at
)
select id, card_id, date_from, date_to, created_by, updated_by, created_at, updated_at
  from _ad_spend_entry_ids;

update public.ad_spend_reports r
   set entry_id = e.id
  from _ad_spend_entry_ids e
 where r.id = any(e.line_ids);

alter table public.ad_spend_report_entries
  add constraint ad_spend_report_entries_no_overlap
  exclude using gist (card_id with =, daterange(date_from, date_to, '[]') with &&);

-- ---------------------------------------------------------------------------
-- Trigger kompatibilitas: baris yang ditulis tanpa entry_id (jalur lama/tes)
-- otomatis masuk ke entry dengan tanggal yang sama, atau entry baru.
-- Trigger `ad_spend_reports_set_card` berjalan lebih dulu (nama berurutan).
-- ---------------------------------------------------------------------------
create or replace function public.ad_spend_reports_set_entry() returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_entry public.ad_spend_report_entries;
begin
  if new.entry_id is not null then
    select * into v_entry
      from public.ad_spend_report_entries
     where id = new.entry_id and card_id = new.card_id;
    if found and v_entry.date_from <= new.date_from and v_entry.date_to >= new.date_to then
      return new;
    end if;
  end if;

  if new.card_id is null then
    return new;
  end if;

  select * into v_entry
    from public.ad_spend_report_entries
   where card_id = new.card_id
     and date_from = new.date_from
     and date_to = new.date_to
   limit 1;

  if not found then
    select * into v_entry
      from public.ad_spend_report_entries
     where card_id = new.card_id
       and daterange(date_from, date_to, '[]') && daterange(new.date_from, new.date_to, '[]')
     limit 1;
  end if;

  if not found then
    insert into public.ad_spend_report_entries (
      card_id, date_from, date_to, created_by, updated_by
    )
    values (new.card_id, new.date_from, new.date_to, new.created_by, new.updated_by)
    returning * into v_entry;
  else
    -- Jalur lama bisa menambah report yang bertumpuk ("Tambahkan Data Ini").
    -- Perluas entry yang sama agar seluruh baris tetap tercakup.
    if v_entry.date_from > new.date_from or v_entry.date_to < new.date_to then
      update public.ad_spend_report_entries
         set date_from = least(v_entry.date_from, new.date_from),
             date_to = greatest(v_entry.date_to, new.date_to)
       where id = v_entry.id
       returning * into v_entry;
    end if;
  end if;

  new.entry_id := v_entry.id;
  return new;
end $$;
revoke all on function public.ad_spend_reports_set_entry() from public, anon, authenticated;

create trigger ad_spend_reports_set_entry
  before insert on public.ad_spend_reports
  for each row execute function public.ad_spend_reports_set_entry();
