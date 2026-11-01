-- 0066_presensi_operator_dan_koreksi_manual — A62 (permintaan pengguna 2 November 2026)
--
-- 1. Halaman Presensi dapat menampilkan SIAPA yang melakukan check-in. Database
--    sudah menyimpan `attendance_events.scanner_user_id`; yang kurang adalah cara
--    membaca nama operator tanpa membuka seluruh tabel `users` (RLS hanya
--    memperbolehkan user membaca barisnya sendiri).
-- 2. Koreksi manual: tandai hadir tanpa scan dan kembalikan tiket ke Belum Hadir.
--    Keduanya memakai izin `action.manual_checkin` yang sudah ada.
-- 3. `checkin_seminar` memakai nomor tiket kosong pertama, bukan `jumlah hadir + 1`.
--    Tanpa ini, setelah sebagian tiket dihapus (koreksi manual) check-in berikutnya
--    bisa bentrok dengan `ticket_no` yang masih ada dan salah mengembalikan
--    ALREADY_CHECKED_IN padahal masih ada sisa tiket.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 66 $$;

-- ---------------------------------------------------------------------------
-- 1. Nama operator untuk halaman Presensi
-- ---------------------------------------------------------------------------
-- RLS public.users hanya mengizinkan membaca baris sendiri. Helper ini membuka
-- HANYA display_name, dan hanya untuk pemegang izin Presensi (RLS tetap menjadi
-- penjaga utama untuk data lain).
create or replace function public.operator_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select u.display_name
    from public.users u
   where u.id = p_user_id
     and public.has_permission('operasional.presensi')
$$;

