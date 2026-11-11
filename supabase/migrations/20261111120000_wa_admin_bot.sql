-- Fitur 3.0 — WA Admin Bot (pengingat laporan iklan harian).
--
-- Alur: Cloudflare Worker cron memicu `POST /api/internal/wa-reminders/run`.
-- Backend memanggil `wa_reminder_claim` (fungsi di bawah), mengirim pesan ke
-- Fonnte, lalu menandai hasilnya lewat `wa_reminder_mark`.
--
-- Yang dijaga skema ini:
--   * token Fonnte TIDAK dapat dibaca browser (tanpa grant/policy SELECT);
--   * satu pesan per (jadwal, pengiklan, produk, tanggal WIB) — cron yang jalan
--     setiap menit tidak boleh mengirim ulang pesan yang sama;
--   * pengecekan laporan per PRODUK dan mengabaikan batch, sesuai keputusan
--     pengguna 11 November 2026;
--   * pesan dirender dari template, bukan hardcode;
--   * retry maksimal 3 kali untuk pengiriman yang gagal.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 70 $$;

-- ---------------------------------------------------------------------------
-- 1. Token Fonnte (dienkripsi backend dengan INTEGRATION_ENCRYPTION_KEY)
-- ---------------------------------------------------------------------------
create table public.wa_bot_settings (
  id smallint primary key default 1,
  fonnte_token_encrypted text,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint wa_bot_settings_single_row check (id = 1)
);

-- ---------------------------------------------------------------------------
-- 2. Mapping pengiklan -> grup WhatsApp + PIC
-- ---------------------------------------------------------------------------
create table public.wa_reminder_groups (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null unique references public.advertisers (id) on delete cascade,
  fonnte_group_id text not null,
  pic_phone text not null,
  pic_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_reminder_groups_group_not_blank check (btrim(fonnte_group_id) <> ''),
  constraint wa_reminder_groups_group_length check (length(fonnte_group_id) <= 100),
  constraint wa_reminder_groups_phone_format check (pic_phone ~ '^62[0-9]{8,13}$'),
  constraint wa_reminder_groups_pic_name_length check (pic_name is null or length(pic_name) <= 50)
);
create trigger wa_reminder_groups_set_updated_at
  before update on public.wa_reminder_groups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Template pesan dinamis
-- ---------------------------------------------------------------------------
create table public.wa_reminder_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  message_content text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_reminder_templates_name_not_blank check (btrim(name) <> ''),
  constraint wa_reminder_templates_name_length check (length(name) <= 50),
  constraint wa_reminder_templates_content_not_blank check (btrim(message_content) <> ''),
  constraint wa_reminder_templates_content_length check (length(message_content) <= 4000)
);
create unique index wa_reminder_templates_name_key on public.wa_reminder_templates (lower(name));
create trigger wa_reminder_templates_set_updated_at
  before update on public.wa_reminder_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Jadwal eksekusi (jam WIB) + aturan kondisional
-- ---------------------------------------------------------------------------
create table public.wa_reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  execution_time time not null,
  template_id uuid not null references public.wa_reminder_templates (id) on delete restrict,
  -- 0 = Minggu, mengikuti extract(dow) PostgreSQL.
  days smallint[] not null default '{0,1,2,3,4,5,6}',
  only_if_missing_report boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_reminder_schedules_days_valid check (
    cardinality(days) > 0 and days <@ '{0,1,2,3,4,5,6}'::smallint[]
  )
);
create index wa_reminder_schedules_time_idx on public.wa_reminder_schedules (execution_time) where is_active;
create trigger wa_reminder_schedules_set_updated_at
  before update on public.wa_reminder_schedules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Riwayat pengiriman (idempotensi + diagnosa)
-- ---------------------------------------------------------------------------
create table public.wa_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.wa_reminder_schedules (id) on delete set null,
  advertiser_id uuid not null,
  advertiser_name text not null,
  product_code text not null,
  product_name text,
  reminder_date date not null,
  group_id text not null,
  template_id uuid references public.wa_reminder_templates (id) on delete set null,
  message text not null,
  status text not null default 'queued',
  attempts integer not null default 1,
  fonnte_message_id text,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint wa_reminder_logs_status_check check (status in ('queued', 'sent', 'failed')),
  constraint wa_reminder_logs_attempts_check check (attempts between 1 and 10),
  constraint wa_reminder_logs_message_not_blank check (btrim(message) <> '')
);
-- Satu kiriman per jadwal/pengiklan/produk/tanggal. Baris `failed` sengaja TIDAK
-- ikut unik supaya masih dapat dicoba ulang (maksimal 3 kali, lihat klaim).
create unique index wa_reminder_logs_once_idx
  on public.wa_reminder_logs (schedule_id, advertiser_id, product_code, reminder_date)
  where schedule_id is not null and status in ('queued', 'sent');
