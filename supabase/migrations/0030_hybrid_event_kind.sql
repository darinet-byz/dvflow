-- 0030_hybrid_event_kind — jenis acara HYBRID (permintaan pengguna 14 Okt 2026, AMENDMENTS A14).
--
-- Satu Order ID Hybrid yang Paid berlaku untuk dua jalur sekaligus:
--   * tiket QR + check-in di lokasi (attendance_type 'seminar', tetap SATU kali per order);
--   * redirect ke link Zoom (attendance_type 'webinar', setiap klik tercatat).
-- Status hadir = punya presensi jenis apa pun (sudah demikian di presensi/dashboard).
-- Tidak ada tabel/kolom baru: hanya nilai yang diizinkan diperluas.

alter table public.event_types drop constraint event_types_kind_check;
alter table public.event_types add constraint event_types_kind_check check (kind in ('seminar', 'webinar', 'hybrid'));

alter table public.orders drop constraint orders_event_type_check;
alter table public.orders add constraint orders_event_type_check check (event_type in ('Seminar Offline', 'Webinar Online', 'Hybrid'));

create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 30 $$;

-- Sama dengan 0027, kecuali order Hybrid juga boleh check-in di lokasi.
create or replace function public.checkin_seminar(
  p_order_id text,
  p_source text,
  p_scanner_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_order public.orders;
  v_inserted boolean := false;
  v_clicked_at timestamptz;
  v_id uuid;
begin
  if not public.actor_has_permission(p_scanner_user_id, 'operasional.scan_qr') or
    (p_source = 'seminar_manual' and not public.actor_has_permission(p_scanner_user_id, 'action.manual_checkin')) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_source not in ('seminar_qr', 'seminar_manual') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_order from public.orders where order_id = btrim(p_order_id);
  if not found then
    raise exception using errcode = 'DF001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.actor_can_product(p_scanner_user_id, v_order.product_code) then raise exception using errcode = 'DF006', message = 'FORBIDDEN'; end if;
  if v_order.app_status <> 'Paid' then
    raise exception using errcode = 'DF002', message = 'ORDER_NOT_PAID';
  end if;
  if v_order.event_type is null or v_order.event_type not in ('Seminar Offline', 'Hybrid') then
    raise exception using errcode = 'DF003', message = 'NOT_SEMINAR_ORDER';
  end if;

  insert into public.attendance_events (order_id, attendance_type, source, scanner_user_id)
  values (v_order.order_id, 'seminar', p_source, p_scanner_user_id)
  on conflict (order_id) where attendance_type = 'seminar' do nothing
  returning id, clicked_at into v_id, v_clicked_at;
  v_inserted := found;

  if not v_inserted then
    -- Scan berulang: kembalikan timestamp check-in PERTAMA (01 §13).
    select id, clicked_at into v_id, v_clicked_at
      from public.attendance_events
     where order_id = v_order.order_id
       and attendance_type = 'seminar';
  end if;

  return jsonb_build_object(
    'order_id', v_order.order_id,
    'state', case when v_inserted then 'CHECKIN_SUCCESS' else 'ALREADY_CHECKED_IN' end,
    'attendance_id', v_id,
    'clicked_at', v_clicked_at,
    'scanner_user_id', p_scanner_user_id
  );
end;
$$;
revoke all on function public.checkin_seminar(text, text, uuid) from public, anon, authenticated;
grant execute on function public.checkin_seminar(text, text, uuid) to service_role;
