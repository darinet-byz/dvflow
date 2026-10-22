-- 0048_ad_spend_reports — A37 (permintaan pengguna 22 Okt 2026): Report Spend Iklan.
-- Pengiklan melaporkan biaya iklan per BATCH untuk satu rentang tanggal (biasanya H-1, kadang dirapel).
-- Leads/Paid/Omzet TIDAK disimpan: selalu dihitung live dari orders pada rentang tanggal order (WIB, A24)
-- yang sama, dengan produk + kode pengiklan + batch (normalize_batch, A33) yang sama.
-- Input hanya akun Advertiser (pengiklannya sendiri); role lain hanya melihat lewat izin di Konfigurasi Role.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 48 $$;

create table public.ad_spend_reports (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  batch text not null,
  date_from date not null,
  date_to date not null,
  -- Spend SEBELUM PPN. PPN iklan berbeda per akun iklan, jadi diisi pengiklan per report (persen, 11 = 11%).
  spend numeric(14, 2) not null,
  tax_percent numeric(5, 2) not null default 0,
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Batch disimpan sudah dinormalisasi supaya `0122` dan `122` adalah report yang sama (A33).
  constraint ad_spend_reports_batch_normalized check (btrim(batch) <> '' and batch = public.normalize_batch(batch)),
  constraint ad_spend_reports_date_range check (date_to >= date_from),
  constraint ad_spend_reports_spend_range check (spend >= 0 and spend <= 9999999999),
  constraint ad_spend_reports_tax_percent_range check (tax_percent >= 0 and tax_percent <= 100)
);
create index ad_spend_reports_scope_idx on public.ad_spend_reports (advertiser_id, product_id, batch, date_from, date_to);
create index ad_spend_reports_dates_idx on public.ad_spend_reports (date_from, date_to);
create trigger ad_spend_reports_set_updated_at
  before update on public.ad_spend_reports
  for each row execute function public.set_updated_at();

-- Order dicocokkan lewat kode ternormalisasi + normalize_batch(); indeks ekspresi untuk agregasi report.
create index if not exists orders_report_spend_idx
  on public.orders (public.normalize_code(product_code), public.normalize_code(advertiser_code), public.normalize_batch(batch));

-- Izin. Input hanya bermakna untuk akun yang memegang pengiklan (A20), jadi dibatasi ke role advertiser.
insert into public.app_permissions (key, name, module, description, sort_order)
values
  ('operasional.report_spend', 'Report Spend Iklan', 'operasional', 'Melihat laporan biaya iklan per batch beserta leads, paid, dan omzet', 7),
  ('action.input_spend', 'Input Biaya Iklan', 'aksi', 'Menginput, mengedit, dan menghapus laporan biaya iklan pengiklannya sendiri (khusus role Advertiser)', 44)
on conflict (key) do nothing;
insert into public.app_role_permissions (role_id, permission_key)
select 'advertiser', k from unnest(array['operasional.report_spend', 'action.input_spend']) k
where exists (select 1 from public.app_roles where id = 'advertiser')
on conflict (role_id, permission_key) do nothing;

-- RLS: hanya baca. Semua tulis lewat Worker (service_role) + RPC di bawah.
alter table public.ad_spend_reports enable row level security;
revoke all on table public.ad_spend_reports from anon, authenticated;
grant all on table public.ad_spend_reports to service_role;
grant select on public.ad_spend_reports to authenticated;
create policy ad_spend_reports_select_app_users on public.ad_spend_reports for select to authenticated using (
  public.has_permission('operasional.report_spend')
  and exists (select 1 from public.products p where p.id = product_id and public.can_access_product(p.code))
  and (public.current_advertiser_id() is null or advertiser_id = public.current_advertiser_id())
);

-- Dropdown produk/pengiklan di halaman report dibaca lewat RLS tabel konfigurasi.
create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'action.ots','operasional.report_spend',
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;

