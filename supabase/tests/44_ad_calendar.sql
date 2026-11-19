-- A80: Kalender Iklan + skor kedisiplinan di Performa/Analitik.
-- Mengunci: satu deadline per pengiklan+produk+batch, tanggal tayang dari lead
-- lalu report, band skor 10/8/6/4/2/0, batch belum jatuh tempo dikecualikan,
-- prev_tickets bulan kalender sebelumnya, dan scope produk.
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 80, 'schema_version mencakup 80');
select is((select count(*)::int from public.app_role_permissions
  where permission_key = 'action.manage_ad_calendar' and role_id in ('manajer','admin')), 2,
  'Manajer + Admin default dapat mengelola Kalender Iklan');
select is(has_table_privilege('authenticated', 'public.ad_calendar', 'select'), false,
  'ad_calendar tertutup untuk authenticated');
select is(has_table_privilege('authenticated', 'public.ad_calendar', 'insert'), false,
  'ad_calendar tidak dapat ditulis browser');

insert into public.products(id,name,code,active) values
  ('ad000000-0000-0000-0000-0000000000aa','Produk Iklan','ADCX',true);
insert into public.advertisers(id,name,code,active) values
  ('ad000000-0000-0000-0000-000000000001','Pengiklan Iklan','91',true),
  ('ad000000-0000-0000-0000-000000000002','Pengiklan OTS','92',true);
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access) values
  ('ad000000-0000-0000-0000-0000000000c1','adc_mgr','Manajer Iklan','test','manajer',true);
insert into public.event_calendar(id,product_code,category,event_date,start_time,location) values
  ('ad000000-0000-0000-0000-0000000000e1','ADCX','Webinar',current_date + 20,'10:00','Zoom');

-- Satu batch: deadline lewat 10 hari, lead pertama 9 hari lalu -> telat 1 hari (8).
insert into public.ad_calendar(event_id,advertiser_id,product_code,batch,deadline_date) values
  ('ad000000-0000-0000-0000-0000000000e1','ad000000-0000-0000-0000-000000000001','ADCX','392',current_date - 10),
  -- Tanpa lead, report mulai 12 hari lalu -> tepat waktu (10).
  ('ad000000-0000-0000-0000-0000000000e1','ad000000-0000-0000-0000-000000000001','ADCX','393',current_date - 10),
  -- Deadline masih 10 hari lagi, belum ada data -> upcoming (tidak dinilai).
  ('ad000000-0000-0000-0000-0000000000e1','ad000000-0000-0000-0000-000000000001','ADCX','394',current_date + 10),
  -- Hanya ada OTS: bukan bukti iklan tayang.
  ('ad000000-0000-0000-0000-0000000000e1','ad000000-0000-0000-0000-000000000002','ADCX','400',current_date - 10);

select throws_ok($$insert into public.ad_calendar(advertiser_id,product_code,batch,deadline_date)
  values ('ad000000-0000-0000-0000-000000000001','ADCX','0392',current_date)$$,
  '23514', null, 'batch harus sudah dinormalisasi');
select throws_ok($$insert into public.ad_calendar(advertiser_id,product_code,batch,deadline_date)
  values ('ad000000-0000-0000-0000-000000000001','ADCX','392',current_date)$$,
  '23505', null, 'satu deadline per pengiklan + produk + batch');

insert into public.orders(order_id,product_code,product_name,advertiser_code,advertiser_name,batch,session,city,
  product_raw,product_parse_status,event_type,app_status,gross_amount,quantity,source_created_at,source) values
  ('adc-1','ADCX','Produk Iklan','91','Pengiklan Iklan','392','S1','Solo','r','valid','Webinar Online','Pending',100000,1,
   ((current_date - 9)::timestamp at time zone 'Asia/Jakarta'),'orderonline'),
  ('adc-ots','ADCX','Produk Iklan','92','Pengiklan OTS','400','S1','Solo','r','valid','Webinar Online','Paid',100000,1,
   ((current_date - 20)::timestamp at time zone 'Asia/Jakarta'),'ots'),
  ('adc-prev','ADCX','Produk Iklan','91','Pengiklan Iklan','392','S1','Solo','r','valid','Webinar Online','Paid',200000,2,
   ((date_trunc('month', current_date) - interval '1 month' + interval '3 days')::timestamp at time zone 'Asia/Jakarta'),'orderonline');
insert into public.ad_spend_reports(advertiser_id,product_id,batch,event_type,date_from,date_to,spend,tax_percent) values
  ('ad000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-0000000000aa','392','Webinar Online',current_date - 12,current_date - 12,50000,0),
  ('ad000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-0000000000aa','393','Webinar Online',current_date - 12,current_date - 12,50000,0);

