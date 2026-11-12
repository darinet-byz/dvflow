# 04 — Kontrak API & Keamanan

Semua respons memakai envelope standar:

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": { "code": "INVALID_ARGUMENT", "message": "…" } }
```

## 1. Endpoint admin (Bearer + permission)

| Method | Path | Permission | Fungsi |
|---|---|---|---|
| GET | `/api/wa-bot` | `config.wa_bot` | Seluruh konfigurasi + status token. |
| PUT | `/api/wa-bot/settings` | `config.wa_bot` | Simpan/ganti token Fonnte. |
| POST | `/api/wa-bot/settings/verify` | `config.wa_bot` | Cek token ke Fonnte dan kembalikan status device (tanpa token). |
| POST | `/api/wa-bot/product-groups` | `config.wa_bot` | Tambah mapping grup produk. |
| PATCH | `/api/wa-bot/product-groups/:id` | `config.wa_bot` | Edit mapping grup produk. |
| DELETE | `/api/wa-bot/product-groups/:id` | `config.wa_bot` | Hapus mapping grup produk. |
| PATCH | `/api/wa-bot/advertisers/:id` | `config.wa_bot` | Simpan nomor WA pengiklan. |
| POST | `/api/wa-bot/templates` | `config.wa_bot` | Tambah template. |
| PATCH | `/api/wa-bot/templates/:id` | `config.wa_bot` | Edit template. |
| DELETE | `/api/wa-bot/templates/:id` | `config.wa_bot` | Hapus template (ditolak bila dipakai jadwal). |
| POST | `/api/wa-bot/schedules` | `config.wa_bot` | Tambah jadwal. |
| PATCH | `/api/wa-bot/schedules/:id` | `config.wa_bot` | Edit jadwal. |
| DELETE | `/api/wa-bot/schedules/:id` | `config.wa_bot` | Hapus jadwal. |
| GET | `/api/wa-bot/logs` | `config.wa_bot` | Riwayat + filter + pagination. |
| POST | `/api/wa-bot/test-preview` | `action.wa_bot_send` | Render pesan uji tanpa mengirim. |
| POST | `/api/wa-bot/test-send` | `action.wa_bot_send` | Kirim satu pesan uji. |
| POST | `/api/wa-bot/logs/:id/resend` | `action.wa_bot_send` | Kirim ulang pesan yang tercatat. |

### GET /api/wa-bot

```json
{
  "settings": { "has_token": true, "updated_at": "2026-11-11T01:00:00Z" },
  "products": [{
    "id": "…", "code": "KM", "name": "Kuliner Masteri", "active": true,
    "group": {
      "id": "…", "product_id": "…", "fonnte_group_id": "111@g.us",
      "is_active": true, "created_at": "…", "updated_at": "…"
    },
    "advertisers": [{ "id": "…", "code": "01", "name": "Zul", "active": true, "wa_phone": "628111111111" }]
  }],
  "advertisers": [{
    "id": "…", "code": "01", "name": "Zul", "active": true, "wa_phone": "628111111111",
    "products": [{ "code": "KM", "name": "Kuliner Masteri" }]
  }],
  "templates": [{ "id": "…", "name": "Pagi", "message_content": "…", "is_active": true }],
  "schedules": [{
    "id": "…", "execution_time": "09:00:00", "template_id": "…", "template_name": "Pagi",
    "days": [0,1,2,3,4,5,6], "only_if_missing_report": true, "is_active": true
  }]
}
```

`fonnte_token_encrypted` **tidak pernah** ada di respons.

### PUT /api/wa-bot/settings

```json
{ "fonnte_token": "token-device-fonnte" }
```

Token 8–512 karakter. Respons `{ "has_token": true }`. Token dienkripsi sebelum
disimpan; nilai lama ditimpa. Menyimpan token **tidak** membuktikan device
terhubung; gunakan endpoint verify di bawah.

### POST /api/wa-bot/settings/verify

Memanggil `POST https://api.fonnte.com/device` memakai token tersimpan (dekripsi
server-side). Token tidak pernah ikut di respons.

```json
{
  "has_token": true,
  "reachable": true,
  "connected": true,
  "status": "connect",
  "device": {
    "number": "6282227097005", "name": "Fonnte admin", "status": "connect",
    "quota": "78", "package": "Reguler", "expired": "18 November 2029"
  },
  "error": null,
  "detail": null
}
```

- `reachable: false` — Fonnte tidak menjawab (jaringan/timeout), `error: "NETWORK"`
  dan `detail` memuat alasan teknis (DNS/koneksi/TLS) yang dipotong 200 karakter.
- `reachable: true, error: "token invalid"` — Fonnte menolak token.
- `reachable: true, error: null, status: "disconnect"` — token valid, tetapi
  device sedang logout dari WhatsApp.
- `error: "TOKEN_UNREADABLE"` — kunci enkripsi berubah; simpan ulang token.
- Tanpa token: `has_token: false`, `connected: false`.


### POST/PATCH product-group

