-- A64: source is orthogonal to payment and attendance. Existing OTS rows remain intact.
-- Extend the installed definitions to preserve retention, reschedule and RBAC rules.
-- No overloads: old named/positional calls work via the final optional argument.
do $migration$
declare
  r record;
  definition text;
  signature text;
  guard text := $guard$
  if nullif(btrim(p_source), '') is not null and p_source not in ('orderonline', 'ots') then
    raise exception using errcode = 'DF011', message = 'INVALID_SOURCE';
  end if;
$guard$;
begin
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'dashboard_summary', 'presensi_summary', 'orders_page', 'export_orders_page',
      'presensi_page', 'export_presensi_page', 'tax_report',
      'dashboard_session_summary', 'refund_page', 'export_refund_page'
    )
  loop
    definition := pg_get_functiondef(r.oid);
    definition := regexp_replace(definition, E'\\)\\n RETURNS', E', p_source text DEFAULT NULL::text)\n RETURNS');
    if position('p_source text DEFAULT' in definition) = 0 then
      raise exception 'Could not extend signature of %', r.proname;
    end if;
    definition := replace(definition, E'begin\n', E'begin\n' || guard);
    if position('v_filter text' in definition) > 0 then
      definition := replace(definition, guard, guard || $append$
  if nullif(btrim(p_source), '') is not null then
    v_filter := '(' || v_filter || ') and o.source = ' || quote_literal(p_source);
  end if;
$append$);
    elsif r.proname = 'dashboard_session_summary' then
      definition := replace(definition, 'where o.app_status',
        'where (nullif(btrim(p_source), '''') is null or o.source = p_source) and o.app_status');
    elsif r.proname in ('refund_page', 'export_refund_page') then
      definition := replace(definition, 'where r.reverted_at is null',
        'where (nullif(btrim($10::text), '''') is null or o.source = $10::text) and r.reverted_at is null');
      definition := replace(definition, 'p_event_type, p_batch, p_session, p_city;',
        'p_event_type, p_batch, p_session, p_city, p_source;');
    else
      raise exception 'Unrecognized filter in %', r.proname;
    end if;
    -- Explicit row projections in attendance/refund; order projections use o.*.
    definition := replace(definition, 'select o.order_id, o.name', 'select o.source, o.order_id, o.name');
    if r.proname in ('orders_page', 'export_orders_page') and position('o.source,' in definition) = 0 then
      definition := replace(definition, 'o.id, o.order_id', 'o.source, o.id, o.order_id');
    end if;
    execute format('drop function public.%I(%s)', r.proname, r.args);
    execute definition;
    signature := r.args || ', p_source text';
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.proname, signature);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, signature);
  end loop;
end
$migration$;

-- Normalize Indonesian telephone prefixes without treating a shared number as identity.
create or replace function public.ots_phone_key(p_phone text) returns text
language sql immutable set search_path = pg_catalog as $$
  select regexp_replace(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '^(62|0)', '')
$$;
revoke all on function public.ots_phone_key(text) from public, anon, authenticated;
grant execute on function public.ots_phone_key(text) to service_role;

create or replace function public.ots_duplicate_candidates(p_actor uuid, p_phone text,
  p_product_code text, p_batch text, p_session text, p_city text)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog, pg_temp as $$
declare result jsonb;
begin
  if not public.actor_has_permission(p_actor, 'action.ots') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into result from (
    select o.order_id, o.source, o.name, o.app_status, o.quantity
    from public.orders o
    where public.actor_can_order(p_actor, o.product_code, o.advertiser_code)
      and public.ots_phone_key(p_phone) <> ''
      and public.ots_phone_key(o.phone) = public.ots_phone_key(p_phone)
      and public.normalize_code(o.product_code) = public.normalize_code(p_product_code)
      and public.normalize_batch(o.effective_batch) = public.normalize_batch(p_batch)
      and public.normalize_code(o.effective_session) = public.normalize_code(p_session)
      and lower(btrim(o.effective_city)) = lower(btrim(p_city))
    order by o.created_at desc, o.order_id limit 20
  ) c;
  return jsonb_build_object('rows', result);