create index wa_reminder_logs_created_idx on public.wa_reminder_logs (created_at desc);
create index wa_reminder_logs_advertiser_idx on public.wa_reminder_logs (advertiser_id, reminder_date desc);

-- ---------------------------------------------------------------------------
-- 6. Izin
-- ---------------------------------------------------------------------------
insert into public.app_permissions (key, name, module, description, sort_order)
values
  ('config.wa_bot', 'WA Admin Bot', 'konfigurasi', 'Mengelola grup, template, jadwal, dan token Fonnte untuk pengingat laporan iklan', 17),
  ('action.wa_bot_send', 'Kirim Pesan WA', 'aksi', 'Mengirim pesan uji dan mengirim ulang pengingat yang gagal', 46)
on conflict (key) do nothing;

insert into public.app_role_permissions (role_id, permission_key)
select r, k
from unnest(array['manajer', 'admin']) r
cross join unnest(array['config.wa_bot', 'action.wa_bot_send']) k
where exists (select 1 from public.app_roles where id = r)
on conflict (role_id, permission_key) do nothing;

-- Dropdown produk/pengiklan di modal Kirim Tes dibaca browser lewat RLS tabel
-- konfigurasi, jadi izin baru ini harus ikut membuka fungsi pembaca konfigurasi.
create or replace function public.can_read_configuration() returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists(select 1 from unnest(array[
    'action.ots','operasional.report_spend','operasional.resume_batch','operasional.advertiser_notes',
    'operasional.order','operasional.presensi','operasional.dashboard','operasional.generator','operasional.scan_qr',
    'operasional.order_unmapped','config.produk','config.alias_produk','config.zoom','config.tiket','config.report_tax',
    'config.wa_bot','team.manage'
  ]) k where public.has_permission(k))
$$;
revoke all on function public.can_read_configuration() from public, anon, authenticated;
grant execute on function public.can_read_configuration() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Grants: seluruh akses lewat backend (service_role). Token tidak pernah
--    diekspos ke browser, jadi tabel ini sengaja tanpa policy SELECT.
-- ---------------------------------------------------------------------------
alter table public.wa_bot_settings enable row level security;
alter table public.wa_reminder_groups enable row level security;
alter table public.wa_reminder_templates enable row level security;
alter table public.wa_reminder_schedules enable row level security;
alter table public.wa_reminder_logs enable row level security;

revoke all on table public.wa_bot_settings, public.wa_reminder_groups,
  public.wa_reminder_templates, public.wa_reminder_schedules, public.wa_reminder_logs
  from public, anon, authenticated;
