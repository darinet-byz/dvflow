-- ============================================================================
-- 0017_write_rpcs — RPC tulis (AMENDMENTS A4)
-- ============================================================================
--
-- Seluruh penulisan lewat fungsi SECURITY DEFINER yang hanya dapat dieksekusi
-- `service_role` (STATE.md K11). Tidak ada policy tulis di 0015, jadi tabelnya
-- sendiri tetap tertutup untuk browser.
--
-- ---------------------------------------------------------------------------
-- TABEL KODE ERROR (dipakai Worker untuk memetakan ke HTTP)
-- ---------------------------------------------------------------------------
--   DF001 ORDER_NOT_FOUND                  404
--   DF002 ORDER_NOT_PAID                   403
--   DF003 NOT_SEMINAR_ORDER                409
--   DF004 INVALID_CREDENTIALS              401
--   DF005 USER_DISABLED                    401
--   DF006 FORBIDDEN                        403
--   DF007 WEAK_PASSWORD                    400
--   DF008 MASTER_ADMIN_CREATE_FORBIDDEN    403
--   DF009 USERNAME_TAKEN                   409
--   DF010 PASSWORD_MISMATCH                400
--   DF011 INVALID_ARGUMENT                 400  (dipakai juga oleh RPC baca 0016)
--   DF012 FORBIDDEN_REPORT_TAX             403
--   DF014 INVALID_PAYLOAD                  400
--
-- `message` sengaja sama dengan nama kode, supaya Worker tidak perlu
-- mencocokkan teks bebas.

-- ============================================================================
-- upsert_order_webhook
-- ============================================================================
-- Idempoten berdasarkan `order_id` UNIQUE (C01, C02, C14, M01) dan sekaligus
-- menentukan snapshot tax dalam satu transaksi (M03).
--
-- Pemanggil (Worker) mengirim objek KANONIK yang sudah divalidasi (03 §2),
-- bukan payload mentah provider. Parsing produk TIDAK dilakukan di sini:
-- parser hidup di packages/shared dan hasilnya dikirim pada blok `parse`.
-- Yang dihitung di SQL hanyalah aritmetika tax (K10) dan normalisasi
-- payment identifier (agar pasti identik dengan kolom generated di
-- payment_fee_rules).
--
-- Semantik merge webhook berulang (AMENDMENTS A7):
--   * `null` pada field opsional berarti "tidak disebutkan", BUKAN "kosongkan" —
--     nilai lama dipertahankan. Ini sejalan dengan cara tax.ts memperlakukan
--     identifier null.
--   * blok `parse` hanya ditulis bila `productRaw` dikirim; itulah satu-satunya
--     saat kita tahu hasil parsing benar-benar berlaku (01 §9).
--   * `gross_amount`, `raw_status`, dan `app_status` selalu ditulis (wajib).
--   * `created_at` dan `paid_at` tidak pernah ditimpa setelah terisi.
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

  select r.id, r.name, r.fee_type, r.fee_value
    into v_rule_id, v_rule_name, v_rule_type, v_rule_value
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
    or (v_existing.tax_mapping_status = 'unmapped' and v_has_rule);

  if v_recalculate then
    if v_has_rule then
      v_tax := public.calc_tax_amount(v_gross, v_rule_type, v_rule_value);
      v_net := round(v_gross - v_tax, 2);
      v_tax_status := 'mapped';
      v_snap_id := v_rule_id;
      v_snap_name := v_rule_name;
      v_snap_type := v_rule_type;
      v_snap_value := v_rule_value;
    else
      v_tax := 0;
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
    source_created_at = coalesce(v_source_created_at, source_created_at),
    source_updated_at = coalesce(v_source_updated_at, source_updated_at),
    paid_at = v_paid_at
  where order_id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'action', v_action);
end;
$$;

