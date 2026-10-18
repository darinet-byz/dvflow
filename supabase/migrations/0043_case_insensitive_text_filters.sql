-- 0043_case_insensitive_text_filters — A31 (laporan pengguna 18 Okt 2026): filter Kota membedakan
-- "Solo" dan "solo". Filter teks ketik bebas Kota & Batch kini mengabaikan huruf besar/kecil dan spasi
-- di tepi — sama seperti Payment method sejak awal. Hanya dua baris filter per RPC yang berubah.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 43 $$;

-- orders_page
CREATE OR REPLACE FUNCTION public.orders_page(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_app_status text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  -- Predikat filter SENGAJA identik dengan 0016_read_rpcs.sql, ditambah dua
  -- filter yang hanya ada di halaman Order: status dan payment method.
  -- Paritasnya dijaga `supabase/tests/06_orders_page.sql`.
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
      and ($7::text is null or lower(btrim(o.batch)) = lower(btrim($7::text)))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
      and ($10::text is null or o.app_status = $10::text)
      -- Pencocokan payment method: sama persis, hanya mengabaikan besar/kecil
      -- huruf dan spasi tepi. TIDAK ada pencocokan mendekati, sejalan dengan
      -- aturan identifier tax (01 §11).
      and ($11::text is null or lower(btrim(o.payment_method)) = lower(btrim($11::text)))
  $q$;
  v_columns text :=
    'o.id, o.order_id, o.name, o.phone, o.email,
     o.product_raw, o.product_parse_status, o.product_code, o.product_name,
     o.advertiser_code, o.advertiser_name, o.event_type, o.batch, o.session, o.city,
     o.raw_status, o.app_status,
     o.payment_method, o.payment_provider, o.payment_identifier,
     o.gross_amount, o.tax_amount, o.net_amount, o.tax_mapping_status,
     o.epayment_tax_amount, o.platform_fee_amount,
     o.epayment_tax_type_snapshot, o.epayment_tax_value_snapshot, o.platform_fee_percent_snapshot,
     o.fee_rule_name_snapshot, o.fee_type_snapshot, o.fee_value_snapshot,
     o.source_created_at, o.source_updated_at,
     o.created_at, o.paid_at, o.updated_at';
  v_sort_expr text;
  v_search text;
  v_base text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  if not public.has_permission('operasional.order') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;
  -- A18: list hanya bisa dibuka sampai 500 baris (10 halaman x 50); offset dalam membebani database.
  if (p_page - 1) * p_page_size >= 500 then
    raise exception using errcode = 'DF011', message = 'PAGE_LIMIT';
  end if;
  if p_app_status is not null and p_app_status not in ('Pending', 'Paid', 'Cancelled') then
    raise exception using errcode = 'DF011', message = 'INVALID_APP_STATUS';
  end if;

  -- Whitelist sort — persis daftar pada 01 §6. Nama kolom database mentah tidak
  -- pernah diteruskan dari pemanggil.
  v_sort_expr := case p_sort
    when 'order_id' then 'order_id'
    when 'name' then 'name'
    when 'app_status' then 'app_status'
    when 'gross_amount' then 'gross_amount'
    when 'tax_amount' then 'tax_amount'
    when 'net_amount' then 'net_amount'
    when 'created_at' then 'created_at'
    when 'paid_at' then 'paid_at'
    when 'updated_at' then 'updated_at'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  -- Teks pengguna menjadi pola ilike yang wildcard-nya sudah di-escape.
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  v_base := format('select %s from public.orders o where %s', v_columns, v_filter);
  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  execute format($q$
    with filtered as (%s),
    counted as (
      select count(*)::int as total,
             count(*) filter (where app_status = 'Paid')::int as paid,
             count(*) filter (where app_status = 'Pending')::int as pending
        from filtered
    ),
    paged as (
      select * from filtered
       order by %s %s nulls last, order_id asc
       limit %s offset %s
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(p)) from paged p), '[]'::jsonb),
      'total', (select total from counted),
      'summary', (select jsonb_build_object('total', total, 'paid', paid, 'pending', pending) from counted)
    )
  $q$, v_base, v_sort_expr, p_sort_dir, v_limit, v_offset)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city, p_app_status, p_payment_method;

  return v_result;
