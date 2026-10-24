-- 0050_batch_summary_city_order — A39 (permintaan pengguna 24 Okt 2026): baris Resume Batch
-- dikelompokkan per kota (abjad), lalu sesi S1, S2, …, S10 di dalam kota. Hanya urutan yang berubah.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 50 $$;

create or replace function public.batch_session_summary(
  p_product_code text,
  p_batch text,
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
  v_result jsonb;
begin
  if not public.has_permission('operasional.resume_batch') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(p_product_code, '')), '') is null or nullif(btrim(coalesce(p_batch, '')), '') is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  with paid as (
    select upper(btrim(o.session)) as session_key,
           lower(btrim(o.city)) as city_key,
           o.session, o.city, o.event_type, o.quantity, o.source,
           public.normalize_code(o.advertiser_code) as advertiser_key,
           o.advertiser_code, o.advertiser_name
      from public.orders o
     where o.app_status = 'Paid'
       and o.product_parse_status = 'valid'
       and public.normalize_code(o.product_code) = public.normalize_code(p_product_code)
       and public.normalize_batch(o.batch) = public.normalize_batch(btrim(p_batch))
       and (nullif(btrim(coalesce(p_event_type, '')), '') is null or o.event_type = btrim(p_event_type))
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
    -- Kota tidak membedakan huruf (A31): "Solo" dan "SOLO" satu baris; tampilannya ejaan yang ada.
    select session_key, city_key, event_type,
           max(session) as session, max(city) as city,
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
      -- Per kota (abjad), lalu S1, S2, …, S10 (bukan S1, S10, S2).
      ) order by s.city_key nulls last, nullif(regexp_replace(s.session_key, '\D', '', 'g'), '')::bigint nulls last, s.session_key nulls last)
      from per_session s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.batch_session_summary(text,text,text) from public, anon, authenticated;
grant execute on function public.batch_session_summary(text,text,text) to authenticated;
