-- 0046_ots_reference_read — A34 follow-up: form OTS memuat produk & sesi langsung
-- lewat RLS. Role yang hanya diberi izin `action.ots` (tanpa operasional.order/scan_qr)
-- tetap harus bisa membaca daftar produk/sesi, kalau tidak form-nya kosong.
--
-- `can_read_configuration()` adalah gerbang baca tabel konfigurasi. Menambahkan
-- `action.ots` di sini TIDAK memberi izin menulis konfigurasi; penulisan tetap lewat
-- backend + izin config.*. Produk tetap dibatasi `can_access_product(code)`.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 46 $$;

create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'action.ots',
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;
