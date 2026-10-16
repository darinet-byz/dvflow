-- 0035 (A18): list orders/presensi hanya bisa dibuka sampai 500 baris (10 halaman x 50).
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select ok(public.schema_version() >= 35, 'schema_version mencakup 0035');
insert into public.users(id,username,display_name,password_hash,role) values ('f3000000-0000-0000-0000-000000000001','lim_dev','Dev','test','developer');
set local role authenticated;
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-000000000001","app_role":"developer"}';

select lives_ok($$select public.orders_page(p_page => 10, p_page_size => 50)$$, 'orders: halaman 10 x 50 boleh');
select throws_ok($$select public.orders_page(p_page => 11, p_page_size => 50)$$, 'DF011', 'PAGE_LIMIT', 'orders: halaman 11 ditolak');
select lives_ok($$select public.orders_page(p_page => 5, p_page_size => 100)$$, 'orders: halaman 5 x 100 boleh');
select throws_ok($$select public.orders_page(p_page => 6, p_page_size => 100)$$, 'DF011', 'PAGE_LIMIT', 'orders: halaman 6 x 100 ditolak');
select lives_ok($$select public.presensi_page(p_page => 10, p_page_size => 50)$$, 'presensi: halaman 10 x 50 boleh');
select throws_ok($$select public.presensi_page(p_page => 11, p_page_size => 50)$$, 'DF011', 'PAGE_LIMIT', 'presensi: halaman 11 ditolak');
reset role;

select * from finish();
rollback;
