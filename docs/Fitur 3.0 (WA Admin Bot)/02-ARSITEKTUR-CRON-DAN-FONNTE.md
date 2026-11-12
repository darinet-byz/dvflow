# 02 — Arsitektur Cron & Fonnte

## 1. Diagram

```text
Admin (browser)
  └─ /wa-bot
       ├─ baca  : GET  /api/wa-bot
       └─ tulis : POST/PATCH/DELETE /api/wa-bot/*
                        │
                        ▼
                Pages Functions → @dvflow/api
                        │ service_role
                        ▼
                    Supabase
        wa_bot_settings / wa_product_groups
        product_advertisers / advertisers
        wa_reminder_templates / wa_reminder_schedules
        wa_reminder_logs + RPC claim/mark/preview/purge

Cloudflare Worker cron  (* * * * *, setiap menit)
  └─ POST /api/internal/wa-reminders/run
       header: X-WA-Cron-Secret
            │
            ▼
     Backend (detik-detik):
       1. baca token Fonnte (dekripsi)
       2. RPC wa_reminder_claim(now WIB, base_url, limit)
       3. untuk setiap task: POST api.fonnte.com/send
       4. RPC wa_reminder_mark(sent|failed)
            │
            ▼
        Fonnte → grup WhatsApp
```

## 2. Mengapa Worker terpisah

Cloudflare **Pages Functions tidak memiliki cron trigger**. Yang tersedia hanya
`pg_cron` di Supabase, dan itu tidak dapat memanggil HTTP tanpa `pg_net`.
Karena itu:

- `apps/wa-cron` = Worker kecil dengan `[triggers] crons = ["* * * * *"]`.
- Worker tidak menyimpan token Fonnte dan tidak tahu template/jadwal.
- Semua keputusan ada di backend, sesuai dokumen asli Fitur 3.0 §5.

Konsekuensi operasional: ada **dua** target deploy (Pages + Worker). Workflow
terpisah `.github/workflows/deploy-wa-cron.yml` memastikan kegagalan Worker tidak
menahan rilis aplikasi utama.

## 3. Mengapa backend yang mengirim

Dokumen asli menaruh pengiriman di Worker. Implementasi ini memindahkannya ke
backend karena:

1. Token Fonnte harus dapat diganti dari dashboard. Menyalinnya ke Worker
   berarti setiap rotasi token butuh deploy/secret baru.
2. Log `sent/failed` dan retry harus satu tempat dengan data lain.
3. Worker tidak perlu memegang kredensial pihak ketiga.

Batas platform yang harus dihormati: cron berinterval < 1 jam dibatasi
**±30 detik wall-clock** per invokasi. Karena itu backend mengirim **maksimal 10
pesan per run** dengan jeda 1,5 detik (dapat diatur `WA_BATCH_LIMIT` /
`WA_SEND_DELAY_MS`). Jumlah efektif juga diturunkan otomatis agar total jeda
tidak melewati 20 detik; sisa antrean dihabiskan run berikutnya (satu menit
kemudian).

## 4. Idempotensi

Satu-satunya penjaga pesan ganda adalah unique index parsial:

```sql
unique (schedule_id, advertiser_id, product_code, event_type, reminder_date)
where schedule_id is not null and status in ('queued', 'sent')
```

`wa_reminder_claim` memakai `insert ... on conflict do nothing`, sehingga dua run
bersamaan tetap menghasilkan satu task. Baris `failed` sengaja tidak ikut unik
agar dapat dicoba ulang; jumlah percobaan dibatasi 3 per hari.

Klaim yang menggantung (Worker mati setelah klaim, sebelum menandai hasil)
ditandai `failed` setelah 10 menit, lalu boleh dicoba lagi.

## 5. Zona waktu

- Semua jadwal dan tanggal laporan memakai **Asia/Jakarta**.
- `p_now` dikirim backend sebagai ISO UTC; SQL mengubahnya:
  `p_now at time zone 'Asia/Jakarta'`.
- Jendela eksekusi 09:00–09:59 WIB (toleransi 60 menit) membuat cron yang
  terlambat tidak kehilangan jadwal, tanpa mengirim dua kali.
- Batas “kemarin” memakai konvensi A24 yang sama dengan laporan lain.

## 6. Alur kegagalan

| Kejadian | Perilaku |
|---|---|
| Token kosong | Run berhenti dengan `skipped: NO_TOKEN`; dashboard menampilkan “Token belum diatur”. |
| Token tidak dapat didekripsi | `skipped: TOKEN_UNREADABLE`; admin menyimpan ulang token. |
| Fonnte menolak (token invalid, target invalid, kuota) | Log `failed` + alasan; run lain tetap dikirim. |
| Jaringan/timeout | Log `failed` dengan `NETWORK`; retry otomatis pada run berikutnya (maks. 3). |
| Worker cron mati | Tidak ada klaim baru; saat hidup lagi, jadwal dalam jendela 60 menit tetap dikirim. |
| Dua run bersamaan | Unique index + `on conflict do nothing`; satu task. |
| Ads report jenis acara itu sudah ada | Pengiklan dilewati untuk jadwal itu; jenis acara lain tetap dikirim. |

## 7. Urutan pengiriman

`wa_reminder_claim` mengurutkan `execution_time`, nama pengiklan, nama produk,
jenis acara. Backend mengirim berurutan dengan jeda. Tidak ada paralelisme agar
tidak memancing rate limit/ban Fonnte.
