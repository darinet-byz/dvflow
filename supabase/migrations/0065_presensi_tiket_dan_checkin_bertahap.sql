-- 0065_presensi_tiket_dan_checkin_bertahap — A61 (permintaan pengguna 29 Oktober 2026)
--
-- 1. Presensi seminar disimpan PER TIKET, bukan per order. Satu Order ID bisa berisi
--    beberapa tiket, dan rombongan bisa datang bertahap. Setiap gelombang check-in
--    menambah baris attendance_events dengan ticket_no berikutnya.
-- 2. Check-in menerima jumlah tiket yang dikonfirmasi (p_tickets). Bila jumlah tiket
--    tersisa > 1 dan pemanggil belum menentukan jumlah, RPC mengembalikan
--    NEEDS_QUANTITY tanpa menulis apa pun.
-- 3. Halaman Presensi hanya menampilkan order Paid dan menghitung Hadir/Belum Hadir
--    dari jumlah tiket. Order yang baris presensinya sudah terhapus retensi 30 hari
--    diberi status "Data presensi tidak tersedia" dan tidak masuk KPI.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 65 $$;

-- ---------------------------------------------------------------------------
-- 1. attendance_events: satu baris = satu tiket seminar
-- ---------------------------------------------------------------------------
alter table public.attendance_events
  add column if not exists ticket_no integer not null default 1;

alter table public.attendance_events
  drop constraint if exists attendance_events_ticket_no_check;
alter table public.attendance_events
  add constraint attendance_events_ticket_no_check check (ticket_no between 1 and 10000);

-- Index lama (unik per ORDER) harus dilepas dulu: ia akan menolak baris tiket ke-2
-- yang dibuat backfill di bawah.
-- Nama index dipertahankan agar referensi dokumen/tes tidak berubah; definisinya
-- sekarang per tiket.
drop index if exists public.attendance_events_seminar_unique;

-- Backfill makna lama: check-in sebelum A61 berarti SELURUH tiket order hadir.
insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id, clicked_at, ticket_no)
select e.order_id, e.attendance_type, e.source, e.scanner_user_id, e.clicked_at, gs
  from public.attendance_events e
  join public.orders o on o.order_id = e.order_id
  cross join lateral generate_series(2, greatest(coalesce(o.quantity, 1), 1)) as gs
 where e.attendance_type = 'seminar'
   and not exists (
     select 1
       from public.attendance_events x
      where x.order_id = e.order_id
        and x.attendance_type = 'seminar'
        and x.ticket_no = gs
   );

create unique index if not exists attendance_events_seminar_unique
  on public.attendance_events (order_id, ticket_no)
  where attendance_type = 'seminar';

