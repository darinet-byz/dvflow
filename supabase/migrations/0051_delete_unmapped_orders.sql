-- 0051_delete_unmapped_orders — A40 (permintaan pengguna 24 Okt 2026): hapus massal Order Unmapped.
-- Pengecualian aturan "No Master Order delete" KHUSUS order yang masih unmapped (product_parse_status
-- = 'invalid'); order ter-mapping tetap tidak bisa dihapus. Retensi otomatis 90 hari (0026) tidak berubah.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 51 $$;

create or replace function public.delete_unmapped_orders(p_actor_id uuid, p_order_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_requested integer := coalesce(array_length(p_order_ids, 1), 0);
  v_targets text[];
  v_deleted integer := 0;
begin
  -- Izin sama dengan halaman + remap (akses semua produk), ditambah izin hapus.
  if not public.actor_has_permission(p_actor_id, 'operasional.order_unmapped')
     or not public.actor_has_permission(p_actor_id, 'action.delete_master')
     or not public.actor_can_product(p_actor_id, null) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if v_requested = 0 or v_requested > 1000 then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  -- Kunci baris dulu: webhook/remap yang berjalan bersamaan tidak bisa memetakan order ini di tengah
  -- penghapusan. Order yang sudah valid saat dikunci dilewati (skipped), tidak pernah dihapus.
  select coalesce(array_agg(order_id), '{}') into v_targets
    from (
      select order_id from public.orders
       where order_id = any(p_order_ids) and product_parse_status = 'invalid'
       for update
    ) locked;

  -- Urutan sama dengan purge_expired_unmapped_orders (0026): presensi memakai FK on delete restrict.
  delete from public.attendance_events where order_id = any(v_targets);
  delete from public.orderonline_order_sources where order_id = any(v_targets);
  delete from public.orders where order_id = any(v_targets) and product_parse_status = 'invalid';
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted_count', v_deleted,
    'skipped_count', (select count(distinct x) from unnest(p_order_ids) x) - v_deleted
  );
end $$;
revoke all on function public.delete_unmapped_orders(uuid, text[]) from public, anon, authenticated;
grant execute on function public.delete_unmapped_orders(uuid, text[]) to service_role;