grant all on table public.wa_bot_settings, public.wa_reminder_groups,
  public.wa_reminder_templates, public.wa_reminder_schedules, public.wa_reminder_logs
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Klaim atomik: jadwal due -> produk dengan aktivitas kemarin -> belum lapor
-- ---------------------------------------------------------------------------
create or replace function public.wa_reminder_claim(
  p_now timestamptz,
  p_base_url text default '',
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_local timestamp;
  v_today date;
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer;
  v_result jsonb;
begin
  if p_now is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  v_local := p_now at time zone 'Asia/Jakarta';
  v_today := v_local::date;
  -- Batas hari WIB yang sama dengan laporan lain (A24).
  v_start := ((v_today - 1)::timestamp at time zone 'Asia/Jakarta');
  v_end := (v_today::timestamp at time zone 'Asia/Jakarta');
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 50);

  -- Worker yang mati setelah klaim tidak boleh memblokir selamanya.
  update public.wa_reminder_logs
     set status = 'failed', error = 'CLAIM_TIMEOUT'
   where status = 'queued'
     and claimed_at is not null
     and claimed_at < p_now - interval '10 minutes';

  with due as (
    select s.id as schedule_id, s.execution_time, s.only_if_missing_report,
           s.template_id, t.message_content
      from public.wa_reminder_schedules s
      join public.wa_reminder_templates t on t.id = s.template_id
     where s.is_active
       and t.is_active
       and s.days @> array[extract(dow from v_today)::smallint]
       -- Toleransi 60 menit: cron boleh datang terlambat tanpa kehilangan jadwal,
       -- dan pengiriman tetap satu kali berkat unique index di bawah.
       and v_local >= (v_today + s.execution_time)
       and v_local < (v_today + s.execution_time + interval '60 minutes')
  ),
  activity as (
    select g.id as group_row_id, g.advertiser_id, g.fonnte_group_id, g.pic_phone,
           a.code as advertiser_code, a.name as advertiser_name,
           o.product_code,
           min(coalesce(o.product_name, p.name, o.product_code)) as product_name,
           count(*)::int as leads,
           (count(*) filter (where o.app_status = 'Paid'))::int as paid
      from public.wa_reminder_groups g
      join public.advertisers a on a.id = g.advertiser_id
      join public.orders o
        on o.source = 'orderonline'
       and public.normalize_code(o.advertiser_code) = a.code_normalized
       and o.product_code is not null
       and coalesce(o.source_created_at, o.created_at) >= v_start
       and coalesce(o.source_created_at, o.created_at) < v_end
      left join public.products p on p.code_normalized = public.normalize_code(o.product_code)
     where g.is_active
       and a.active
     group by g.id, g.advertiser_id, g.fonnte_group_id, g.pic_phone, a.code, a.name, o.product_code
  ),
  candidates as (
    select d.schedule_id, d.template_id, d.execution_time, d.only_if_missing_report,
           d.message_content, ac.*
      from due d
      cross join activity ac
     where ac.leads > 0
       -- Keputusan pengguna: cek per produk, abaikan batch.
       and (not d.only_if_missing_report or not exists (
             select 1
               from public.ad_spend_reports r
               join public.products rp on rp.id = r.product_id
              where r.advertiser_id = ac.advertiser_id
                and rp.code_normalized = public.normalize_code(ac.product_code)
                and r.date_from <= v_today - 1
                and r.date_to >= v_today - 1
           ))
       and (select count(*)
              from public.wa_reminder_logs l
             where l.schedule_id = d.schedule_id
               and l.advertiser_id = ac.advertiser_id
               and l.product_code = ac.product_code
               and l.reminder_date = v_today
               and l.status = 'failed') < 3
  ),
  prepared as (
    select c.*,
           replace(
             replace(
               replace(
                 replace(
                   replace(
                     replace(c.message_content, '{{mention}}', '@' || c.pic_phone),
                     '{{store_name}}', c.advertiser_name),
                   '{{product_name}}', c.product_name),
                 '{{leads}}', c.leads::text),
               '{{paid}}', c.paid::text),
             '{{report_url}}',
             coalesce(p_base_url, '') || '/report-spend?advertiserCode=' || c.advertiser_code || '&productCode=' || c.product_code
           ) as message
      from candidates c
  ),
  inserted as (
    insert into public.wa_reminder_logs (
      schedule_id, advertiser_id, advertiser_name, product_code, product_name,
      reminder_date, group_id, template_id, message, status, attempts, claimed_at
    )
    select schedule_id, advertiser_id, advertiser_name, product_code, product_name,
           v_today, fonnte_group_id, template_id, message, 'queued', 1, p_now
      from prepared
     order by execution_time, advertiser_name, product_name, product_code
     limit v_limit
    on conflict (schedule_id, advertiser_id, product_code, reminder_date)
      where schedule_id is not null and status in ('queued', 'sent')
      do nothing
    returning id, group_id, message, advertiser_id, advertiser_name, product_code, product_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'log_id', i.id,
    'group_id', i.group_id,
    'message', i.message,
    'advertiser_id', i.advertiser_id,
    'advertiser_name', i.advertiser_name,
    'product_code', i.product_code,
    'product_name', i.product_name
  )), '[]'::jsonb)
  into v_result
  from inserted i;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Tandai hasil pengiriman
