-- ============================================================================
-- 0009_orders — Master Order (02 §9)
-- ============================================================================
--
-- Aturan yang dijaga skema ini:
--   * 1 Order ID = 1 Master Order  -> order_id UNIQUE (webhook berulang = UPSERT);
--   * tax adalah SNAPSHOT transaksi -> kolom *_snapshot tidak pernah diturunkan
--     ulang dari konfigurasi saat dibaca (01 §12);
--   * tidak ada kolom timestamp_1..timestamp_10 (02 §16).
--
-- net_amount SENGAJA tanpa CHECK >= 0: bila flat fee lebih besar dari gross,
-- dokumen tetap mengikuti formula apa adanya (STATE.md O2).

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  name text,
  phone text,
  email text,

  -- Produk mentah + hasil parsing. product_raw selalu dipertahankan (01 §9).
  product_raw text,
  product_parse_status text not null default 'invalid',
  product_code text,
  product_name text,
  advertiser_code text,
  advertiser_name text,
  event_type text,
  batch text,
  session text,
  city text,

  raw_status text,
  app_status text not null,

  payment_method text,
  payment_provider text,
  payment_identifier text,
  payment_identifier_normalized text,

  gross_amount numeric(18, 2) not null default 0,
  tax_amount numeric(18, 2) not null default 0,
  net_amount numeric(18, 2) not null default 0,
  tax_mapping_status text not null default 'unmapped',

  -- Snapshot tax: dibekukan saat perhitungan, tidak ikut berubah saat rule diedit.
  fee_rule_id uuid references public.payment_fee_rules (id) on delete restrict,
  fee_rule_name_snapshot text,
  fee_type_snapshot text,
  fee_value_snapshot numeric(18, 4),

  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint orders_order_id_key unique (order_id),
  constraint orders_order_id_not_blank check (btrim(order_id) <> ''),
  constraint orders_product_parse_status_check check (product_parse_status in ('valid', 'invalid')),
  -- Dua literal ini dipaku Data Dictionary; `orders.event_type` diturunkan dari
  -- event_types.kind sehingga rename konfigurasi tidak merusak ingestion (K7).
  constraint orders_event_type_check check (event_type in ('Seminar Offline', 'Webinar Online')),
  constraint orders_app_status_check check (app_status in ('Pending', 'Paid', 'Cancelled')),
  constraint orders_gross_amount_check check (gross_amount >= 0),
  constraint orders_tax_amount_check check (tax_amount >= 0),
  constraint orders_tax_mapping_status_check check (tax_mapping_status in ('mapped', 'unmapped')),
  constraint orders_fee_type_snapshot_check check (fee_type_snapshot in ('flat', 'percentage'))
);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();
