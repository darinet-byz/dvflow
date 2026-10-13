-- User-requested revision: webinar configuration and attendance retention 60 days.
-- Existing orders, role identifiers, webhook retention and read policies are unchanged.
create or replace function public.save_webinar_destination(p_actor uuid, p_product_raw text, p_destination text)
returns void
language plpgsql security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if not exists (select 1 from public.users where id = p_actor and active) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if btrim(coalesce(p_product_raw, '')) = '' or coalesce(p_destination, '') !~ '^https://' then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;
  insert into public.app_settings (key, value_text, updated_by)
  values ('webinar_destination::' || p_product_raw, p_destination, p_actor)
  on conflict (key) do update set value_text = excluded.value_text, updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.save_webinar_destination(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_webinar_destination(uuid, text, text) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dvflow_attendance_retention', '17 3 * * *',
      $cron$delete from public.attendance_events where clicked_at < now() - interval '60 days'$cron$);
  else
    raise warning 'pg_cron tidak tersedia: jadwalkan retensi presensi 60 hari sebelum produksi.';
  end if;
end;
$$;
