-- ============================================================================
-- 0011_app_settings — 02 §11
-- ============================================================================
--
-- Satu-satunya key yang diizinkan MVP: webinar_destination::<product_raw>.
-- CHECK di bawah menegakkan larangan "jangan menambah key lain tanpa
-- requirement" (CLAUDE.md §4) di level database, bukan hanya konvensi.
--
-- Destination webinar adalah data operasional (URL Zoom), jadi tabel ini TIDAK
-- dapat dibaca browser: lookup selalu dilakukan backend (0015).

create table public.app_settings (
  key text primary key,
  value_text text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null,
  constraint app_settings_key_allowed check (key like 'webinar_destination::%'),
  constraint app_settings_key_not_blank check (btrim(key) <> 'webinar_destination::')
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();
