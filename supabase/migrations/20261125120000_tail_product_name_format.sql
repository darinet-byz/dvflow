-- A96: format ketiga nama produk — teks bebas dibaca dari BELAKANG.
--
--   [TEKS BEBAS] - [KOTA] - [SESI] - [KODE PRODUK+PENGIKLAN+JENIS+BATCH]
--   contoh: Kelas Pagi - Live Zoom - S1 - MTIX01SO600
--
-- Teks bebas boleh memuat pemisah ` - `; batas yang dipakai adalah TIGA pemisah
-- terakhir, sehingga kota dan sesi selalu berada tepat sebelum blok kode.
-- Pola ini perlu dikenali fungsi SQL juga supaya guard hapus/rename konfigurasi
-- (`master_is_used`) dan key Zoom/tiket (`master_setting_parts`) tidak
-- melewatkan order yang memakainya.

create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 95 $$;

-- ---------------------------------------------------------------------------
-- 1. Bagian kode dari nama format teks bebas (A96).
--    Mengembalikan 0..N baris; pemanggil hanya memakai EXISTS, jadi ambiguitas
--    tetap berarti "dipakai" dan tidak pernah ditebak.
-- ---------------------------------------------------------------------------
create or replace function public.master_tail_parts(p_text text)
returns table(product_code text, advertiser_code text, type_code text, session_code text)
language sql
stable
set search_path = public, pg_catalog, pg_temp
as $$
  select pr.code, ad.code, et.code, s.m[3]
    from (select regexp_match(
            upper(btrim(coalesce(p_text, ''))),
            '^(.*) - (.+) - (ST|S[1-8]) - ([A-Z]{4})([0-9]{2})([A-Z]{2})([0-9A-Za-z]+)$'
          ) as m) s
    join public.advertisers ad on public.normalize_code(ad.code) = s.m[5]
    join public.event_types et on public.normalize_code(et.code) = s.m[6]
    join public.products pr on public.normalize_code(pr.code) = s.m[4]
   where s.m is not null
     and btrim(s.m[1]) <> ''
     and btrim(s.m[2]) <> ''
$$;
revoke all on function public.master_tail_parts(text) from public, anon, authenticated;
grant execute on function public.master_tail_parts(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Key Zoom/tiket: scope `__scope__::PROD:BATCH:SESI` atau nama kanonik
--    (tiga format).
-- ---------------------------------------------------------------------------
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
  union all
  select p.* from k, public.master_tail_parts(k.v) p where not starts_with(k.v, '__scope__::')
$$;
revoke all on function public.master_setting_parts(text) from public, anon, authenticated;
grant execute on function public.master_setting_parts(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. master_is_used — versi A75 + pembacaan format teks bebas (A96)
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
      from public.orders o, public.master_tail_parts(o.product_raw) p
    union all
    select p.product_code, p.advertiser_code, p.type_code, p.session_code, null
      from public.product_aliases a, public.master_canonical_parts(a.canonical_target) p
    union all
    select p.product_code, p.advertiser_code, p.type_code, p.session_code, null
      from public.product_aliases a, public.master_detailed_parts(a.canonical_target) p
    union all
    select p.product_code, p.advertiser_code, p.type_code, p.session_code, null
      from public.product_aliases a, public.master_tail_parts(a.canonical_target) p
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