-- ---------------------------------------------------------------------------
create or replace function public.wa_reminder_mark(
  p_id uuid,
  p_status text,
  p_fonnte_message_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  update public.wa_reminder_logs
     set status = p_status,
         fonnte_message_id = nullif(btrim(coalesce(p_fonnte_message_id, '')), ''),
         error = case
           when p_status = 'failed' then left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'SEND_FAILED'), 500)
           else null
         end,
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id
     and status = 'queued';

  if not found then
    return jsonb_build_object('updated', false);
  end if;

  return jsonb_build_object('updated', true);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Preview/uji kirim: angka kemarin + pesan final untuk satu produk
-- ---------------------------------------------------------------------------
create or replace function public.wa_reminder_preview(
  p_now timestamptz,
  p_advertiser_code text,
  p_product_code text,
  p_template_id uuid,
  p_base_url text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_today date := (p_now at time zone 'Asia/Jakarta')::date;
  v_start timestamptz := (((p_now at time zone 'Asia/Jakarta')::date - 1)::timestamp at time zone 'Asia/Jakarta');
  v_end timestamptz := ((p_now at time zone 'Asia/Jakarta')::date::timestamp at time zone 'Asia/Jakarta');
  v_group public.wa_reminder_groups;
  v_advertiser public.advertisers;
  v_product public.products;
  v_template public.wa_reminder_templates;
  v_leads int := 0;
  v_paid int := 0;
  v_message text;
begin
  if p_now is null then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_template from public.wa_reminder_templates where id = p_template_id;
  if not found then return jsonb_build_object('found', false, 'reason', 'TEMPLATE_NOT_FOUND'); end if;

  select * into v_advertiser from public.advertisers
   where code_normalized = public.normalize_code(p_advertiser_code)
     and active;
  if not found then return jsonb_build_object('found', false, 'reason', 'ADVERTISER_NOT_FOUND'); end if;

  select * into v_product from public.products
   where code_normalized = public.normalize_code(p_product_code);
  if not found then return jsonb_build_object('found', false, 'reason', 'PRODUCT_NOT_FOUND'); end if;

  select * into v_group from public.wa_reminder_groups
   where advertiser_id = v_advertiser.id and is_active;
  if not found then return jsonb_build_object('found', false, 'reason', 'GROUP_NOT_FOUND'); end if;

  select count(*)::int,
         (count(*) filter (where o.app_status = 'Paid'))::int
    into v_leads, v_paid
    from public.orders o
   where o.source = 'orderonline'
     and public.normalize_code(o.advertiser_code) = v_advertiser.code_normalized
     and public.normalize_code(o.product_code) = v_product.code_normalized
     and coalesce(o.source_created_at, o.created_at) >= v_start
     and coalesce(o.source_created_at, o.created_at) < v_end;

  v_message := replace(
    replace(
      replace(
        replace(
          replace(
            replace(v_template.message_content, '{{mention}}', '@' || v_group.pic_phone),
            '{{store_name}}', v_advertiser.name),
          '{{product_name}}', v_product.name),
        '{{leads}}', v_leads::text),
      '{{paid}}', v_paid::text),
    '{{report_url}}',
    coalesce(p_base_url, '') || '/report-spend?advertiserCode=' || v_advertiser.code || '&productCode=' || v_product.code
  );

  return jsonb_build_object(
    'found', true,
    'group_id', v_group.fonnte_group_id,
    'message', v_message,
    'leads', v_leads,
    'paid', v_paid,
    'advertiser_name', v_advertiser.name,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'reminder_date', v_today
  );
end $$;

revoke all on function public.wa_reminder_claim(timestamptz, text, integer),
  public.wa_reminder_mark(uuid, text, text, text),
  public.wa_reminder_preview(timestamptz, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.wa_reminder_claim(timestamptz, text, integer),
  public.wa_reminder_mark(uuid, text, text, text),
  public.wa_reminder_preview(timestamptz, text, text, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 11. Retensi log (90 hari). Defensif bila pg_cron tidak tersedia.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'pg_cron tidak tersedia: retensi wa_reminder_logs TIDAK dijadwalkan.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'dvflow_wa_reminder_logs_retention') then
    perform cron.unschedule('dvflow_wa_reminder_logs_retention');
  end if;
  perform cron.schedule(
    'dvflow_wa_reminder_logs_retention',
    '43 3 * * *',
    $cron$delete from public.wa_reminder_logs where created_at < now() - interval '90 days'$cron$
  );
end
$$;

notify pgrst, 'reload schema';

