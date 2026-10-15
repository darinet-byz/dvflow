-- 0031_platform_fee_and_epayment_tax — A15 (permintaan pengguna 15 Okt 2026).
--
-- Potongan per order (snapshot, dibekukan saat dihitung; edit tarif tidak mengubah order lama):
--   e-payment fee     = tax_amount (rule: flat Rp atau % dari gross) — kolom lama, makna tetap
--   e-payment fee tax = flat Rp atau % dari e-payment fee (mis. PPN 1% untuk VA)
--   platform fee      = PLATFORM FEE % global x gross, hanya order Paid dan rule yang dicentang
--   net               = gross - e-payment fee - e-payment fee tax - platform fee
-- Report Tax dan nominal Dashboard hanya menjumlahkan order Paid.

alter table public.payment_fee_rules
  add column platform_fee_applies boolean not null default false,
  add column epayment_tax_type text,
  add column epayment_tax_value numeric(18, 4),
  add constraint payment_fee_rules_epayment_tax_type_check check (epayment_tax_type in ('flat', 'percentage')),
  add constraint payment_fee_rules_epayment_tax_value_check check (epayment_tax_value >= 0),
  add constraint payment_fee_rules_epayment_tax_pair_check check ((epayment_tax_type is null) = (epayment_tax_value is null));

alter table public.orders
  add column epayment_tax_amount numeric(18, 2) not null default 0,
  add column epayment_tax_type_snapshot text,
  add column epayment_tax_value_snapshot numeric(18, 4),
  add column platform_fee_amount numeric(18, 2) not null default 0,
  add column platform_fee_percent_snapshot numeric(9, 4),
  add constraint orders_epayment_tax_amount_check check (epayment_tax_amount >= 0),
  add constraint orders_platform_fee_amount_check check (platform_fee_amount >= 0),
  add constraint orders_epayment_tax_type_snapshot_check check (epayment_tax_type_snapshot in ('flat', 'percentage'));

-- PLATFORM FEE global: app_settings key fee_setting::platform_fee_percent (value_text = angka persen).
alter table public.app_settings
  drop constraint if exists app_settings_key_allowed,
  drop constraint if exists app_settings_key_not_blank;
alter table public.app_settings
  add constraint app_settings_key_allowed
    check (key like 'webinar_destination::%' or key like 'seminar_ticket::%' or key like 'fee_setting::%'),
  add constraint app_settings_key_not_blank
    check (btrim(key) not in ('', 'webinar_destination::', 'seminar_ticket::', 'fee_setting::'));

create or replace function public.calc_epayment_tax_amount(p_epayment_fee numeric, p_type text, p_value numeric)
returns numeric language sql immutable set search_path = pg_catalog, pg_temp as $$
  select round(case
    when p_type = 'flat' then p_value
    when p_type = 'percentage' then p_epayment_fee * (p_value / 100)
    else 0
  end, 2)
$$;

-- Nilai tidak valid/terhapus dibaca sebagai 0, bukan error: webhook tidak boleh gagal karena setting.
create or replace function public.platform_fee_percent() returns numeric
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select coalesce((
    select case when value_text ~ '^[0-9]+(\.[0-9]+)?$' then least(value_text::numeric, 100) else 0 end
      from public.app_settings where key = 'fee_setting::platform_fee_percent'
  ), 0)
$$;
revoke all on function public.calc_epayment_tax_amount(numeric, text, numeric), public.platform_fee_percent() from public, anon, authenticated;
grant execute on function public.calc_epayment_tax_amount(numeric, text, numeric), public.platform_fee_percent() to service_role;

create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 31 $$;


-- upsert_order_webhook: sama dengan 0017 + A15.