revoke all on function public.operator_display_name(uuid) from public, anon, authenticated;
grant execute on function public.operator_display_name(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Check-in seminar: izin per sumber + nomor tiket kosong pertama
-- ---------------------------------------------------------------------------
create or replace function public.checkin_seminar(
  p_order_id text,
  p_source text,
  p_scanner_user_id uuid,
  p_tickets integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_quantity integer;
  v_present integer;
  v_remaining integer;
  v_want integer;
  v_inserted integer := 0;
  v_state text;
  v_first_clicked_at timestamptz;
  v_last_clicked_at timestamptz;
  v_attendance_id uuid;
begin
  -- Sumber menentukan izin yang diperlukan. Scanner QR tetap wajib
  -- `operasional.scan_qr`; check-in manual (scanner maupun koreksi Presensi)
  -- cukup `action.manual_checkin`. Handler API tetap memeriksa izin halaman.
  if p_source = 'seminar_qr' then
    if not public.actor_has_permission(p_scanner_user_id, 'operasional.scan_qr') then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
  elsif p_source = 'seminar_manual' then
    if not public.actor_has_permission(p_scanner_user_id, 'action.manual_checkin') then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
  else
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  -- -1 = probe dari klien baru ("berapa sisa tiket?"), bukan jumlah yang dikonfirmasi.
  -- NULL = pemanggil lama (3 argumen): perlakukan sebagai check-in seluruh sisa tiket,
  -- supaya tab/aplikasi versi lama tidak berubah perilaku saat database dimigrasi lebih dulu.
  if p_tickets is not null and p_tickets <> -1 and (p_tickets < 1 or p_tickets > 10000) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id);
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_order(p_scanner_user_id, v_order.product_code, v_order.advertiser_code) then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if v_order.app_status <> 'Paid' then
    raise exception using errcode = 'DF002', message = 'ORDER_NOT_PAID';
  end if;
  if v_order.event_type is null or v_order.event_type not in ('Seminar Offline', 'Hybrid') then
    raise exception using errcode = 'DF003', message = 'NOT_SEMINAR_ORDER';
  end if;

  -- Dua operator yang memindai Order ID yang sama diserialkan per order, supaya
  -- nomor tiket tidak pernah dobel dan sisa tiket dihitung dari keadaan terbaru.
  perform pg_advisory_xact_lock(hashtextextended(v_order.order_id, 0));

  v_quantity := greatest(coalesce(v_order.quantity, 1), 1);
  select count(*)::int, min(clicked_at), max(clicked_at)
    into v_present, v_first_clicked_at, v_last_clicked_at
    from public.attendance_events
   where order_id = v_order.order_id
     and attendance_type = 'seminar';
  v_remaining := greatest(v_quantity - v_present, 0);

  if v_remaining = 0 then
    select id into v_attendance_id
      from public.attendance_events
     where order_id = v_order.order_id
       and attendance_type = 'seminar'
     order by clicked_at desc
     limit 1;

    return jsonb_build_object(
      'order_id', v_order.order_id,
      'state', 'ALREADY_CHECKED_IN',
      'attendance_id', v_attendance_id,
      'clicked_at', coalesce(v_last_clicked_at, v_first_clicked_at),
      'first_clicked_at', v_first_clicked_at,
      'scanner_user_id', p_scanner_user_id,
      'quantity', v_quantity,
      'checked_in_tickets', v_present,
      'remaining_tickets', 0,
      'tickets_confirmed', 0
    );
  end if;

  -- Klien baru belum tahu jumlah tiket yang masuk: jangan tulis apa pun dulu.
  if p_tickets = -1 and v_remaining > 1 then
    return jsonb_build_object(
      'order_id', v_order.order_id,
      'state', 'NEEDS_QUANTITY',
      'attendance_id', null,
      'clicked_at', null,
      'first_clicked_at', v_first_clicked_at,
      'scanner_user_id', p_scanner_user_id,
      'quantity', v_quantity,
      'checked_in_tickets', v_present,
      'remaining_tickets', v_remaining,
      'tickets_confirmed', 0
    );
  end if;

  -- NULL (klien lama) = seluruh sisa tiket. -1 (probe) hanya sampai di sini bila
  -- sisa = 1. Lebih dari sisa (mis. dua operator bersamaan) dipotong ke sisa.
  v_want := case
    when p_tickets is null then v_remaining
    when p_tickets = -1 then 1
    else least(p_tickets, v_remaining)
  end;

  -- Nomor tiket kosong pertama. Setelah koreksi manual, baris bisa berlubang
  -- (mis. ticket_no 1 dan 3 masih ada); memakai v_present + g akan bentrok
  -- dengan ticket_no 3 dan membuat check-in gagal padahal masih ada sisa.
  with slots as (
    select gs as ticket_no
      from generate_series(1, v_quantity) as gs
     where not exists (
       select 1
         from public.attendance_events e
        where e.order_id = v_order.order_id
          and e.attendance_type = 'seminar'
          and e.ticket_no = gs
     )
     order by gs
     limit v_want
  ), inserted as (
    insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id, ticket_no)
    select v_order.order_id, 'seminar', p_source, p_scanner_user_id, slots.ticket_no
      from slots
    on conflict (order_id, ticket_no) where attendance_type = 'seminar' do nothing
    returning id, clicked_at
  )
  select count(*)::int, max(clicked_at), (array_agg(id order by clicked_at desc))[1]
    into v_inserted, v_last_clicked_at, v_attendance_id
    from inserted;

  select count(*)::int, min(clicked_at), max(clicked_at)
    into v_present, v_first_clicked_at, v_last_clicked_at
    from public.attendance_events
   where order_id = v_order.order_id
     and attendance_type = 'seminar';
  v_remaining := greatest(v_quantity - v_present, 0);

  v_state := case
    when v_inserted > 0 then 'CHECKIN_SUCCESS'
    else 'ALREADY_CHECKED_IN'
  end;

  if v_attendance_id is null then
    select id into v_attendance_id
      from public.attendance_events
     where order_id = v_order.order_id
       and attendance_type = 'seminar'
     order by clicked_at desc
     limit 1;
  end if;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'state', v_state,
    'attendance_id', v_attendance_id,
    'clicked_at', coalesce(v_last_clicked_at, v_first_clicked_at),
    'first_clicked_at', v_first_clicked_at,
    'scanner_user_id', p_scanner_user_id,
    'quantity', v_quantity,
    'checked_in_tickets', v_present,
    'remaining_tickets', v_remaining,
    'tickets_confirmed', v_inserted
  );
end;
$$;

