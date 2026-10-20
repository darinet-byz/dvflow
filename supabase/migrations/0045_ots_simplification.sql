-- 0045_ots_simplification — A34 (permintaan pengguna 20 Okt 2026): form OTS cepat untuk meja registrasi.
-- Konteks acara (produk/batch/sesi/kota) diisi sekali; peserta cukup nama, HP, jumlah tiket,
-- harga per tiket, dan metode. Harga per tiket x jumlah tiket dihitung SERVER, bukan dipercaya
-- dari browser. OTS tetap tanpa e-payment fee, tax, atau platform fee.
--
-- Kompatibilitas: signature lama (11 argumen) tetap bisa memanggil fungsi baru karena dua
-- parameter terakhir punya DEFAULT. Ini penting karena aplikasi lama bisa masih terbuka di HP
-- petugas saat database dimigrasi lebih dulu.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 45 $$;

drop function if exists public.save_ots_registration(
  uuid, text, text, text, text, text, text, text, text, numeric, text
);

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
  -- Pemanggil baru mengirim harga satuan. Pemanggil lama hanya mengirim total (p_amount).
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

  -- Form baru mewajibkan No HP, batch, sesi, dan kota. Pemanggil lama tetap diizinkan
  -- mengirim nilai kosong selama masa transisi (aplikasi lama masih bisa terbuka di perangkat).
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
      -- Tidak lewat OrderOnline: tanpa e-payment fee, pajak, maupun platform fee.
      v_amount, 0, v_amount, 'mapped', v_quantity,
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
           event_type = v_event_type, batch = v_batch, session = v_session, city = v_city,
           payment_method = p_method, payment_identifier = p_method, payment_identifier_normalized = p_method,
           gross_amount = v_amount, net_amount = v_amount, quantity = v_quantity,
           source_updated_at = now()
     where order_id = v_order.order_id
     returning * into v_order;

    -- Pengaman untuk data lama/edge case: edit tidak boleh menghilangkan status hadir.
    insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id)
    values (v_order.order_id, 'seminar', 'seminar_ots', p_actor)
    on conflict (order_id) where attendance_type = 'seminar' do nothing;
  end if;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'action', case when v_created then 'created' else 'updated' end,
    'quantity', v_order.quantity,
    'gross_amount', v_order.gross_amount,
    'checked_in_at', (select clicked_at from public.attendance_events where order_id = v_order.order_id and attendance_type = 'seminar')
  );
end;
$$;

revoke all on function public.save_ots_registration(
  uuid, text, text, text, text, text, text, text, text, numeric, text, integer, numeric
) from public, anon, authenticated;
grant execute on function public.save_ots_registration(
  uuid, text, text, text, text, text, text, text, text, numeric, text, integer, numeric
) to service_role;