end $$;
revoke all on function public.ots_duplicate_candidates(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.ots_duplicate_candidates(uuid,text,text,text,text,text) to service_role;

-- One statement/snapshot for totals, money, options and paginated rows. No REST row cap.
create or replace function public.ots_registrations_page(p_actor uuid, p_filters jsonb)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog, pg_temp as $$
declare result jsonb;
begin
  if not public.actor_has_permission(p_actor, 'action.ots') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  with scoped as materialized (
    select o.*, (select u.display_name from public.users u where u.id = o.ots_collected_by) as collected_by
    from public.orders o where o.source = 'ots'
      and public.actor_can_order(p_actor, o.product_code, o.advertiser_code)
  ), filtered as materialized (
    select o.* from scoped o
    where (p_filters->>'from' is null or o.created_at >= ((p_filters->>'from')::date::timestamp at time zone 'Asia/Jakarta'))
      and (p_filters->>'to' is null or o.created_at < (((p_filters->>'to')::date + 1)::timestamp at time zone 'Asia/Jakarta'))
      and (p_filters->>'q' is null or position(lower(p_filters->>'q') in lower(concat_ws(' ', o.order_id, o.name, o.phone))) > 0)
      and (p_filters->>'product_code' is null or o.product_code = p_filters->>'product_code')
      and (p_filters->>'batch' is null or public.normalize_batch(o.effective_batch) = public.normalize_batch(p_filters->>'batch'))
      and (p_filters->>'session' is null or o.effective_session = p_filters->>'session')
      and (p_filters->>'city' is null or lower(btrim(o.effective_city)) = lower(btrim(p_filters->>'city')))
      and (p_filters->>'method' is null or o.payment_method = p_filters->>'method')
      and (p_filters->>'collector' is null or o.ots_collected_by::text = p_filters->>'collector')
  ), paged as (
    select o.order_id, o.source, o.name, o.phone, o.product_code, o.product_name,
      o.effective_batch as batch, o.effective_session as session, o.effective_city as city,
      o.event_type, o.quantity, o.gross_amount, o.payment_method, o.app_status,
      o.created_at, o.ots_collected_by, o.collected_by,
      least(o.quantity, (select count(*) from public.attendance_events e
        where e.order_id = o.order_id and e.attendance_type = 'seminar')) as checked_in_tickets,
      (o.created_at < now() - interval '30 days' and not exists (
        select 1 from public.attendance_events e where e.order_id = o.order_id
      )) as attendance_data_expired
    from filtered o order by o.created_at desc, o.order_id
    limit (p_filters->>'pageSize')::int offset (((p_filters->>'page')::int - 1) * (p_filters->>'pageSize')::int)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p)) from paged p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'summary', (select jsonb_build_object('transactions', count(*),
      'tickets', coalesce(sum(quantity) filter (where app_status = 'Paid'), 0),
      'gross_amount', coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0),
      'ots_tunai', coalesce(sum(gross_amount) filter (where app_status = 'Paid' and payment_method = 'ots_tunai'), 0),
      'ots_transfer', coalesce(sum(gross_amount) filter (where app_status = 'Paid' and payment_method = 'ots_transfer'), 0),
      'ots_qris', coalesce(sum(gross_amount) filter (where app_status = 'Paid' and payment_method = 'ots_qris'), 0)
    ) from filtered),
    'collectors', coalesce((select jsonb_agg(to_jsonb(c)) from (
      select distinct ots_collected_by as id, collected_by as name from scoped
      where ots_collected_by is not null order by collected_by
    ) c), '[]'::jsonb)
  ) into result;
  return result || jsonb_build_object('page', (p_filters->>'page')::int, 'pageSize', (p_filters->>'pageSize')::int);
end $$;
revoke all on function public.ots_registrations_page(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ots_registrations_page(uuid,jsonb) to service_role;

create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 68 $$;
notify pgrst, 'reload schema';
