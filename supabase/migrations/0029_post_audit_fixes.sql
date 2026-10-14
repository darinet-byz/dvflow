-- 0029_post_audit_fixes — perbaikan hasil audit 14 Okt 2026 (docs/Fitur-2.0/09).
--
-- 1. schema_version(): kode aplikasi dan CI dapat menolak berjalan di atas database
--    yang tertinggal (penyebab tombol "Terjadi kesalahan pada server").
-- 2. master_is_used: kode dibaca dari struktur nama kanonik
--    [PRODUK][PENGIKLAN][TIPE][BATCH] - [SESI] - [KOTA] dan dari key scope Zoom/tiket,
--    bukan pencocokan teks. Pencocokan token di 0028 meloloskan pengiklan/tipe yang
--    menempel di dalam blok kode (mis. 01 di KULI01SO392).
-- 3. batch_remap_orders: hanya order unmapped, dan mapping disimpan sebagai alias
--    berkunci product_raw asli supaya webhook berikutnya tidak membatalkannya.
-- 4. admin_delete_user: hapus anggota tim lewat RPC yang menjaga hierarki role penuh.

create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 29 $$;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;

-- Bagian kode dari nama kanonik strict (0028). NULL bila teks bukan nama kanonik.
create or replace function public.master_canonical_parts(p_text text)
returns table(product_code text, advertiser_code text, type_code text, session_code text)
language sql immutable set search_path = public, pg_catalog, pg_temp as $$
  select m[1], m[2], m[3], m[5]
  from (select regexp_match(upper(btrim(coalesce(p_text, ''))),
    '^([A-Z]{4})([0-9]{2})([A-Z]{2})([0-9]+) - (ST|S[1-8]) - .+$') as m) s
  where m is not null
$$;

-- Bagian kode dari key Zoom/tiket: scope `__scope__::PROD:BATCH:SESI` atau nama kanonik exact.
create or replace function public.master_setting_parts(p_key text)
returns table(product_code text, advertiser_code text, type_code text, session_code text)
language sql immutable set search_path = public, pg_catalog, pg_temp as $$
  with k as (select regexp_replace(p_key, '^(webinar_destination|seminar_ticket)::', '') as v)
  select nullif(split_part(substr(v, 12), ':', 1), '*'), null::text, null::text, nullif(split_part(substr(v, 12), ':', 3), '*')
    from k where starts_with(v, '__scope__::')
  union all
  select p.* from k, public.master_canonical_parts(k.v) p where not starts_with(k.v, '__scope__::')
$$;

revoke all on function public.master_canonical_parts(text), public.master_setting_parts(text) from public, anon, authenticated;
grant execute on function public.master_canonical_parts(text), public.master_setting_parts(text) to service_role;

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

-- 0028 tidak lagi memakainya.
drop function if exists public.master_code_in_text(text, text);

create or replace function public.batch_remap_orders(
  p_order_ids text[],
  p_canonical_target text,
  p_parsed jsonb,
  p_save_alias boolean default false,
  p_alias_name text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_count integer := 0;
  v_target text := btrim(coalesce(p_canonical_target, ''));
begin
  if not public.actor_has_permission(p_actor_id, 'operasional.order_unmapped') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.actor_can_product(p_actor_id, null) or (p_save_alias and not public.actor_has_permission(p_actor_id, 'config.alias_produk')) then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null or array_length(p_order_ids, 1) = 0 then
    raise exception using errcode = 'DF011', message = 'EMPTY_ORDER_IDS';
  end if;
  if v_target = '' then
    raise exception using errcode = 'DF011', message = 'INVALID_CANONICAL_TARGET';
  end if;
  if p_parsed is null or p_parsed->>'product_parse_status' <> 'valid' then
    raise exception using errcode = 'DF011', message = 'CANONICAL_TARGET_NOT_VALID';
  end if;

  -- Webhook berikutnya mem-parse ulang product_raw. Tanpa alias berkunci nama asli,
  -- remap hilang dan peserta Paid kembali ditolak. Nama asli yang sudah beralias ke
  -- target lain ikut diarahkan ulang: keputusan remap terbaru yang berlaku.
  insert into public.product_aliases (alias_name, alias_name_normalized, canonical_target, created_by)
  select distinct on (lower(btrim(o.product_raw))) btrim(o.product_raw), lower(btrim(o.product_raw)), v_target, p_actor_id
    from public.orders o
   where o.order_id = any(p_order_ids)
     and o.product_parse_status = 'invalid'
     and nullif(btrim(o.product_raw), '') is not null
     and lower(btrim(o.product_raw)) <> lower(v_target)
  on conflict (alias_name_normalized) do update
    set canonical_target = excluded.canonical_target, updated_at = now();

  update public.orders
     set product_raw = coalesce(nullif(btrim(product_raw), ''), v_target),
         product_parse_status = 'valid',
         product_code = p_parsed->>'product_code',
         product_name = p_parsed->>'product_name',
         advertiser_code = p_parsed->>'advertiser_code',
         advertiser_name = p_parsed->>'advertiser_name',
         event_type = p_parsed->>'event_type',
         batch = p_parsed->>'batch',
         session = p_parsed->>'session',
         city = p_parsed->>'city',
         updated_at = now()
   where order_id = any(p_order_ids)
     -- Order yang sudah valid (mungkin sudah check-in) tidak boleh dipetakan ulang diam-diam.
     and product_parse_status = 'invalid';

  get diagnostics v_count = row_count;

  if p_save_alias and p_alias_name is not null and btrim(p_alias_name) <> '' then
    insert into public.product_aliases (alias_name, alias_name_normalized, canonical_target, created_by)
    values (btrim(p_alias_name), lower(btrim(p_alias_name)), v_target, p_actor_id)
    on conflict (alias_name_normalized) do update
      set canonical_target = excluded.canonical_target,
          updated_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'updated_count', v_count,
    'alias_saved', p_save_alias and p_alias_name is not null and btrim(p_alias_name) <> ''
  );
end;
$$;
revoke all on function public.batch_remap_orders(text[], text, jsonb, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.batch_remap_orders(text[], text, jsonb, boolean, text, uuid) to service_role;

-- Role penuh (developer/owner/master_admin) hanya boleh dihapus Developer; tidak ada
-- yang menghapus akunnya sendiri. Sesi ikut terhapus (FK cascade 0003).
create or replace function public.admin_delete_user(p_actor uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_actor_role text; v_target_role text;
begin
  select role into v_actor_role from public.users where id = p_actor and active;
  if v_actor_role is null or v_actor_role not in ('developer', 'owner', 'master_admin') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_target = p_actor then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  select role into v_target_role from public.users where id = p_target for update;
  if v_target_role is null then raise exception using errcode = 'DF005', message = 'USER_NOT_FOUND'; end if;
  if v_target_role in ('developer', 'owner', 'master_admin') and v_actor_role <> 'developer' then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  delete from public.users where id = p_target;
end $$;
revoke all on function public.admin_delete_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_user(uuid, uuid) to service_role;