-- Prioritas lead: OTS 20 hari lalu dan report tidak boleh menang.
select is((select publish_date::text from public.ad_calendar_publish_date(
    'ad000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-0000000000aa','392')),
  (current_date - 9)::text, 'tanggal tayang dari lead pertama; OTS diabaikan');
select is((select publish_source from public.ad_calendar_publish_date(
    'ad000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-0000000000aa','392')),
  'order', 'sumber tanggal tayang = order');
select is((select publish_date::text from public.ad_calendar_publish_date(
    'ad000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-0000000000aa','393')),
  (current_date - 12)::text, 'tanpa lead, report date_from menjadi tanggal tayang');

-- Halaman Kalender Iklan.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-0000000000c1","app_role":"manajer"}';
create temp table adc_page on commit drop as
  select public.ad_calendar_page(current_date - 30, current_date + 30) as v;

select is((select jsonb_array_length(v->'rows') from adc_page), 4, 'empat deadline tampil');
select is((select x->>'publish_date' from adc_page, jsonb_array_elements(v->'rows') x where x->>'batch' = '400'), null,
  'OTS tidak dihitung sebagai tanggal tayang');
select is((select x->>'publish_source' from adc_page, jsonb_array_elements(v->'rows') x where x->>'batch' = '400'), null,
  'tanpa lead/report, sumber tayang kosong');
select is((select x->>'status' from adc_page, jsonb_array_elements(v->'rows') x where x->>'batch' = '392'), 'late',
  'batch 392 terlambat');
select is((select (x->>'score')::int from adc_page, jsonb_array_elements(v->'rows') x where x->>'batch' = '392'), 8,
  'telat 1 hari = skor 8');
select is((select (x->>'score')::int from adc_page, jsonb_array_elements(v->'rows') x where x->>'batch' = '393'), 10,
  'report lebih awal = skor 10');
select is((select x->>'status' from adc_page, jsonb_array_elements(v->'rows') x where x->>'batch' = '394'), 'upcoming',
  'batch belum jatuh tempo = upcoming');
select is((select (x->>'score') from adc_page, jsonb_array_elements(v->'rows') x where x->>'batch' = '394'), null,
  'batch upcoming tidak punya skor');
select is((select x->>'publish_source' from adc_page, jsonb_array_elements(v->'rows') x where x->>'batch' = '392'), 'order',
  'halaman membawa sumber tayang');

-- Performa: pembanding bulan lalu + skor kedisiplinan.
create temp table adc_perf on commit drop as
  select public.advertiser_performance(null,null,null,date_trunc('month', current_date)::date,current_date,'month') as v;
select is((select (x->>'prev_tickets')::int from adc_perf, jsonb_array_elements(v->'advertisers') x
  where x->>'advertiser_code' = '91'), 2, 'prev_tickets = tiket Paid bulan kalender sebelumnya');
select is((select (x->>'discipline_rate')::numeric from adc_perf, jsonb_array_elements(v->'advertisers') x
  where x->>'advertiser_code' = '91'), 0.9::numeric, 'disiplin = (8+10)/(2x10) = 90%');
select is((select (x->>'discipline_batches')::int from adc_perf, jsonb_array_elements(v->'advertisers') x
  where x->>'advertiser_code' = '91'), 2, 'dua batch dinilai; yang upcoming dikecualikan');
select is((select (x->>'discipline_on_time')::int from adc_perf, jsonb_array_elements(v->'advertisers') x
  where x->>'advertiser_code' = '91'), 1, 'satu batch tepat waktu');
select is((select (x->>'discipline_late')::int from adc_perf, jsonb_array_elements(v->'advertisers') x
  where x->>'advertiser_code' = '91'), 1, 'satu batch terlambat');
select is((select (x->>'discipline_upcoming')::int from adc_perf, jsonb_array_elements(v->'advertisers') x
  where x->>'advertiser_code' = '91'), 1, 'satu batch belum jatuh tempo');

-- Detail pengiklan juga membawa ringkasan kedisiplinan.
create temp table adc_detail on commit drop as
  select public.advertiser_performance('91',null,null,date_trunc('month', current_date)::date,current_date,'month') as v;
select is((select (v->'summary'->>'discipline_rate')::numeric from adc_detail), 0.9::numeric,
  'detail: kedisiplinan 90%');
select is((select (v->'summary'->>'discipline_batches')::int from adc_detail), 2,
  'detail: dua batch dinilai');

reset role;
select * from finish();
rollback;
