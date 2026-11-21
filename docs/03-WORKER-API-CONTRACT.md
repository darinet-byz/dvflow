# CLOUDFLARE WORKER API CONTRACT
## dvflow

Versi: 1.0

## 1. General response format
JSON API success:
```json
{ "ok": true, "data": {} }
```

JSON API error:
```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable Indonesian message"
  }
}
```

Jangan expose stack trace, database error mentah, secret, atau SQL ke client.

## 2. Canonical OrderOnline webhook object
External payload OrderOnline harus diubah oleh adapter menjadi object internal ini sebelum business logic berjalan:

```ts
type CanonicalOrderWebhook = {
  orderId: string
  customerName?: string | null
  phone?: string | null
  email?: string | null
  productRaw?: string | null
  rawStatus: 'pending' | 'processing' | 'complete' | 'cancelled' | string
  paymentMethod?: string | null
  paymentProvider?: string | null
  paymentIdentifier?: string | null
  grossAmount: number
  sourceCreatedAt?: string | null
  sourceUpdatedAt?: string | null
}
```

IMPORTANT:
- nama key eksternal OrderOnline tidak boleh ditebak;
- implementasikan adapter setelah sample payload nyata tersedia;
- business logic setelah adapter tidak boleh bergantung pada provider key mentah.

## 3. POST /api/webhooks/orderonline/:webhookSecret
Auth: secret path match Worker environment.

Behavior:
1. reject invalid secret with 404;
2. parse JSON/body;
3. adapter -> CanonicalOrderWebhook;
4. validate required canonical fields: orderId, rawStatus, grossAmount;
5. parse productRaw;
6. normalize status;
7. normalize payment identifier;
8. resolve fee rule;
9. calculate tax snapshot;
10. upsert by order_id;
11. return 200 quickly.

Status normalization:
- pending -> Pending
- processing -> Paid
- complete -> Paid
- cancelled -> Cancelled
- unknown raw status -> 422 `UNSUPPORTED_ORDER_STATUS` and do not silently map.

Success response:
```json
{
  "ok": true,
  "data": {
    "order_id": "283033796",
    "action": "inserted | updated"
  }
}
```

Errors:
- 400 INVALID_PAYLOAD
- 404 endpoint secret mismatch
- 422 UNSUPPORTED_ORDER_STATUS
- 500 INTERNAL_ERROR

Provider retries must be safe because order_id is unique/upsert.

## 4. POST /api/auth/login
Body:
```json
{ "username": "zul", "password": "..." }
```

Behavior:
- normalize username lowercase+trim;
- lookup active user;
- verify PBKDF2 hash constant-time;
- issue refresh session cookie;
- mint 30-minute Supabase-compatible access JWT;
- return safe profile + access token.

Invalid login always returns same generic response:
- 401 INVALID_CREDENTIALS

Do not reveal whether username exists.

## 5. POST /api/auth/refresh
Auth: HttpOnly refresh cookie.

Behavior:
- hash cookie token and lookup active, unexpired, unrevoked session;
- verify user active;
- update last_used_at;
- mint new 30-minute access JWT;
- return profile + token.

Errors:
- 401 SESSION_INVALID
- 401 USER_DISABLED

## 6. POST /api/auth/logout
Auth: refresh cookie if present.

Behavior:
- revoke matched app_session;
- clear cookie;
- return 200 even if session already invalid (idempotent).

## 7. POST /api/auth/change-password
Auth: logged-in session.
Body:
```json
{
  "current_password": "...",
  "new_password": "...",
  "new_password_confirmation": "..."
}
```

Validation:
- minimum 8 characters;
- new/confirmation equal;
- current password correct.

On success:
- generate new salt/hash;
- revoke all existing sessions for user;
- current client must login again.

## 8. GET /access/:orderId
Public participant route.

Lookup order.
Denied when:
- order not found;
- app_status != Paid;
- product_parse_status != valid;
- event_type unknown.

If Webinar Online:
1. lookup app_settings exact key `webinar_destination::<product_raw>`;
2. if missing -> error page, no attendance event;
3. insert webinar attendance row;
4. HTTP 302 redirect to destination.

If Seminar Offline:
- render participant ticket page containing safe participant/event data and client-side QR payload `/checkin/:orderId`.