end;
$function$;

-- export_orders_page
CREATE OR REPLACE FUNCTION public.export_orders_page(p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_app_status text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  -- Predikat filter SENGAJA identik dengan 0016_read_rpcs.sql, ditambah dua
  -- filter yang hanya ada di halaman Order: status dan payment method.
  -- Paritasnya dijaga `supabase/tests/06_orders_page.sql`.
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
      and ($7::text is null or lower(btrim(o.batch)) = lower(btrim($7::text)))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
      and ($10::text is null or o.app_status = $10::text)
      -- Pencocokan payment method: sama persis, hanya mengabaikan besar/kecil
      -- huruf dan spasi tepi. TIDAK ada pencocokan mendekati, sejalan dengan
      -- aturan identifier tax (01 §11).
      and ($11::text is null or lower(btrim(o.payment_method)) = lower(btrim($11::text)))
  $q$;
  v_columns text :=
    'o.id, o.order_id, o.name, o.phone, o.email,
     o.product_raw, o.product_parse_status, o.product_code, o.product_name,
     o.advertiser_code, o.advertiser_name, o.event_type, o.batch, o.session, o.city,
     o.raw_status, o.app_status,
     o.payment_method, o.payment_provider, o.payment_identifier,
     o.gross_amount, o.tax_amount, o.net_amount, o.tax_mapping_status,
     o.epayment_tax_amount, o.platform_fee_amount,
     o.epayment_tax_type_snapshot, o.epayment_tax_value_snapshot, o.platform_fee_percent_snapshot,
     o.fee_rule_name_snapshot, o.fee_type_snapshot, o.fee_value_snapshot,
     o.source_created_at, o.source_updated_at,
     o.created_at, o.paid_at, o.updated_at';
  v_sort_expr text;
  v_search text;
  v_base text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  if not public.has_permission('action.export_data') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.has_permission('operasional.order') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;
  if p_app_status is not null and p_app_status not in ('Pending', 'Paid', 'Cancelled') then
    raise exception using errcode = 'DF011', message = 'INVALID_APP_STATUS';
  end if;

  -- Whitelist sort — persis daftar pada 01 §6. Nama kolom database mentah tidak
  -- pernah diteruskan dari pemanggil.
  v_sort_expr := case p_sort
    when 'order_id' then 'order_id'
    when 'name' then 'name'
    when 'app_status' then 'app_status'
    when 'gross_amount' then 'gross_amount'
    when 'tax_amount' then 'tax_amount'
    when 'net_amount' then 'net_amount'
    when 'created_at' then 'created_at'
    when 'paid_at' then 'paid_at'
    when 'updated_at' then 'updated_at'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  -- Teks pengguna menjadi pola ilike yang wildcard-nya sudah di-escape.
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  v_base := format('select %s from public.orders o where %s', v_columns, v_filter);
  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  execute format($q$
    with filtered as (%s),
    counted as (
      select count(*)::int as total,
             count(*) filter (where app_status = 'Paid')::int as paid,
             count(*) filter (where app_status = 'Pending')::int as pending
        from filtered
    ),
    paged as (
      select * from filtered
       order by %s %s nulls last, order_id asc
       limit %s offset %s
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(p)) from paged p), '[]'::jsonb),
      'total', (select total from counted),
      'summary', (select jsonb_build_object('total', total, 'paid', paid, 'pending', pending) from counted)
    )
  $q$, v_base, v_sort_expr, p_sort_dir, v_limit, v_offset)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city, p_app_status, p_payment_method;

  return v_result;
end;
$function$;

