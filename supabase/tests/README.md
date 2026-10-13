# supabase/tests

Test perilaku database (pgTAP), dijalankan dengan:

```bash
npm run db:start     # sekali per sesi
npm run db:reset     # menerapkan migrations/ + seed.sql
npm run test:db      # setara `supabase test db`
```

Setiap berkas berjalan di dalam satu transaksi dan diakhiri `rollback`, jadi
tidak meninggalkan data di database lokal.

| Berkas | Cakupan |
|---|---|
| `01_rls_and_grants.sql` | batas RLS/grant, kolom kredensial, penolakan staff, anon |
| `02_webhook_upsert.sql` | C01–C14: idempotensi, validasi, `paid_at`, `product_raw` |
| `03_seminar_checkin.sql` | G/H: idempotensi check-in seminar, penolakan, retensi 30 hari |
| `04_tax_snapshot.sql` | E01–E10: aritmetika, snapshot, paritas angka dengan TypeScript |
| `05_read_rpcs.sql` | I/J: KPI, filter, sort, pagination, paritas filter, Report Tax |

## Dua jebakan saat menulis test di image ini

### 1. Jangan memanggil fungsi yang hak `EXECUTE`-nya sudah dicabut

Pada image Supabase lokal (PostgreSQL 17.6) di mesin pengembangan ini,
memanggil fungsi di mana peran pemanggil **tidak** punya `EXECUTE` membuat
backend **segfault** — bukan `42501`:

```text
LOG:  server process (PID 586) was terminated by signal 11: Segmentation fault
```

Terjadi untuk fungsi `SECURITY DEFINER` maupun `SECURITY INVOKER`, dan untuk
`anon` maupun `authenticated`. Penolakan tingkat **tabel** (`permission denied
for table ...`) berjalan normal dan tetap boleh diuji dengan `throws_ok`.

Karena itu hak eksekusi fungsi diuji dengan `has_function_privilege(...)`, yang
menanyakan hak yang sama tanpa menjalankan fungsinya:

```sql
select is(has_function_privilege('authenticated', 'public.verify_login(text, text)', 'execute'),
  false, 'RPC verifikasi login tertutup untuk authenticated');
```

Ini bug platform, bukan bug skema. Dampaknya terbatas pada koneksi SQL
langsung: PostgREST hanya mengekspos fungsi yang dapat dieksekusi peran
pemanggil, sehingga jalur ini tidak dapat dicapai lewat API aplikasi.

### 2. Jangan membuat ekstensi `pgtap` di schema `public`

CLI sudah memasang `pgtap` di schema `extensions`. Mencoba
`create extension pgtap with schema public` juga memicu segfault yang sama.
Setiap berkas test cukup menyetel `search_path`:

```sql
begin;
set local search_path = public, extensions, pg_catalog;
select no_plan();
```

## Cakupan yang belum tertutup

- **M01/M02 paralel sejati.** pgTAP berjalan pada satu sesi, jadi dua webhook
  atau dua scan yang benar-benar bersamaan belum diuji. Yang diuji adalah
  mekanismenya (UNIQUE `order_id`, `INSERT ... ON CONFLICT DO NOTHING`, partial
  unique index seminar) lewat pengulangan. Uji paralel dua koneksi perlu
  ditambahkan sebelum klaim production-ready.
- **Jalur HTTP Worker.** Belum ada backend (P3/P4), jadi seluruh test di sini
  menguji database secara langsung.