Never include privileged admin data.

## 9. POST /checkin/:orderId
Preferred scanner call. GET route may display only a safe result page; actual mutation should be POST.

Auth: admin/staff/master_admin app session/access token.

Validation:
- order exists;
- app_status = Paid;
- event_type = Seminar Offline.

A61 — check-in per tiket. Body opsional:
```json
{ "tickets": 2 }
```

- Tiket tersisa 1 → langsung check-in tanpa body.
- Tiket tersisa > 1 tanpa `tickets` → 200 `NEEDS_QUANTITY` + `remaining_tickets`, **tanpa menulis**.
- `tickets` diisi → satu baris presensi seminar per tiket; kelebihan dipotong ke sisa.
- Semua tiket sudah hadir → 200 `ALREADY_CHECKED_IN`.
- Respons memuat `quantity`, `checked_in_tickets`, `remaining_tickets`, `tickets_confirmed`.

Errors:
- 404 ORDER_NOT_FOUND
- 403 ORDER_NOT_PAID
- 409 NOT_SEMINAR_ORDER
- 400 INVALID_ARGUMENT (tickets < 1 atau di luar batas)

## 10. GET /api/scanner/search?q=
Auth: logged-in user.

Search seminar candidates by:
- exact/partial Order ID;
- name;
- phone.

Limit results: 20.
Server-side query.
Do not return webinar orders.
A61: setiap kandidat memuat `quantity`, `checked_in_tickets`, `remaining_tickets`.

## 11. POST /api/scanner/manual-checkin
Auth: logged-in user.
Body:
```json
{ "order_id": "283033796", "tickets": 2 }
```

`tickets` opsional dan mengikuti aturan yang sama dengan POST /checkin/:orderId.
Same validator as POST /checkin/:orderId.
Source = seminar_manual.
No bypass.

## 11a. POST /api/presensi/:orderId/mark-present (A62)
Auth: `operasional.presensi` + `action.manual_checkin`.

Body opsional:
```json
{ "tickets": 1 }
```

Tanpa `tickets` = seluruh sisa tiket ditandai hadir. Dengan `tickets` = sejumlah itu
(dipotong ke sisa oleh RPC). Memakai `checkin_seminar` source `seminar_manual`,
sehingga operator yang melakukan koreksi tercatat di `attendance_events.scanner_user_id`.

## 11b. POST /api/presensi/:orderId/reset (A62)
Auth: `operasional.presensi` + `action.manual_checkin`.

Body opsional:
```json
{ "tickets": 1 }
```

Tanpa `tickets` = seluruh presensi seminar order dihapus. Dengan `tickets` = N presensi
terbaru dihapus, sehingga status dapat berubah menjadi `Hadir Sebagian`.
Order harus Paid dan Seminar Offline/Hybrid; webinar ditolak `NOT_SEMINAR_ORDER`.

## 12. Configuration CRUD endpoints
Use one consistent protected pattern.

Allowed resources:
- products
- advertisers
- event-types
- sessions
- payment-fee-rules

GET list: master_admin/admin/staff only where page needs read.
POST/PATCH/DELETE(deactivate): master_admin/admin only.

Delete semantics = `active=false`.
No hard delete endpoint.

**A74 — status sesi khusus Developer.** Untuk `sessions`:
- `POST` dari role mana pun selalu menyimpan `active=true` (field `active` di body diabaikan).
- `PATCH` yang memuat `active` dan `DELETE` (nonaktifkan) hanya untuk role `developer`; role lain menerima `403 FORBIDDEN`.
- `DELETE ?permanent=true` untuk sesi juga hanya `developer`, dan tetap ditolak `MASTER_IN_USE` bila order/alias memakai kode tersebut.
- Menyunting nama sesi tetap boleh untuk pemegang `config.produk`.

## 12a. Card Report Spend Iklan (A37/A87)
Halaman membaca lewat RPC `ad_spend_report(p_date_from, p_date_to, p_product_code, p_advertiser_code, p_batch, p_event_type)`.
Hasil RPC: `summary` (semua card yang beririsan filter), `cards[]` (status `berjalan`), `rows[]` (status `selesai`),
`sessions` (A43), dan `comparison` (A46). Setiap card membawa `spends[]` (baris budget: `date_from`, `date_to`,
`spend`, `tax_percent`, `tax_amount`), plus `own` dan `can_edit`.

