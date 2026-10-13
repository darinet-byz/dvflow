-- ============================================================================
-- 0008_payment_fee_rules — 02 §8 + A5
-- ============================================================================
--
-- `fee_value` persentase disimpan sebagai ANGKA PERSEN: 0.7 berarti 0,7%
-- (bukan 0,007). Formula: tax = gross * (fee_value / 100).

create table public.payment_fee_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  identifier text not null,
  identifier_normalized text generated always as (public.normalize_payment_identifier(identifier)) stored not null,
  fee_type text not null,
  fee_value numeric(18, 4) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_fee_rules_name_not_blank check (btrim(name) <> ''),
  constraint payment_fee_rules_identifier_not_blank check (btrim(identifier) <> ''),
  constraint payment_fee_rules_fee_type_check check (fee_type in ('flat', 'percentage')),
  constraint payment_fee_rules_fee_value_check check (fee_value >= 0)
);

create trigger payment_fee_rules_set_updated_at
  before update on public.payment_fee_rules
  for each row execute function public.set_updated_at();

-- Uniqueness hanya di antara rule AKTIF (02 §8): rule lama boleh nonaktif dan
-- tetap hidup untuk menjelaskan snapshot historis.
create unique index payment_fee_rules_identifier_active_key
  on public.payment_fee_rules (identifier_normalized)
  where active;
