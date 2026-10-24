-- 0052_attendance_retention_30_days — A41 (permintaan pengguna 24 Okt 2026): retensi attendance_events
-- kembali ke 30 hari (CLAUDE.md §4), menggantikan 60 hari dari 0021 (A10). Master Order tidak tersentuh.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 52 $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule dengan nama yang sama memperbarui job yang ada (jadwal tetap 03:17 UTC).
    perform cron.schedule('dvflow_attendance_retention', '17 3 * * *',
      $cron$delete from public.attendance_events where clicked_at < now() - interval '30 days'$cron$);
  else
    raise warning 'pg_cron tidak tersedia: jadwalkan retensi presensi 30 hari sebelum produksi.';
  end if;
end;
$$;
