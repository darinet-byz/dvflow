-- ============================================================================
-- 0012_webhook_logs — 02 §12
-- ============================================================================
--
-- Untuk troubleshooting ingestion (mis. status tak dikenal, kode ambigu).
-- TIDAK boleh memuat credential/secret header (04 §14) — payload_sanitized
-- adalah tanggung jawab pemanggil, dan tabel ini tidak dapat dibaca browser.
-- Retensi 7 hari (0018).
--
-- Tanpa FK ke orders: log harus tetap bisa ditulis untuk webhook yang gagal
-- sebelum Order sempat dibuat.

create table public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'orderonline',
  request_id text,
  order_id text,
  outcome text not null,
  error_code text,
  payload_sanitized jsonb,
  created_at timestamptz not null default now(),
  constraint webhook_logs_outcome_not_blank check (btrim(outcome) <> '')
);
