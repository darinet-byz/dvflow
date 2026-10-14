-- NOT VALID preserves legacy rows for inspection/backup. New writes are strict.
-- Cleanup validates these constraints after removing unused legacy configuration.
-- Stored generated columns execute these helpers as the writing role.
grant execute on function public.normalize_code(text), public.normalize_payment_identifier(text) to service_role;
alter table public.products add constraint products_code_standard check (code ~ '^[A-Z]{4}$') not valid;
alter table public.advertisers add constraint advertisers_code_standard check (code ~ '^[0-9]{2}$') not valid;
alter table public.event_types add constraint event_types_code_standard check (code ~ '^[A-Z]{2}$') not valid;
alter table public.sessions_config add constraint sessions_code_standard check (code ~ '^(ST|S[1-8])$') not valid;
alter table public.products add constraint products_name_length check (length(btrim(name)) between 1 and 200) not valid;
alter table public.advertisers add constraint advertisers_name_length check (length(btrim(name)) between 1 and 200) not valid;
alter table public.event_types add constraint event_types_name_length check (length(btrim(name)) between 1 and 200) not valid;
alter table public.sessions_config add constraint sessions_name_length check (length(btrim(name)) between 1 and 200) not valid;

-- Whole-token match (delimiters = anything non-alphanumeric). Plain strpos gave false
-- positives, e.g. session ST matching the key prefix "webinar_deSTination".
create or replace function public.master_code_in_text(p_text text, p_code text) returns boolean
language sql immutable set search_path = public, pg_catalog, pg_temp as $$
  select upper(coalesce(p_text,'')) ~ ('(^|[^A-Z0-9])' || regexp_replace(upper(p_code), '[^A-Z0-9]', '', 'g') || '([^A-Z0-9]|$)')
$$;