```json
{
  "product_id": "uuid",
  "fonnte_group_id": "12xxx@g.us",
  "is_active": true
}
```

Validasi: produk ada, belum punya grup lain, grup tidak kosong ≤100. Saat
mengaktifkan, semua pengiklan aktif yang ditugaskan ke produk wajib sudah punya
`wa_phone`; bila belum, respons 400 menyebut nama pengiklan yang kurang.

### PATCH advertiser

```json
{ "wa_phone": "0812-3456-7890" }
```

Nomor dinormalisasi ke `628…`; kosong/format salah ditolak 400. Respons
`{ "id": "…", "wa_phone": "6281234567890" }`.

### POST/PATCH template

```json
{ "name": "Template Pagi", "message_content": "Halo {{mention}} …", "is_active": true }
```

Ditolak bila nama kosong/ganda, isi kosong/>4.000 karakter, atau placeholder
tidak dikenal.

### POST/PATCH schedule

```json
{
  "execution_time": "09:00",
  "template_id": "uuid",
  "days": [1,2,3,4,5],
  "only_if_missing_report": true,
  "is_active": true
}
```

Waktu dinormalisasi menjadi `HH:MM:00`; minimal satu hari; template harus ada.

### GET /api/wa-bot/logs

Query: `page`, `pageSize` (maks. 100), `status` (`queued|sent|failed`),
`product` (kode), `advertiser` (kode), `event_type`
(`Seminar Offline|Webinar Online|Hybrid`), `date_from`, `date_to`
(`YYYY-MM-DD`). Respons: `{ rows, total, page, pageSize }`. Baris memuat
`event_type`.

### POST /api/wa-bot/test-preview

```json
{
  "advertiser_code": "01",
  "product_code": "KM",
  "template_id": "uuid",
  "event_type": "Seminar Offline"
}
```

Respons sama dengan data preview: `group_id`, `message`, `leads`, `paid`,
`advertiser_id`, `advertiser_name`, `product_code`, `product_name`, `event_type`.
Tidak mengirim apa pun dan tidak menulis log.

### POST /api/wa-bot/test-send

Body sama dengan preview. Respons:

```json
{
  "log_id": "uuid",
  "sent": true,
  "error": null,
  "message": "Halo @Zul …",
  "group_id": "111@g.us",
  "event_type": "Seminar Offline"
}
```

Pesan tes tetap dicatat di `wa_reminder_logs` (`schedule_id = null`).

### POST /api/wa-bot/logs/:id/resend

Tidak memerlukan body. Mengirim ulang `message` yang tersimpan, menaikkan
`attempts`, memperbarui status. `404 WA_LOG_NOT_FOUND` untuk id tak dikenal.

## 2. Endpoint internal (cron)

| Method | Path | Autentikasi |
|---|---|---|
| POST | `/api/internal/wa-reminders/run` | Header `X-WA-Cron-Secret` |

- `WA_CRON_SECRET` kosong → **404**.
- Secret salah → **404** (bukan 401, agar tidak mengonfirmasi endpoint).
- Perbandingan waktu tetap (constant-time).
- Tidak memakai cookie, sehingga tidak ada risiko CSRF.

Respons normal:

```json
{ "skipped": null, "claimed": 10, "sent": 9, "failed": 1 }
{ "skipped": "NO_TOKEN", "claimed": 0, "sent": 0, "failed": 0 }
{ "skipped": "TOKEN_UNREADABLE", "claimed": 0, "sent": 0, "failed": 0 }
```

## 3. Kode error

| Kode | Status | Kapan |
|---|---|---|
| `FORBIDDEN` | 403 | Tidak punya permission. |
| `INVALID_ARGUMENT` | 400 | Validasi form/grup/produk/nomor/template/jadwal/token. |
| `RESOURCE_NOT_FOUND` | 404 | Produk-group/template/schedule/advertiser tidak ada. |
| `WA_LOG_NOT_FOUND` | 404 | Log kirim ulang tidak ada. |
| `MASTER_IN_USE` | 409 | Template masih dipakai jadwal. |
| `NOT_FOUND` | 404 | Endpoint cron tanpa secret yang benar. |
| `INTERNAL_ERROR` | 500 | Kegagalan tak terduga. |

## 4. Keamanan

| Aturan | Penerapan |
|---|---|
| Token tidak ke browser | Tanpa grant/policy SELECT; respons hanya `has_token`. |
| Token terenkripsi | AES-256-GCM + IV acak, kunci backend `INTEGRATION_ENCRYPTION_KEY`. |
| Secret cron | Header + constant-time compare + gagal-tertutup. |
| Permission server-side | `requirePermission` membaca baris `users` di database, bukan claim JWT. |
| Tidak ada injeksi | Semua nilai lewat PostgREST/RPC berparameter; template hanya dikirim sebagai teks WhatsApp. |
| Log tanpa kredensial | Pesan/nama boleh ada (kebutuhan operasional); token/secret tidak pernah ditulis. |
| Retensi | Log **3 hari**, dihapus `pg_cron` + purge defensif di klaim. |