Sejak A87, satu card = pengiklan + produk + batch + jenis acara. Budget boleh banyak baris; tiap baris punya PPN
sendiri. Leads/Paid/Tiket/Omzet dihitung sekali per card (`distinct order_id`), bukan sekali per baris budget.

### Buat/ubah/hapus card
- `POST /api/ad-spend-cards` → 201 (200 `action: "existing"` bila card scope itu sudah ada)
- `PATCH /api/ad-spend-cards/:id` → 200
- `DELETE /api/ad-spend-cards/:id` → 200 (hard delete card + semua baris)

Body POST:
```json
{
  "name": "Produk A · Batch 122 · Seminar Offline",
  "product_code": "KULI",
  "batch": "122",
  "event_type": "Seminar Offline",
  "spends": [
    { "date_from": "2026-10-21", "date_to": "2026-10-21", "spend": 6000000, "tax_percent": 11 },
    { "date_from": "2026-10-21", "date_to": "2026-10-21", "spend": 4000000, "tax_percent": 0 }
  ]
}
```
Body PATCH: `{ "name", "status": "berjalan"|"selesai", "spends": [...] }`. Baris lama boleh membawa `id`; baris
baru memakai `id: null`. Scope produk/batch/jenis acara terkunci setelah card dibuat.

Izin: buat card hanya `action.input_spend` + akun advertiser (pengiklan dari akun, bukan body). Edit/hapus:
advertiser pemilik atau role dengan `action.manage_spend` (manajer/owner/developer), dalam scope produk yang diakses.

Error: `AD_SPEND_NOT_FOUND` 404, `FORBIDDEN` 403, `INVALID_ARGUMENT` 400.

### Jalur lama (tetap ada)
- `POST /api/ad-spend-reports` → 201
- `PATCH /api/ad-spend-reports/:id` → 200 (hanya report pengiklan sendiri)
- `DELETE /api/ad-spend-reports/:id` → 200 (hard delete baris; card kosong ikut dihapus)

Body lama: `{ "product_code", "batch", "event_type", "date_from", "date_to", "spend", "tax_percent", "confirm_overlap" }`.
Baris tanpa `card_id` otomatis dimasukkan ke card scope-nya. `AD_SPEND_OVERLAP` 409 masih berlaku untuk jalur lama.

### Status Produk & Pengiklan (A52)
- `product_status_list()` → array produk `{id,code,name,status,active,advertisers[]}`.
- `advertiser_status_list()` → array pengiklan `{id,code,name,status,active,products[]}`.
- `set_product_status(p_product_id, p_status)` dan `set_advertiser_status(p_advertiser_id, p_status)`.
- `set_product_advertisers(p_product_id, p_advertiser_ids[])` dan `set_advertiser_products(p_advertiser_id, p_product_ids[])`.
- Semua RPC memakai izin `operasional.product_status` / `operasional.advertiser_status`; mapping hanya label (tabel `product_advertisers`).
- `set_advertiser_status('Resign')` menonaktifkan user terkait + sesi; status aktif kembali mengaktifkan user terkait.

## 12b. Hapus Order Unmapped (A40)
`POST /api/orders/unmapped/delete` → 200. Butuh izin `operasional.order_unmapped` + `action.delete_master` + akses
semua produk. Hanya order yang masih `product_parse_status = 'invalid'` yang dihapus (beserta presensi dan sumber
tokonya); order ter-mapping atau tidak dikenal dilewati.

Body: `{ "orderIds": ["SOLO-1001", "SOLO-1002"] }` (1–1000 id). Response: `{ "deleted_count": 2, "skipped_count": 0 }`.

Error: `FORBIDDEN` 403, `INVALID_ARGUMENT` 400.

## 12c. Performa / Analitik (A46)
Baca langsung browser ke RPC `advertiser_performance(p_advertiser_code, p_product_code, p_batch, p_date_from, p_date_to, p_granularity)`.
Tidak ada endpoint Worker baru.

- Tanpa `p_advertiser_code`: mode dashboard, hasil `{ advertisers: [...] }` — satu baris per pengiklan dengan
  `spend`, `tax_amount`, `total_spend`, `leads`, `paid`, `tickets`, `omzet`, `profit`, `closing_rate`, `roas`,
  `coverage`, dan `top_products[]`.
