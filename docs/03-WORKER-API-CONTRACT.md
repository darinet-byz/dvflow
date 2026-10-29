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

## 12a. Report Spend Iklan (A37)
Tulis saja; laporan dibaca browser lewat RPC `ad_spend_report(p_date_from, p_date_to, p_product_code, p_advertiser_code, p_batch)`.
Hasil RPC: `summary`, `rows` (per report, termasuk `tickets` = sum quantity order Paid - A45), `sessions` (A43: tiket Paid per sesi x pengiklan dari order yang sama), dan `comparison` (A46: roll-up per produk + batch + pengiklan dengan `totals` dan `rows[]`; angka order memakai himpunan distinct yang sama dengan `summary`).

### Status Produk & Pengiklan (A52)
- `product_status_list()` → array produk `{id,code,name,status,active,advertisers[]}`.
- `advertiser_status_list()` → array pengiklan `{id,code,name,status,active,products[]}`.
- `set_product_status(p_product_id, p_status)` dan `set_advertiser_status(p_advertiser_id, p_status)`.
- `set_product_advertisers(p_product_id, p_advertiser_ids[])` dan `set_advertiser_products(p_advertiser_id, p_product_ids[])`.
- Semua RPC memakai izin `operasional.product_status` / `operasional.advertiser_status`; mapping hanya label (tabel `product_advertisers`).
- `set_advertiser_status('Resign')` menonaktifkan user terkait + sesi; status aktif kembali mengaktifkan user terkait.
Semua rute butuh izin `action.input_spend` DAN akun yang memegang pengiklan (role advertiser).
Pengiklan selalu diambil dari akun, tidak pernah dari body.
`spend` = biaya iklan SEBELUM PPN; `tax_percent` = PPN iklan dalam persen (0–100, wajib; 0 bila tanpa PPN).

- `POST /api/ad-spend-reports` → 201
- `PATCH /api/ad-spend-reports/:id` → 200 (hanya report pengiklan sendiri)
- `DELETE /api/ad-spend-reports/:id` → 200 (hard delete, hanya report pengiklan sendiri)

Body POST/PATCH:
```json
{ "product_code": "KULI", "batch": "122", "date_from": "2026-10-21", "date_to": "2026-10-21", "spend": 6000000, "tax_percent": 11, "confirm_overlap": false }
```

Error:
- `AD_SPEND_OVERLAP` 409 "Tanggal, produk, dan batch sudah ada." — rentang beririsan dengan report produk + batch +
  pengiklan yang sama. Kirim ulang dengan `confirm_overlap: true` untuk tetap menyimpan.
- `AD_SPEND_NOT_FOUND` 404 — id tidak ada atau milik pengiklan lain.
- `FORBIDDEN` 403, `INVALID_ARGUMENT` 400.

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