revoke all on function public.checkin_seminar(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.checkin_seminar(text, text, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Koreksi manual: kembalikan tiket ke Belum Hadir
-- ---------------------------------------------------------------------------
-- p_tickets NULL = hapus SEMUA presensi seminar order tersebut.
-- p_tickets N    = hapus N baris presensi terbaru (berdasarkan waktu check-in).
create or replace function public.reset_presensi(
  p_actor uuid,
  p_order_id text,
  p_tickets integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_quantity integer;
  v_present integer;
  v_remove integer;
  v_removed integer := 0;
begin
  if not public.actor_has_permission(p_actor, 'action.manual_checkin')
     or not public.actor_has_permission(p_actor, 'operasional.presensi') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_order_id is null or btrim(p_order_id) = '' or length(btrim(p_order_id)) > 64 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if p_tickets is not null and (p_tickets < 1 or p_tickets > 10000) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id) for update;
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_order(p_actor, v_order.product_code, v_order.advertiser_code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_order.app_status <> 'Paid' then
    raise exception using errcode = 'DF002', message = 'ORDER_NOT_PAID';
  end if;
  if v_order.event_type is null or v_order.event_type not in ('Seminar Offline', 'Hybrid') then
    raise exception using errcode = 'DF003', message = 'NOT_SEMINAR_ORDER';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_order.order_id, 0));

  v_quantity := greatest(coalesce(v_order.quantity, 1), 1);
  select count(*)::int into v_present
    from public.attendance_events
   where order_id = v_order.order_id
     and attendance_type = 'seminar';

  v_remove := least(coalesce(p_tickets, v_present), v_present);
  if v_remove > 0 then
    with removed as (
      delete from public.attendance_events
       where id in (
         select e.id
           from public.attendance_events e
          where e.order_id = v_order.order_id
            and e.attendance_type = 'seminar'
          order by e.clicked_at desc, e.ticket_no desc
          limit v_remove
       )
      returning id
    )
    select count(*)::int into v_removed from removed;
  end if;

  select count(*)::int into v_present
    from public.attendance_events
   where order_id = v_order.order_id
     and attendance_type = 'seminar';

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'removed_tickets', v_removed,
    'quantity', v_quantity,
    'checked_in_tickets', v_present,
    'remaining_tickets', greatest(v_quantity - v_present, 0)
  );
end;
$$;

