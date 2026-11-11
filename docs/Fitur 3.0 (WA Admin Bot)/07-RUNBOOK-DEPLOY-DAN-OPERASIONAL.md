# 07 — Runbook Deploy & Operasional

## 1. Prasyarat

- Migrasi `20261111120000_wa_admin_bot.sql` diterapkan ke Supabase produksi.
- `INTEGRATION_ENCRYPTION_KEY` sudah ada (dipakai integrasi OrderOnline).
- Token device Fonnte.
- ID grup WhatsApp tiap pengiklan (`12xxx@g.us`).

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
`scripts/check-schema-version.mjs` sampai `schema_version = 70` terpasang.

Verifikasi cepat di SQL editor:

```sql
select public.schema_version();                      -- 70
select count(*) from public.app_permissions
 where key in ('config.wa_bot', 'action.wa_bot_send'); -- 2
select jobname from cron.job
 where jobname = 'dvflow_wa_reminder_logs_retention';  -- 1 baris
```

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
4. **Grup & PIC**: `+ Tambah Grup` untuk setiap pengiklan; isi ID grup dan
   nomor PIC `08xxx`.
5. **Template Pesan**: buat minimal satu template, gunakan chip placeholder.
6. **Jadwal Pengingat**: tambah jam (WIB), pilih template, pilih hari, aktifkan.
7. **Kirim Tes** ke satu grup untuk membuktikan token dan ID grup benar.

## 7. Smoke test produksi

1. Buat jadwal 2–5 menit dari sekarang (WIB).
2. Tunggu satu run cron; buka **Riwayat Pengiriman**.
3. Baris harus muncul dengan status `Terkirim` (atau `Gagal` + alasan).
4. Pastikan grup menerima **satu** pesan; tunggu satu menit lagi dan pastikan
   tidak ada pesan kedua.
5. Ubah laporan: isi Report Spend untuk produk itu kemarin, lalu buat jadwal
   berikutnya; produk tersebut harus tidak diingatkan lagi.

## 8. Troubleshooting

| Gejala | Penyebab paling mungkin | Tindakan |
|---|---|---|
| Riwayat kosong padahal jadwal lewat | `WA_CRON_SECRET` beda antara Pages dan Worker | Samakan secret, cek log Worker. |
| `skipped: NO_TOKEN` | Token belum diisi | Simpan token di dashboard. |
| `skipped: TOKEN_UNREADABLE` | `INTEGRATION_ENCRYPTION_KEY` berubah/hilang | Kembalikan kunci lama atau simpan ulang token. |
| `failed` dengan `token invalid` | Token Fonnte dicabut | Ambil token baru dari dashboard Fonnte, simpan ulang. |
| `target invalid` / pesan tidak sampai | ID grup salah atau device tidak tergabung | Salin ulang ID grup dari Fonnte. |
| Pesan masuk tetapi status `failed` | Respons Fonnte tidak berstatus `true` | Lihat kolom Keterangan; kirim ulang setelah token benar. |
| Semua produk diingatkan padahal sudah lapor | Rentang tanggal report tidak mencakup kemarin | Periksa tanggal report; batch memang diabaikan. |
| Produk tidak diingatkan | Tidak ada leads kemarin, atau tidak ada grup aktif | Cek order D-1 dan status grup. |
| Tidak ada pesan sama sekali | Cron Worker belum deploy / `APP_BASE_URL` salah | Cek trigger & deployment Worker. |

## 9. Rollback

- Nonaktifkan jadwal (`is_active = false`) untuk menghentikan pengiriman tanpa
  menghapus konfigurasi.
- Hapus trigger Worker dengan menghapus/menonaktifkan Worker `dvflow-wa-cron`.
- Migrasi tidak dihapus. Tabel baru tidak memengaruhi fitur lama, sehingga
  rollback aplikasi tidak memerlukan rollback database.
