-- ============================================================================
-- 0019_search_indexes — index pencarian teks (pg_trgm)
-- ============================================================================
--
-- Kotak pencarian (01 §7, PRD §109) mencocokkan SUBSTRING, jadi btree tidak
-- menolong. Satu index ekspresi gabungan TIDAK dapat dipakai untuk rantai
-- `OR` pada kolom berbeda, sehingga index dibuat per kolom — planner lalu
-- menggabungkannya dengan BitmapOr.
--
-- Biaya: setiap index GIN menambah biaya tulis pada ingestion webhook. Bila
-- volume tulis menjadi dominan, index yang paling jarang dipakai boleh
-- dihapus lewat migrasi baru (06 §7: setiap perubahan skema = migrasi baru).

create index orders_order_id_trgm_idx on public.orders using gin (order_id extensions.gin_trgm_ops);
create index orders_name_trgm_idx on public.orders using gin (name extensions.gin_trgm_ops);
create index orders_phone_trgm_idx on public.orders using gin (phone extensions.gin_trgm_ops);
create index orders_product_raw_trgm_idx on public.orders using gin (product_raw extensions.gin_trgm_ops);
create index orders_product_name_trgm_idx on public.orders using gin (product_name extensions.gin_trgm_ops);
create index orders_advertiser_name_trgm_idx on public.orders using gin (advertiser_name extensions.gin_trgm_ops);
create index orders_batch_trgm_idx on public.orders using gin (batch extensions.gin_trgm_ops);
create index orders_session_trgm_idx on public.orders using gin (session extensions.gin_trgm_ops);
create index orders_city_trgm_idx on public.orders using gin (city extensions.gin_trgm_ops);