- Dengan `p_advertiser_code`: mode detail, hasil `{ summary, rows[], products[], batches[], top_products[] }`.
  `rows[]` berisi bucket `day|month|year`; bucket tidak penuh punya `is_partial = true` dan `prev`/`yoy` null.
- Spend diprorata harian; tiket/omzet hanya order Paid. Ini berbeda dari `ad_spend_report` yang memakai nilai report
  penuh saat beririsan dengan filter (lihat A46).
- Izin `operasional.analytics`; scope produk lewat `actor_can_product` (A44). Error: `FORBIDDEN` 403,
  `INVALID_ARGUMENT` 400.

## 12d. Reschedule & Refund (A58)
Semua endpoint mengubah state, memakai access token, dan menegakkan aturan ulang di RPC database.

### `POST /api/orders/:orderId/reschedule`
Izin `action.reschedule`. Body:
```json
{ "batch": "392", "session": "S2", "city": "Bandung", "reason": "opsional" }
```
Hanya order Paid, produk valid, bukan OTS, dan **belum memiliki presensi apa pun**. Mengubah acara efektif
(`event_*`), tidak mengubah omzet/atribusi batch. Response: `{ order_id, from_*, batch, session, city, rescheduled }`.

Error: `ORDER_NOT_FOUND` 404, `ORDER_NOT_PAID` 403, `ORDER_ALREADY_CHECKED_IN` 409,
`RESCHEDULE_NOT_ALLOWED` 409, `INVALID_ARGUMENT` 400, `FORBIDDEN` 403.

### `POST /api/orders/:orderId/refund`
Izin `action.refund`. Body: `{ "reason": "wajib" }`. Refund **penuh** sebesar `gross_amount`; order menjadi
`app_status = 'Refund'`, sehingga keluar dari Paid/tiket/omzet/laporan Paid dan akses tiket/Zoom ditutup.

Error: `ORDER_NOT_FOUND` 404, `ORDER_NOT_PAID` 403, `ORDER_ALREADY_REFUNDED` 409, `INVALID_ARGUMENT` 400.

### `POST /api/orders/:orderId/refund/cancel`
Izin `action.refund`. Body: `{ "reason": "opsional" }`. Menutup refund aktif dan mengembalikan order ke
`previous_status` (status provider terakhir). Riwayat refund tetap tersimpan.

Error: `ORDER_NOT_REFUNDED` 409.

### Baca halaman Order Refund
Browser membaca RPC `refund_page` / `export_refund_page` (filter tanggal memakai **tanggal refund**).
Izin halaman `operasional.order_refund`; export juga membutuhkan `action.export_data`.

## 13. Profile endpoints
GET /api/profile
PATCH /api/profile

Editable:
- display_name
- avatar_emoji

Username change is not exposed in Profile MVP unless requirement changes.

## 14. Master Admin user provisioning endpoint
POST /api/internal/users
Auth: master_admin only.
No sidebar/menu required.

Allowed fields:
- username
- display_name
- initial_password
- role
- avatar_emoji optional

Master Admin may create admin/staff.
Creation of another master_admin is allowed only if explicitly enabled by environment `ALLOW_MASTER_ADMIN_CREATE_MASTER=true`; default false.

Developer may provision first Master Admin using seed/CLI.

## 15. Error page contract participant access
Use branded but minimal pages:
- ORDER_NOT_FOUND
- PAYMENT_REQUIRED / ORDER_NOT_PAID
- INVALID_EVENT_PRODUCT
- WEBINAR_DESTINATION_NOT_CONFIGURED
- GENERIC_ACCESS_ERROR

Do not show stack traces or internal IDs beyond Order ID supplied by participant.

## 16. Rate limiting
No product-level rate-limit feature is added.
Infrastructure protection is allowed:
- auth login: basic Cloudflare rate limit if configured;
- webhook: Cloudflare/WAF optional.
Do not add user-facing quota behavior.


## A64 - Sumber pendaftaran dan rekap OTS

