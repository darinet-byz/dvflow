-- ============================================================================
-- 0013_indexes — index minimum (02 §13) + pendukung sort/pagination
-- ============================================================================
--
-- Hanya kolom sort yang DIKONTRAK diizinkan (CLAUDE.md §15) yang diberi index.
-- Index pencarian teks (pg_trgm) ada di 0019.

-- orders ---------------------------------------------------------------------
-- order_id unique sudah dibuat di 0009.
create index orders_product_code_idx on public.orders (product_code);
create index orders_advertiser_code_idx on public.orders (advertiser_code);
create index orders_event_type_idx on public.orders (event_type);
create index orders_batch_idx on public.orders (batch);
create index orders_session_idx on public.orders (session);
create index orders_city_idx on public.orders (city);
create index orders_app_status_idx on public.orders (app_status);
create index orders_created_at_idx on public.orders (created_at desc);
create index orders_paid_at_idx on public.orders (paid_at desc);
create index orders_updated_at_idx on public.orders (updated_at desc);
create index orders_payment_identifier_normalized_idx on public.orders (payment_identifier_normalized);
-- Mendukung sort kolom teks yang diizinkan.
create index orders_name_idx on public.orders (name);
create index orders_gross_amount_idx on public.orders (gross_amount);
create index orders_tax_amount_idx on public.orders (tax_amount);
create index orders_net_amount_idx on public.orders (net_amount);

-- attendance_events ----------------------------------------------------------
create index attendance_events_order_id_idx on public.attendance_events (order_id);
create index attendance_events_clicked_at_idx on public.attendance_events (clicked_at desc);

-- app_sessions ---------------------------------------------------------------
-- Token lookup memakai token_hash unique (0003). Index pendukung:
create index app_sessions_active_lookup_idx
  on public.app_sessions (token_hash)
  where revoked_at is null;

-- webhook_logs ---------------------------------------------------------------
create index webhook_logs_created_at_idx on public.webhook_logs (created_at desc);
create index webhook_logs_order_id_idx on public.webhook_logs (order_id);