-- Produk/pengiklan yang punya report spend tidak boleh dihapus/diganti kodenya: report mencocokkan
-- order lewat kode, jadi mengganti kode akan memutus hubungan report dengan ordernya.
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
    union all
    -- A37: report spend iklan.
    select p.code, a.code, null, null, null
      from public.ad_spend_reports r
      join public.products p on p.id = r.product_id
      join public.advertisers a on a.id = r.advertiser_id
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

-- Konfigurasi Role: "Input Biaya Iklan" hanya untuk role advertiser, dan tidak ikut diberikan otomatis
-- ke role penuh (developer/owner tidak memegang pengiklan, jadi tidak bisa menginput).
CREATE OR REPLACE FUNCTION public.save_role_permissions(p_actor uuid, p_role text, p_permissions text[], p_create boolean DEFAULT false, p_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare v_role public.app_roles;
begin
  if not public.actor_has_permission(p_actor, 'config.roles') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_permissions is null or exists (
    select 1 from unnest(p_permissions) k where k is null or not exists (select 1 from public.app_permissions p where p.key = k)
  ) then raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION'; end if;
  -- A30: Tampilan Apps Lapangan hanya untuk role lapangan.
  if 'ui.field_app' = any(p_permissions) and p_role not in ('pimpro', 'member') then
    raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION';
  end if;
  -- A37: Input Biaya Iklan hanya untuk role Advertiser.
  if 'action.input_spend' = any(p_permissions) and p_role <> 'advertiser' then
    raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION';
  end if;
  if p_create then
    if p_role !~ '^[a-z0-9_]{3,32}$' or length(btrim(p_name)) not between 2 and 64 or p_name is null then
      raise exception using errcode = 'DF011', message = 'INVALID_ROLE';
    end if;
    insert into public.app_roles(id,name,description,is_system) values(p_role,btrim(p_name),p_description,false);
  end if;
  select * into v_role from public.app_roles where id = p_role for update;
  if not found then raise exception using errcode = 'DF011', message = 'ROLE_NOT_FOUND'; end if;
  delete from public.app_role_permissions where role_id = p_role;
  -- Full-access system roles cannot accidentally lock themselves out.
  if p_role in ('developer','owner') then
    insert into public.app_role_permissions select p_role, key from public.app_permissions
      where key not in ('ui.field_app', 'action.input_spend');
  else
    insert into public.app_role_permissions select p_role, k from (select distinct unnest(p_permissions) k) keys;
  end if;
  return to_jsonb(v_role);
end $function$;
revoke all on function public.save_role_permissions(uuid,text,text[],boolean,text,text) from public, anon, authenticated;
grant execute on function public.save_role_permissions(uuid,text,text[],boolean,text,text) to service_role;

-- Pengiklan aktor untuk input. actor_has_permission memberi semua izin ke developer/owner, maka
-- pengiklan yang terisi adalah syarat tambahan: tanpa pengiklan, tidak ada input.
create or replace function public.ad_spend_actor_advertiser(p_actor uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_advertiser uuid;
begin
  if not public.actor_has_permission(p_actor, 'action.input_spend') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select u.advertiser_id into v_advertiser from public.users u where u.id = p_actor and u.active;
  if v_advertiser is null then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  return v_advertiser;
end $$;

-- Buat (p_id null) atau edit (p_id terisi) report spend milik pengiklan aktor.
-- Rentang tanggal yang bertumpuk dengan report produk + batch + pengiklan yang sama ditolak (DF016)
-- kecuali p_confirm_overlap = true ("Tambahkan Data Ini").
create or replace function public.save_ad_spend_report(
  p_actor uuid,
  p_id uuid,
  p_product_code text,
  p_batch text,
  p_date_from date,
  p_date_to date,
  p_spend numeric,
  p_tax_percent numeric,
  p_confirm_overlap boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_advertiser uuid := public.ad_spend_actor_advertiser(p_actor);
  v_batch text := public.normalize_batch(nullif(btrim(coalesce(p_batch, '')), ''));
  v_product public.products;
  v_existing public.ad_spend_reports;
  v_row public.ad_spend_reports;
begin
  if v_batch is null or length(v_batch) > 32 or p_date_from is null or p_date_to is null or p_date_to < p_date_from
     or p_spend is null or p_spend < 0 or p_spend > 9999999999
     or p_tax_percent is null or p_tax_percent < 0 or p_tax_percent > 100 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  select * into v_product from public.products
   where code_normalized = public.normalize_code(p_product_code) and active;
  if not found then raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT'; end if;
  if not public.actor_can_product(p_actor, v_product.code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if p_id is not null then
    select * into v_existing from public.ad_spend_reports where id = p_id for update;
    -- Report pengiklan lain diperlakukan sama dengan tidak ada: tidak membocorkan keberadaannya.
    if not found or v_existing.advertiser_id <> v_advertiser then
      raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND';
    end if;
  end if;

  -- Dua input bersamaan untuk kombinasi yang sama tidak boleh sama-sama lolos cek tumpang tindih.
  perform pg_advisory_xact_lock(hashtextextended('ad_spend:' || v_advertiser || ':' || v_product.id || ':' || v_batch, 0));
  if not coalesce(p_confirm_overlap, false) and exists (
    select 1 from public.ad_spend_reports r
     where r.advertiser_id = v_advertiser and r.product_id = v_product.id and r.batch = v_batch
       and (p_id is null or r.id <> p_id)
       and daterange(r.date_from, r.date_to, '[]') && daterange(p_date_from, p_date_to, '[]')
  ) then
    raise exception using errcode = 'DF016', message = 'AD_SPEND_OVERLAP';
  end if;

  if p_id is null then
    insert into public.ad_spend_reports (advertiser_id, product_id, batch, date_from, date_to, spend, tax_percent, created_by, updated_by)
    values (v_advertiser, v_product.id, v_batch, p_date_from, p_date_to, round(p_spend, 2), round(p_tax_percent, 2), p_actor, p_actor)
    returning * into v_row;
  else
    update public.ad_spend_reports
       set product_id = v_product.id, batch = v_batch, date_from = p_date_from, date_to = p_date_to,
           spend = round(p_spend, 2), tax_percent = round(p_tax_percent, 2), updated_by = p_actor
     where id = p_id
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'action', case when p_id is null then 'created' else 'updated' end,
    'product_code', v_product.code,
    'batch', v_row.batch,
    'date_from', v_row.date_from,
    'date_to', v_row.date_to,
    'spend', v_row.spend,
    'tax_percent', v_row.tax_percent
  );
end $$;

create or replace function public.delete_ad_spend_report(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_advertiser uuid := public.ad_spend_actor_advertiser(p_actor);
begin
  delete from public.ad_spend_reports where id = p_id and advertiser_id = v_advertiser;
  if not found then raise exception using errcode = 'DF017', message = 'AD_SPEND_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

revoke all on function public.ad_spend_actor_advertiser(uuid),
  public.save_ad_spend_report(uuid,uuid,text,text,date,date,numeric,numeric,boolean),
  public.delete_ad_spend_report(uuid,uuid) from public, anon, authenticated;
grant execute on function public.ad_spend_actor_advertiser(uuid),
  public.save_ad_spend_report(uuid,uuid,text,text,date,date,numeric,numeric,boolean),
  public.delete_ad_spend_report(uuid,uuid) to service_role;

-- Laporan: report yang rentangnya beririsan dengan filter tanggal, plus angka order live per report.
-- security definer karena role yang hanya punya izin report ini tidak lolos RLS orders; scope produk dan
-- pengiklan diterapkan ulang di sini persis seperti RLS (can_access_product + pengiklan akun).
create or replace function public.ad_spend_report(
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_batch text default null
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
  v_result jsonb;
begin
  if not public.has_permission('operasional.report_spend') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select advertiser_id into v_own_advertiser from public.users where id = v_actor;

  with reports as (
    select r.id, r.batch, r.date_from, r.date_to, r.spend, r.created_at, r.tax_percent,
           -- PPN iklan per report; Total Spend = spend + PPN (dasar profit/boncos di halaman).
           round(r.spend * r.tax_percent / 100, 2) as tax_amount,
           r.advertiser_id, p.code as product_code, p.name as product_name,
           a.code as advertiser_code, a.name as advertiser_name,
           -- Batas hari WIB, sama dengan filter tanggal order di seluruh aplikasi (A24).
           (r.date_from::timestamp at time zone 'Asia/Jakarta') as starts_at,
           ((r.date_to + 1)::timestamp at time zone 'Asia/Jakarta') as ends_at
      from public.ad_spend_reports r
      join public.products p on p.id = r.product_id
      join public.advertisers a on a.id = r.advertiser_id
     where public.actor_can_product(v_actor, p.code)
       and (v_own_advertiser is null or r.advertiser_id = v_own_advertiser)
       and (p_date_from is null or r.date_to >= p_date_from)
       and (p_date_to is null or r.date_from <= p_date_to)
       and (p_product_code is null or p.code_normalized = public.normalize_code(p_product_code))
       and (p_advertiser_code is null or a.code_normalized = public.normalize_code(p_advertiser_code))
       and (p_batch is null or btrim(p_batch) = '' or r.batch = public.normalize_batch(btrim(p_batch)))
  ),
  matched as (
    -- Satu baris per (report, order). Order yang tercakup beberapa report muncul beberapa kali di sini,
    -- tetapi total di bawah menghitungnya sekali (distinct order_id).
    select r.id as report_id, o.order_id, o.app_status, o.gross_amount
      from reports r
      join public.orders o
        on public.normalize_code(o.product_code) = public.normalize_code(r.product_code)
       and public.normalize_code(o.advertiser_code) = public.normalize_code(r.advertiser_code)
       and public.normalize_batch(o.batch) = r.batch
       and coalesce(o.source_created_at, o.created_at) >= r.starts_at
       and coalesce(o.source_created_at, o.created_at) < r.ends_at
  ),
  per_report as (
    select r.*,
           count(m.order_id)::int as leads,
           count(m.order_id) filter (where m.app_status = 'Paid')::int as paid,
           coalesce(sum(m.gross_amount) filter (where m.app_status = 'Paid'), 0)::numeric(18,2) as omzet
      from reports r left join matched m on m.report_id = r.id
     group by r.id, r.batch, r.date_from, r.date_to, r.spend, r.created_at, r.tax_percent, r.tax_amount, r.advertiser_id, r.product_code,
              r.product_name, r.advertiser_code, r.advertiser_name, r.starts_at, r.ends_at
  ),
  distinct_orders as (
    select distinct on (order_id) order_id, app_status, gross_amount from matched
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'reports', (select count(*) from reports),
      'spend', (select coalesce(sum(spend), 0) from reports),
      'tax_amount', (select coalesce(sum(tax_amount), 0) from reports),
      'total_spend', (select coalesce(sum(spend + tax_amount), 0) from reports),
      'leads', (select count(*) from distinct_orders),
      'paid', (select count(*) from distinct_orders where app_status = 'Paid'),
      'omzet', (select coalesce(sum(gross_amount), 0) from distinct_orders where app_status = 'Paid')
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'date_from', pr.date_from,
        'date_to', pr.date_to,
        'product_code', pr.product_code,
        'product_name', pr.product_name,
        'advertiser_code', pr.advertiser_code,
        'advertiser_name', pr.advertiser_name,
        'batch', pr.batch,
        'spend', pr.spend,
        'tax_percent', pr.tax_percent,
        'tax_amount', pr.tax_amount,
        'total_spend', pr.spend + pr.tax_amount,
        'leads', pr.leads,
        'paid', pr.paid,
        'omzet', pr.omzet,
        'own', v_own_advertiser is not null and pr.advertiser_id = v_own_advertiser
      ) order by pr.date_to desc, pr.date_from desc, pr.product_name, pr.batch, pr.created_at desc)
      from per_report pr
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.ad_spend_report(date,date,text,text,text) from public, anon, authenticated;
grant execute on function public.ad_spend_report(date,date,text,text,text) to authenticated;
