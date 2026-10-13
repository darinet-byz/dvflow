-- ============================================================================
-- 0015_rls_policies_and_grants — model akses (STATE.md K11, 02 §14, 04 §5)
-- ============================================================================
--
-- Keputusan yang dikunci di sini: BROWSER HANYA MEMBACA.
--
-- Konsekuensinya, dan alasannya:
--   * Tidak ada satu pun policy INSERT/UPDATE/DELETE dibuat. Ketiadaan policy
--     berarti tertutup, jadi "menyembunyikan tombol" tidak pernah menjadi
--     satu-satunya pertahanan (CLAUDE.md §9).
--   * Seluruh penulisan lewat backend memakai service_role / RPC SECURITY
--     DEFINER (0016, 0017).
--   * `users` dapat dibaca hanya baris sendiri, dan `password_hash` /
--     `password_algo` di-REVOKE tingkat kolom sehingga tidak mungkin ikut
--     terkirim walaupun `select *` dipakai (A1, 04 §6).
--   * `app_sessions`, `webhook_logs`, dan `app_settings` tidak punya grant
--     sama sekali: token hash, log, dan destination webinar hanya untuk backend.

-- ---------------------------------------------------------------------------
-- 1. Aktifkan RLS di seluruh tabel
-- ---------------------------------------------------------------------------
alter table public.users              enable row level security;
alter table public.app_sessions       enable row level security;
alter table public.products           enable row level security;
alter table public.advertisers        enable row level security;
alter table public.event_types        enable row level security;
alter table public.sessions_config    enable row level security;
alter table public.payment_fee_rules  enable row level security;
alter table public.orders             enable row level security;
alter table public.attendance_events  enable row level security;
alter table public.app_settings       enable row level security;
alter table public.webhook_logs       enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Cabut seluruh hak default, lalu berikan kembali seperlunya
-- ---------------------------------------------------------------------------
revoke all on table public.users              from anon, authenticated;
revoke all on table public.app_sessions       from anon, authenticated;
revoke all on table public.products           from anon, authenticated;
revoke all on table public.advertisers        from anon, authenticated;
revoke all on table public.event_types        from anon, authenticated;
revoke all on table public.sessions_config    from anon, authenticated;
revoke all on table public.payment_fee_rules  from anon, authenticated;
revoke all on table public.orders             from anon, authenticated;
revoke all on table public.attendance_events  from anon, authenticated;
revoke all on table public.app_settings       from anon, authenticated;
revoke all on table public.webhook_logs       from anon, authenticated;

-- service_role memang butuh akses penuh (backend), tetapi dinyatakan eksplisit
-- supaya modelnya terbaca, bukan diwarisi diam-diam dari default Supabase.
grant all on table public.users              to service_role;
grant all on table public.app_sessions       to service_role;
grant all on table public.products           to service_role;
grant all on table public.advertisers        to service_role;
grant all on table public.event_types        to service_role;
grant all on table public.sessions_config    to service_role;
grant all on table public.payment_fee_rules  to service_role;
grant all on table public.orders             to service_role;
grant all on table public.attendance_events  to service_role;
grant all on table public.app_settings       to service_role;
grant all on table public.webhook_logs       to service_role;

-- Baca saja untuk user aplikasi. Tidak ada grant tulis sama sekali.
grant select on public.orders            to authenticated;
grant select on public.attendance_events to authenticated;
grant select on public.products          to authenticated;
grant select on public.advertisers       to authenticated;
grant select on public.event_types       to authenticated;
grant select on public.sessions_config   to authenticated;
grant select on public.payment_fee_rules to authenticated;

-- Profil sendiri: kolom aman saja. password_hash/password_algo TIDAK pernah
-- masuk daftar ini, dan tidak ada jalur lain yang memberikannya.
grant select (
  id, username, username_normalized, display_name, role, avatar_emoji, active, created_at, updated_at
) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Fungsi: cabut EXECUTE default PUBLIC, berikan seperlunya
-- ---------------------------------------------------------------------------
-- Setiap fungsi baru otomatis dapat dieksekusi PUBLIC. Untuk RPC tulis itu
-- berbahaya, jadi default-nya dicabut lebih dulu dan grant diberikan per fungsi.
revoke all on function public.normalize_code(text) from public, anon, authenticated;
revoke all on function public.normalize_payment_identifier(text) from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.app_role() from public, anon, authenticated;
revoke all on function public.is_app_user() from public, anon, authenticated;
revoke all on function public.calc_tax_amount(numeric, text, numeric) from public, anon, authenticated;

-- Policy RLS dievaluasi sebagai peran pemanggil, jadi helper ini wajib
-- executable oleh `authenticated`. Semuanya murni/baca-saja dan tidak membocorkan apa pun.
grant execute on function public.app_role() to authenticated;
grant execute on function public.is_app_user() to authenticated;
grant execute on function public.normalize_code(text) to authenticated;
grant execute on function public.normalize_payment_identifier(text) to authenticated;
grant execute on function public.calc_tax_amount(numeric, text, numeric) to authenticated;

-- Disiplin untuk migrasi berikutnya: tabel/fungsi baru TIDAK otomatis terbuka.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Policy baca (satu-satunya jenis policy yang ada)
-- ---------------------------------------------------------------------------
create policy orders_select_app_users
  on public.orders for select to authenticated
  using (public.is_app_user());

create policy attendance_events_select_app_users
  on public.attendance_events for select to authenticated
  using (public.is_app_user());

create policy products_select_app_users
  on public.products for select to authenticated
  using (public.is_app_user());

create policy advertisers_select_app_users
  on public.advertisers for select to authenticated
  using (public.is_app_user());

create policy event_types_select_app_users
  on public.event_types for select to authenticated
  using (public.is_app_user());

create policy sessions_config_select_app_users
  on public.sessions_config for select to authenticated
  using (public.is_app_user());

create policy payment_fee_rules_select_app_users
  on public.payment_fee_rules for select to authenticated
  using (public.is_app_user());

-- Profil sendiri saja. is_app_user() memastikan user aktif; keduanya
-- digabung supaya user yang dinonaktifkan tidak dapat membaca barisnya sendiri.
create policy users_select_self
  on public.users for select to authenticated
  using (public.is_app_user() and id = auth.uid());
