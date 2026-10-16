-- 0040_paid_tickets — A25 (16 Okt 2026): Dashboard menampilkan Jumlah Tiket = total quantity order Paid.
-- Paid tetap dihitung per Order ID (1 Order ID = 1 baris; processing -> complete tidak menambah hitungan).
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 40 $$;

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
      and ($7::text is null or o.batch = $7::text)
      and ($8::text is null or o.session = $8::text)
      and ($9::text is null or o.city = $9::text)
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