-- presensi_page
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
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or lower(btrim(o.batch)) = lower(btrim($7::text)))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
  $q$;
  v_search text;
  v_base text;
  v_classified text;
  v_paged text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  -- Teks pengguna menjadi pola `ilike` yang seluruh karakter wildcard-nya sudah
  -- di-escape, sehingga input diperlakukan sebagai data (L06) dan `%` tidak
  -- berarti "semua baris".
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Ukuran halaman dibatasi ke nilai yang diizinkan dokumen (PRD §33).
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;
  -- A18: list hanya bisa dibuka sampai 500 baris (10 halaman x 50); offset dalam membebani database.
  if (p_page - 1) * p_page_size >= 500 then
    raise exception using errcode = 'DF011', message = 'PAGE_LIMIT';
  end if;

  if p_attendance_status is not null
     and p_attendance_status not in ('Hadir', 'Belum Hadir', 'Pending', 'Cancelled') then
    raise exception using errcode = 'DF011', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  -- Whitelist sort (CLAUDE.md §15). Kolom database mentah tidak pernah diteruskan.
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

  -- `latest_activity_sort`: presensi default adalah aktivitas terbaru, dan
  -- order yang belum pernah hadir jatuh ke created_at order (01 §6).
  v_base :=
    'select o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type, o.batch, o.session, o.city,
            o.product_parse_status, o.app_status, o.created_at, o.paid_at, o.updated_at,
            a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.timestamps
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity,
                max(e.clicked_at) as latest_activity,
                (array_agg(e.clicked_at order by e.clicked_at desc))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where ' || v_filter;

  -- Status presensi dihitung dari data (PRD §107) — tidak pernah disimpan.
  v_classified :=
    'select t.*,
            case when t.app_status <> ''Paid'' then t.app_status
                 when t.total_activity > 0 then ''Hadir''
                 else ''Belum Hadir'' end as attendance_status
       from (' || v_base || ') t';

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

-- export_presensi_page
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
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or lower(btrim(o.batch)) = lower(btrim($7::text)))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
  $q$;
  v_search text;
  v_base text;
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
  -- Teks pengguna menjadi pola `ilike` yang seluruh karakter wildcard-nya sudah
  -- di-escape, sehingga input diperlakukan sebagai data (L06) dan `%` tidak
  -- berarti "semua baris".
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Ukuran halaman dibatasi ke nilai yang diizinkan dokumen (PRD §33).
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;

  if p_attendance_status is not null
     and p_attendance_status not in ('Hadir', 'Belum Hadir', 'Pending', 'Cancelled') then
    raise exception using errcode = 'DF011', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  -- Whitelist sort (CLAUDE.md §15). Kolom database mentah tidak pernah diteruskan.
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

  -- `latest_activity_sort`: presensi default adalah aktivitas terbaru, dan
  -- order yang belum pernah hadir jatuh ke created_at order (01 §6).
  v_base :=
    'select o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type, o.batch, o.session, o.city,
            o.product_parse_status, o.app_status, o.created_at, o.paid_at, o.updated_at,
            a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.timestamps
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity,
                max(e.clicked_at) as latest_activity,
                (array_agg(e.clicked_at order by e.clicked_at desc))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where ' || v_filter;

  -- Status presensi dihitung dari data (PRD §107) — tidak pernah disimpan.
  v_classified :=
    'select t.*,
            case when t.app_status <> ''Paid'' then t.app_status
                 when t.total_activity > 0 then ''Hadir''
                 else ''Belum Hadir'' end as attendance_status
       from (' || v_base || ') t';

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

