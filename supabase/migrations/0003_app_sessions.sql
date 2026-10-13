-- ============================================================================
-- 0003_app_sessions — 02 §3
-- ============================================================================
--
-- Refresh session opaque. Yang disimpan hanya HASH token (04 §6): nilai mentah
-- token tidak pernah ada di database, sehingga bocornya tabel ini tidak
-- langsung memberi sesi yang bisa dipakai.
--
-- ON DELETE CASCADE: sesi tidak punya makna tanpa user-nya. User sendiri tidak
-- pernah di-hard-delete dari UI MVP (01 §8 hanya menonaktifkan), jadi cascade
-- ini hanya berlaku bila developer benar-benar menghapus user.

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint app_sessions_token_hash_not_blank check (btrim(token_hash) <> '')
);

create index app_sessions_user_id_idx on public.app_sessions (user_id);
create index app_sessions_expires_at_idx on public.app_sessions (expires_at);
