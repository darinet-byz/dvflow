-- ============================================================================
-- A74 — Toggle status sesi khusus Developer + OTS menolak sesi nonaktif
-- ============================================================================
--
-- Permintaan pengguna: Sesi Tunggal (ST) tidak dipakai lagi, tetapi 344 order
-- dan 8 alias di produksi masih menunjuk ST. Menghapus barisnya akan membuat
-- parser kehilangan kamus (replay webhook order lama berubah menjadi invalid),
-- jadi baris TIDAK dihapus. Yang ditambahkan adalah aturan:
--
--   1. Role selain Developer boleh menambah sesi, dan sesi baru selalu aktif.
--   2. Menonaktifkan/mengaktifkan sesi hanya boleh oleh role Developer.
--   3. OTS tidak boleh MEMBUAT pendaftaran dengan sesi nonaktif. Saat mengedit,
--      sesi lama yang sudah tersimpan tetap boleh dipertahankan supaya koreksi
--      nama peserta tidak gagal karena sesi itu kemudian dinonaktifkan.
--   4. Reset konfigurasi produk menanam ST dalam keadaan nonaktif.
--
-- Tidak ada baris yang dihapus dan tidak ada data historis yang diubah.
-- ============================================================================
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 76 $$;

-- ---------------------------------------------------------------------------
-- 1. Hard delete sesi hanya Developer
-- ---------------------------------------------------------------------------
create or replace function public.delete_config_master(p_actor uuid, p_resource text, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_table text; v_code text;
begin
  if not public.actor_has_permission(p_actor, 'action.delete_master') or
    not public.actor_has_permission(p_actor, case when p_resource = 'payment-fee-rules' then 'config.tax' else 'config.produk' end) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  -- Sesi hanya boleh dihapus permanen oleh Developer, sejalan dengan aturan
  -- toggle status di API. Order/alias tetap menjadi penjaga terakhir lewat
  -- master_is_used di bawah.
  if p_resource = 'sessions' and not exists (
    select 1 from public.users where id = p_actor and active and role = 'developer'
  ) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  v_table := case p_resource when 'products' then 'products' when 'advertisers' then 'advertisers'
    when 'event-types' then 'event_types' when 'sessions' then 'sessions_config' when 'payment-fee-rules' then 'payment_fee_rules' end;
  if v_table is null then raise exception using errcode = 'DF011', message = 'INVALID_RESOURCE'; end if;
  -- Freeze dependent writes between the dependency check and deletion.
  lock table public.orders, public.product_aliases, public.app_settings, public.user_product_access in share row exclusive mode;
  execute format('select %I from public.%I where id = $1 for update', case when p_resource = 'payment-fee-rules' then 'identifier' else 'code' end, v_table) into v_code using p_id;
  if v_code is null then raise exception using errcode = 'DF011', message = 'MASTER_NOT_FOUND'; end if;
  if not public.actor_can_product(p_actor, case when p_resource = 'products' then v_code else null end) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if public.master_is_used(p_resource,v_code,p_id) then raise exception using errcode = 'DF015', message = 'MASTER_IN_USE'; end if;
  execute format('delete from public.%I where id = $1', v_table) using p_id;
end $$;
revoke all on function public.delete_config_master(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.delete_config_master(uuid,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Reset konfigurasi: ST ditanam nonaktif
-- ---------------------------------------------------------------------------
create or replace function public.reset_product_configuration(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_result jsonb; v_count integer;
begin
  if not exists(select 1 from public.users where id = p_actor and active and role = 'developer') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  lock table public.orders, public.attendance_events, public.products, public.advertisers,
    public.event_types, public.sessions_config, public.product_aliases, public.app_settings,
    public.user_product_access in share row exclusive mode;
  -- Even an unmapped order may need the old dictionary on its next webhook update.
  if exists(select 1 from public.orders) or exists(select 1 from public.attendance_events) then
    raise exception using errcode = 'DF015', message = 'TRANSACTIONS_DEPEND_ON_CONFIGURATION';
  end if;
  v_result := jsonb_build_object(
    'products',(select count(*) from public.products), 'advertisers',(select count(*) from public.advertisers),
    'event_types',(select count(*) from public.event_types), 'sessions_config',(select count(*) from public.sessions_config),
    'product_aliases',(select count(*) from public.product_aliases), 'user_product_access',(select count(*) from public.user_product_access)
  );
  delete from public.product_aliases;
  delete from public.app_settings where key like 'webinar_destination::%' or key like 'seminar_ticket::%';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('event_mappings',v_count);
  delete from public.user_product_access;
  delete from public.products;
  delete from public.advertisers;
  delete from public.event_types;
  delete from public.sessions_config;
  -- The parser cannot work without the canonical event types (seeded in 0006).
  insert into public.event_types(name,code,kind) values ('Seminar Offline','SO','seminar'),('Webinar Online','WO','webinar');
  -- ST tetap ditanam (baris masih dibutuhkan kamus parser & data historis) tetapi
  -- nonaktif, sehingga tidak muncul di pemilih. S1–S8 aktif.
  insert into public.sessions_config(name,code,active)
    select case when n = 0 then 'Sesi Tunggal' else 'Sesi ' || n end,
      case when n = 0 then 'ST' else 'S' || n end,
      n > 0
      from generate_series(0,8) n;
  alter table public.products validate constraint products_code_standard;
  alter table public.advertisers validate constraint advertisers_code_standard;
  alter table public.event_types validate constraint event_types_code_standard;
  alter table public.sessions_config validate constraint sessions_code_standard;
  alter table public.products validate constraint products_name_length;
  alter table public.advertisers validate constraint advertisers_name_length;
  alter table public.event_types validate constraint event_types_name_length;
  alter table public.sessions_config validate constraint sessions_name_length;
  return jsonb_build_object('success',true,'deleted',v_result,'seeded_sessions',9,'seeded_event_types',2);
end $$;
revoke all on function public.reset_product_configuration(uuid) from public, anon, authenticated;
grant execute on function public.reset_product_configuration(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. OTS: sesi nonaktif hanya boleh dipertahankan saat edit
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
  -- Sesi harus terdaftar. Untuk pendaftaran baru sesi juga harus AKTIF; saat
  -- mengedit, sesi lama yang sama boleh dipertahankan walau sudah nonaktif.
  if v_session is not null and not exists (
    select 1 from public.sessions_config s
     where s.code_normalized = public.normalize_code(v_session)
       and (
         s.active
         or exists (
           select 1 from public.orders o
            where o.order_id = btrim(coalesce(p_order_id, ''))
              and public.normalize_code(o.session) = public.normalize_code(v_session)
         )
       )
  ) then
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
