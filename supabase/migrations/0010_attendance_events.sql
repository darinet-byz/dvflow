-- ============================================================================
-- 0010_attendance_events — presensi row-based (02 §10)
-- ============================================================================
--
-- Row-based, bukan kolom timestamp_1..timestamp_10 (02 §16). UI yang mengubah
-- baris menjadi T1..T10 (PRD §104–§105).
--
-- Webinar  : TIDAK unik — setiap klik/redirect valid adalah baris baru.
-- Seminar  : UNIK per order_id — check-in idempoten (M02).
--
-- FK ON DELETE RESTRICT ke orders(order_id): retensi 30 hari hanya boleh
-- menghapus attendance, tidak pernah Master Order (I07/I08).

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders (order_id) on delete restrict,
  attendance_type text not null,
  source text not null,
  scanner_user_id uuid references public.users (id) on delete set null,
  clicked_at timestamptz not null default now(),

  constraint attendance_events_type_check check (attendance_type in ('webinar', 'seminar')),
  constraint attendance_events_source_check check (source in ('webinar_redirect', 'seminar_qr', 'seminar_manual')),
  -- source harus cocok dengan jenis presensinya.
  constraint attendance_events_source_matches_type check (
    (attendance_type = 'webinar' and source = 'webinar_redirect')
    or (attendance_type = 'seminar' and source in ('seminar_qr', 'seminar_manual'))
  ),
  -- scanner_user_id hanya bermakna untuk check-in seminar oleh operator (H10).
  constraint attendance_events_scanner_only_seminar check (
    attendance_type = 'seminar' or scanner_user_id is null
  )
);

-- Idempotensi seminar. Partial unique index inilah yang membuat dua scan
-- nyaris bersamaan tetap menghasilkan satu baris (M02) tanpa bergantung UI.
create unique index attendance_events_seminar_unique
  on public.attendance_events (order_id)
  where attendance_type = 'seminar';