RPC dashboard_summary, presensi_summary, orders_page/export_orders_page, presensi_page/export_presensi_page, tax_report, dashboard_session_summary, refund_page/export_refund_page menerima argumen akhir `p_source text default null`: `orderonline`, `ots`, atau null/kosong (Semua). Nilai lain ditolak DF011. Izin asli dan aturan retensi/refund tetap berlaku. Baris order/presensi/refund menyertakan `source`.

`GET /api/ots` mempertahankan date/from/to/q/scope/page/pageSize dan default hari ini. Filter tambahan: product_code, batch, session, city, method (ots_tunai/ots_transfer/ots_qris), collector (ID petugas). Tanggal tidak valid atau from > to ditolak 400. Tanggal adalah waktu pendaftaran WIB; batas akhir eksklusif hari berikutnya. Respons menambah `summary: {transactions,tickets,gross_amount,ots_tunai,ots_transfer,ots_qris}` dan `collectors: [{id,name}]`. Ringkasan dihitung sebelum pagination. Transaksi mencakup seluruh hasil; tiket/omzet hanya Paid. Baris menambah app_status, checked_in_tickets, attendance_data_expired. RPC internal service-role `ots_registrations_page(p_actor,p_filters)` menegakkan action.ots dan actor_can_order.

`GET /api/ots/duplicates?phone=...&product_code=...&batch=...&session=...&city=...`: semua parameter wajib; izin action.ots. Respons `{rows:[{order_id,source,name,app_status,quantity}]}`, maksimum 20 kecocokan terbaru. Nomor dinormalisasi (tanda baca dibuang; awalan 0/62 disamakan). Acara memakai effective_batch/session/city dan scope aktor. Pemeriksaan ini tidak mengubah order dan bukan bukti identitas unik. Form baru memerlukan konfirmasi ketika ada hasil; kontrak POST lama tetap kompatibel.

## A79 - Chat internal dan kalender event

### GET /api/chat/recipients
Izin `operasional.chat`. Respons data: `roles: [{id, name, users: [{id, display_name, account_name, is_advertiser, advertiser_name}]}]`. Hanya user aktif yang role-nya punya izin chat; aktor sendiri tidak muncul. Akun Advertiser memakai nama pengiklan sebagai `display_name`.

### GET /api/chat/threads
Izin `operasional.chat`. Respons data: `threads[]` (`id`, `other_user_id`, `other_name`, `other_account_name`, `other_role`, `other_role_name`, `other_advertiser_name`, `last_message`, `last_sender_id`, `last_message_at`, `unread`) dan `unread_total`. Satu thread selalu 1:1.

### GET /api/chat/threads/:id/messages
Izin `operasional.chat`. Hanya peserta thread. Respons: `thread` dan `messages[]` (`id`, `sender_id`, `body`, `created_at`, `mine`). Pesan lawan yang belum dibaca ditandai `read_at`. Thread tidak ada atau bukan peserta -> `RESOURCE_NOT_FOUND` (404).

### POST /api/chat/messages
Izin `action.send_chat`. Body: `role_id`, `all` (boolean), `recipient_id` (wajib bila `all=false`), `body` (maks 2000). Sukses 201 `{sent, thread_ids}`. `all=true` mengirim satu pesan per user aktif di role itu (fan-out 1:1), bukan satu thread grup. Role/penerima/isi tidak valid -> 400.

### GET /api/event-calendar
Izin `operasional.event_calendar`. Query `from`, `to` (YYYY-MM-DD, opsional; maks 400 hari). Respons: `events[]` (`id`, `product_code`, `product_name`, `category`, `event_date`, `start_time`, `location`) dan `products[]` aktif.

### POST /api/event-calendar
Izin `action.manage_event_calendar`. Body: `product_code`, `category` (Seminar/Webinar/Workshop), `event_date` (YYYY-MM-DD), `start_time` (HH:MM), `location` (maks 200). Sukses 201.

### PATCH /api/event-calendar/:id
Sama dengan POST, sukses 200. `DELETE /api/event-calendar/:id` menghapus event, sukses 200. ID tidak valid atau tidak ada -> 404.

### Saran batch
RPC langsung `recent_batches(p_product_code, p_advertiser_code, p_limit)` dari browser (grant authenticated). Maks 3 batch terbaru; nilai batch tetap boleh diketik bebas.

## A80 - Kalender Iklan dan kedisiplinan pengiklan