revoke all on function public.reset_presensi(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reset_presensi(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Presensi: sertakan operator yang check-in
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presensi_page(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_attendance_status text DEFAULT NULL::text, p_sort text DEFAULT 'latest_activity'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
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
          or o.effective_batch ilike $1::text
          or o.effective_session ilike $1::text
          or o.effective_city ilike $1::text
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.effective_batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.effective_session = $8::text)
      and ($9::text is null or lower(btrim(o.effective_city)) = lower(btrim($9::text)))
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

  -- Hanya peserta (Paid). Pending/Cancelled/Refund tidak pernah masuk tabel presensi;
  -- order Refund tetap dikelola di halaman Order Refund.
  v_base :=
    'select o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type,
            o.effective_batch as batch, o.effective_session as session, o.effective_city as city,
            o.batch as original_batch, o.session as original_session, o.city as original_city,
            (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
            o.product_parse_status, o.app_status, o.gross_amount, o.quantity,
            o.created_at, o.paid_at, o.updated_at,
            (coalesce(o.source_created_at, o.created_at) < (now() - interval ''30 days'')) as retention_old,
            a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.seminar_present, a.webinar_clicks, a.timestamps,
            coalesce((
              select jsonb_agg(names.name order by names.name)
                from (
                  select distinct public.operator_display_name(e2.scanner_user_id) as name
                    from public.attendance_events e2
                   where e2.order_id = o.order_id
                     and e2.attendance_type = ''seminar''
                     and e2.scanner_user_id is not null
                ) names
               where names.name is not null
            ), ''[]''::jsonb) as scanner_names
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity,
                max(e.clicked_at) as latest_activity,
                count(*) filter (where e.attendance_type = ''seminar'')::int as seminar_present,
                count(*) filter (where e.attendance_type = ''webinar'')::int as webinar_clicks,
                (array_agg(e.clicked_at order by e.clicked_at desc))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where (' || v_filter || ')
        and o.app_status = ''Paid''';

  v_counted :=
    'select t.*,
            least(t.quantity, case
              when t.seminar_present > 0 then t.seminar_present
              when t.webinar_clicks > 0 then t.quantity
              else 0
            end) as checked_in_tickets,
            (t.total_activity = 0 and t.retention_old) as attendance_data_expired
       from (' || v_base || ') t';

  v_classified :=
    'select t.*,
            case
              when t.rescheduled and t.checked_in_tickets = 0 then ''Reschedule''
              when t.attendance_data_expired then ''Data presensi tidak tersedia''
              when t.checked_in_tickets >= t.quantity then ''Hadir''
              when t.checked_in_tickets > 0 then ''Hadir Sebagian''
              else ''Belum Hadir''
            end as attendance_status
       from (' || v_counted || ') t';

  execute format('select count(*) from (%s) c where ($10::text is null or c.attendance_status = $10::text)', v_classified)
    into v_total
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  v_paged := format(
    'select t.* from (%s) t where ($10::text is null or t.attendance_status = $10::text) order by %s %s nulls last, t.order_id asc limit %s offset %s',
    v_classified, v_sort_expr, p_sort_dir, v_limit, v_offset
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from (%s) p', v_paged)
    into v_rows
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.export_presensi_page(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_attendance_status text DEFAULT NULL::text, p_sort text DEFAULT 'latest_activity'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
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
          or o.effective_batch ilike $1::text
          or o.effective_session ilike $1::text
          or o.effective_city ilike $1::text
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.effective_batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.effective_session = $8::text)
      and ($9::text is null or lower(btrim(o.effective_city)) = lower(btrim($9::text)))
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
    'select o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type,
            o.effective_batch as batch, o.effective_session as session, o.effective_city as city,
            o.batch as original_batch, o.session as original_session, o.city as original_city,
            (o.event_batch is not null or o.event_session is not null or o.event_city is not null) as rescheduled,
            o.product_parse_status, o.app_status, o.gross_amount, o.quantity,
            o.created_at, o.paid_at, o.updated_at,
            (coalesce(o.source_created_at, o.created_at) < (now() - interval ''30 days'')) as retention_old,
            a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.seminar_present, a.webinar_clicks, a.timestamps,
            coalesce((
              select jsonb_agg(names.name order by names.name)
                from (
                  select distinct public.operator_display_name(e2.scanner_user_id) as name
                    from public.attendance_events e2
                   where e2.order_id = o.order_id
                     and e2.attendance_type = ''seminar''
                     and e2.scanner_user_id is not null
                ) names
               where names.name is not null
            ), ''[]''::jsonb) as scanner_names
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity,
                max(e.clicked_at) as latest_activity,
                count(*) filter (where e.attendance_type = ''seminar'')::int as seminar_present,
                count(*) filter (where e.attendance_type = ''webinar'')::int as webinar_clicks,
                (array_agg(e.clicked_at order by e.clicked_at desc))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where (' || v_filter || ')
        and o.app_status = ''Paid''';

  v_counted :=
    'select t.*,
            least(t.quantity, case
              when t.seminar_present > 0 then t.seminar_present
              when t.webinar_clicks > 0 then t.quantity
              else 0
            end) as checked_in_tickets,
            (t.total_activity = 0 and t.retention_old) as attendance_data_expired
       from (' || v_base || ') t';

  v_classified :=
    'select t.*,
            case
              when t.rescheduled and t.checked_in_tickets = 0 then ''Reschedule''
              when t.attendance_data_expired then ''Data presensi tidak tersedia''
              when t.checked_in_tickets >= t.quantity then ''Hadir''
              when t.checked_in_tickets > 0 then ''Hadir Sebagian''
              else ''Belum Hadir''
            end as attendance_status
       from (' || v_counted || ') t';

  execute format('select count(*) from (%s) c where ($10::text is null or c.attendance_status = $10::text)', v_classified)
    into v_total
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  v_paged := format(
    'select t.* from (%s) t where ($10::text is null or t.attendance_status = $10::text) order by %s %s nulls last, t.order_id asc limit %s offset %s',
    v_classified, v_sort_expr, p_sort_dir, v_limit, v_offset
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from (%s) p', v_paged)
    into v_rows
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$function$;
