-- ============================================================================
-- 0001_extensions — ekstensi + fondasi fungsi normalisasi
-- Rujukan: 02 §15 langkah 1, docs/AMENDMENTS.md A1/A4
-- ============================================================================
--
-- pgcrypto : bcrypt untuk password (A1 — hashing dilakukan di database, bukan di Worker)
-- pg_trgm  : index pencarian teks untuk filter ilike (0019)
-- pg_cron  : retention job harian (0018)
--
-- Catatan: dua fungsi normalisasi sengaja dibuat di sini, bukan di 0014, karena
-- kolom `code_normalized` / `identifier_normalized` dihitung database memakai
-- fungsi tersebut (lihat AMENDMENTS A5). Fungsi harus ada sebelum tabelnya.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Normalisasi kode konfigurasi.
-- Cermin TypeScript: packages/shared/src/domain/text.ts -> normalizeCode()
--   trim + uppercase, TANPA membuang spasi tengah ("S 1" != "S1").
-- Trim memakai regexp_replace (bukan btrim) supaya karakter whitespace selain
-- spasi ikut terpotong seperti String.prototype.trim() di JS.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_code(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select upper(regexp_replace(p_value, '^\s+|\s+$', '', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Normalisasi payment identifier (01-IMPLEMENTATION-DECISIONS §11).
-- Cermin TypeScript: packages/shared/src/domain/payment-identifier.ts
--   trim -> collapse whitespace -> lowercase; kosong menjadi NULL.
-- Urutan operasi sengaja sama persis dengan versi TypeScript.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_payment_identifier(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(
    lower(regexp_replace(regexp_replace(p_value, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')),
    ''
  )
$$;

-- ---------------------------------------------------------------------------
-- Pemeliharaan updated_at.
--
-- Trigger dipakai (bukan menulis updated_at di setiap RPC) supaya satu
-- kelalaian di satu jalur tulis tidak menghasilkan timestamp yang basi.
-- Dicatat sebagai AMENDMENTS A6.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
