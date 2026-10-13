-- ============================================================================
-- 0020_orders_page — RPC baca untuk tabel Master Order
-- ============================================================================
--
-- Mengapa RPC, bukan query PostgREST langsung dari browser:
--   * SATU definisi filter. Tabel Order memakai filter yang sama dengan
--     Dashboard (PRD §41: "semua angka mengikuti filter aktif"), dan menyalin
--     predikat itu ke dalam JavaScript berarti dua tempat yang bisa menyimpang;
--   * server yang menegakkan whitelist sort (CLAUDE.md §15), bukan kepercayaan
--     pada UI;
--   * ringkasan (Total Result / Paid / Pending) dihitung dari himpunan yang
--     SAMA dengan barisnya, dalam satu transaksi — tidak mungkin menyimpang;
--   * teks pencarian tidak perlu disusun menjadi bahasa filter PostgREST di
--     browser, sehingga tidak ada permukaan escaping kedua.
--
-- SECURITY INVOKER: RLS tetap berlaku, jadi fungsi ini tidak menambah akses
-- apa pun. Ini objek database tambahan — dicatat sebagai AMENDMENTS A9.

create or replace function public.orders_page(
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_event_type text default null,
  p_batch text default null,
  p_session text default null,
  p_city text default null,
  p_app_status text default null,
  p_payment_method text default null,
  p_sort text default 'created_at',
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
      and ($2::date is null or o.created_at >= $2::date)
      and ($3::date is null or o.created_at < ($3::date + 1))
      and ($4::text is null or o.product_code = $4::text)
      and ($5::text is null or o.advertiser_code = $5::text)
      and ($6::text is null or o.event_type = $6::text)
      and ($7::text is null or o.batch = $7::text)
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or o.city = $9::text)
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
$$;

revoke all on function public.orders_page(text, date, date, text, text, text, text, text, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.orders_page(text, date, date, text, text, text, text, text, text, text, text, text, text, integer, integer)
  to authenticated;
