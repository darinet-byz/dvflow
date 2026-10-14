-- Current database authority; JWT app_role is informational only.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$ select role from public.users where id = auth.uid() and active $$;

create or replace function public.actor_has_permission(p_actor uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.users u where u.id = p_actor and u.active and (
      u.role in ('developer', 'owner', 'master_admin') or (
        p_key not in ('config.roles', 'team.manage') and exists (
          select 1 from public.app_role_permissions p where p.role_id = u.role and p.permission_key = p_key
        )
      )
    )
  )
$$;

create or replace function public.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$ select public.actor_has_permission(auth.uid(), p_key) $$;

create or replace function public.actor_can_product(p_actor uuid, p_code text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.users u where u.id = p_actor and u.active and (
      u.role in ('developer', 'owner', 'master_admin') or u.has_all_product_access or exists (
        select 1 from public.user_product_access a
        where a.user_id = u.id and public.normalize_code(a.product_code) = public.normalize_code(p_code)
      )
    )
  )
$$;

create or replace function public.can_access_product(p_code text) returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp
as $$ select public.actor_can_product(auth.uid(), p_code) $$;

revoke all on function public.actor_has_permission(uuid,text), public.actor_can_product(uuid,text),
  public.has_permission(text), public.can_access_product(text) from public, anon, authenticated;
grant execute on function public.actor_has_permission(uuid,text), public.actor_can_product(uuid,text) to service_role;
grant execute on function public.has_permission(text), public.can_access_product(text) to authenticated, service_role;

alter policy orders_select_app_users on public.orders using (
  public.can_access_product(product_code) and (
    public.has_permission('operasional.order') or public.has_permission('operasional.dashboard') or
    public.has_permission('operasional.presensi') or public.has_permission('config.report_tax')
  )
);
alter policy attendance_events_select_app_users on public.attendance_events using (
  (public.has_permission('operasional.presensi') or public.has_permission('operasional.dashboard') or public.has_permission('operasional.order'))
  and exists (select 1 from public.orders o where o.order_id = attendance_events.order_id)
);
alter policy products_select_app_users on public.products using (public.can_access_product(code));
alter policy payment_fee_rules_select_app_users on public.payment_fee_rules using (
  public.has_permission('config.tax') or public.has_permission('config.report_tax') or
  public.has_permission('operasional.order') or public.has_permission('operasional.presensi') or public.has_permission('operasional.dashboard')
);
alter policy app_roles_select_policy on public.app_roles using (public.is_app_user());
alter policy app_permissions_select_policy on public.app_permissions using (public.is_app_user());
alter policy app_role_permissions_select_policy on public.app_role_permissions using (
  public.is_app_user() and (role_id = public.app_role() or public.has_permission('config.roles'))
);
alter policy user_product_access_select_policy on public.user_product_access using (
  public.is_app_user() and (user_id = auth.uid() or public.has_permission('team.manage'))
);

create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;
alter policy products_select_app_users on public.products using (public.can_read_configuration() and public.can_access_product(code));
alter policy advertisers_select_app_users on public.advertisers using (public.can_read_configuration());
alter policy event_types_select_app_users on public.event_types using (public.can_read_configuration());
alter policy sessions_config_select_app_users on public.sessions_config using (public.can_read_configuration());

