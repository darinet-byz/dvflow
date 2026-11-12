# 07 — Runbook Deploy & Operasional

## 1. Prasyarat

- Migrasi `20261111120000_wa_admin_bot.sql`,
  `20261112090000_wa_bot_product_level.sql`, dan
  `20261112180000_wa_group_mentions.sql` diterapkan ke Supabase produksi.
- `INTEGRATION_ENCRYPTION_KEY` sudah ada (dipakai integrasi OrderOnline).
- Token device Fonnte.
- ID grup WhatsApp per produk (`12xxx@g.us`).

## 2. Variabel & secret

### Backend (Cloudflare Pages)

| Nama | Wajib | Keterangan |
|---|---|---|
| `WA_CRON_SECRET` | Ya | Harus sama dengan secret Worker. Tanpa ini endpoint cron 404. |
| `WA_BATCH_LIMIT` | Tidak | Default `10`; maks. 25. |
| `WA_SEND_DELAY_MS` | Tidak | Default `1500`; maks. 5000. |
| `WA_FONNTE_BASE_URL` | Tidak | Default `https://api.fonnte.com` (untuk uji lokal). |

```bash
wrangler pages secret put WA_CRON_SECRET
```

### Cron Worker (`apps/wa-cron`)

| Nama | Wajib | Keterangan |
|---|---|---|
| `WA_CRON_SECRET` | Ya | Secret yang sama dengan backend. |
| `APP_BASE_URL` | Ya (var) | Domain aplikasi, mis. `https://dvflow.pages.dev`. Diatur di `wrangler.toml`. |

```bash
npx wrangler secret put WA_CRON_SECRET -c apps/wa-cron/wrangler.toml
```

Token Fonnte **tidak** dipasang di Worker. Token diisi dari dashboard
**WA Admin Bot → Koneksi Fonnte**.

## 3. Terapkan migrasi

```bash
# dari root repo, terhadap project produksi yang sudah tertaut
supabase db push
```

Jangan memakai `supabase db reset` di produksi. Deploy aplikasi ditahan
`scripts/check-schema-version.mjs` sampai `schema_version = 71` terpasang.

Verifikasi cepat di SQL editor:

```sql
select public.schema_version();                      -- 74
select count(*) from public.app_permissions
 where key in ('config.wa_bot', 'action.wa_bot_send'); -- 2
select jobname from cron.job
 where jobname = 'dvflow_wa_reminder_logs_retention';  -- 1 baris
select count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'advertisers'
   and column_name = 'wa_phone';                       -- 0 (kolom sudah dihapus)
```

Tabel `wa_reminder_groups` dibiarkan sebagai legacy (tidak dibaca kode baru);
konfigurasi grup produk dimulai dari nol.

## 4. Deploy Worker cron

Manual:

```bash
npm run deploy:wa-cron
```

Workflow `.github/workflows/deploy-wa-cron.yml` bersifat **manual**
(`workflow_dispatch`) karena deploy Pages memakai akun/token Cloudflare yang
belum tentu punya izin Workers Scripts:Edit. Jalankan manual hanya bila secret
repo `CLOUDFLARE_API_TOKEN` sudah memiliki izin Workers pada akun Worker;
selain itu gunakan perintah di atas dengan akun OAuth yang berhak.

Catatan lingkungan saat ini: Pages berada di akun `d8737f6c…` (token API),
sedangkan Worker `dvflow-wa-cron` di akun `e85eb36d…` (OAuth). Worker hanya
memanggil URL publik Pages, jadi perbedaan akun tidak masalah.

Setelah deploy, pastikan:

```bash
npx wrangler deployments list -c apps/wa-cron/wrangler.toml
```

dan di dashboard Cloudflare → Workers → `dvflow-wa-cron` → Triggers terlihat
cron `* * * * *`.

## 5. Uji lokal

```bash
npm run db:start
node scripts/write-dev-vars.mjs      # membuat WA_CRON_SECRET lokal
npm run dev:backend                  # wrangler pages dev :8788

# terminal lain: jalankan worker dengan cron tiruan
npx wrangler dev -c apps/wa-cron/wrangler.toml --test-scheduled \
  --var APP_BASE_URL:http://127.0.0.1:8788

curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"
```

Catatan: jalankan Worker pada port yang berbeda dari backend, dan samakan
`WA_CRON_SECRET` di kedua sisi. Untuk uji tanpa mengirim WhatsApp nyata, arahkan
`WA_FONNTE_BASE_URL` ke server tiruan.

## 6. Setup di dashboard