-- ============================================================================
-- checkin_seminar
-- ============================================================================
-- Idempoten per `order_id` (G01–G06, H01–H05, H09, H10, M02).
--
-- QR adalah pengenal, BUKAN otorisasi (04 §11): seluruh syarat diperiksa ulang
-- di sini — order ada, Paid, Seminar Offline, dan belum pernah check-in.
-- Idempotensi ditegakkan partial unique index, bukan pengecekan UI, sehingga
-- dua scan nyaris bersamaan tetap menghasilkan satu baris.
create or replace function public.checkin_seminar(
  p_order_id text,
  p_source text,
  p_scanner_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_inserted boolean := false;
  v_clicked_at timestamptz;
  v_id uuid;
begin
  if p_source not in ('seminar_qr', 'seminar_manual') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id);
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if v_order.app_status <> 'Paid' then
    raise exception using errcode = 'DF002', message = 'ORDER_NOT_PAID';
  end if;
  if v_order.event_type is distinct from 'Seminar Offline' then
    raise exception using errcode = 'DF003', message = 'NOT_SEMINAR_ORDER';
  end if;

  insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id)
  values (v_order.order_id, 'seminar', p_source, p_scanner_user_id)
  on conflict (order_id) where attendance_type = 'seminar' do nothing
  returning id, clicked_at into v_id, v_clicked_at;
  v_inserted := found;

  if not v_inserted then
    -- Scan berulang: kembalikan timestamp check-in PERTAMA (01 §13).
    select id, clicked_at into v_id, v_clicked_at
      from public.attendance_events
     where order_id = v_order.order_id
       and attendance_type = 'seminar';
  end if;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'state', case when v_inserted then 'CHECKIN_SUCCESS' else 'ALREADY_CHECKED_IN' end,
    'attendance_id', v_id,
    'clicked_at', v_clicked_at,
    'scanner_user_id', p_scanner_user_id
  );
end;
$$;

