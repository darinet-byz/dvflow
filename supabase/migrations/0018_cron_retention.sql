-- ============================================================================
-- 0018_cron_retention — retensi harian (02 §10, §12; 06 §8)
-- ============================================================================
--
-- Dua job, keduanya di luar jam sibuk dan sengaja TIDAK di menit :00 supaya
-- tidak bertabrakan dengan beban lain pada jam yang sama.
--
-- Yang penting: job ini HANYA menghapus `attendance_events` dan `webhook_logs`.
-- Master Order tidak pernah ikut terhapus (I07, I08) — ditegakkan oleh arah FK
-- `attendance_events.order_id -> orders.order_id ON DELETE RESTRICT`, bukan
-- hanya oleh niat baik job ini.
--
-- Dijadwalkan secara defensif: bila pg_cron tidak tersedia (mis. environment
-- tanpa shared_preload_libraries), migrasi tetap berhasil dan retensi menjadi
-- tanggung jawab operator. Kondisi ini harus terlihat, bukan diam-diam lewat.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'pg_cron tidak tersedia: job retensi TIDAK dijadwalkan. Jalankan delete manual sesuai 06 section 8.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'dvflow_attendance_retention') then
    perform cron.unschedule('dvflow_attendance_retention');
  end if;
  if exists (select 1 from cron.job where jobname = 'dvflow_webhook_logs_retention') then
    perform cron.unschedule('dvflow_webhook_logs_retention');
  end if;

  perform cron.schedule(
    'dvflow_attendance_retention',
    '17 3 * * *',
    $cron$delete from public.attendance_events where clicked_at < now() - interval '30 days'$cron$
  );

  perform cron.schedule(
    'dvflow_webhook_logs_retention',
    '23 3 * * *',
    $cron$delete from public.webhook_logs where created_at < now() - interval '7 days'$cron$
  );
end
$$;