create or replace function public.upsert_order_webhook(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  -- canonical
  v_order_id text;
  v_name text;
  v_phone text;
  v_email text;
  v_product_raw text;
  v_raw_status text;
  v_payment_method text;
  v_payment_provider text;
  v_payment_identifier text;
  v_gross numeric(18, 2);
  v_source_created_at timestamptz;
  v_source_updated_at timestamptz;
  v_app_status text;
  v_parse jsonb;

  v_existing public.orders;
  v_inserted boolean := false;
  v_action text;

  v_identifier_normalized text;
  v_effective_identifier text;
  v_rule_id uuid;
  v_rule_name text;
  v_rule_type text;
  v_rule_value numeric(18, 4);
  v_has_rule boolean;

  v_recalculate boolean;
  v_tax numeric(18, 2);
  v_net numeric(18, 2);
  v_tax_status text;
  v_snap_id uuid;
  v_snap_name text;
  v_snap_type text;
  v_snap_value numeric(18, 4);
  v_paid_at timestamptz;

  -- A15: e-payment fee tax + platform fee.
  v_rule_platform boolean;
  v_rule_etax_type text;
  v_rule_etax_value numeric(18, 4);
  v_etax numeric(18, 2);
  v_pf numeric(18, 2);
  v_pf_pct numeric(9, 4);
  v_snap_etax_type text;
  v_snap_etax_value numeric(18, 4);
begin
  -- ------------------------------------------------------------------
  -- 1. Validasi payload kanonik. Webhook adalah input tak terpercaya (04 §10),
  --    jadi panjang teks dibatasi dan nilai uang harus wajar.
  -- ------------------------------------------------------------------
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  v_order_id := nullif(btrim(p_payload ->> 'orderId'), '');
  v_raw_status := nullif(btrim(p_payload ->> 'rawStatus'), '');
  v_app_status := nullif(btrim(p_payload ->> 'appStatus'), '');

  if v_order_id is null or v_raw_status is null or v_app_status is null then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;
  if length(v_order_id) > 64 or length(v_raw_status) > 32 then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;
  if v_app_status not in ('Pending', 'Paid', 'Cancelled') then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  if p_payload ->> 'grossAmount' is null then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;
  begin
    v_gross := round((p_payload ->> 'grossAmount')::numeric, 2);
  exception
    when others then
      raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end;
  if v_gross is null or v_gross < 0 or v_gross > 9999999999999999.99 then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  v_name := nullif(btrim(p_payload ->> 'customerName'), '');
  v_phone := nullif(btrim(p_payload ->> 'phone'), '');
  v_email := nullif(btrim(p_payload ->> 'email'), '');
  v_product_raw := nullif(btrim(p_payload ->> 'productRaw'), '');
  v_payment_method := nullif(btrim(p_payload ->> 'paymentMethod'), '');
  v_payment_provider := nullif(btrim(p_payload ->> 'paymentProvider'), '');
  v_payment_identifier := nullif(btrim(p_payload ->> 'paymentIdentifier'), '');

  -- Batas panjang sama dengan packages/shared/src/domain/constants.ts.
  if length(coalesce(v_name, '')) > 200
     or length(coalesce(v_phone, '')) > 32
     or length(coalesce(v_email, '')) > 200
     or length(coalesce(v_product_raw, '')) > 200
     or length(coalesce(v_payment_method, '')) > 100
     or length(coalesce(v_payment_provider, '')) > 100
     or length(coalesce(v_payment_identifier, '')) > 200 then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  begin
    v_source_created_at := nullif(btrim(p_payload ->> 'sourceCreatedAt'), '')::timestamptz;
    v_source_updated_at := nullif(btrim(p_payload ->> 'sourceUpdatedAt'), '')::timestamptz;
  exception
    when others then
      raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end;

  v_parse := case when jsonb_typeof(p_payload -> 'parse') = 'object' then p_payload -> 'parse' else null end;
  if v_product_raw is not null and v_parse is null then
    -- productRaw dikirim tanpa hasil parsing: worker melanggar kontrak.
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  -- ------------------------------------------------------------------
  -- 2. Pastikan baris ada, lalu kunci.
  --
  -- INSERT ... ON CONFLICT DO NOTHING lebih dulu (bukan SELECT lalu INSERT)
  -- supaya dua webhook identik yang datang bersamaan tetap menghasilkan satu
  -- baris: yang kalah menunggu transaksi pemenang, lalu tidak melakukan apa pun
  -- (M01).
  -- ------------------------------------------------------------------
  insert into public.orders (order_id, app_status, gross_amount, product_parse_status)
  values (v_order_id, v_app_status, v_gross, 'invalid')
  on conflict (order_id) do nothing
  returning true into v_inserted;
  v_inserted := coalesce(v_inserted, false);

  select * into v_existing from public.orders where order_id = v_order_id for update;
  v_action := case when v_inserted then 'inserted' else 'updated' end;

  -- ------------------------------------------------------------------
  -- 3. Tentukan snapshot tax.
  --
  -- Aturan hitung ulang (01 §12) dicerminkan dari shouldRecalculateTax() di
  -- packages/shared/src/domain/tax.ts; paritasnya diuji di
  -- supabase/tests/tax_parity.sql.
  -- ------------------------------------------------------------------
  v_identifier_normalized := public.normalize_payment_identifier(v_payment_identifier);

  -- Webhook parsial yang tidak menyebut identifier TIDAK berarti identifier
  -- order menjadi kosong: nilai yang tersimpan tetap yang berlaku (A7). Tanpa
  -- aturan ini, satu webhook parsial yang membawa gross baru akan menghapus
  -- snapshot tax yang sudah benar dan menandai order `unmapped`.
  v_effective_identifier := coalesce(v_identifier_normalized, v_existing.payment_identifier_normalized);

  select r.id, r.name, r.fee_type, r.fee_value, r.platform_fee_applies, r.epayment_tax_type, r.epayment_tax_value
    into v_rule_id, v_rule_name, v_rule_type, v_rule_value, v_rule_platform, v_rule_etax_type, v_rule_etax_value
    from public.payment_fee_rules r
   where r.active
     and r.identifier_normalized = v_effective_identifier
   limit 1;
  v_has_rule := found;

  v_recalculate :=
    v_inserted
    or (v_identifier_normalized is not null
        and v_identifier_normalized is distinct from v_existing.payment_identifier_normalized)
    or (v_gross is distinct from v_existing.gross_amount)
    or (v_existing.tax_mapping_status = 'unmapped' and v_has_rule)
    -- A15: platform fee hanya untuk order Paid, jadi tarif dibekukan saat order dibayar.
    or (v_app_status = 'Paid' and v_existing.app_status is distinct from 'Paid');

  if v_recalculate then
    if v_has_rule then
      v_tax := public.calc_tax_amount(v_gross, v_rule_type, v_rule_value);
      v_etax := public.calc_epayment_tax_amount(v_tax, v_rule_etax_type, v_rule_etax_value);
      v_pf_pct := case when v_rule_platform then public.platform_fee_percent() else null end;
      v_pf := case when v_rule_platform and v_app_status = 'Paid' then round(v_gross * v_pf_pct / 100, 2) else 0 end;
      v_net := round(v_gross - v_tax - v_etax - v_pf, 2);
      v_snap_etax_type := v_rule_etax_type;
      v_snap_etax_value := v_rule_etax_value;
      v_tax_status := 'mapped';
      v_snap_id := v_rule_id;
      v_snap_name := v_rule_name;
      v_snap_type := v_rule_type;
      v_snap_value := v_rule_value;
    else
      v_tax := 0;
      v_etax := 0;
      v_pf := 0;
      v_pf_pct := null;
      v_snap_etax_type := null;
      v_snap_etax_value := null;
      v_net := v_gross;
      v_tax_status := 'unmapped';
      v_snap_id := null;
      v_snap_name := null;
      v_snap_type := null;
      v_snap_value := null;
    end if;
  else
    -- Tidak dihitung ulang: snapshot lama dipertahankan apa adanya (E07–E09).
    v_tax := v_existing.tax_amount;
    v_etax := v_existing.epayment_tax_amount;
    v_pf := v_existing.platform_fee_amount;
    v_pf_pct := v_existing.platform_fee_percent_snapshot;
    v_snap_etax_type := v_existing.epayment_tax_type_snapshot;
    v_snap_etax_value := v_existing.epayment_tax_value_snapshot;
    v_net := v_existing.net_amount;
    v_tax_status := v_existing.tax_mapping_status;
    v_snap_id := v_existing.fee_rule_id;
    v_snap_name := v_existing.fee_rule_name_snapshot;
    v_snap_type := v_existing.fee_type_snapshot;
    v_snap_value := v_existing.fee_value_snapshot;
  end if;

  -- ------------------------------------------------------------------
  -- 4. paid_at: diisi pada transisi pertama ke Paid, tidak pernah dihapus (C13).
  -- ------------------------------------------------------------------
  v_paid_at := v_existing.paid_at;
  if v_app_status = 'Paid' and v_paid_at is null then
    v_paid_at := now();
  end if;

  -- ------------------------------------------------------------------
  -- 5. Tulis. `created_at` sengaja tidak ada di SET: timestamp terima lokal
  --    pertama tidak boleh bergeser karena webhook berulang.
  -- ------------------------------------------------------------------
  update public.orders set
    name = coalesce(v_name, name),
    phone = coalesce(v_phone, phone),
    email = coalesce(v_email, email),
    product_raw = case when v_parse is not null then v_product_raw else product_raw end,
    product_parse_status = case
      when v_parse is null then product_parse_status
      when v_parse ->> 'status' = 'valid' then 'valid'
      else 'invalid'
    end,
    product_code = case when v_parse is null then product_code else nullif(btrim(v_parse ->> 'productCode'), '') end,
    product_name = case when v_parse is null then product_name else nullif(btrim(v_parse ->> 'productName'), '') end,
    advertiser_code = case when v_parse is null then advertiser_code else nullif(btrim(v_parse ->> 'advertiserCode'), '') end,
    advertiser_name = case when v_parse is null then advertiser_name else nullif(btrim(v_parse ->> 'advertiserName'), '') end,
    event_type = case when v_parse is null then event_type else nullif(btrim(v_parse ->> 'eventType'), '') end,
    batch = case when v_parse is null then batch else nullif(btrim(v_parse ->> 'batch'), '') end,
    session = case when v_parse is null then session else nullif(btrim(v_parse ->> 'session'), '') end,
    city = case when v_parse is null then city else nullif(btrim(v_parse ->> 'city'), '') end,
    raw_status = v_raw_status,
    app_status = v_app_status,
    payment_method = coalesce(v_payment_method, payment_method),
    payment_provider = coalesce(v_payment_provider, payment_provider),
    payment_identifier = coalesce(v_payment_identifier, payment_identifier),
    payment_identifier_normalized = coalesce(v_identifier_normalized, payment_identifier_normalized),
    gross_amount = v_gross,
    tax_amount = v_tax,
    net_amount = v_net,
    tax_mapping_status = v_tax_status,
    fee_rule_id = v_snap_id,
    fee_rule_name_snapshot = v_snap_name,
    fee_type_snapshot = v_snap_type,
    fee_value_snapshot = v_snap_value,
    epayment_tax_amount = v_etax,
    epayment_tax_type_snapshot = v_snap_etax_type,
    epayment_tax_value_snapshot = v_snap_etax_value,
    platform_fee_amount = v_pf,
    platform_fee_percent_snapshot = v_pf_pct,
    source_created_at = coalesce(v_source_created_at, source_created_at),
    source_updated_at = coalesce(v_source_updated_at, source_updated_at),
    paid_at = v_paid_at
  where order_id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'action', v_action);
end;
$$;


-- dashboard_summary: sama dengan 0027, nominal uang hanya Paid.

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
  if not public.has_permission('operasional.dashboard') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  execute format($q$
    with filtered as (
      select o.app_status, o.gross_amount, o.tax_amount, o.net_amount, o.epayment_tax_amount, o.platform_fee_amount,
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
$$;

-- tax_report: sama dengan 0027, hanya Paid + dua potongan baru.

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

-- orders_page / export_orders_page: sama dengan 0027 + kolom potongan baru.

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

create or replace function public.export_orders_page(
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
$$;
