-- ============================================================================
-- 0006_event_types — 02 §6 (termasuk seed canonical) + A5
-- ============================================================================
--
-- `kind` adalah sumber orders.event_type (STATE.md K7): orders.event_type
-- diturunkan dari kind, bukan dari `name`, sehingga mengganti nama baris
-- konfigurasi tidak merusak ingestion maupun CHECK constraint orders.

create table public.event_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  code_normalized text generated always as (public.normalize_code(code)) stored not null,
  kind text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_types_code_normalized_key unique (code_normalized),
  constraint event_types_kind_check check (kind in ('seminar', 'webinar')),
  constraint event_types_name_not_blank check (btrim(name) <> ''),
  constraint event_types_code_not_blank check (btrim(code) <> '')
);

create trigger event_types_set_updated_at
  before update on public.event_types
  for each row execute function public.set_updated_at();

-- Seed canonical (02 §6 "Seed canonical"). Idempoten supaya migrasi aman
-- dijalankan ulang di database yang sudah berisi baris ini.
-- Konfigurasi di sini BUKAN data bisnis palsu: parser tidak bisa bekerja tanpa
-- kedua baris ini, dan nilainya dipaku dokumen.
insert into public.event_types (name, code, kind)
values
  ('Seminar Offline', 'SO', 'seminar'),
  ('Webinar Online', 'WO', 'webinar')
on conflict (code_normalized) do nothing;