-- ============================================================================
-- verify_login
-- ============================================================================
-- Verifikasi password dilakukan di database (AMENDMENTS A1): bcrypt
-- `extensions.crypt()` tidak bisa dijalankan di workerd dengan biaya CPU yang
-- diizinkan free plan.
--
-- Pesan gagal SELALU sama (`INVALID_CREDENTIALS`) untuk username tidak dikenal
-- maupun password salah, supaya tidak membocorkan keberadaan akun (A02, A03,
-- 03 §4). User nonaktif hanya dibedakan SETELAH password terbukti benar,
-- sehingga pembeda itu tidak berguna bagi penebak.
create or replace function public.verify_login(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.users;
  v_normalized text;
begin
  v_normalized := lower(regexp_replace(coalesce(p_username, ''), '^\s+|\s+$', '', 'g'));

  if v_normalized = '' or coalesce(p_password, '') = '' then
    raise exception using errcode = 'DF004', message = 'INVALID_CREDENTIALS';
  end if;

  select * into v_user from public.users where username_normalized = v_normalized;

  if not found then
    -- Kerjakan bcrypt sekali juga pada jalur "user tidak ada" supaya waktu
    -- responsnya tidak menjadi oracle keberadaan akun.
    perform extensions.crypt(p_password, extensions.gen_salt('bf', 12));
    raise exception using errcode = 'DF004', message = 'INVALID_CREDENTIALS';
  end if;

  if extensions.crypt(p_password, v_user.password_hash) <> v_user.password_hash then
    raise exception using errcode = 'DF004', message = 'INVALID_CREDENTIALS';
  end if;

  if not v_user.active then
    raise exception using errcode = 'DF005', message = 'USER_DISABLED';
  end if;

  return jsonb_build_object(
    'user_id', v_user.id,
    'username', v_user.username,
    'display_name', v_user.display_name,
    'role', v_user.role,
    'avatar_emoji', v_user.avatar_emoji
  );
end;
$$;

-- ============================================================================
-- admin_create_user
-- ============================================================================
-- Dipakai endpoint internal (03 §14). Pembuat Master Admin baru hanya boleh
-- bila environment ALLOW_MASTER_ADMIN_CREATE_MASTER=true (O3: default false).
create or replace function public.admin_create_user(
  p_actor_user_id uuid,
  p_username text,
  p_display_name text,
  p_initial_password text,
  p_role text,
  p_avatar_emoji text default null,
  p_allow_master boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_actor public.users;
  v_username text;
  v_display_name text;
  v_new public.users;
begin
  select * into v_actor from public.users where id = p_actor_user_id;
  if not found or not v_actor.active or v_actor.role <> 'master_admin' then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if p_role not in ('master_admin', 'admin', 'staff') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  if p_role = 'master_admin' and not p_allow_master then
    raise exception using errcode = 'DF008', message = 'MASTER_ADMIN_CREATE_FORBIDDEN';
  end if;

  v_username := regexp_replace(coalesce(p_username, ''), '^\s+|\s+$', '', 'g');
  v_display_name := regexp_replace(coalesce(p_display_name, ''), '^\s+|\s+$', '', 'g');

  if v_username = '' or length(v_username) > 64 or v_username ~ '\s'
     or v_display_name = '' or length(v_display_name) > 200 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  -- Panjang minimum password 8 karakter (01 §4). Tanpa aturan kompleksitas lain.
  if length(coalesce(p_initial_password, '')) < 8 then
    raise exception using errcode = 'DF007', message = 'WEAK_PASSWORD';
  end if;

  begin
    insert into public.users (username, display_name, password_hash, password_algo, role, avatar_emoji)
    values (
      v_username,
      v_display_name,
      extensions.crypt(p_initial_password, extensions.gen_salt('bf', 12)),
      'bcrypt',
      p_role,
      nullif(btrim(p_avatar_emoji), '')
    )
    returning * into v_new;
  exception
    when unique_violation then
      raise exception using errcode = 'DF009', message = 'USERNAME_TAKEN';
  end;

  return jsonb_build_object(
    'user_id', v_new.id,
    'username', v_new.username,
    'display_name', v_new.display_name,
    'role', v_new.role,
    'avatar_emoji', v_new.avatar_emoji,
    'active', v_new.active
  );
end;
$$;

-- ============================================================================
-- change_password
-- ============================================================================
-- Ganti password mencabut SELURUH session user (01 §3, A09); klien harus login
-- ulang. Password lama wajib benar (A08).
create or replace function public.change_password(
  p_user_id uuid,
  p_current_password text,
  p_new_password text,
  p_new_password_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.users;
  v_revoked integer;
begin
  if p_new_password is distinct from p_new_password_confirmation then
    raise exception using errcode = 'DF010', message = 'PASSWORD_MISMATCH';
  end if;
  if length(coalesce(p_new_password, '')) < 8 then
    raise exception using errcode = 'DF007', message = 'WEAK_PASSWORD';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if extensions.crypt(coalesce(p_current_password, ''), v_user.password_hash) <> v_user.password_hash then
    raise exception using errcode = 'DF004', message = 'INVALID_CREDENTIALS';
  end if;

  update public.users
     set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
         password_algo = 'bcrypt'
   where id = v_user.id;

  update public.app_sessions
     set revoked_at = now()
   where user_id = v_user.id
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  return jsonb_build_object('user_id', v_user.id, 'revoked_sessions', v_revoked);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grant: RPC tulis HANYA untuk service_role.
-- ---------------------------------------------------------------------------
revoke all on function public.upsert_order_webhook(jsonb) from public, anon, authenticated;
revoke all on function public.checkin_seminar(text, text, uuid) from public, anon, authenticated;
revoke all on function public.verify_login(text, text) from public, anon, authenticated;
revoke all on function public.admin_create_user(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.change_password(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.upsert_order_webhook(jsonb) to service_role;
grant execute on function public.checkin_seminar(text, text, uuid) to service_role;
grant execute on function public.verify_login(text, text) to service_role;
grant execute on function public.admin_create_user(uuid, text, text, text, text, text, boolean) to service_role;
grant execute on function public.change_password(uuid, text, text, text) to service_role;
