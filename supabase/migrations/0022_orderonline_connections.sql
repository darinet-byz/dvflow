create table public.orderonline_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  active boolean not null default true,
  api_token_encrypted text,
  webhook_secret_encrypted text not null,
  webhook_secret_hash text not null,
  last_received_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.orderonline_connections enable row level security;
revoke all on public.orderonline_connections from public, anon, authenticated;
grant all on public.orderonline_connections to service_role;

-- Preserve the existing global Order ID contract; reject collisions between connections.
create table public.orderonline_order_sources (
  order_id text primary key,
  connection_id uuid not null references public.orderonline_connections(id)
);
alter table public.orderonline_order_sources enable row level security;
revoke all on public.orderonline_order_sources from public, anon, authenticated;
grant all on public.orderonline_order_sources to service_role;
create function public.upsert_connected_order(p_connection_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  perform 1 from public.orderonline_connections where id = p_connection_id and active for share;
  if not found then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  insert into public.orderonline_order_sources(order_id, connection_id)
    values (p_payload->>'orderId', p_connection_id) on conflict do nothing;
  if not exists (select 1 from public.orderonline_order_sources where order_id = p_payload->>'orderId' and connection_id = p_connection_id) then
    raise exception using errcode = 'DF011', message = 'Order ID belongs to another connection';
  end if;
  select public.upsert_order_webhook(p_payload) into result;
  update public.orderonline_connections set last_received_at = now() where id = p_connection_id;
  return result;
end;
$$;
revoke all on function public.upsert_connected_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_connected_order(uuid, jsonb) to service_role;
