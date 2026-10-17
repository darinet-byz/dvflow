-- 0041_ots_registrations — A29 (permintaan pengguna 17 Okt 2026): peserta OTS (bayar di lokasi seminar).
-- Fitur tersendiri: setiap pendaftaran OTS = satu order baru (source 'ots', Order ID OTS-000001),
-- Paid, 1 tiket, langsung check-in seminar. Order Pending OrderOnline tidak disentuh. Pembayaran hanya
-- dicatat di dvflow (nominal + metode). Order OTS boleh diedit (pengecualian aturan "No Master Order
-- edit", khusus source 'ots') dan dihapus oleh pemegang izin hapus.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 41 $$;

alter table public.orders
  add column if not exists source text not null default 'orderonline',
  add column if not exists ots_collected_by uuid references public.users (id) on delete set null;
alter table public.orders
  add constraint orders_source_check check (source in ('orderonline', 'ots'));

create sequence if not exists public.ots_order_seq;

-- Kode toko OTS dicadangkan: Order ID OTS-… tidak boleh bisa dibuat oleh koneksi OrderOnline (A27).
alter table public.orderonline_connections
  add constraint orderonline_connections_slug_not_reserved check (slug is null or slug <> 'OTS');

alter table public.attendance_events drop constraint attendance_events_source_check;
alter table public.attendance_events
  add constraint attendance_events_source_check check (source in ('webinar_redirect', 'seminar_qr', 'seminar_manual', 'seminar_ots'));
alter table public.attendance_events drop constraint attendance_events_source_matches_type;
alter table public.attendance_events
  add constraint attendance_events_source_matches_type check (
    (attendance_type = 'webinar' and source = 'webinar_redirect')
    or (attendance_type = 'seminar' and source in ('seminar_qr', 'seminar_manual', 'seminar_ots'))
  );

insert into public.app_permissions (key, name, module, description, sort_order)
values ('action.ots', 'Pendaftaran OTS', 'aksi', 'Mencatat peserta yang membayar di lokasi seminar (OTS) dan langsung check-in', 43)
on conflict (key) do nothing;
insert into public.app_role_permissions (role_id, permission_key)
select r, 'action.ots' from unnest(array['manajer', 'admin']) r
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- Buat (p_order_id null) atau edit (p_order_id = OTS-…) pendaftaran OTS.
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
  p_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_batch text := nullif(btrim(coalesce(p_batch, '')), '');
  v_session text := nullif(upper(btrim(coalesce(p_session, ''))), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_amount numeric(18, 2);
  v_product public.products;
  v_order public.orders;
  v_raw text;
  v_created boolean := false;
begin
  if not public.actor_has_permission(p_actor, 'action.ots') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_name = '' or length(v_name) > 200 or length(coalesce(v_phone, '')) > 32
     or length(coalesce(v_batch, '')) > 32 or length(coalesce(v_city, '')) > 100
     or p_method is null or p_method not in ('ots_tunai', 'ots_transfer', 'ots_qris')
     or p_event_type is null or p_event_type not in ('Seminar Offline', 'Hybrid')
     or p_amount is null or p_amount <= 0 or p_amount > 9999999999 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  v_amount := round(p_amount, 2);

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
      v_raw, 'valid', v_product.code, v_product.name, p_event_type, v_batch, v_session, v_city,
      'ots', 'Paid', p_method, 'ots', p_method, p_method,
      -- Tidak lewat OrderOnline: tanpa e-payment fee, pajak, maupun platform fee.
      v_amount, 0, v_amount, 'mapped', 1,
      now(), now(), now()
    )
    returning * into v_order;
    v_created := true;

    -- Peserta OTS sudah di lokasi: langsung hadir (satu check-in seminar per order).
    insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id)
    values (v_order.order_id, 'seminar', 'seminar_ots', p_actor)
    on conflict (order_id) where attendance_type = 'seminar' do nothing;
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
           event_type = p_event_type, batch = v_batch, session = v_session, city = v_city,
           payment_method = p_method, payment_identifier = p_method, payment_identifier_normalized = p_method,
           gross_amount = v_amount, net_amount = v_amount, source_updated_at = now()
     where order_id = v_order.order_id
     returning * into v_order;
  end if;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'action', case when v_created then 'created' else 'updated' end,
    'checked_in_at', (select clicked_at from public.attendance_events where order_id = v_order.order_id and attendance_type = 'seminar')
  );
end;
$$;

-- Hapus pendaftaran OTS yang salah input (mis. ganda). Hanya order OTS.
create or replace function public.delete_ots_registration(p_actor uuid, p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
begin
  if not public.actor_has_permission(p_actor, 'action.ots') or not public.actor_has_permission(p_actor, 'action.delete_master') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select * into v_order from public.orders where order_id = btrim(coalesce(p_order_id, '')) for update;
  if not found or v_order.source <> 'ots' then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_product(p_actor, v_order.product_code) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  delete from public.attendance_events where order_id = v_order.order_id;
  delete from public.orders where order_id = v_order.order_id;
  return jsonb_build_object('order_id', v_order.order_id, 'deleted', true);
end;
$$;

revoke all on function public.save_ots_registration(uuid, text, text, text, text, text, text, text, text, numeric, text),
  public.delete_ots_registration(uuid, text) from public, anon, authenticated;
grant execute on function public.save_ots_registration(uuid, text, text, text, text, text, text, text, text, numeric, text),
  public.delete_ots_registration(uuid, text) to service_role;
revoke all on sequence public.ots_order_seq from public, anon, authenticated;

-- upsert_order_webhook: sama dengan 0036 + penjaga order OTS.
CREATE OR REPLACE FUNCTION public.upsert_order_webhook(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
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
  v_quantity integer;
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
  v_mapping_kept boolean := false;
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

  -- A19: jumlah tiket opsional; tidak disebut = nilai tersimpan (default 1) dipertahankan.
  if jsonb_typeof(p_payload -> 'quantity') = 'number' then
    begin
      v_quantity := (p_payload ->> 'quantity')::integer;
    exception
      when others then
        raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
    end;
    if (p_payload ->> 'quantity')::numeric <> v_quantity or v_quantity < 1 or v_quantity > 10000 then
      raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
    end if;
  elsif coalesce(jsonb_typeof(p_payload -> 'quantity'), 'null') <> 'null' then
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

  -- A29: order OTS dibuat petugas di lokasi, bukan oleh OrderOnline; webhook tidak boleh menimpanya.
  if v_existing.source = 'ots' then
    raise exception using errcode = 'DF014', message = 'INVALID_PAYLOAD';
  end if;

  -- A17: parse invalid pada webhook berikutnya tidak boleh menghapus pemetaan order yang sudah
  -- valid untuk nama produk yang SAMA (mis. alias dihapus setelah order dipetakan). Nama produk
  -- yang berbeda tetap di-parse ulang; order baru tetap mengikuti hasil parse.
  if not v_inserted and v_parse is not null and coalesce(v_parse ->> 'status', '') <> 'valid'
     and v_existing.product_parse_status = 'valid'
     and lower(btrim(coalesce(v_product_raw, ''))) = lower(btrim(coalesce(v_existing.product_raw, ''))) then
    v_parse := null;
    v_mapping_kept := true;
  end if;
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
    quantity = coalesce(v_quantity, quantity),
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

  return jsonb_build_object('order_id', v_order_id, 'action', v_action, 'mapping_kept', v_mapping_kept);
end;
$function$;
