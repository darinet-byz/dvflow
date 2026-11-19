-- 20261120110000_ad_calendar_auto_incomplete — A84 (permintaan pengguna 20 Nov 2026).
--
-- 1) Citta membuat deadline Kalender Iklan otomatis saat draft /add dikonfirmasi:
--    tanggal event paling awal - 21 hari; bila H-21 sudah lewat, pakai H-14.
-- 2) Batch dan pengiklan tidak wajib disebut di chat. Bila tidak disebut, baris
--    tetap disimpan dengan penanda belum lengkap: batch '?' dan advertiser_id NULL.
--    UI Kalender Iklan menampilkan tanda (!) dan operator melengkapi lewat web.
-- 3) ad_calendar mendapat source ('manual'/'ai') + ai_draft_id. Baris manual tidak
--    pernah ditimpa oleh Citta.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 84 $$;

-- ---------------------------------------------------------------------------
-- 1. ad_calendar: boleh tanpa pengiklan + jejak AI
-- ---------------------------------------------------------------------------
alter table public.ad_calendar
  alter column advertiser_id drop not null;

alter table public.ad_calendar
  add column if not exists source text not null default 'manual';
alter table public.ad_calendar
  add column if not exists ai_draft_id uuid;

alter table public.ad_calendar
  drop constraint if exists ad_calendar_source_check;
alter table public.ad_calendar
  add constraint ad_calendar_source_check check (source in ('manual', 'ai'));

-- Indeks unik dari rancangan awal tidak dipakai: beberapa batch yang sama-sama
-- belum menyebut nomor batch harus tetap menjadi baris terpisah.
drop index if exists public.ad_calendar_unassigned_key;

-- Indeks bantu untuk menelusuri baris yang belum lengkap.
create index if not exists ad_calendar_incomplete_idx
  on public.ad_calendar (product_code, batch)
  where advertiser_id is null;

create index if not exists ad_calendar_ai_draft_idx
  on public.ad_calendar (ai_draft_id)
  where ai_draft_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Halaman Kalender Iklan: tampilkan baris tanpa pengiklan + tanda incomplete
