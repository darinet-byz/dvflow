-- A95: daftar kartu laporan untuk popup "Laporan Iklan".
-- Popup punya filter produk sendiri; daftar tidak mengikuti filter halaman
-- Report Spend Iklan (tanggal/produk/pengiklan/batch/jenis acara).
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 94, 'schema_version mencakup 94');

insert into public.products(id,name,code) values
  ('f9500000-0000-0000-0000-00000000000a','Produk Popup','POP');
insert into public.advertisers(id,name,code) values
  ('f9500000-0000-0000-0000-000000000001','Zul Popup','93'),
  ('f9500000-0000-0000-0000-000000000002','Rina Popup','94');
insert into public.users(id,username,display_name,password_hash,role,has_all_product_access,advertiser_id) values
  ('f9500000-0000-0000-0000-0000000000c1','popup_mgr','Manajer Popup','test','manajer',true,null),
  ('f9500000-0000-0000-0000-0000000000a1','popup_zul','Zul Popup','test','advertiser',true,'f9500000-0000-0000-0000-000000000001'),
  ('f9500000-0000-0000-0000-0000000000a2','popup_rina','Rina Popup','test','advertiser',true,'f9500000-0000-0000-0000-000000000002'),
  ('f9500000-0000-0000-0000-0000000000b1','popup_member','Member Popup','test','member',true,null);

select is((public.save_ad_spend_card(
  'f9500000-0000-0000-0000-0000000000a1', null, 'Card Zul', 'POP', '400', 'Seminar Offline', null, null
))->>'action', 'created', 'card pengiklan 93 dibuat');
select is((public.save_ad_spend_card(
  'f9500000-0000-0000-0000-0000000000a2', null, 'Card Rina', 'POP', '400', 'Seminar Offline', null, null
))->>'action', 'created', 'card pengiklan 94 dibuat');

-- Manajer: semua card berjalan dalam scope produk.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9500000-0000-0000-0000-0000000000c1","app_role":"manajer"}';
create temp table popup_mgr on commit drop as select public.ad_spend_cards_list() as v;
select is((select jsonb_array_length(v) from popup_mgr), 2, 'manajer melihat dua card berjalan');
select ok((select bool_and((x->>'can_edit')::boolean) from popup_mgr, jsonb_array_elements(v) x),
  'manajer boleh mengelola card');
select ok((select bool_and((x->>'own')::boolean = false) from popup_mgr, jsonb_array_elements(v) x),
  'card orang lain bukan own bagi staff');
reset role;

-- Advertiser: hanya card miliknya.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9500000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table popup_zul on commit drop as select public.ad_spend_cards_list() as v;
select is((select jsonb_array_length(v) from popup_zul), 1, 'advertiser hanya melihat card sendiri');
select is((select x->>'advertiser_code' from popup_zul, jsonb_array_elements(v) x), '93', 'card milik pengiklan 93');
select ok((select (x->>'own')::boolean from popup_zul, jsonb_array_elements(v) x), 'own true untuk card sendiri');
reset role;

-- Card Selesai keluar dari daftar popup.
select is((public.finish_ad_spend_card(
  'f9500000-0000-0000-0000-0000000000a1',
  (select id from public.ad_spend_cards where advertiser_id = 'f9500000-0000-0000-0000-000000000001')
))->>'status', 'selesai', 'card pengiklan 93 selesai');
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9500000-0000-0000-0000-0000000000a1","app_role":"advertiser"}';
create temp table popup_zul_done on commit drop as select public.ad_spend_cards_list() as v;
select is((select jsonb_array_length(v) from popup_zul_done), 0, 'card selesai tidak muncul di popup');
reset role;

-- Tanpa izin lihat report spend ditolak.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9500000-0000-0000-0000-0000000000b1","app_role":"member"}';
select throws_ok('select public.ad_spend_cards_list()', 'DF006', 'FORBIDDEN', 'tanpa izin report spend ditolak');
reset role;

select is(has_function_privilege('authenticated','public.ad_spend_cards_list()','execute'), true,
  'browser boleh membaca daftar card');
select is(has_function_privilege('anon','public.ad_spend_cards_list()','execute'), false,
  'anon tidak boleh membaca daftar card');

select * from finish();
rollback;