### GET /api/ad-calendar
Izin `operasional.event_calendar`. Backend memanggil RPC service-only `ad_calendar_page(p_actor, p_from, p_to)` dengan aktor dari sesi; RPC memeriksa izin dan scope produk aktor. Query `from`, `to` (YYYY-MM-DD, opsional; maks 400 hari). Respons: `rows[]` (`id`, `event_id`, `event_date`, `category`, `start_time`, `location`, `product_code`, `product_name`, `advertiser_code`, `advertiser_name`, `batch`, `deadline_date`, `publish_date`, `publish_source`, `days_late`, `score`, `status`), `products[]`, `advertisers[]`, dan `events[]`. `publish_date` diturunkan server: order/lead pertama (selain OTS), lalu `date_from` report spend pertama bila belum ada lead.

### POST /api/ad-calendar
Izin `action.manage_ad_calendar`. Body: `event_id`, `advertiser_code`, `batch` (maks 32, dinormalisasi), `deadline_date` (YYYY-MM-DD). Produk diambil dari event. Satu deadline per pengiklan + produk + batch; duplikat -> `409 AD_CALENDAR_EXISTS`. Sukses 201.

### PATCH /api/ad-calendar/:id dan DELETE /api/ad-calendar/:id
Izin `action.manage_ad_calendar`. PATCH memakai body yang sama; DELETE menghapus deadline. ID tidak valid/tidak ada -> 404.

### Performa
`advertiser_performance` tidak berubah signature. Dashboard menambahkan `prev_tickets` dan field `discipline_*`; detail menambahkan field yang sama di `summary`. Kartu pengiklan memakai Tiket Terjual + delta bulan kalender sebelumnya, ROAS, Kedisiplinan, Top 2 Event, dan Lihat Detail; detail menampilkan Total Spend, Total Omzet, Total Tiket, Profit/Boncos, Closing Rate, ROAS, Kedisiplinan, dan Top 3 Event.

### GET /api/ots/report
Izin `action.ots`. Query: `from`, `to`, `product_code`, `batch`, `session`, `city`, `method`. Respons: `summary`, `batches[]`, `sessions[]`, `from`, `to`. Tanggal memakai WIB; from > to atau tanggal/metode tidak valid -> 400.

## A68 - Presensi Realtime dan total tiket + OTS

`presensi_page`, `export_presensi_page`, dan `presensi_summary` menerima argumen akhir `p_date_mode text default 'order'`: `order` (tanggal order, perilaku lama) atau `attendance` (tanggal scan/check-in `attendance_events.clicked_at`, batas WIB). Nilai lain ditolak DF011 `INVALID_DATE_MODE`. Di mode `attendance`, baris hanya memuat order yang punya check-in pada rentang; `checked_in_in_range` berisi tiket hadir dalam rentang, sedangkan `checked_in_tickets` tetap total. `presensi_summary` mengembalikan tambahan `paid_tickets_online`, `paid_tickets_ots`, `sudah_hadir_online`, `sudah_hadir_ots`, dan `attending_orders`. Semua hitungan per tiket (A61), dan izin `operasional.presensi` tidak berubah.

## A74 - Status sesi khusus Developer dan sesi OTS

Migrasi `20261113120000_session_active_dev_toggle.sql` (`schema_version` 76).

- `PATCH /api/config/sessions/:id` dengan `active` dan `DELETE /api/config/sessions/:id` hanya untuk role `developer`; role lain menerima `403 FORBIDDEN`. `DELETE ?permanent=true` untuk sesi juga hanya Developer dan tetap dijaga `MASTER_IN_USE`.
- `POST /api/config/sessions` menyimpan `active=true` dari role mana pun.
- `save_ots_registration`: sesi untuk pendaftaran **baru** wajib `active`; saat edit, sesi lama yang tersimpan boleh dipertahankan walau nonaktif, tetapi pindah ke sesi nonaktif lain ditolak `DF011 INVALID_ARGUMENT`.
- `reset_product_configuration` menanam ST dalam keadaan nonaktif; baris ST tidak dihapus sehingga parser dan replay webhook order historis tetap valid.
- `POST /api/ots` memeriksa sesi aktif lebih dulu dan mengembalikan pesan "Sesi X sudah dinonaktifkan. Pilih sesi yang masih aktif." sebelum memanggil RPC.
