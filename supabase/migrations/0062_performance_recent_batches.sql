-- 0062_performance_recent_batches — A57 (permintaan pengguna 29 Okt 2026).
-- Revisi halaman Performa / Analitik:
--   * grafik per batch/produk memakai batang semua (bukan campuran batang + garis);
--   * kartu Per Batch wajib memilih produk dan hanya menampilkan 5 batch TERAKHIR;
--   * kartu Per Produk memakai 2 batch TERAKHIR dari masing-masing produk.
--
-- "Batch terakhir" ditentukan dari tanggal aktivitas terbaru:
--   greatest(tanggal order terbaru, date_to report spend terbaru).
-- Nomor batch TIDAK dipakai sebagai urutan utama karena batch berupa teks dan bisa
-- mengandung huruf / nol di depan.
--
-- Signature berubah, jadi fungsi lama di-drop lebih dulu (deploy DB sebelum frontend).
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 62 $$;

drop function if exists public.advertiser_breakdown(text, text, text, integer);

create or replace function public.advertiser_breakdown(
  p_advertiser_code text default null,
  p_product_code text default null,
  p_batch text default null,
  p_limit integer default 200,
  p_recent_batches_per_product integer default null,
  p_batch_limit integer default null
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
  -- null = tanpa batas (perilaku lama tetap tersedia untuk pemanggil lama).
  v_recent_per_product integer := case
    when p_recent_batches_per_product is null then null
    else least(greatest(p_recent_batches_per_product, 1), 50) end;
  v_batch_limit integer := case
    when p_batch_limit is null then null
    else least(greatest(p_batch_limit, 1), 50) end;
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
           o.gross_amount,
           (coalesce(o.source_created_at, o.created_at) at time zone 'Asia/Jakarta')::date as order_date
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
           round(r.spend * r.tax_percent / 100, 2) as tax_amount,
           r.date_to as report_date
      from public.ad_spend_reports r
      join public.products p on p.id = r.product_id
      join public.advertisers a on a.id = r.advertiser_id
     where a.code_normalized = v_advertiser_key
       and (v_product_key is null or p.code_normalized = v_product_key)
       and (v_batch_key is null or r.batch = v_batch_key)
       and public.actor_can_product(v_actor, p.code)
  ),
  -- Tanggal aktivitas terakhir per (produk, batch), dari order maupun report spend.
  batch_activity as (
    select product_key, batch_key,
           max(order_date) as last_order_date,
           max(report_date) as last_report_date
      from (
        select product_key, batch_key, order_date, null::date as report_date from orders_all
        union all
        select product_key, batch_key, null::date, report_date from reports_all
      ) u
     group by product_key, batch_key
  ),
  batch_rank as (
    select product_key, batch_key,
           greatest(last_order_date, last_report_date) as last_activity,
           row_number() over (
             partition by product_key
             order by greatest(last_order_date, last_report_date) desc nulls last, batch_key desc
           )::int as product_rank,
           row_number() over (
             order by greatest(last_order_date, last_report_date) desc nulls last, batch_key desc, product_key
           )::int as overall_rank
      from batch_activity
  ),
  -- Hanya batch peringkat <= N per produk yang ikut dihitung ke produk.
  orders_scoped as (
    select o.*
      from orders_all o
      join batch_rank br
        on br.product_key = o.product_key
       and coalesce(br.batch_key, '') = coalesce(o.batch_key, '')
     where v_recent_per_product is null or br.product_rank <= v_recent_per_product
  ),
  reports_scoped as (
    select r.*
      from reports_all r
      join batch_rank br
        on br.product_key = r.product_key
       and coalesce(br.batch_key, '') = coalesce(r.batch_key, '')
     where v_recent_per_product is null or br.product_rank <= v_recent_per_product
  ),
  order_products as (
    select product_key,
           max(product_code) as product_code,
           max(product_name) as product_name,
           count(*)::int as leads,
           count(*) filter (where app_status = 'Paid')::int as paid,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18, 2) as omzet
      from orders_scoped
     group by product_key
  ),
  report_products as (
    select product_key,
           max(product_code) as product_code,
           max(product_name) as product_name,
           coalesce(sum(spend), 0)::numeric(18, 2) as spend,
           coalesce(sum(tax_amount), 0)::numeric(18, 2) as tax_amount
      from reports_scoped
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
    select product_key, batch_key,
           max(batch) as batch,
           max(product_code) as product_code,
           max(product_name) as product_name,
           count(*)::int as leads,
           count(*) filter (where app_status = 'Paid')::int as paid,
           coalesce(sum(quantity) filter (where app_status = 'Paid'), 0)::int as tickets,
           coalesce(sum(gross_amount) filter (where app_status = 'Paid'), 0)::numeric(18, 2) as omzet
      from orders_all
     group by product_key, batch_key
  ),
  report_batches as (
    select product_key, batch_key,
           max(batch) as batch,
           max(product_code) as product_code,
           max(product_name) as product_name,
           coalesce(sum(spend), 0)::numeric(18, 2) as spend,
           coalesce(sum(tax_amount), 0)::numeric(18, 2) as tax_amount
      from reports_all
     group by product_key, batch_key
  ),
  batch_totals as (
    select coalesce(o.product_key, r.product_key) as product_key,
           coalesce(o.batch_key, r.batch_key) as batch_key,
           coalesce(o.batch, r.batch) as batch,
           coalesce(o.product_code, r.product_code) as product_code,
           coalesce(o.product_name, r.product_name) as product_name,
           coalesce(o.leads, 0) as leads,
           coalesce(o.paid, 0) as paid,
           coalesce(o.tickets, 0) as tickets,
           coalesce(o.omzet, 0)::numeric(18, 2) as omzet,
           coalesce(r.spend, 0)::numeric(18, 2) as spend,
           coalesce(r.tax_amount, 0)::numeric(18, 2) as tax_amount,
           (coalesce(o.omzet, 0) - (coalesce(r.spend, 0) + coalesce(r.tax_amount, 0)))::numeric(18, 2) as profit
      from order_batches o
      full join report_batches r
        on r.product_key = o.product_key
       and coalesce(r.batch_key, '') = coalesce(o.batch_key, '')
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
        'product_code', b.product_code,
        'product_name', b.product_name,
        'last_activity', b.last_activity,
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
      ) order by
        case when v_batch_limit is not null then b.last_activity end desc nulls last,
        case when v_batch_limit is null then b.spend end desc,
        b.tickets desc,
        b.batch)
        from (
          select bt.*, br.last_activity, br.overall_rank
            from batch_totals bt
            join batch_rank br
              on br.product_key = bt.product_key
             and coalesce(br.batch_key, '') = coalesce(bt.batch_key, '')
           where v_batch_limit is null or br.overall_rank <= v_batch_limit
           order by
             case when v_batch_limit is not null then br.last_activity end desc nulls last,
             case when v_batch_limit is null then bt.spend end desc,
             bt.tickets desc,
             bt.batch
           limit v_limit
        ) b
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.advertiser_breakdown(text,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.advertiser_breakdown(text,text,text,integer,integer,integer) to authenticated;