create or replace function public.master_is_used(p_resource text, p_code text, p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists (select 1 from public.orders o where
    case p_resource
      when 'products' then public.normalize_code(o.product_code) = public.normalize_code(p_code)
        or starts_with(upper(coalesce(o.product_raw,'')), upper(p_code))
      when 'advertisers' then public.normalize_code(o.advertiser_code) = public.normalize_code(p_code)
        or (o.product_parse_status = 'invalid' and public.master_code_in_text(o.product_raw, p_code))
      when 'event-types' then o.event_type = (select case kind when 'seminar' then 'Seminar Offline' else 'Webinar Online' end from public.event_types where id = p_id)
      when 'sessions' then public.normalize_code(o.session) = public.normalize_code(p_code)
        or strpos(upper(coalesce(o.product_raw,'')), ' - ' || upper(p_code) || ' - ') > 0
      when 'payment-fee-rules' then o.fee_rule_id = p_id
      else true end
  ) or (p_resource <> 'payment-fee-rules' and (
    exists(select 1 from public.product_aliases where public.master_code_in_text(canonical_target, p_code)
      or (p_resource = 'products' and starts_with(upper(canonical_target), upper(p_code))))
    or exists(select 1 from public.app_settings where
      (key like 'webinar_destination::%' or key like 'seminar_ticket::%') and (
        public.master_code_in_text(regexp_replace(key, '^[a-z_]+::', ''), p_code)
        or (p_resource = 'products' and starts_with(upper(regexp_replace(key, '^[a-z_]+::', '')), upper(p_code)))))
    or (p_resource = 'products' and exists(select 1 from public.user_product_access where product_code = p_code))
  ))
$$;
revoke all on function public.master_is_used(text,text,uuid) from public, anon, authenticated;
grant execute on function public.master_is_used(text,text,uuid) to service_role;

create or replace function public.delete_config_master(p_actor uuid, p_resource text, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_table text; v_code text;
begin
  if not public.actor_has_permission(p_actor, 'action.delete_master') or
    not public.actor_has_permission(p_actor, case when p_resource = 'payment-fee-rules' then 'config.tax' else 'config.produk' end) then
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

-- Separate cleanup entrypoint: never touches transactions, tax, users or connections.
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
  insert into public.sessions_config(name,code,active)
    select case when n = 0 then 'Sesi Tunggal' else 'Sesi ' || n end,
      case when n = 0 then 'ST' else 'S' || n end, true from generate_series(0,8) n;
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

create or replace function public.validate_master_change() returns trigger
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_resource text;
begin
  new.name := btrim(new.name);
  new.code := upper(btrim(new.code));
  if tg_op = 'UPDATE' and (new.code is distinct from old.code or
      (tg_table_name = 'event_types' and to_jsonb(new)->>'kind' is distinct from to_jsonb(old)->>'kind')) then
    v_resource := case tg_table_name when 'event_types' then 'event-types' when 'sessions_config' then 'sessions' else tg_table_name end;
    lock table public.orders, public.product_aliases, public.app_settings, public.user_product_access in share row exclusive mode;
    if public.master_is_used(v_resource,old.code,old.id) then
      raise exception using errcode = 'DF015', message = 'MASTER_IN_USE';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_master_change() from public, anon, authenticated;
create trigger products_validate_master before insert or update on public.products for each row execute function public.validate_master_change();
create trigger advertisers_validate_master before insert or update on public.advertisers for each row execute function public.validate_master_change();
create trigger event_types_validate_master before insert or update on public.event_types for each row execute function public.validate_master_change();
create trigger sessions_validate_master before insert or update on public.sessions_config for each row execute function public.validate_master_change();

create or replace function public.developer_reset_data(p_scopes text[], p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_is_dev boolean;
  v_res jsonb := '{}'::jsonb;
  v_count int;
begin
  -- Perlindungan mutlak: hanya role 'developer' aktif
  select (role = 'developer' and active = true) into v_is_dev
  from public.users
  where id = p_actor_id;

  if not coalesce(v_is_dev, false) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN: Hanya role developer yang diizinkan mereset data';
  end if;

  if 'products_master' = any(p_scopes) then
    if cardinality(p_scopes) <> 1 then raise exception using errcode = 'DF011', message = 'MASTER_RESET_MUST_BE_SEPARATE'; end if;
    return public.reset_product_configuration(p_actor_id);
  end if;

  -- 1. Hapus Semua Orders & Data Presensi
  if 'orders_all' = any(p_scopes) or 'all_test_data' = any(p_scopes) then
    delete from public.attendance_events;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{attendance_events}', to_jsonb(v_count));

    delete from public.orderonline_order_sources;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orderonline_order_sources}', to_jsonb(v_count));

    delete from public.orders;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orders}', to_jsonb(v_count));
  elsif 'orders_unmapped' = any(p_scopes) then
    delete from public.attendance_events
    where order_id in (select order_id from public.orders where product_parse_status = 'invalid');
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{attendance_events}', to_jsonb(v_count));

    delete from public.orderonline_order_sources
    where order_id in (select order_id from public.orders where product_parse_status = 'invalid');
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orderonline_order_sources}', to_jsonb(v_count));

    delete from public.orders
    where product_parse_status = 'invalid';
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orders_unmapped}', to_jsonb(v_count));
  end if;

  -- 2. Hapus Webhook Logs
  if 'webhook_logs' = any(p_scopes) or 'all_test_data' = any(p_scopes) then
    delete from public.webhook_logs;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{webhook_logs}', to_jsonb(v_count));
  end if;

  -- 3. Hapus Kamus Alias Produk
  if 'product_aliases' = any(p_scopes) or 'all_test_data' = any(p_scopes) then
    delete from public.product_aliases;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{product_aliases}', to_jsonb(v_count));
  end if;

  -- 4. Hapus Koneksi OrderOnline
  if 'connections' = any(p_scopes) or 'all_test_data' = any(p_scopes) then
    delete from public.orderonline_order_sources;
    update public.orders set connection_id = null;
    delete from public.orderonline_connections;
    get diagnostics v_count = row_count;
    v_res := jsonb_set(v_res, '{orderonline_connections}', to_jsonb(v_count));
  end if;

  return jsonb_build_object('success', true, 'deleted', v_res);
end;
$$;
