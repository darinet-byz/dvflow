# Runbook Migrasi Produksi (0024–0029) + Pembersihan Data Trial

Tanggal: 14 Oktober 2026. Dijalankan oleh pemilik project.

## Mengapa

Push `2d2674c` ke `main` otomatis men-deploy kode baru ke Cloudflare Pages. Database produksi masih tertinggal:

- riwayat migrasi tercatat sampai 0023;
- objek 0024–0026 sudah ada di database, tetapi belum tercatat di riwayat;
- 0027–0029 belum diterapkan.

Akibatnya RPC seperti `delete_config_master` tidak ditemukan, sehingga tombol **Hapus**, export, simpan permission, dan fitur lain menampilkan "Terjadi kesalahan pada server".

Setelah runbook ini dijalankan, deploy kembali aman. Sejak commit ini, CI juga menahan deploy bila `schema_version()` di database lebih kecil dari nomor migrasi tertinggi (`scripts/check-schema-version.mjs`).

Keputusan pengguna: **seluruh data saat ini adalah data trial dan boleh dihapus total.**

## Prasyarat

- Supabase CLI sudah login, dan project tertaut: `npx supabase link --project-ref <ref>`.
- `.env.setup.local` berisi:
  - `SUPABASE_DB_URL` (connection string Postgres project, bukan URL REST);
  - `SUPABASE_PROJECT_REF`.
- UUID akun **Developer** aktif di produksi. Pembersihan konfigurasi hanya boleh dilakukan Developer.

## Langkah

### 1. Backup penuh

```powershell
npx supabase db dump --linked -f .local-backups/prod-schema.sql
npx supabase db dump --linked --data-only -f .local-backups/prod-data.sql
```

Folder `.local-backups/` diabaikan Git. Simpan salinannya di tempat aman.

### 2. Cek riwayat dan objek 0024–0026 (read-only)

```powershell
npx supabase migration list --linked
```

Jalankan query berikut di SQL Editor Supabase. Semua kolom harus `true`:

```sql
select
  to_regclass('public.app_roles') is not null            as m0024_roles,
  to_regclass('public.user_product_access') is not null  as m0024_access,
  exists(select 1 from pg_proc where proname = 'admin_create_user' and pronargs = 9) as m0024_create_user,
  to_regclass('public.product_aliases') is not null      as m0025_aliases,
  exists(select 1 from pg_proc where proname = 'batch_remap_orders')               as m0025_remap,
  exists(select 1 from pg_proc where proname = 'developer_reset_data')             as m0026_reset,
  exists(select 1 from pg_proc where proname = 'purge_expired_unmapped_orders')    as m0026_purge;
```

- **Semua `true`:** tandai ketiganya sudah diterapkan, tanpa menjalankan ulang seed permission 0024.

  ```powershell
  npx supabase migration repair --status applied 0024 0025 0026 --linked
  ```

- **Ada yang `false`:** berhenti. Jangan `repair`; laporkan hasil query ini ke developer.

### 3. Terapkan 0027–0029

```powershell
npx supabase db push --linked
```

Kemudian, di SQL Editor:

```sql
notify pgrst, 'reload schema';
select public.schema_version();   -- harus 29
```

### 4. Hapus data trial (dry-run dulu)

```powershell
node scripts/wipe-trial-data.mjs --env .env.setup.local
```

Periksa jumlah baris yang dicetak dan file backup JSON yang dibuat. Bila sudah sesuai:

```powershell
node scripts/wipe-trial-data.mjs --env .env.setup.local --apply --project <ref> --actor <uuid-developer> --yes-delete-transactions
```

**Dihapus:**

- order, presensi, sumber order, dan log webhook;
- alias, mapping Zoom/tiket, dan penugasan produk;
- empat kamus master (Produk, Pengiklan, Tipe, Sesi).

Setelah itu tipe SO/WO dan sesi ST/S1–S8 diisi ulang, dan constraint kode ketat divalidasi.

**Dipertahankan:**

- akun dan role/permission;
- koneksi OrderOnline (URL webhook yang terpasang tetap berlaku);
- fee rule tax.

Catatan: user dengan akses produk terbatas kehilangan penugasannya. Tugaskan ulang lewat Add Team setelah produk baru dibuat.

### 5. Deploy ulang

Jalankan ulang workflow **Deploy to Cloudflare Pages** (Actions → Run workflow), atau push commit berikutnya. Langkah *Check database schema version* harus `OK`.

### 6. Smoke test produksi

```powershell
$env:SMOKE_BASE_URL='https://<domain>'; node scripts/smoke-pages-local.mjs
```

Lalu uji manual:

- [ ] Login Developer.
- [ ] Konfigurasi Produk: Tambah (kode 4 huruf), Edit, Nonaktifkan, Aktifkan, Hapus.
- [ ] Pengiklan (2 digit) dan Sesi.
- [ ] Hapus produk yang sedang dipakai rule Zoom → pesan "Konfigurasi masih digunakan" (bukan error server).
- [ ] Integrasi: buka URL redirect `/access/<KODE>/<order_id>` → halaman peserta (bukan halaman aplikasi).

## Bila ada masalah

- **"Database belum diperbarui ke versi aplikasi ini":** langkah 3 belum selesai.
- **Rollback:** pulihkan dari dump langkah 1. Migrasi tidak memiliki skrip turun.
