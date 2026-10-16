-- 0038_presensi_summary — A23 (16 Okt 2026): kartu Hadir/Belum Hadir di halaman Presensi memakai
-- dashboard_summary yang mewajibkan izin Dashboard, sehingga role dengan izin Presensi saja (mis. Staff)
-- melihat error. RPC ini memakai filter & definisi yang sama (Hadir dari order Paid), tetapi hanya
-- mengembalikan angka kehadiran dan cukup dengan izin operasional.presensi. Scope produk/pengiklan ikut RLS.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 38 $$;

create or replace function public.presensi_summary(
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_event_type text default null,
  p_batch text default null,
  p_session text default null,
  p_city text default null
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_filter text := $q$
      ($1::text is null or (
             o.order_id ilike $1::text
          or o.name      ilike $1::text
          or o.phone     ilike $1::text
          or o.product_raw ilike $1::text
          or o.product_name ilike $1::text
          or o.advertiser_name ilike $1::text
          or o.batch     ilike $1::text
          or o.session   ilike $1::text
          or o.city      ilike $1::text
      ))
      and ($2::date is null or o.created_at >= $2::date)
      and ($3::date is null or o.created_at < ($3::date + 1))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or o.batch = $7::text)
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or o.city = $9::text)
  $q$;
  v_search text;
  v_result jsonb;
begin
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  execute format($q$
    with filtered as (
      select o.app_status,
             exists (
               select 1 from public.attendance_events e where e.order_id = o.order_id
             ) as has_attendance
        from public.orders o
       where %s
    ),
    agg as (
      select
        count(*) filter (where app_status = 'Paid')::int as paid,
        count(*) filter (where app_status = 'Paid' and has_attendance)::int as sudah_hadir
      from filtered
    )
    -- Hanya angka kehadiran: izin Presensi tidak membuka angka keuangan Dashboard.
    select jsonb_build_object(
      'paid', a.paid,
      'sudah_hadir', a.sudah_hadir,
      'belum_hadir', a.paid - a.sudah_hadir,
      'attendance_rate', case when a.paid > 0 then round(a.sudah_hadir::numeric / a.paid, 4) else null end
    )
    from agg a
  $q$, v_filter)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city;

  return v_result;
end;
$$;

revoke all on function public.presensi_summary(text, date, date, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.presensi_summary(text, date, date, text, text, text, text, text, text) to authenticated;
