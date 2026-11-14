-- ============================================================================
-- A75 — Dua format nama produk yang sama-sama sah (14 November 2026)
-- ============================================================================
--
--   1. Berbasis kode (lama): [PRODUK][PENGIKLAN][TIPE][BATCH] - [SESI] - [KOTA]
--      contoh: MTIX01SO60 - S1 - Tegal
--
--   2. Berbasis nama (baru): [PENGIKLAN] - [TIPE][BATCH] - [NAMA PRODUK] - [SESI] - [KOTA]
--      contoh: 01 - SO60 - Master Tiktok Indonesia - S1 - Tegal
--
-- Parser TypeScript (packages/shared) sudah menerima keduanya. Migrasi ini
-- mengajari fungsi SQL yang membaca product_raw dari teks agar keduanya juga
-- dikenali: `master_is_used` (guard hapus/ubah konfigurasi) dan key Zoom/tiket.
--
-- Nama produk kini menjadi bagian dari identitas yang ditulis ke OrderOnline,
-- jadi namanya:
--   * harus unik (dua nama sama = segmen ambigu),
--   * tidak boleh memuat pemisah " - ",
--   * tidak boleh diubah setelah produk dipakai (guard di API; lihat
--     `packages/api/src/config/handlers.ts`).
-- Data lama tidak diubah: check `NOT VALID` hanya mengikat tulisan baru.
-- ============================================================================
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 77 $$;

-- ---------------------------------------------------------------------------
-- 1. Normalisasi nama produk (cermin normalizeProductName di TS)
--    trim + rapatkan rangkaian spasi + uppercase. Tanda baca tidak disentuh.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_product_name(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select upper(regexp_replace(regexp_replace(coalesce(p_value, ''), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
$$;
revoke all on function public.normalize_product_name(text) from public, anon, authenticated;
grant execute on function public.normalize_product_name(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Nama produk: tanpa pemisah segmen + unik
-- ---------------------------------------------------------------------------
alter table public.products add constraint products_name_no_separator
  check (position(' - ' in name) = 0) not valid;

-- Dua produk bernama sama akan membuat format baru ambigu. Berhenti dengan
-- daftar yang jelas supaya perbaikan datanya dilakukan sadar, bukan diam-diam.
do $$
declare conflicting text;
begin
  select string_agg(format('%s (%s)', d.name_normalized, d.codes), '; ')
    into conflicting
  from (
    select public.normalize_product_name(name) as name_normalized,
           string_agg(code, ', ' order by code) as codes
      from public.products
     group by 1
    having count(*) > 1
  ) d;
  if conflicting is not null then
    raise exception 'Nama produk duplikat, rapikan dulu sebelum migrasi A75: %', conflicting;
  end if;
end $$;

create unique index products_name_normalized_key
  on public.products (public.normalize_product_name(name));

-- ---------------------------------------------------------------------------
-- 3. Bagian kode dari nama kanonik berbasis nama produk (5 segmen).
--    Mengembalikan 0..N baris; pemanggil hanya memakai EXISTS, jadi ambiguitas
--    tetap berarti "dipakai" dan tidak pernah ditebak.
-- ---------------------------------------------------------------------------
create or replace function public.master_detailed_parts(p_text text)
returns table(product_code text, advertiser_code text, type_code text, session_code text)
language sql
stable
set search_path = public, pg_catalog, pg_temp
as $$
  select pr.code, ad.code, et.code, s.m[5]
    from (select regexp_match(
            upper(btrim(coalesce(p_text, ''))),
            '^([0-9]{2}) - ([A-Z]{2})([^ ].*) - (.+) - (ST|S[1-8]) - (.+)$'
          ) as m) s
    join public.advertisers ad on public.normalize_code(ad.code) = s.m[1]
    join public.event_types et on public.normalize_code(et.code) = s.m[2]
    join public.products pr on public.normalize_product_name(pr.name) = public.normalize_product_name(s.m[4])
   where s.m is not null
$$;
revoke all on function public.master_detailed_parts(text) from public, anon, authenticated;
grant execute on function public.master_detailed_parts(text) to service_role;

-- Key Zoom/tiket: scope `__scope__::PROD:BATCH:SESI` atau nama kanonik (dua format).
create or replace function public.master_setting_parts(p_key text)
returns table(product_code text, advertiser_code text, type_code text, session_code text)
language sql
stable
set search_path = public, pg_catalog, pg_temp
as $$
  with k as (select regexp_replace(p_key, '^(webinar_destination|seminar_ticket)::', '') as v)
  select nullif(split_part(substr(v, 12), ':', 1), '*'), null::text, null::text, nullif(split_part(substr(v, 12), ':', 3), '*')
    from k where starts_with(v, '__scope__::')
  union all
  select p.* from k, public.master_canonical_parts(k.v) p where not starts_with(k.v, '__scope__::')
  union all
  select p.* from k, public.master_detailed_parts(k.v) p where not starts_with(k.v, '__scope__::')
$$;
revoke all on function public.master_setting_parts(text) from public, anon, authenticated;
grant execute on function public.master_setting_parts(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. master_is_used — versi 0048 + pembacaan format berbasis nama (A75)
-- ---------------------------------------------------------------------------
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
      from public.orders o, public.master_detailed_parts(o.product_raw) p
    union all
    select p.product_code, p.advertiser_code, p.type_code, p.session_code, null
      from public.product_aliases a, public.master_canonical_parts(a.canonical_target) p
    union all
    select p.product_code, p.advertiser_code, p.type_code, p.session_code, null
      from public.product_aliases a, public.master_detailed_parts(a.canonical_target) p
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
revoke all on function public.master_is_used(text,text,uuid) from public, anon, authenticated;
grant execute on function public.master_is_used(text,text,uuid) to service_role;