-- ---------------------------------------------------------------------------
-- 2. Check-in seminar bertahap
-- ---------------------------------------------------------------------------
drop function if exists public.checkin_seminar(text, text, uuid);

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
  if not public.actor_has_permission(p_scanner_user_id, 'operasional.scan_qr') or
    (p_source = 'seminar_manual' and not public.actor_has_permission(p_scanner_user_id, 'action.manual_checkin')) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_source not in ('seminar_qr', 'seminar_manual') then
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

  with inserted as (
    insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id, ticket_no)
    select v_order.order_id, 'seminar', p_source, p_scanner_user_id, v_present + g
      from generate_series(1, v_want) as g
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
-- 3. OTS: semua tiket hadir di meja registrasi
-- ---------------------------------------------------------------------------
create or replace function public.save_ots_registration(
  p_actor uuid,
  p_order_id text,
  p_name text,
  p_phone text,
  p_product_code text,
  p_batch text,
  p_session text,
  p_city text,
  p_event_type text,
  p_amount numeric,
  p_method text,
  p_quantity integer default null,
  p_unit_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_batch text := public.normalize_batch(nullif(btrim(coalesce(p_batch, '')), ''));
  v_session text := nullif(upper(btrim(coalesce(p_session, ''))), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_event_type text := coalesce(nullif(btrim(coalesce(p_event_type, '')), ''), 'Seminar Offline');
  v_new_client boolean := p_unit_price is not null;
  v_quantity integer := coalesce(p_quantity, 1);
  v_unit_price numeric(18, 2);
  v_amount numeric(18, 2);
  v_product public.products;
  v_order public.orders;
  v_raw text;
  v_created boolean := false;
begin
  if not public.actor_has_permission(p_actor, 'action.ots') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if v_name = '' or length(v_name) > 200
     or length(coalesce(v_phone, '')) > 32
     or length(coalesce(v_batch, '')) > 32
     or length(coalesce(v_city, '')) > 100
     or p_method is null or p_method not in ('ots_tunai', 'ots_transfer', 'ots_qris')
     or v_event_type not in ('Seminar Offline', 'Hybrid') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if v_new_client and (v_phone is null or v_batch is null or v_session is null or v_city is null) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if p_quantity is not null and (p_quantity < 1 or p_quantity > 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  if v_new_client then
    if p_unit_price is null or p_unit_price <= 0 or p_unit_price > 9999999999 then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;
    v_unit_price := round(p_unit_price, 2);
    v_amount := round(v_unit_price * v_quantity, 2);
  else
    if p_amount is null or p_amount <= 0 or p_amount > 9999999999 then
      raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
    end if;
    v_amount := round(p_amount, 2);
  end if;

  if v_amount > 9999999999 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_product from public.products where code_normalized = public.normalize_code(p_product_code);
  if not found then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if v_session is not null and not exists (select 1 from public.sessions_config where code_normalized = public.normalize_code(v_session)) then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if not public.actor_can_product(p_actor, v_product.code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  v_raw := concat_ws(' - ', v_product.code || coalesce(v_batch, ''), v_session, v_city) || ' (OTS)';

  if p_order_id is null or btrim(p_order_id) = '' then
    insert into public.orders (
      order_id, source, ots_collected_by, name, phone,
      product_raw, product_parse_status, product_code, product_name, event_type, batch, session, city,
      raw_status, app_status, payment_method, payment_provider, payment_identifier, payment_identifier_normalized,
      gross_amount, tax_amount, net_amount, tax_mapping_status, quantity,
      source_created_at, source_updated_at, paid_at
    ) values (
      'OTS-' || lpad(nextval('public.ots_order_seq')::text, 6, '0'), 'ots', p_actor, v_name, v_phone,
      v_raw, 'valid', v_product.code, v_product.name, v_event_type, v_batch, v_session, v_city,
      'ots', 'Paid', p_method, 'ots', p_method, p_method,
      v_amount, 0, v_amount, 'mapped', v_quantity,
      now(), now(), now()
    )
    returning * into v_order;
    v_created := true;
  else
    select * into v_order from public.orders where order_id = btrim(p_order_id) for update;
    if not found or v_order.source <> 'ots' then
      raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
    end if;
    if not public.actor_can_product(p_actor, v_order.product_code) then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
    update public.orders
       set name = v_name, phone = v_phone,
           product_raw = v_raw, product_code = v_product.code, product_name = v_product.name,
           event_type = v_event_type, batch = v_batch, session = v_session, city = v_city,
           payment_method = p_method, payment_identifier = p_method, payment_identifier_normalized = p_method,
           gross_amount = v_amount, net_amount = v_amount, quantity = v_quantity,
           source_updated_at = now()
     where order_id = v_order.order_id
     returning * into v_order;
  end if;

  -- OTS berarti peserta sudah di lokasi: seluruh tiketnya hadir. Baris yang sudah
  -- ada (mis. hasil scan sebelumnya) tidak ditimpa.
  insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id, ticket_no)
  select v_order.order_id, 'seminar', 'seminar_ots', p_actor, g
    from generate_series(1, greatest(coalesce(v_order.quantity, 1), 1)) as g
  on conflict (order_id, ticket_no) where attendance_type = 'seminar' do nothing;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'action', case when v_created then 'created' else 'updated' end,
    'quantity', v_order.quantity,
    'gross_amount', v_order.gross_amount,
    'checked_in_at', (
      select min(clicked_at) from public.attendance_events
       where order_id = v_order.order_id and attendance_type = 'seminar'
    )
  );
end;
$$;

revoke all on function public.save_ots_registration(
  uuid, text, text, text, text, text, text, text, text, numeric, text, integer, numeric
) from public, anon, authenticated;
grant execute on function public.save_ots_registration(
  uuid, text, text, text, text, text, text, text, text, numeric, text, integer, numeric
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. presensi_page: hanya Paid, hitung tiket, tandai data kedaluwarsa
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
            a.seminar_present, a.webinar_clicks, a.timestamps
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
            a.seminar_present, a.webinar_clicks, a.timestamps
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

-- ---------------------------------------------------------------------------
-- 5. presensi_summary & dashboard_summary: KPI dari jumlah tiket
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presensi_summary(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
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
  v_result jsonb;
begin
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  execute format($q$
    with filtered as (
      select o.app_status, o.quantity,
             exists (
               select 1 from public.attendance_events e where e.order_id = o.order_id
             ) as has_attendance,
             (
               select count(*)::int from public.attendance_events e
                where e.order_id = o.order_id and e.attendance_type = 'seminar'
             ) as seminar_present,
             exists (
               select 1 from public.attendance_events e
                where e.order_id = o.order_id and e.attendance_type = 'webinar'
             ) as has_webinar,
             (coalesce(o.source_created_at, o.created_at) < (now() - interval '30 days')) as retention_old
        from public.orders o
       where %s
    ),
    agg as (
      select
        -- Tiket Paid yang data presensinya masih tersedia (bukan hasil retensi 30 hari).
        coalesce(sum(quantity) filter (
          where app_status = 'Paid' and not (retention_old and not has_attendance)
        ), 0)::int as paid_tickets,
        coalesce(sum(
          least(quantity, case
            when seminar_present > 0 then seminar_present
            when has_webinar then quantity
            else 0
          end)
        ) filter (
          where app_status = 'Paid' and not (retention_old and not has_attendance)
        ), 0)::int as sudah_hadir
      from filtered
    )
    select jsonb_build_object(
      'paid_tickets', a.paid_tickets,
      'sudah_hadir', a.sudah_hadir,
      'belum_hadir', a.paid_tickets - a.sudah_hadir,
      'attendance_rate', case when a.paid_tickets > 0 then round(a.sudah_hadir::numeric / a.paid_tickets, 4) else null end
    )
    from agg a
  $q$, v_filter)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_summary(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
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
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or public.normalize_batch(o.batch) = public.normalize_batch($7::text))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
  $q$;
  v_search text;
  v_result jsonb;
begin
  if not public.has_permission('operasional.dashboard') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  execute format($q$
    with filtered as (
      select o.app_status, o.quantity, o.gross_amount, o.tax_amount, o.net_amount, o.epayment_tax_amount, o.platform_fee_amount,
             exists (
               select 1 from public.attendance_events e where e.order_id = o.order_id
             ) as has_attendance,
             (
               select count(*)::int from public.attendance_events e
                where e.order_id = o.order_id and e.attendance_type = 'seminar'
             ) as seminar_present,
             exists (
               select 1 from public.attendance_events e
                where e.order_id = o.order_id and e.attendance_type = 'webinar'
             ) as has_webinar,
             (coalesce(o.source_created_at, o.created_at) < (now() - interval '30 days')) as retention_old
        from public.orders o
       where %s
    ),
    agg as (
      select
        count(*)::int as leads,
        count(*) filter (where app_status = 'Paid')::int as paid,
        -- A25: tiket terjual = jumlah quantity order Paid (1 Order ID bisa 2+ tiket).
        coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as paid_tickets,
        -- Penyebut kehadiran tidak memasukkan tiket yang baris presensinya sudah dihapus retensi.
        coalesce(sum(quantity) filter (
          where app_status = 'Paid' and not (retention_old and not has_attendance)
        ), 0)::int as attendance_paid_tickets,
        count(*) filter (where app_status = 'Pending')::int as pending,
        count(*) filter (where app_status = 'Cancelled')::int as cancelled,
        -- A15: angka uang hanya dari order Paid; leads/pending/cancelled tetap semua status.
        coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as gross_amount,
        coalesce(sum(tax_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as tax_amount,
        coalesce(sum(epayment_tax_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as epayment_tax_amount,
        coalesce(sum(platform_fee_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as platform_fee_amount,
        coalesce(sum(net_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as net_amount,
        coalesce(sum(
          least(quantity, case
            when seminar_present > 0 then seminar_present
            when has_webinar then quantity
            else 0
          end)
        ) filter (
          where app_status = 'Paid' and not (retention_old and not has_attendance)
        ), 0)::int as sudah_hadir
      from filtered
    )
    select jsonb_build_object(
      'leads', a.leads,
      'paid', a.paid,
      'paid_tickets', a.paid_tickets,
      'pending', a.pending,
      'cancelled', a.cancelled,
      'conversion_rate', case when a.leads > 0 then round(a.paid::numeric / a.leads, 4) else null end,
      'gross_amount', a.gross_amount,
      'tax_amount', a.tax_amount,
      'epayment_tax_amount', a.epayment_tax_amount,
      'platform_fee_amount', a.platform_fee_amount,
      'net_amount', a.net_amount,
      'sudah_hadir', a.sudah_hadir,
      'belum_hadir', greatest(a.attendance_paid_tickets - a.sudah_hadir, 0),
      'attendance_rate', case when a.attendance_paid_tickets > 0 then round(a.sudah_hadir::numeric / a.attendance_paid_tickets, 4) else null end
    )
    from agg a
  $q$, v_filter)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city;

  return v_result;
end;
$function$;