-- Role creation and permission replacement are one transaction, including validation.
create or replace function public.save_role_permissions(
  p_actor uuid, p_role text, p_permissions text[], p_create boolean default false,
  p_name text default null, p_description text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog, pg_temp
as $$
declare v_role public.app_roles;
begin
  if not public.actor_has_permission(p_actor, 'config.roles') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_permissions is null or exists (
    select 1 from unnest(p_permissions) k where k is null or not exists (select 1 from public.app_permissions p where p.key = k)
  ) then raise exception using errcode = 'DF011', message = 'INVALID_PERMISSION'; end if;
  if p_create then
    if p_role !~ '^[a-z0-9_]{3,32}$' or length(btrim(p_name)) not between 2 and 64 or p_name is null then
      raise exception using errcode = 'DF011', message = 'INVALID_ROLE';
    end if;
    insert into public.app_roles(id,name,description,is_system) values(p_role,btrim(p_name),p_description,false);
  end if;
  select * into v_role from public.app_roles where id = p_role for update;
  if not found then raise exception using errcode = 'DF011', message = 'ROLE_NOT_FOUND'; end if;
  delete from public.app_role_permissions where role_id = p_role;
  -- Full-access system roles cannot accidentally lock themselves out.
  if p_role in ('developer','owner','master_admin') then
    insert into public.app_role_permissions select p_role, key from public.app_permissions;
  else
    insert into public.app_role_permissions select p_role, k from (select distinct unnest(p_permissions) k) keys;
  end if;
  return to_jsonb(v_role);
end $$;
revoke all on function public.save_role_permissions(uuid,text,text[],boolean,text,text) from public, anon, authenticated;
grant execute on function public.save_role_permissions(uuid,text,text[],boolean,text,text) to service_role;

-- Read RPCs keep their existing signatures and SECURITY INVOKER/RLS behavior.
create or replace function public.presensi_page(
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_event_type text default null,
  p_batch text default null,
  p_session text default null,
  p_city text default null,
  p_attendance_status text default null,
  p_sort text default 'latest_activity',
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
  v_base text;
  v_classified text;
  v_paged text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  -- Teks pengguna menjadi pola `ilike` yang seluruh karakter wildcard-nya sudah
  -- di-escape, sehingga input diperlakukan sebagai data (L06) dan `%` tidak
  -- berarti "semua baris".
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Ukuran halaman dibatasi ke nilai yang diizinkan dokumen (PRD §33).
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;

  if p_attendance_status is not null
     and p_attendance_status not in ('Hadir', 'Belum Hadir', 'Pending', 'Cancelled') then
    raise exception using errcode = 'DF011', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  -- Whitelist sort (CLAUDE.md §15). Kolom database mentah tidak pernah diteruskan.
  v_sort_expr := case p_sort
    when 'order_id' then 't.order_id'
    when 'name' then 't.name'
    when 'total_activity' then 't.total_activity'
    when 'latest_activity' then 't.latest_activity_sort'
    when 'product_name' then 't.product_name'
    when 'batch' then 't.batch'
    when 'session' then 't.session'
    when 'city' then 't.city'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  -- `latest_activity_sort`: presensi default adalah aktivitas terbaru, dan
  -- order yang belum pernah hadir jatuh ke created_at order (01 §6).
  v_base :=
    'select o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type, o.batch, o.session, o.city,
            o.product_parse_status, o.app_status, o.created_at, o.paid_at, o.updated_at,
            a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.timestamps
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity,
                max(e.clicked_at) as latest_activity,
                (array_agg(e.clicked_at order by e.clicked_at desc))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where ' || v_filter;

  -- Status presensi dihitung dari data (PRD §107) — tidak pernah disimpan.
  v_classified :=
    'select t.*,
            case when t.app_status <> ''Paid'' then t.app_status
                 when t.total_activity > 0 then ''Hadir''
                 else ''Belum Hadir'' end as attendance_status
       from (' || v_base || ') t';

  execute format('select count(*) from (%s) c where ($10::text is null or c.attendance_status = $10::text)', v_classified)
    into v_total
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  v_paged := format(
    'select t.* from (%s) t where ($10::text is null or t.attendance_status = $10::text) order by %s %s nulls last, t.order_id asc limit %s offset %s',
    v_classified, v_sort_expr, p_sort_dir, v_limit, v_offset
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from (%s) p', v_paged)
    into v_rows
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$$;
create or replace function public.export_presensi_page(
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_product_code text default null,
  p_advertiser_code text default null,
  p_event_type text default null,
  p_batch text default null,
  p_session text default null,
  p_city text default null,
  p_attendance_status text default null,
  p_sort text default 'latest_activity',
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
  v_base text;
  v_classified text;
  v_paged text;
  v_sort_expr text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  if not public.has_permission('action.export_data') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.has_permission('operasional.presensi') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  -- Teks pengguna menjadi pola `ilike` yang seluruh karakter wildcard-nya sudah
  -- di-escape, sehingga input diperlakukan sebagai data (L06) dan `%` tidak
  -- berarti "semua baris".
  v_search := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Ukuran halaman dibatasi ke nilai yang diizinkan dokumen (PRD §33).
  if p_page_size is null or p_page_size not in (50, 100) then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE_SIZE';
  end if;
  if p_page is null or p_page < 1 then
    raise exception using errcode = 'DF011', message = 'INVALID_PAGE';
  end if;

  if p_attendance_status is not null
     and p_attendance_status not in ('Hadir', 'Belum Hadir', 'Pending', 'Cancelled') then
    raise exception using errcode = 'DF011', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  -- Whitelist sort (CLAUDE.md §15). Kolom database mentah tidak pernah diteruskan.
  v_sort_expr := case p_sort
    when 'order_id' then 't.order_id'
    when 'name' then 't.name'
    when 'total_activity' then 't.total_activity'
    when 'latest_activity' then 't.latest_activity_sort'
    when 'product_name' then 't.product_name'
    when 'batch' then 't.batch'
    when 'session' then 't.session'
    when 'city' then 't.city'
    else null
  end;
  if v_sort_expr is null then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT';
  end if;
  if p_sort_dir is null or p_sort_dir not in ('asc', 'desc') then
    raise exception using errcode = 'DF011', message = 'INVALID_SORT_DIRECTION';
  end if;

  -- `latest_activity_sort`: presensi default adalah aktivitas terbaru, dan
  -- order yang belum pernah hadir jatuh ke created_at order (01 §6).
  v_base :=
    'select o.order_id, o.name, o.phone, o.product_code, o.product_name,
            o.advertiser_code, o.advertiser_name, o.event_type, o.batch, o.session, o.city,
            o.product_parse_status, o.app_status, o.created_at, o.paid_at, o.updated_at,
            a.total_activity, a.latest_activity,
            coalesce(a.latest_activity, o.created_at) as latest_activity_sort,
            a.timestamps
       from public.orders o
       cross join lateral (
         select count(*)::int as total_activity,
                max(e.clicked_at) as latest_activity,
                (array_agg(e.clicked_at order by e.clicked_at desc))[1:10] as timestamps
           from public.attendance_events e
          where e.order_id = o.order_id
       ) a
      where ' || v_filter;

  -- Status presensi dihitung dari data (PRD §107) — tidak pernah disimpan.
  v_classified :=
    'select t.*,
            case when t.app_status <> ''Paid'' then t.app_status
                 when t.total_activity > 0 then ''Hadir''
                 else ''Belum Hadir'' end as attendance_status
       from (' || v_base || ') t';

  execute format('select count(*) from (%s) c where ($10::text is null or c.attendance_status = $10::text)', v_classified)
    into v_total
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  v_limit := p_page_size;
  v_offset := (p_page - 1) * p_page_size;

  v_paged := format(
    'select t.* from (%s) t where ($10::text is null or t.attendance_status = $10::text) order by %s %s nulls last, t.order_id asc limit %s offset %s',
    v_classified, v_sort_expr, p_sort_dir, v_limit, v_offset
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from (%s) p', v_paged)
    into v_rows
    using v_search, p_date_from, p_date_to, p_product_code, p_advertiser_code,
          p_event_type, p_batch, p_session, p_city, p_attendance_status;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$$;
revoke all on function public.export_presensi_page(text,date,date,text,text,text,text,text,text,text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.export_presensi_page(text,date,date,text,text,text,text,text,text,text,text,text,integer,integer) to authenticated;
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
      select o.app_status, o.gross_amount, o.tax_amount, o.net_amount,
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
        coalesce(sum(gross_amount), 0)::numeric(18,2) as gross_amount,
        coalesce(sum(tax_amount), 0)::numeric(18,2) as tax_amount,
        coalesce(sum(net_amount), 0)::numeric(18,2) as net_amount,
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
      select %s as label, o.gross_amount, o.tax_amount, o.net_amount
        from public.orders o
       where %s
    ),
    grouped as (
      select label,
             count(*)::int as transactions,
             coalesce(sum(gross_amount), 0)::numeric(18,2) as gross_amount,
             coalesce(sum(tax_amount), 0)::numeric(18,2) as tax_amount,
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
revoke all on function public.export_orders_page(text,date,date,text,text,text,text,text,text,text,text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.export_orders_page(text,date,date,text,text,text,text,text,text,text,text,text,text,integer,integer) to authenticated;
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
  if not public.actor_has_permission(p_scanner_user_id, 'operasional.scan_qr') or
    (p_source = 'seminar_manual' and not public.actor_has_permission(p_scanner_user_id, 'action.manual_checkin')) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_source not in ('seminar_qr', 'seminar_manual') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id);
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_product(p_scanner_user_id, v_order.product_code) then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
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

create or replace function public.save_webinar_destination(p_actor uuid, p_product_raw text, p_destination text)
returns void
language plpgsql security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if not public.actor_has_permission(p_actor, 'config.zoom') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.actor_can_product(p_actor, case when starts_with(p_product_raw, '__scope__::') then split_part(substr(p_product_raw,12), ':',1) else (select code from public.products where starts_with(upper(p_product_raw),upper(code)) order by length(code) desc limit 1) end) then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not exists (select 1 from public.users where id = p_actor and active) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if btrim(coalesce(p_product_raw, '')) = '' or coalesce(p_destination, '') !~ '^https://' then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  insert into public.app_settings (key, value_text, updated_by)
  values ('webinar_destination::' || p_product_raw, p_destination, p_actor)
  on conflict (key) do update set value_text = excluded.value_text, updated_by = excluded.updated_by;
end;
$$;
create or replace function public.save_seminar_ticket(
  p_actor uuid,
  p_scope_key text,
  p_value_json text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if not public.actor_has_permission(p_actor, 'config.tiket') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.actor_can_product(p_actor, case when starts_with(p_scope_key, '__scope__::') then split_part(substr(p_scope_key,12), ':',1) else (select code from public.products where starts_with(upper(p_scope_key),upper(code)) order by length(code) desc limit 1) end) then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not exists (select 1 from public.users where id = p_actor and active) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  if btrim(coalesce(p_scope_key, '')) = '' or btrim(coalesce(p_value_json, '')) = '' then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  insert into public.app_settings (key, value_text, updated_by)
  values ('seminar_ticket::' || p_scope_key, p_value_json, p_actor)
  on conflict (key) do update
    set value_text = excluded.value_text,
        updated_by = excluded.updated_by;
end;
$$;
create or replace function public.batch_remap_orders(
  p_order_ids text[],
  p_canonical_target text,
  p_parsed jsonb,
  p_save_alias boolean default false,
  p_alias_name text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if not public.actor_has_permission(p_actor_id, 'operasional.order_unmapped') then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if not public.actor_can_product(p_actor_id, null) or (p_save_alias and not public.actor_has_permission(p_actor_id, 'config.alias_produk')) then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null or array_length(p_order_ids, 1) = 0 then
    raise exception using errcode = 'DF011', message = 'EMPTY_ORDER_IDS';
  end if;
  if p_canonical_target is null or btrim(p_canonical_target) = '' then
    raise exception using errcode = 'DF011', message = 'INVALID_CANONICAL_TARGET';
  end if;
  if p_parsed is null or p_parsed->>'product_parse_status' <> 'valid' then
    raise exception using errcode = 'DF011', message = 'CANONICAL_TARGET_NOT_VALID';
  end if;

  update public.orders
     set product_raw = coalesce(nullif(btrim(product_raw), ''), p_canonical_target),
         product_parse_status = 'valid',
         product_code = p_parsed->>'product_code',
         product_name = p_parsed->>'product_name',
         advertiser_code = p_parsed->>'advertiser_code',
         advertiser_name = p_parsed->>'advertiser_name',
         event_type = p_parsed->>'event_type',
         batch = p_parsed->>'batch',
         session = p_parsed->>'session',
         city = p_parsed->>'city',
         updated_at = now()
   where order_id = any(p_order_ids);

  get diagnostics v_count = row_count;

  if p_save_alias and p_alias_name is not null and btrim(p_alias_name) <> '' then
    insert into public.product_aliases (alias_name, alias_name_normalized, canonical_target, created_by)
    values (
      btrim(p_alias_name),
      lower(btrim(p_alias_name)),
      btrim(p_canonical_target),
      p_actor_id
    )
    on conflict (alias_name_normalized) do update
      set canonical_target = excluded.canonical_target,
          updated_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'updated_count', v_count,
    'alias_saved', p_save_alias and p_alias_name is not null and btrim(p_alias_name) <> ''
  );
end;
$$;
