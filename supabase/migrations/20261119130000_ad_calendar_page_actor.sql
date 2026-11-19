-- 20261119130000_ad_calendar_page_actor — perbaikan A80.
--
-- `ad_calendar_page` dipanggil backend memakai service key, sehingga `auth.uid()`
-- bernilai NULL dan pengecekan `has_permission` di dalam RPC selalu gagal
-- (developer/owner pun mendapat FORBIDDEN). RPC ini sekarang menerima `p_actor`
-- dari backend dan hanya dapat dipanggil `service_role`; izin + scope produk
-- diperiksa memakai aktor tersebut, pola yang sama dengan RPC service-only lain.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 81 $$;

drop function if exists public.ad_calendar_page(date, date);

create or replace function public.ad_calendar_page(
  p_actor uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_actor is null or not public.actor_has_permission(p_actor, 'operasional.event_calendar') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  with base as (
    select ac.id,
           ac.event_id,
           ac.deadline_date,
           ac.batch,
           ac.product_code,
           p.name as product_name,
           a.code as advertiser_code,
           a.name as advertiser_name,
           e.event_date,
           e.category,
           e.start_time,
           e.location,
           pub.publish_date,
           pub.publish_source
      from public.ad_calendar ac
      join public.products p on p.code = ac.product_code
      join public.advertisers a on a.id = ac.advertiser_id
      left join public.event_calendar e on e.id = ac.event_id
      cross join lateral public.ad_calendar_publish_date(ac.advertiser_id, p.id, ac.batch) pub
     where public.actor_can_product(p_actor, p.code)
       and (p_from is null or ac.deadline_date >= p_from)
       and (p_to is null or ac.deadline_date <= p_to)
  ),
  scored as (
    select b.*,
           case
             when b.publish_date is null and b.deadline_date > (now() at time zone 'Asia/Jakarta')::date then null
             when b.publish_date is null then 0
             when b.publish_date <= b.deadline_date then 10
             when b.publish_date - b.deadline_date <= 3 then 8
             when b.publish_date - b.deadline_date <= 7 then 6
             when b.publish_date - b.deadline_date <= 14 then 4
             when b.publish_date - b.deadline_date <= 30 then 2
             else 0
           end as score,
           case
             when b.publish_date is null and b.deadline_date > (now() at time zone 'Asia/Jakarta')::date then 'upcoming'
             when b.publish_date is null then 'unpublished'
             when b.publish_date <= b.deadline_date then 'on_time'
             else 'late'
           end as status
      from base b
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'event_id', s.event_id,
        'event_date', s.event_date,
        'category', s.category,
        'start_time', s.start_time,
        'location', s.location,
        'product_code', s.product_code,
        'product_name', s.product_name,
        'advertiser_code', s.advertiser_code,
        'advertiser_name', s.advertiser_name,
        'batch', s.batch,
        'deadline_date', s.deadline_date,
        'publish_date', s.publish_date,
        'publish_source', s.publish_source,
        'days_late', case when s.publish_date is null then null else s.publish_date - s.deadline_date end,
        'score', s.score,
        'status', s.status
      ) order by s.deadline_date, s.advertiser_code, s.product_code, s.batch)
        from scored s
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by p.code)
        from public.products p
       where p.active
    ), '[]'::jsonb),
    'advertisers', coalesce((
      select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name) order by a.code)
        from public.advertisers a
       where a.active
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'product_code', e.product_code,
        'product_name', p.name,
        'category', e.category,
        'event_date', e.event_date,
        'start_time', e.start_time,
        'location', e.location
      ) order by e.event_date, e.start_time, e.product_code)
        from public.event_calendar e
        join public.products p on p.code = e.product_code
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.ad_calendar_page(uuid, date, date) from public, anon, authenticated;
grant execute on function public.ad_calendar_page(uuid, date, date) to service_role;

notify pgrst, 'reload schema';