-- dashboard_summary
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
      and ($7::text is null or lower(btrim(o.batch)) = lower(btrim($7::text)))
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
             ) as has_attendance
        from public.orders o
       where %s
    ),
    agg as (
      select
        count(*)::int as leads,
        count(*) filter (where app_status = 'Paid')::int as paid,
        -- A25: tiket terjual = jumlah quantity order Paid (1 Order ID bisa 2+ tiket).
        coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as paid_tickets,
        count(*) filter (where app_status = 'Pending')::int as pending,
        count(*) filter (where app_status = 'Cancelled')::int as cancelled,
        -- A15: angka uang hanya dari order Paid; leads/pending/cancelled tetap semua status.
        coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as gross_amount,
        coalesce(sum(tax_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as tax_amount,
        coalesce(sum(epayment_tax_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as epayment_tax_amount,
        coalesce(sum(platform_fee_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as platform_fee_amount,
        coalesce(sum(net_amount) filter (where app_status = 'Paid'), 0)::numeric(18,2) as net_amount,
        count(*) filter (where app_status = 'Paid' and has_attendance)::int as sudah_hadir
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
$function$;

-- presensi_summary
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
      ))
      and ($2::date is null or coalesce(o.source_created_at, o.created_at) >= ($2::date::timestamp at time zone 'Asia/Jakarta'))
      and ($3::date is null or coalesce(o.source_created_at, o.created_at) < (($3::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or lower(btrim(o.batch)) = lower(btrim($7::text)))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
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
$function$;

-- tax_report
CREATE OR REPLACE FUNCTION public.tax_report(p_dimension text, p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_code text DEFAULT NULL::text, p_advertiser_code text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_session text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
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
      and ($7::text is null or lower(btrim(o.batch)) = lower(btrim($7::text)))
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or lower(btrim(o.city)) = lower(btrim($9::text)))
  $q$;
  v_group_expr text;
  v_search text;
  v_result jsonb;
begin
  if not public.has_permission('config.report_tax') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Tujuh dimensi breakdown (PRD §85). Tidak ada dimensi bebas.
  v_group_expr := case p_dimension
    -- A16: per kode metode/channel (bank_transfer, bca_va, gopay, ...), bukan payment.method mentah
    -- yang membuat seluruh e-payment menjadi satu baris "instant".
    when 'payment_method' then 'coalesce(o.payment_identifier, o.payment_method, ''-'')'
    when 'product' then 'coalesce(o.product_name, ''-'')'
    when 'batch' then 'coalesce(o.batch, ''-'')'
    when 'advertiser' then 'coalesce(o.advertiser_name, ''-'')'
    when 'date' then 'to_char(o.created_at, ''YYYY-MM-DD'')'
    when 'city' then 'coalesce(o.city, ''-'')'
    when 'event_type' then 'coalesce(o.event_type, ''-'')'
    else null
  end;
  if v_group_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_DIMENSION';
  end if;

  execute format($q$
    with filtered as (
      select %s as label, o.gross_amount, o.tax_amount, o.epayment_tax_amount, o.platform_fee_amount, o.net_amount
        from public.orders o
       -- A15: laporan uang hanya order Paid (Pending belum tentu dibayar, Cancelled tidak menghasilkan uang).
       where o.app_status = 'Paid' and %s
    ),
    grouped as (
      select label,
             count(*)::int as transactions,
             coalesce(sum(gross_amount), 0)::numeric(18,2) as gross_amount,
             coalesce(sum(tax_amount), 0)::numeric(18,2) as tax_amount,
             coalesce(sum(epayment_tax_amount), 0)::numeric(18,2) as epayment_tax_amount,
             coalesce(sum(platform_fee_amount), 0)::numeric(18,2) as platform_fee_amount,
             coalesce(sum(net_amount), 0)::numeric(18,2) as net_amount
        from filtered
       group by label
    )
    select jsonb_build_object(
      'dimension', %L,
      -- Summary selalu dihitung dari SELURUH baris yang lolos filter,
      -- bukan dari jumlah baris breakdown yang terkirim.
      'summary', (
        select jsonb_build_object(
          'transactions', coalesce(sum(transactions), 0),
          'gross_amount', coalesce(sum(gross_amount), 0),
          'tax_amount', coalesce(sum(tax_amount), 0),
          'epayment_tax_amount', coalesce(sum(epayment_tax_amount), 0),
          'platform_fee_amount', coalesce(sum(platform_fee_amount), 0),
          'net_amount', coalesce(sum(net_amount), 0)
        ) from grouped
      ),
      'rows', coalesce(
        (select jsonb_agg(to_jsonb(g) order by g.label asc) from grouped g),
        '[]'::jsonb
      )
    )
  $q$, v_group_expr, v_filter, p_dimension)
  into v_result
  using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
        p_event_type, p_batch, p_session, p_city;

  return v_result;
end;
$function$;