1. Login sebagai Manajer/Admin (atau Developer/Owner).
2. **Sistem → WA Admin Bot**.
3. **Koneksi Fonnte**: tempel token device, klik **Simpan Token**.
4. **Produk & Grup**: `+ Atur Produk`; pilih produk, isi ID grup, aktifkan.
   Semua pengiklan yang ditugaskan ke produk otomatis disebut namanya.
5. **Template**: buat minimal satu template, gunakan chip placeholder.
6. **Jadwal**: tambah jam (WIB), pilih template, pilih hari, pilih **Siapa yang
   disebut** (semua pengiklan untuk pagi; hanya yang belum lapor untuk siang/sore),
   lalu aktifkan.
7. **Kirim Tes** → **Preview** → **Kirim ke Grup** untuk membuktikan token,
   grup, dan nomor tag benar.

## 7. Smoke test produksi

1. Buat jadwal 2–5 menit dari sekarang (WIB).
2. Tunggu satu run cron; buka **Riwayat**.
3. Baris harus muncul dengan status `Terkirim` (atau `Gagal` + alasan) dan
   jenis acara yang benar.
4. Pastikan grup menerima **satu** pesan per pengiklan yang belum lapor; tunggu
   satu menit lagi dan pastikan tidak ada pesan kedua.
5. Isi Report Spend untuk **satu jenis acara** kemarin, lalu buat jadwal
   berikutnya; jenis acara itu tidak diingatkan lagi, jenis acara lain tetap.
6. Cek log berumur lebih dari 3 hari sudah hilang (retensi otomatis).

## 8. Troubleshooting

| Gejala | Penyebab paling mungkin | Tindakan |
|---|---|---|
| Riwayat kosong padahal jadwal lewat | `WA_CRON_SECRET` beda antara Pages dan Worker | Samakan secret, cek log Worker. |
| `skipped: NO_TOKEN` | Token belum diisi | Simpan token di dashboard. |
| Badge **Token ditolak** | Fonnte menolak token (dicabut/salah salin) | Ambil token baru di dashboard Fonnte, simpan ulang. |
| Badge **Device terputus** | Device logout dari WhatsApp meski token valid | Buka WhatsApp di ponsel Fonnte, sambungkan ulang, klik **Cek Ulang**. |
| Badge **Fonnte tak terjangkau** | `fetch` dari Pages Functions ke `api.fonnte.com` gagal (DNS/koneksi/TLS); detail teknis tampil di panel status | Cek **Cek Ulang**; bila tetap, catat detailnya dan uji koneksi keluar dari Worker. Pesan juga akan gagal dengan `NETWORK: …`. |
| `skipped: TOKEN_UNREADABLE` | `INTEGRATION_ENCRYPTION_KEY` berubah/hilang | Kembalikan kunci lama atau simpan ulang token. |
| `failed` dengan `token invalid` | Token Fonnte dicabut | Ambil token baru dari dashboard Fonnte, simpan ulang. |
| `target invalid` / pesan tidak sampai | ID grup salah atau device tidak tergabung | Salin ulang ID grup dari Fonnte. |
| Pesan masuk tetapi status `failed` | Respons Fonnte tidak berstatus `true` | Lihat kolom Keterangan; kirim ulang setelah token benar. |
| Semua produk diingatkan padahal sudah lapor | Rentang tanggal report tidak mencakup kemarin, atau jenis acaranya beda | Periksa tanggal + jenis acara report; batch memang diabaikan. |
| Pengiklan tidak disebut | Pengiklan tidak ditugaskan ke produk, nonaktif, atau tidak punya order kemarin untuk jenis acara itu | Cek mapping `product_advertisers`, status aktif, dan order D-1. Tag WhatsApp memang tidak tersedia di Fonnte; yang muncul hanya teks `@Nama`. |
| Produk tidak diingatkan | Tidak ada order kemarin, grup produk nonaktif, atau pengiklan tidak ditugaskan | Cek order D-1, status grup, dan mapping `product_advertisers`. |
| Log lama masih terlihat | `pg_cron` tidak tersedia dan cron belum berjalan | Panggil `select public.wa_reminder_purge(now(), 3);` atau biarkan klaim berikutnya membersihkan. |
| Tidak ada pesan sama sekali | Cron Worker belum deploy / `APP_BASE_URL` salah | Cek trigger & deployment Worker. |

## 9. Rollback

- Nonaktifkan jadwal (`is_active = false`) untuk menghentikan pengiriman tanpa
  menghapus konfigurasi.
- Hapus trigger Worker dengan menghapus/menonaktifkan Worker `dvflow-wa-cron`.
- Migrasi tidak dihapus. Tabel baru tidak memengaruhi fitur lama, sehingga
  rollback aplikasi tidak memerlukan rollback database.