-- ---------------------------------------------------------------------------
create or replace function public.ad_calendar_page(
  p_actor uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_actor is null or not public.actor_has_permission(p_actor, 'operasional.event_calendar') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception using errcode = 'DF011', message = 'INVALID_ARGUMENT';
  end if;

  with base as (
    select ac.id,
           ac.event_id,
           ac.deadline_date,
           ac.batch,
           ac.product_code,
           ac.source,
           ac.advertiser_id,
           p.name as product_name,
           a.code as advertiser_code,
           a.name as advertiser_name,
           e.event_date,
           e.category,
           e.start_time,
           e.location,
           pub.publish_date,
           pub.publish_source
      from public.ad_calendar ac
      join public.products p on p.code = ac.product_code
      left join public.advertisers a on a.id = ac.advertiser_id
      left join public.event_calendar e on e.id = ac.event_id
      cross join lateral public.ad_calendar_publish_date(ac.advertiser_id, p.id, ac.batch) pub
     where public.actor_can_product(p_actor, p.code)
       and (p_from is null or ac.deadline_date >= p_from)
       and (p_to is null or ac.deadline_date <= p_to)
  ),
  scored as (
    select b.*,
           (b.advertiser_id is null or b.batch = '?') as incomplete,
           case
             when b.publish_date is null and b.deadline_date > (now() at time zone 'Asia/Jakarta')::date then null
             when b.publish_date is null then 0
             when b.publish_date <= b.deadline_date then 10
             when b.publish_date - b.deadline_date <= 3 then 8
             when b.publish_date - b.deadline_date <= 7 then 6
             when b.publish_date - b.deadline_date <= 14 then 4
             when b.publish_date - b.deadline_date <= 30 then 2
             else 0
           end as score,
           case
             when b.publish_date is null and b.deadline_date > (now() at time zone 'Asia/Jakarta')::date then 'upcoming'
             when b.publish_date is null then 'unpublished'
             when b.publish_date <= b.deadline_date then 'on_time'
             else 'late'
           end as status
      from base b
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'event_id', s.event_id,
        'event_date', s.event_date,
        'category', s.category,
        'start_time', s.start_time,
        'location', s.location,
        'product_code', s.product_code,
        'product_name', s.product_name,
        'advertiser_code', s.advertiser_code,
        'advertiser_name', s.advertiser_name,
        'batch', s.batch,
        'deadline_date', s.deadline_date,
        'publish_date', s.publish_date,
        'publish_source', s.publish_source,
        'days_late', case when s.publish_date is null then null else s.publish_date - s.deadline_date end,
        'score', s.score,
        'status', s.status,
        'incomplete', s.incomplete,
        'source', s.source
      ) order by s.deadline_date, s.advertiser_code, s.product_code, s.batch)
        from scored s
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by p.code)
        from public.products p
       where p.active
    ), '[]'::jsonb),
    'advertisers', coalesce((
      select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name) order by a.code)
        from public.advertisers a
       where a.active
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'product_code', e.product_code,
        'product_name', p.name,
        'category', e.category,
        'event_date', e.event_date,
        'start_time', e.start_time,
        'location', e.location
      ) order by e.event_date, e.start_time, e.product_code)
        from public.event_calendar e
        join public.products p on p.code = e.product_code
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.ad_calendar_page(uuid, date, date) from public, anon, authenticated;
grant execute on function public.ad_calendar_page(uuid, date, date) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Konfirmasi draft: event + deadline iklan otomatis
-- ---------------------------------------------------------------------------
create or replace function public.ai_confirm_draft(
  p_actor uuid,
  p_draft_id uuid,
  p_group_id text,
  p_selection integer[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_draft public.ai_drafts;
  v_item jsonb;
  v_idx integer;
  v_saved integer := 0;
  v_skipped integer := 0;
  v_created uuid[] := '{}';
  v_deleted uuid[] := '{}';
  v_id uuid;
  v_event public.event_calendar;
  v_first_date date;
  v_first_time time;
  v_event_id uuid;
  v_advertiser_ids uuid[];
  v_advertiser_id uuid;
  v_batch text;
  v_deadline date;
  v_ad_rule text;
  v_ad_saved integer := 0;
  v_ad_skipped integer := 0;
  v_ad_incomplete boolean := false;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if not exists (select 1 from public.users where id = p_actor and is_system) then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;

  select * into v_draft
    from public.ai_drafts
   where id = p_draft_id
     for update;

  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_draft.wa_group_id is distinct from p_group_id then
    return jsonb_build_object('status', 'WRONG_GROUP');
  end if;
  if v_draft.status <> 'pending' then
    return jsonb_build_object('status', 'NOT_PENDING');
  end if;
  if v_draft.expires_at <= now() then
    update public.ai_drafts set status = 'expired' where id = v_draft.id;
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  if v_draft.command = 'add' then
    if not exists (
      select 1 from public.products where code = v_draft.product_code and active
    ) then
      update public.ai_drafts
         set status = 'failed', error = 'PRODUCT_INACTIVE'
       where id = v_draft.id;
      return jsonb_build_object('status', 'FAILED', 'reason', 'PRODUCT_INACTIVE');
    end if;

    for v_idx in 1..jsonb_array_length(coalesce(v_draft.payload -> 'items', '[]'::jsonb)) loop
      if p_selection is not null and array_length(p_selection, 1) is not null
         and not (v_idx = any (p_selection)) then
        continue;
      end if;

      v_item := v_draft.payload -> 'items' -> (v_idx - 1);
      if coalesce((v_item ->> 'valid')::boolean, false) is false then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Revalidasi saat konfirmasi: katalog bisa berubah sejak preview.
      if coalesce(v_item ->> 'category', '') not in ('Seminar', 'Webinar', 'Workshop')
         or coalesce(btrim(v_item ->> 'location'), '') = ''
         or length(coalesce(v_item ->> 'location', '')) > 200
         or coalesce(v_item ->> 'event_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
         or (v_item ->> 'event_date')::date < v_today
         or coalesce(v_item ->> 'start_time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
         or length(coalesce(v_item ->> 'city', '')) > 80 then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if exists (
        select 1 from public.event_calendar e
         where e.product_code = v_draft.product_code
           and e.event_date = (v_item ->> 'event_date')::date
           and e.start_time = ((v_item ->> 'start_time') || ':00')::time
           and lower(e.location) = lower(v_item ->> 'location')
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.event_calendar (
        product_code, category, event_date, start_time, location, city,
        source, ai_draft_id, created_by, updated_by
      ) values (
        v_draft.product_code,
        v_item ->> 'category',
        (v_item ->> 'event_date')::date,
        ((v_item ->> 'start_time') || ':00')::time,
        btrim(v_item ->> 'location'),
        nullif(btrim(v_item ->> 'city'), ''),
        'ai',
        v_draft.id,
        p_actor,
        p_actor
      )
      returning id into v_id;

      v_created := array_append(v_created, v_id);
      v_saved := v_saved + 1;

      if v_first_date is null
         or (v_item ->> 'event_date')::date < v_first_date
         or ((v_item ->> 'event_date')::date = v_first_date
             and ((v_item ->> 'start_time') || ':00')::time < v_first_time) then
        v_first_date := (v_item ->> 'event_date')::date;
        v_first_time := ((v_item ->> 'start_time') || ':00')::time;
        v_event_id := v_id;
      end if;
    end loop;

    -- Deadline iklan otomatis dari event paling awal yang benar-benar tersimpan.
    if v_saved > 0 and v_first_date is not null and v_event_id is not null then
      v_batch := nullif(btrim(coalesce(v_draft.payload ->> 'batch', '')), '');
      if v_batch is null or length(v_batch) > 32 then
        v_batch := '?';
      end if;

      v_deadline := v_first_date - 21;
      v_ad_rule := 'H-21';
      if v_deadline < v_today then
        v_deadline := v_first_date - 14;
        v_ad_rule := 'H-14';
      end if;

      -- Pengiklan yang disebut di chat; hanya yang benar-benar ditugaskan ke produk.
      if jsonb_array_length(coalesce(v_draft.payload -> 'advertiser_codes', '[]'::jsonb)) > 0 then
        select array_agg(distinct a.id)
          into v_advertiser_ids
          from jsonb_array_elements_text(v_draft.payload -> 'advertiser_codes') c
          join public.advertisers a on a.code_normalized = public.normalize_code(c)
          join public.product_advertisers pa on pa.advertiser_id = a.id and pa.product_id = v_draft.product_id
         where a.active;
      end if;

      if v_advertiser_ids is null or array_length(v_advertiser_ids, 1) is null then
        -- Belum ada pengiklan: simpan satu baris belum lengkap. Batch '?' boleh
        -- muncul lebih dari sekali (batch berbeda yang belum disebut); operator
        -- melengkapi batch + pengiklan lewat web.
        v_ad_incomplete := true;
        insert into public.ad_calendar (
          event_id, advertiser_id, product_code, batch, deadline_date,
          source, ai_draft_id, created_by, updated_by
        ) values (
          v_event_id, null, v_draft.product_code, v_batch, v_deadline,
          'ai', v_draft.id, p_actor, p_actor
        );

        v_ad_saved := v_ad_saved + 1;
      else
        if v_batch = '?' then
          v_ad_incomplete := true;
        end if;

        foreach v_advertiser_id in array v_advertiser_ids loop
          if exists (
            select 1 from public.ad_calendar ac
             where ac.advertiser_id = v_advertiser_id
               and ac.product_code = v_draft.product_code
               and ac.batch = v_batch
               and ac.source = 'manual'
          ) then
            v_ad_skipped := v_ad_skipped + 1;
          else
            insert into public.ad_calendar (
              event_id, advertiser_id, product_code, batch, deadline_date,
              source, ai_draft_id, created_by, updated_by
            ) values (
              v_event_id, v_advertiser_id, v_draft.product_code, v_batch, v_deadline,
              'ai', v_draft.id, p_actor, p_actor
            )
            on conflict (advertiser_id, product_code, batch)
            do update set
              event_id = excluded.event_id,
              deadline_date = excluded.deadline_date,
              updated_by = excluded.updated_by,
              updated_at = now(),
              ai_draft_id = excluded.ai_draft_id
            where public.ad_calendar.source = 'ai';

            v_ad_saved := v_ad_saved + 1;
          end if;
        end loop;
      end if;
    end if;
  elsif v_draft.command = 'delete' then
    for v_idx in 1..jsonb_array_length(coalesce(v_draft.payload -> 'candidates', '[]'::jsonb)) loop
      if p_selection is not null and array_length(p_selection, 1) is not null
         and not (v_idx = any (p_selection)) then
        continue;
      end if;

      v_item := v_draft.payload -> 'candidates' -> (v_idx - 1);

      select * into v_event
        from public.event_calendar
       where id = (v_item ->> 'id')::uuid
         and product_code = v_draft.product_code
         for update;

      if not found then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Deadline manual adalah sumber kebenaran operator: event tidak boleh hilang.
      -- Deadline otomatis Citta (source='ai') ikut dihapus bersama event.
      if exists (
        select 1 from public.ad_calendar ac
         where ac.event_id = v_event.id and ac.source = 'manual'
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      update public.ai_drafts
         set deleted_snapshot = coalesce(deleted_snapshot, '[]'::jsonb)
             || jsonb_build_array(to_jsonb(v_event))
       where id = v_draft.id;

      delete from public.ad_calendar
       where event_id = v_event.id and source = 'ai';

      delete from public.event_calendar where id = v_event.id;
      v_deleted := array_append(v_deleted, v_event.id);
      v_saved := v_saved + 1;
    end loop;
  end if;

  update public.ai_drafts
     set status = case when v_saved > 0 then 'confirmed' else 'failed' end,
         created_ids = v_created,
         deleted_ids = v_deleted,
         confirmed_at = now(),
         error = case when v_saved = 0 then 'NO_ROW_SAVED' else null end
   where id = v_draft.id;

  return jsonb_build_object(
    'status', case when v_saved > 0 then 'CONFIRMED' else 'FAILED' end,
    'saved', v_saved,
    'skipped', v_skipped,
    'created_ids', to_jsonb(v_created),
    'deleted_ids', to_jsonb(v_deleted),
    'ad_calendar_saved', v_ad_saved,
    'ad_calendar_skipped', v_ad_skipped,
    'ad_calendar_incomplete', v_ad_incomplete,
    'ad_batch', v_batch,
    'ad_deadline_date', v_deadline,
    'ad_deadline_rule', v_ad_rule
  );
end $$;

revoke all on function public.ai_confirm_draft(uuid, uuid, text, integer[]) from public, anon, authenticated;
grant execute on function public.ai_confirm_draft(uuid, uuid, text, integer[]) to service_role;

notify pgrst, 'reload schema';
