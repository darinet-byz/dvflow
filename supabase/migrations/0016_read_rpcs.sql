-- ============================================================================
-- 0016_read_rpcs — RPC baca (AMENDMENTS A4)
-- ============================================================================
--
-- Mengapa RPC dan bukan query PostgREST biasa (A4):
--   * `presensi_page`     -> urut `total_activity`/`latest_activity` tidak bisa
--                            dinyatakan lewat PostgREST tanpa membocorkan nama kolom;
--   * `dashboard_summary` -> seluruh KPI wajib memakai SATU set filter yang sama
--                            (PRD §41: "tidak boleh ada KPI yang memakai filter berbeda");
--   * `tax_report`        -> breakdown 7 dimensi; RLS tidak bisa menolak satu halaman
--                            saja untuk staff, jadi cek peran ada di dalam fungsi (04 §1).
--
-- Ketiganya SECURITY INVOKER: RLS tetap berlaku, jadi fungsi tidak menambah
-- permukaan akses baru.
--
-- PREDIKAT FILTER (`v_filter` di bawah) SENGAJA identik di ketiga fungsi.
-- Alasannya: dokumen menuntut definisi filter yang sama untuk seluruh angka.
-- Duplikasi ini dijaga oleh test `supabase/tests/filter_parity.sql`, yang
-- membandingkan hasil ketiga fungsi pada set filter yang sama.
--
-- Tanggal: filter `p_date_from`/`p_date_to` memakai `orders.created_at`
-- (tanggal order diterima), inklusif pada kedua ujung.
--
-- Pencarian: teks pengguna diperlakukan sebagai DATA, bukan pola. Karakter
-- `%`, `_`, dan `\` di-escape lebih dulu (lihat `v_search` di setiap fungsi),
-- sehingga mengetik `%` tidak berubah menjadi "tampilkan semua baris". Ini
-- melengkapi L06 pada sisi perilaku, bukan hanya sisi injeksi.

-- ---------------------------------------------------------------------------
-- presensi_page (PRD §102–§111, 01 §6)
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
  p_page_size integer default 50
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
  v_base text;
  v_classified text;
  v_paged text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
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
$$;

-- ---------------------------------------------------------------------------
-- dashboard_summary (PRD §40–§43, STATE.md K4)
-- ---------------------------------------------------------------------------
-- KPI yang dikembalikan persis yang didokumentasikan; tidak ada KPI tambahan
-- dan tidak ada chart (01 §16).
--
-- Formula turunan yang PRD namai tetapi tidak rumuskan (K4):
--   Conversion Rate = Paid / Leads
--   Attendance Rate = Sudah Hadir / Paid
-- Keduanya NULL bila penyebutnya 0 — bukan 0, supaya UI membedakan
-- "belum ada data" dari "nol persen".
create or replace function public.dashboard_summary(
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
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  execute format($q$
    with filtered as (
      select o.app_status, o.gross_amount, o.tax_amount, o.net_amount,
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
        count(*) filter (where app_status = 'Pending')::int as pending,
        count(*) filter (where app_status = 'Cancelled')::int as cancelled,
        coalesce(sum(gross_amount), 0)::numeric(18,2) as gross_amount,
        coalesce(sum(tax_amount), 0)::numeric(18,2) as tax_amount,
        coalesce(sum(net_amount), 0)::numeric(18,2) as net_amount,
        count(*) filter (where app_status = 'Paid' and has_attendance)::int as sudah_hadir
      from filtered
    )
    select jsonb_build_object(
      'leads', a.leads,
      'paid', a.paid,
      'pending', a.pending,
      'cancelled', a.cancelled,
      'conversion_rate', case when a.leads > 0 then round(a.paid::numeric / a.leads, 4) else null end,
      'gross_amount', a.gross_amount,
      'tax_amount', a.tax_amount,
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
$$;

-- ---------------------------------------------------------------------------
-- tax_report (PRD §84–§86, 01 §6)
-- ---------------------------------------------------------------------------
-- Cek peran DI DALAM fungsi: staff tidak boleh membuka Report Tax (04 §1, B04).
-- RLS tidak dapat menolak satu halaman saja, jadi pagar-nya ada di sini.
create or replace function public.tax_report(
  p_dimension text,
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
  v_group_expr text;
  v_search text;
  v_result jsonb;
begin
  if public.app_role() not in ('master_admin', 'admin') then
    raise exception using errcode = 'DF012', message = 'FORBIDDEN_REPORT_TAX';
  end if;

  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Tujuh dimensi breakdown (PRD §85). Tidak ada dimensi bebas.
  v_group_expr := case p_dimension
    when 'payment_method' then 'coalesce(o.payment_method, ''-'')'
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
      select %s as label, o.gross_amount, o.tax_amount, o.net_amount
        from public.orders o
       where %s
    ),
    grouped as (
      select label,
             count(*)::int as transactions,
             coalesce(sum(gross_amount), 0)::numeric(18,2) as gross_amount,
             coalesce(sum(tax_amount), 0)::numeric(18,2) as tax_amount,
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
$$;

-- ---------------------------------------------------------------------------
-- Grant RPC baca: seluruh user aplikasi (Dashboard/Presensi/Order/Generator).
-- tax_report memang di-grant juga — penolakan staff terjadi di dalam fungsi,
-- supaya pesannya eksplisit (FORBIDDEN_REPORT_TAX), bukan "nol baris".
-- ---------------------------------------------------------------------------
revoke all on function public.presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.dashboard_summary(text, date, date, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.tax_report(text, text, date, date, text, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.presensi_page(text, date, date, text, text, text, text, text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.dashboard_summary(text, date, date, text, text, text, text, text, text) to authenticated;
grant execute on function public.tax_report(text, text, date, date, text, text, text, text, text, text) to authenticated;
