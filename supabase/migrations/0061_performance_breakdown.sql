-- 0061_performance_breakdown — A56 (permintaan pengguna 29 Okt 2026).
-- Halaman Performa / Analitik memakai SATU grafik garis (Spend + Tiket) yang mengikuti
-- filter tanggal, lalu grafik perbandingan per batch dan per produk yang SENGAJA
-- mengabaikan filter tanggal (semua waktu).
--
-- RPC ini sengaja tidak punya parameter tanggal sama sekali: batas waktu tidak bisa
-- "ikut terbawa" dari pemanggil. Scope pengiklan (A48) dan scope produk (A44) tetap
-- ditegakkan, dan filter produk/batch non-tanggal tetap berlaku.
--
-- Berbeda dari array `products`/`batches` di `advertiser_performance`, di sini:
--   * spend per PRODUK ikut dihitung (report spend menunjuk satu product_id);
--   * produk/batch yang punya spend tetapi belum ada tiket Paid tetap muncul
--     supaya kebocoran biaya iklan terlihat.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 61 $$;

create or replace function public.advertiser_breakdown(
  p_advertiser_code text default null,
  p_product_code text default null,
  p_batch text default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_own_advertiser_key text;
  v_advertiser_key text;
  v_product_key text;
  v_batch_key text;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_result jsonb;
begin
  if not public.has_permission('operasional.analytics') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  -- Akun Advertiser = akun yang memegang satu pengiklan (users.advertiser_id).
  select a.code_normalized into v_own_advertiser_key
    from public.users u
    join public.advertisers a on a.id = u.advertiser_id
   where u.id = v_actor;

  v_advertiser_key := case when nullif(btrim(coalesce(p_advertiser_code, '')), '') is null
    then null else public.normalize_code(btrim(p_advertiser_code)) end;
  v_product_key := case when nullif(btrim(coalesce(p_product_code, '')), '') is null
    then null else public.normalize_code(btrim(p_product_code)) end;
  v_batch_key := case when nullif(btrim(coalesce(p_batch, '')), '') is null
    then null else public.normalize_batch(btrim(p_batch)) end;

  -- A48: akun Advertiser hanya boleh melihat breakdown pengiklannya sendiri.
  if v_own_advertiser_key is not null then
    if v_advertiser_key is not null and v_advertiser_key <> v_own_advertiser_key then
      raise exception using errcode = 'DF006', message = 'FORBIDDEN';
    end if;
    v_advertiser_key := v_own_advertiser_key;
  end if;

  -- Breakdown selalu untuk satu pengiklan; dashboard tidak memakai RPC ini.
  if v_advertiser_key is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  with orders_all as (
    select public.normalize_code(o.product_code) as product_key,
           o.product_code,
           o.product_name,
           public.normalize_batch(o.batch) as batch_key,
           o.batch,
           o.app_status,
           o.quantity,
           o.gross_amount
      from public.orders o
     where o.product_parse_status = 'valid'
       and public.normalize_code(o.advertiser_code) = v_advertiser_key
       and (v_product_key is null or public.normalize_code(o.product_code) = v_product_key)
       and (v_batch_key is null or public.normalize_batch(o.batch) = v_batch_key)
       and public.actor_can_product(v_actor, o.product_code)
  ),
  reports_all as (
    -- `ad_spend_reports.batch` sudah tersimpan ternormalisasi (0048), jadi perbandingan
    -- langsung dengan kunci batch aman.
    select r.batch as batch_key,
           r.batch,
           p.code_normalized as product_key,
           p.code as product_code,
           p.name as product_name,
           r.spend,
           round(r.spend * r.tax_percent / 100, 2) as tax_amount
      from public.ad_spend_reports r
      join public.products p on p.id = r.product_id
      join public.advertisers a on a.id = r.advertiser_id
     where a.code_normalized = v_advertiser_key
       and (v_product_key is null or p.code_normalized = v_product_key)
       and (v_batch_key is null or r.batch = v_batch_key)
       and public.actor_can_product(v_actor, p.code)
  ),
  order_products as (
    select product_key,
           max(product_code) as product_code,
           max(product_name) as product_name,
           count(*)::int as leads,
           count(*) filter (where app_status = 'Paid')::int as paid,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18, 2) as omzet
      from orders_all
     group by product_key
  ),
  report_products as (
    select product_key,
           max(product_code) as product_code,
           max(product_name) as product_name,
           coalesce(sum(spend), 0)::numeric(18, 2) as spend,
           coalesce(sum(tax_amount), 0)::numeric(18, 2) as tax_amount
      from reports_all
     group by product_key
  ),
  product_totals as (
    select coalesce(o.product_key, r.product_key) as product_key,
           coalesce(o.product_code, r.product_code) as product_code,
           coalesce(o.product_name, r.product_name) as product_name,
           coalesce(o.leads, 0) as leads,
           coalesce(o.paid, 0) as paid,
           coalesce(o.tickets, 0) as tickets,
           coalesce(o.omzet, 0)::numeric(18, 2) as omzet,
           coalesce(r.spend, 0)::numeric(18, 2) as spend,
           coalesce(r.tax_amount, 0)::numeric(18, 2) as tax_amount,
           (coalesce(o.omzet, 0) - (coalesce(r.spend, 0) + coalesce(r.tax_amount, 0)))::numeric(18, 2) as profit
      from order_products o
      full join report_products r on r.product_key = o.product_key
     where coalesce(o.tickets, 0) > 0 or coalesce(r.spend, 0) > 0
  ),
  order_batches as (
    select batch_key,
           max(batch) as batch,
           count(*)::int as leads,
           count(*) filter (where app_status = 'Paid')::int as paid,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18, 2) as omzet
      from orders_all
     group by batch_key
  ),
  report_batches as (
    select batch_key,
           max(batch) as batch,
           coalesce(sum(spend), 0)::numeric(18, 2) as spend,
           coalesce(sum(tax_amount), 0)::numeric(18, 2) as tax_amount
      from reports_all
     group by batch_key
  ),
  batch_totals as (
    select coalesce(o.batch_key, r.batch_key) as batch_key,
           coalesce(o.batch, r.batch) as batch,
           coalesce(o.leads, 0) as leads,
           coalesce(o.paid, 0) as paid,
           coalesce(o.tickets, 0) as tickets,
           coalesce(o.omzet, 0)::numeric(18, 2) as omzet,
           coalesce(r.spend, 0)::numeric(18, 2) as spend,
           coalesce(r.tax_amount, 0)::numeric(18, 2) as tax_amount,
           (coalesce(o.omzet, 0) - (coalesce(r.spend, 0) + coalesce(r.tax_amount, 0)))::numeric(18, 2) as profit
      from order_batches o
      full join report_batches r on r.batch_key = o.batch_key
     where coalesce(o.tickets, 0) > 0 or coalesce(r.spend, 0) > 0
  )
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code', p.product_code,
        'product_name', p.product_name,
        'leads', p.leads,
        'paid', p.paid,
        'tickets', p.tickets,
        'omzet', p.omzet,
        'spend', p.spend,
        'tax_amount', p.tax_amount,
        'total_spend', p.spend + p.tax_amount,
        'profit', p.profit,
        'roas', case when p.spend + p.tax_amount > 0
          then p.omzet / (p.spend + p.tax_amount) else null end
      ) order by p.spend desc, p.tickets desc, p.product_name)
        from (select * from product_totals order by spend desc, tickets desc, product_name limit v_limit) p
    ), '[]'::jsonb),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch', b.batch,
        'leads', b.leads,
        'paid', b.paid,
        'tickets', b.tickets,
        'omzet', b.omzet,
        'spend', b.spend,
        'tax_amount', b.tax_amount,
        'total_spend', b.spend + b.tax_amount,
        'profit', b.profit,
        'roas', case when b.spend + b.tax_amount > 0
          then b.omzet / (b.spend + b.tax_amount) else null end
      ) order by b.spend desc, b.tickets desc, b.batch)
        from (select * from batch_totals order by spend desc, tickets desc, batch limit v_limit) b
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.advertiser_breakdown(text,text,text,integer) from public, anon, authenticated;
grant execute on function public.advertiser_breakdown(text,text,text,integer) to authenticated;
