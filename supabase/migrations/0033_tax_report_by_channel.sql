-- 0033_tax_report_by_channel — breakdown Report Tax "Metode Bayar" per kode channel (A16).
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 33 $$;

-- tax_report: sama dengan 0031, kecuali dimensi payment_method.
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
$$;
