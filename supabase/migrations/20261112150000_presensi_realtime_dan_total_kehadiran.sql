-- A68 (permintaan pengguna 12 November 2026)
--
-- Halaman Presensi Acara punya dua sudut pandang:
--   * Berdasarkan Order  -> filter tanggal memakai tanggal order (perilaku lama).
--   * Realtime Presensi  -> filter tanggal memakai tanggal scan/check-in
--                            (attendance_events.clicked_at, batas WIB).
--
-- Semua angka kehadiran tetap PER TIKET (A61), bukan per Order ID. Ringkasan
-- sekarang juga memisahkan tiket Online dan OTS supaya total kehadiran tidak
-- perlu dijumlah manual di dua halaman.
--
-- Argumen baru diletakkan paling akhir dengan default 'order', sehingga
-- pemanggil lama dan tes lama tidak berubah perilaku.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 72 $$;

-- Signature lama (sebelum p_date_mode) harus dilepas dulu; CREATE OR REPLACE
-- dengan jumlah argumen berbeda akan membuat overload, bukan menimpa.
drop function if exists public.presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer, text);
drop function if exists public.export_presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer, text);
drop function if exists public.presensi_summary(text, date, date, text, text, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 1. presensi_page
-- ---------------------------------------------------------------------------
create or replace function public.presensi_page(
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_event_type text default null,
  p_batch text default null,
  p_session text default null,
  p_city text default null,
  p_attendance_status text default null,
  p_sort text default 'latest_activity',
  p_sort_dir text default 'desc',
  p_page integer default 1,
  p_page_size integer default 50,
  p_source text default null,
  p_date_mode text default 'order'
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_date_mode text := coalesce(nullif(btrim(coalesce(p_date_mode, '')), ''), 'order');
  v_window text := $w$($12::text <> 'attendance' or (
      ($2::date is null or e.clicked_at >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or e.clicked_at < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
  ))$w$;
  v_window_e2 text := replace(v_window, 'e.clicked_at', 'e2.clicked_at');
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
          or o.effective_batch ilike $1::text
          or o.effective_session ilike $1::text
          or o.effective_city ilike $1::text
      ))
      and ($2::date is null or $12::text = 'attendance' or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or $12::text = 'attendance' or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.effective_batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.effective_session = $8::text)
      and ($9::text is null or lower(btrim(o.effective_city)) = lower(btrim($9::text)))
      and ($11::text is null or o.source = $11::text)
      and ($12::text <> 'attendance' or exists (
        select 1
          from public.attendance_events ew
         where ew.order_id = o.order_id
           and ($2::date is null or ew.clicked_at >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
           and ($3::date is null or ew.clicked_at < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      ))
  $q$;
  v_search text;
  v_base text;
  v_counted text;
  v_classified text;
  v_paged text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if v_source is not null and v_source not in ('orderonline', 'ots') then
    raise exception using errcode = 'DF011', message = 'INVALID_SOURCE';
  end if;
  if v_date_mode not in ('order', 'attendance') then
    raise exception using errcode = 'DF011', message = 'INVALID_DATE_MODE';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;
  if (p_page - 1) * p_page_size >= 500 then
    raise exception using errcode = 'DF011', message = 'PAGE_LIMIT';
  end if;

  if p_attendance_status is not null
     and p_attendance_status not in (
       'Hadir', 'Hadir Sebagian', 'Belum Hadir', 'Reschedule',
       'Data presensi tidak tersedia', 'Pending', 'Cancelled', 'Refund'
     ) then
    raise exception using errcode = 'DF011', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  v_sort_expr := case p_sort
    when 'order_id' then 't.order_id'
    when 'name' then 't.name'
    when 'total_activity' then 't.total_activity'
    when 'latest_activity' then 't.latest_activity_sort'
    when 'product_name' then 't.product_name'
    when 'batch' then 't.batch'
    when 'session' then 't.session'
    when 'city' then 't.city'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  -- Hanya peserta Paid. Pending/Cancelled/Refund tidak pernah masuk tabel presensi.
  v_base :=
    'select o.source, o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type,
            o.effective_batch as batch, o.effective_session as session, o.effective_city as city,
            o.batch as original_batch, o.session as original_session, o.city as original_city,
            (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
            o.product_parse_status, o.app_status, o.gross_amount, o.quantity,
            o.created_at, o.paid_at, o.updated_at,
            (coalesce(o.source_created_at, o.created_at) < (now() - interval ''30 days'')) as retention_old,
            a.total_activity_all, a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.seminar_present_all, a.seminar_present,
            a.webinar_clicks_all, a.webinar_clicks, a.timestamps,
            coalesce((
              select jsonb_agg(names.name order by names.name)
                from (
                  select distinct public.operator_display_name(e2.scanner_user_id) as name
                    from public.attendance_events e2
                   where e2.order_id = o.order_id
                     and e2.attendance_type = ''seminar''
                     and e2.scanner_user_id is not null
                     and ' || v_window_e2 || '
                ) names
               where names.name is not null
            ), ''[]''::jsonb) as scanner_names
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity_all,
                count(*) filter (where ' || v_window || ')::int as total_activity,
                max(e.clicked_at) filter (where ' || v_window || ') as latest_activity,
                count(*) filter (where e.attendance_type = ''seminar'')::int as seminar_present_all,
                count(*) filter (where e.attendance_type = ''seminar'' and ' || v_window || ')::int as seminar_present,
                count(*) filter (where e.attendance_type = ''webinar'')::int as webinar_clicks_all,
                count(*) filter (where e.attendance_type = ''webinar'' and ' || v_window || ')::int as webinar_clicks,
                (array_agg(e.clicked_at order by e.clicked_at desc) filter (where ' || v_window || '))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where (' || v_filter || ')
        and o.app_status = ''Paid''';

  v_counted :=
    'select t.*,
            least(t.quantity, case
              when t.seminar_present_all > 0 then t.seminar_present_all
              when t.webinar_clicks_all > 0 then t.quantity
              else 0
            end) as checked_in_tickets,
            least(t.quantity, case
              when t.seminar_present > 0 then t.seminar_present
              when t.webinar_clicks > 0 then t.quantity
              else 0
            end) as checked_in_in_range,
            (t.total_activity_all = 0 and t.retention_old) as attendance_data_expired
       from (' || v_base || ') t';

  v_classified :=
    'select t.*,
            case
              when t.rescheduled and t.checked_in_in_range = 0 then ''Reschedule''
              when t.attendance_data_expired then ''Data presensi tidak tersedia''
              when t.checked_in_in_range >= t.quantity then ''Hadir''
              when t.checked_in_in_range > 0 then ''Hadir Sebagian''
              else ''Belum Hadir''
            end as attendance_status
       from (' || v_counted || ') t';

  execute format('select count(*) from (%s) c where ($10::text is null or c.attendance_status = $10::text)', v_classified)
    into v_total
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status, v_source, v_date_mode;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  v_paged := format(
    'select t.* from (%s) t where ($10::text is null or t.attendance_status = $10::text) order by %s %s nulls last, t.order_id asc limit %s offset %s',
    v_classified, v_sort_expr, p_sort_dir, v_limit, v_offset
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from (%s) p', v_paged)
    into v_rows
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status, v_source, v_date_mode;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$function$;

revoke all on function public.presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. export_presensi_page (kembaran presensi_page, tanpa batas PAGE_LIMIT)
-- ---------------------------------------------------------------------------
create or replace function public.export_presensi_page(
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_event_type text default null,
  p_batch text default null,
  p_session text default null,
  p_city text default null,
  p_attendance_status text default null,
  p_sort text default 'latest_activity',
  p_sort_dir text default 'desc',
  p_page integer default 1,
  p_page_size integer default 50,
  p_source text default null,
  p_date_mode text default 'order'
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_date_mode text := coalesce(nullif(btrim(coalesce(p_date_mode, '')), ''), 'order');
  v_window text := $w$($12::text <> 'attendance' or (
      ($2::date is null or e.clicked_at >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or e.clicked_at < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
  ))$w$;
  v_window_e2 text := replace(v_window, 'e.clicked_at', 'e2.clicked_at');
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
          or o.effective_batch ilike $1::text
          or o.effective_session ilike $1::text
          or o.effective_city ilike $1::text
      ))
      and ($2::date is null or $12::text = 'attendance' or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or $12::text = 'attendance' or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.effective_batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.effective_session = $8::text)
      and ($9::text is null or lower(btrim(o.effective_city)) = lower(btrim($9::text)))
      and ($11::text is null or o.source = $11::text)
      and ($12::text <> 'attendance' or exists (
        select 1
          from public.attendance_events ew
         where ew.order_id = o.order_id
           and ($2::date is null or ew.clicked_at >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
           and ($3::date is null or ew.clicked_at < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      ))
  $q$;
  v_search text;
  v_base text;
  v_counted text;
  v_classified text;
  v_paged text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  if not public.has_permission('action.export_data') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if v_source is not null and v_source not in ('orderonline', 'ots') then
    raise exception using errcode = 'DF011', message = 'INVALID_SOURCE';
  end if;
  if v_date_mode not in ('order', 'attendance') then
    raise exception using errcode = 'DF011', message = 'INVALID_DATE_MODE';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;

  if p_attendance_status is not null
     and p_attendance_status not in (
       'Hadir', 'Hadir Sebagian', 'Belum Hadir', 'Reschedule',
       'Data presensi tidak tersedia', 'Pending', 'Cancelled', 'Refund'
     ) then
    raise exception using errcode = 'DF011', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  v_sort_expr := case p_sort
    when 'order_id' then 't.order_id'
    when 'name' then 't.name'
    when 'total_activity' then 't.total_activity'
    when 'latest_activity' then 't.latest_activity_sort'
    when 'product_name' then 't.product_name'
    when 'batch' then 't.batch'
    when 'session' then 't.session'
    when 'city' then 't.city'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  v_base :=
    'select o.source, o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type,
            o.effective_batch as batch, o.effective_session as session, o.effective_city as city,
            o.batch as original_batch, o.session as original_session, o.city as original_city,
            (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
            o.product_parse_status, o.app_status, o.gross_amount, o.quantity,
            o.created_at, o.paid_at, o.updated_at,
            (coalesce(o.source_created_at, o.created_at) < (now() - interval ''30 days'')) as retention_old,
            a.total_activity_all, a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.seminar_present_all, a.seminar_present,
            a.webinar_clicks_all, a.webinar_clicks, a.timestamps,
            coalesce((
              select jsonb_agg(names.name order by names.name)
                from (
                  select distinct public.operator_display_name(e2.scanner_user_id) as name
                    from public.attendance_events e2
                   where e2.order_id = o.order_id
                     and e2.attendance_type = ''seminar''
                     and e2.scanner_user_id is not null
                     and ' || v_window_e2 || '
                ) names
               where names.name is not null
            ), ''[]''::jsonb) as scanner_names
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity_all,
                count(*) filter (where ' || v_window || ')::int as total_activity,
                max(e.clicked_at) filter (where ' || v_window || ') as latest_activity,
                count(*) filter (where e.attendance_type = ''seminar'')::int as seminar_present_all,
                count(*) filter (where e.attendance_type = ''seminar'' and ' || v_window || ')::int as seminar_present,
                count(*) filter (where e.attendance_type = ''webinar'')::int as webinar_clicks_all,
                count(*) filter (where e.attendance_type = ''webinar'' and ' || v_window || ')::int as webinar_clicks,
                (array_agg(e.clicked_at order by e.clicked_at desc) filter (where ' || v_window || '))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where (' || v_filter || ')
        and o.app_status = ''Paid''';

  v_counted :=
    'select t.*,
            least(t.quantity, case
              when t.seminar_present_all > 0 then t.seminar_present_all
              when t.webinar_clicks_all > 0 then t.quantity
              else 0
            end) as checked_in_tickets,
            least(t.quantity, case
              when t.seminar_present > 0 then t.seminar_present
              when t.webinar_clicks > 0 then t.quantity
              else 0
            end) as checked_in_in_range,
            (t.total_activity_all = 0 and t.retention_old) as attendance_data_expired
       from (' || v_base || ') t';

  v_classified :=
    'select t.*,
            case
              when t.rescheduled and t.checked_in_in_range = 0 then ''Reschedule''
              when t.attendance_data_expired then ''Data presensi tidak tersedia''
              when t.checked_in_in_range >= t.quantity then ''Hadir''
              when t.checked_in_in_range > 0 then ''Hadir Sebagian''
              else ''Belum Hadir''
            end as attendance_status
       from (' || v_counted || ') t';

  execute format('select count(*) from (%s) c where ($10::text is null or c.attendance_status = $10::text)', v_classified)
    into v_total
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status, v_source, v_date_mode;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  v_paged := format(
    'select t.* from (%s) t where ($10::text is null or t.attendance_status = $10::text) order by %s %s nulls last, t.order_id asc limit %s offset %s',
    v_classified, v_sort_expr, p_sort_dir, v_limit, v_offset
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from (%s) p', v_paged)
    into v_rows
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status, v_source, v_date_mode;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$function$;

revoke all on function public.export_presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.export_presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. presensi_summary: total per tiket + rincian Online/OTS
-- ---------------------------------------------------------------------------
create or replace function public.presensi_summary(
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_event_type text default null,
  p_batch text default null,
  p_session text default null,
  p_city text default null,
  p_source text default null,
  p_date_mode text default 'order'
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_date_mode text := coalesce(nullif(btrim(coalesce(p_date_mode, '')), ''), 'order');
  v_window text := $w$($11::text <> 'attendance' or (
      ($2::date is null or e.clicked_at >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or e.clicked_at < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
  ))$w$;
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
          or o.effective_batch ilike $1::text
          or o.effective_session ilike $1::text
          or o.effective_city ilike $1::text
      ))
      and ($2::date is null or $11::text = 'attendance' or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or $11::text = 'attendance' or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.effective_batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.effective_session = $8::text)
      and ($9::text is null or lower(btrim(o.effective_city)) = lower(btrim($9::text)))
      and ($10::text is null or o.source = $10::text)
      and ($11::text <> 'attendance' or exists (
        select 1
          from public.attendance_events ew
         where ew.order_id = o.order_id
           and ($2::date is null or ew.clicked_at >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
           and ($3::date is null or ew.clicked_at < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      ))
  $q$;
  v_search text;
  v_result jsonb;
begin
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if v_source is not null and v_source not in ('orderonline', 'ots') then
    raise exception using errcode = 'DF011', message = 'INVALID_SOURCE';
  end if;
  if v_date_mode not in ('order', 'attendance') then
    raise exception using errcode = 'DF011', message = 'INVALID_DATE_MODE';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  execute format($q$
    with filtered as (
      select o.app_status, o.quantity, o.source,
             a.total_all, a.total_window, a.seminar_window, a.webinar_window,
             (coalesce(o.source_created_at, o.created_at) < (now() - interval '30 days')) as retention_old
        from public.orders o
        cross join lateral (
          select count(*)::int as total_all,
                 count(*) filter (where %s)::int as total_window,
                 count(*) filter (where e.attendance_type = 'seminar' and %s)::int as seminar_window,
                 count(*) filter (where e.attendance_type = 'webinar' and %s)::int as webinar_window
            from public.attendance_events e
           where e.order_id = o.order_id
        ) a
       where %s
    ),
    eligible as (
      select f.*,
             case
               when $11::text = 'attendance'
                 then f.app_status = 'Paid' and f.total_window > 0
               else f.app_status = 'Paid' and not (f.retention_old and f.total_all = 0)
             end as counted
        from filtered f
    ),
    agg as (
      select
        coalesce(sum(quantity) filter (where counted), 0)::int as paid_tickets,
        coalesce(sum(least(quantity, case
          when seminar_window > 0 then seminar_window
          when webinar_window > 0 then quantity
          else 0
        end)) filter (where counted), 0)::int as sudah_hadir,
        coalesce(sum(quantity) filter (where counted and source = 'orderonline'), 0)::int as paid_tickets_online,
        coalesce(sum(quantity) filter (where counted and source = 'ots'), 0)::int as paid_tickets_ots,
        coalesce(sum(least(quantity, case
          when seminar_window > 0 then seminar_window
          when webinar_window > 0 then quantity
          else 0
        end)) filter (where counted and source = 'orderonline'), 0)::int as sudah_hadir_online,
        coalesce(sum(least(quantity, case
          when seminar_window > 0 then seminar_window
          when webinar_window > 0 then quantity
          else 0
        end)) filter (where counted and source = 'ots'), 0)::int as sudah_hadir_ots,
        coalesce(count(*) filter (where app_status = 'Paid' and total_window > 0), 0)::int as attending_orders
        from eligible
    )
    select jsonb_build_object(
      'paid_tickets', a.paid_tickets,
      'sudah_hadir', a.sudah_hadir,
      'belum_hadir', greatest(a.paid_tickets - a.sudah_hadir, 0),
      'attendance_rate', case when a.paid_tickets > 0 then round(a.sudah_hadir::numeric / a.paid_tickets, 4) else null end,
      'paid_tickets_online', a.paid_tickets_online,
      'paid_tickets_ots', a.paid_tickets_ots,
      'sudah_hadir_online', a.sudah_hadir_online,
      'sudah_hadir_ots', a.sudah_hadir_ots,
      'attending_orders', a.attending_orders
    )
    from agg a
  $q$, v_window, v_window, v_window, v_filter)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city, v_source, v_date_mode;

  return v_result;
end;
$function$;

revoke all on function public.presensi_summary(text, date, date, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.presensi_summary(text, date, date, text, text, text, text, text, text, text, text) to authenticated;
