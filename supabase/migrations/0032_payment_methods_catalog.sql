-- 0032_payment_methods_catalog — A16 (info provider OrderOnline 15 Okt 2026).
--
-- * Bank transfer: payment.method = "bank_transfer". E-payment: payment.method = "instant",
--   kode channel di payment.channels (bca_va, bri_va, bni_va, bsi_va, permata_va, echannel = Mandiri,
--   gopay, ovo, dana, shopeepay, alfamart, credit_card). Adapter memakai kode itu sebagai identifier.
-- * E-payment fee boleh kombinasi: percentage_flat = gross x persen + flat.
-- * Katalog metode bayar ditulis lengkap (nonaktif, nilai 0) tanpa menimpa rule yang sudah ada.

alter table public.payment_fee_rules drop constraint payment_fee_rules_fee_type_check;
alter table public.payment_fee_rules
  add constraint payment_fee_rules_fee_type_check check (fee_type in ('flat', 'percentage', 'percentage_flat')),
  add column fee_flat_value numeric(18, 4) not null default 0,
  add constraint payment_fee_rules_fee_flat_value_check check (fee_flat_value >= 0);

alter table public.orders drop constraint orders_fee_type_snapshot_check;
alter table public.orders
  add constraint orders_fee_type_snapshot_check check (fee_type_snapshot in ('flat', 'percentage', 'percentage_flat')),
  add column fee_flat_value_snapshot numeric(18, 4);

create or replace function public.calc_epayment_fee(p_gross numeric, p_type text, p_value numeric, p_flat numeric)
returns numeric language sql immutable set search_path = pg_catalog, pg_temp as $$
  select round(case
    when p_type = 'flat' then p_value
    when p_type = 'percentage' then p_gross * (p_value / 100)
    when p_type = 'percentage_flat' then p_gross * (p_value / 100) + coalesce(p_flat, 0)
    else null
  end, 2)
$$;
revoke all on function public.calc_epayment_fee(numeric, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.calc_epayment_fee(numeric, text, numeric, numeric) to service_role;

create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 32 $$;

-- Katalog: nonaktif + nilai 0 sampai operator mengisi dan menyalakan toggle.
insert into public.payment_fee_rules (name, identifier, fee_type, fee_value, platform_fee_applies, epayment_tax_type, epayment_tax_value, active)
select v.name, v.identifier, 'flat', 0, v.platform_fee_applies, v.epayment_tax_type, v.epayment_tax_value, false
  from (values
  ('Bank Transfer', 'bank_transfer', false, null, null),
  ('VA BCA', 'bca_va', true, 'percentage', 1),
  ('VA BRI', 'bri_va', true, 'percentage', 1),
  ('VA BNI', 'bni_va', true, 'percentage', 1),
  ('VA BSI', 'bsi_va', true, 'percentage', 1),
  ('VA Permata', 'permata_va', true, 'percentage', 1),
  ('VA Mandiri', 'echannel', true, 'percentage', 1),
  ('GoPay', 'gopay', true, null, null),
  ('OVO', 'ovo', true, null, null),
  ('DANA', 'dana', true, null, null),
  ('ShopeePay', 'shopeepay', true, null, null),
  ('Alfamart', 'alfamart', true, null, null),
  ('Kartu Kredit', 'credit_card', true, null, null),
  ('E-payment (channel tidak terbaca)', 'instant', true, null, null)
  ) as v(name, identifier, platform_fee_applies, epayment_tax_type, epayment_tax_value)
 where not exists (
   select 1 from public.payment_fee_rules r
    where r.identifier_normalized = public.normalize_payment_identifier(v.identifier)
 );

-- upsert_order_webhook: sama dengan 0031 + e-payment fee kombinasi.
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
  -- A16: bagian flat untuk e-payment fee kombinasi (persen + flat).
  v_rule_flat numeric(18, 4);
  v_snap_flat numeric(18, 4);
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

  select r.id, r.name, r.fee_type, r.fee_value, r.platform_fee_applies, r.epayment_tax_type, r.epayment_tax_value, r.fee_flat_value
    into v_rule_id, v_rule_name, v_rule_type, v_rule_value, v_rule_platform, v_rule_etax_type, v_rule_etax_value, v_rule_flat
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
      v_tax := public.calc_epayment_fee(v_gross, v_rule_type, v_rule_value, v_rule_flat);
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
      v_snap_flat := v_rule_flat;
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
      v_snap_flat := null;
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
    v_snap_flat := v_existing.fee_flat_value_snapshot;
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
    fee_flat_value_snapshot = v_snap_flat,
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
