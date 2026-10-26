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

If no seminar attendance exists:
- insert one row source=seminar_qr;
- return 200 CHECKIN_SUCCESS.

If already exists:
- do not insert;
- return 200 with state ALREADY_CHECKED_IN + original timestamp.

Errors:
- 404 ORDER_NOT_FOUND
- 403 ORDER_NOT_PAID
- 409 NOT_SEMINAR_ORDER

## 10. GET /api/scanner/search?q=
Auth: logged-in user.

Search seminar candidates by:
- exact/partial Order ID;
- name;
- phone.

Limit results: 20.
Server-side query.
Do not return webinar orders.

## 11. POST /api/scanner/manual-checkin
Auth: logged-in user.
Body:
```json
{ "order_id": "283033796" }
```

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
Hasil RPC: `summary`, `rows` (per report), dan `sessions` (A43: tiket Paid per sesi × pengiklan dari order yang sama).
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
