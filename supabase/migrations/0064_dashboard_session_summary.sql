-- 0064_dashboard_session_summary — A59 (permintaan pengguna 29 Okt 2026).
--
-- Resume Batch dilebur ke Dashboard sebagai kartu "Data per Sesi".
--   * Kartu tetap tampil; bila Produk/Batch belum dipilih, UI menampilkan tabel kosong
--     dengan instruksi "Pilih spesifik produk dan batch".
--   * Saat filter lengkap, RPC memakai SELURUH filter Dashboard: tanggal, pencarian,
--     produk, pengiklan, jenis acara, batch, sesi, dan kota.
--   * Tiket = sum(quantity) order Paid, produk valid, acara efektif (A58), refund tidak
--     dihitung. Omzet tidak terlibat.
--   * Izin halaman Resume Batch dilebur ke operasional.dashboard. Wrapper 3 arg lama
--     dipertahankan agar tab yang masih terbuka tidak rusak.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 64 $$;

update public.app_permissions
   set name = 'Dashboard',
       description = 'Melihat KPI dashboard dan data tiket per sesi'
 where key = 'operasional.dashboard';

delete from public.app_role_permissions where permission_key = 'operasional.resume_batch';
delete from public.app_permissions where key = 'operasional.resume_batch';

create or replace function public.dashboard_session_summary(
  p_product_code text,
  p_batch text,
  p_event_type text default null,
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_advertiser_code text default null,
  p_session text default null,
  p_city text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_product_code text := public.normalize_code(nullif(btrim(coalesce(p_product_code, '')), ''));
  v_batch text := public.normalize_batch(nullif(btrim(coalesce(p_batch, '')), ''));
  v_event_type text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_advertiser text := public.normalize_code(nullif(btrim(coalesce(p_advertiser_code, '')), ''));
  v_session text := public.normalize_code(nullif(btrim(coalesce(p_session, '')), ''));
  v_city text := lower(btrim(nullif(btrim(coalesce(p_city, '')), '')));
  v_search text;
  v_result jsonb;
begin
  if not public.has_permission('operasional.dashboard') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_product_code is null or v_batch is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  with paid as (
    select upper(btrim(o.effective_session)) as session_key,
           lower(btrim(o.effective_city)) as city_key,
           o.effective_session as session,
           o.effective_city as city,
           o.event_type,
           o.quantity,
           o.source,
           public.normalize_code(o.advertiser_code) as advertiser_key,
           o.advertiser_code,
           o.advertiser_name
      from public.orders o
     where o.app_status = 'Paid'
       and o.product_parse_status = 'valid'
       and public.normalize_code(o.product_code) = v_product_code
       and public.normalize_batch(o.effective_batch) = v_batch
       and (v_event_type is null or o.event_type = v_event_type)
       and (v_advertiser is null or public.normalize_code(o.advertiser_code) = v_advertiser)
       and (v_session is null or public.normalize_code(o.effective_session) = v_session)
       and (v_city is null or lower(btrim(o.effective_city)) = v_city)
       and (p_date_from is null or coalesce(o.source_created_at, o.created_at) >= (p_date_from::timestamp at time zone 'Asia/Jakarta'))
       and (p_date_to is null or coalesce(o.source_created_at, o.created_at) < ((p_date_to + 1)::timestamp at time zone 'Asia/Jakarta'))
       and (v_search is null or (
             o.order_id ilike v_search
          or o.name ilike v_search
          or o.phone ilike v_search
          or o.product_raw ilike v_search
          or o.product_name ilike v_search
          or o.advertiser_name ilike v_search
          or o.batch ilike v_search
          or o.session ilike v_search
          or o.city ilike v_search
          or o.effective_batch ilike v_search
          or o.effective_session ilike v_search
          or o.effective_city ilike v_search
       ))
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
           max(session) as session,
           max(city) as city,
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
revoke all on function public.dashboard_session_summary(text,text,text,text,date,date,text,text,text) from public, anon, authenticated;
grant execute on function public.dashboard_session_summary(text,text,text,text,date,date,text,text,text) to authenticated;

-- Wrapper lama untuk tab Resume Batch yang sudah terlanjur terbuka. Permission-nya
-- mengikuti Dashboard karena izin resume_batch sudah dilebur.
create or replace function public.batch_session_summary(
  p_product_code text,
  p_batch text,
  p_event_type text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select public.dashboard_session_summary(p_product_code, p_batch, p_event_type)
$$;
revoke all on function public.batch_session_summary(text,text,text) from public, anon, authenticated;
grant execute on function public.batch_session_summary(text,text,text) to authenticated;
