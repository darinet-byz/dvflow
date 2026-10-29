# RBAC, AUTH & SECURITY SPEC
## dvflow

Versi: 1.0

## 1. Permission matrix
| Capability | Master Admin | Admin | Staff |
|---|---|---|---|
| Login | Yes | Yes | Yes |
| Dashboard read | Yes | Yes | Yes |
| Order read/search/filter | Yes | Yes | Yes |
| Order Refund read (A58) | Yes | Yes | No |
| Reschedule peserta (A58) | Yes | Yes | No |
| Refund / batalkan refund (A58) | Yes | Yes | No |
| Order edit/delete | No | No | No |
| Presensi read | Yes | Yes | Yes |
| QR/manual check-in | Yes | Yes | Yes |
| Product Generator | Yes | Yes | Yes |
| Product config CRUD | Yes | Yes | No |
| Advertiser config CRUD | Yes | Yes | No |
| Event Type config CRUD | Yes | Yes | No |
| Session config CRUD | Yes | Yes | No |
| Tax config CRUD | Yes | Yes | No |
| Report Tax read | Yes | Yes | No |
| Profile own read/update | Yes | Yes | Yes |
| Change own password | Yes | Yes | Yes |
| Create admin/staff via internal endpoint | Yes | No | No |
| Create master admin | Disabled by default | No | No |

### Dynamic roles (A50/A52)
- `team.manage` dapat didelegasikan ke role non-master (mis. Manajer) untuk **menambah** anggota
  dan mengatur produk yang ia pegang. Edit/hapus akun tetap Developer/Owner.
- `config.roles` tetap khusus Developer/Owner.
- `operasional.product_status` dan `operasional.advertiser_status` default Manajer + Admin.
- A58: `operasional.order_refund` (halaman), `action.reschedule`, dan `action.refund` default Manajer + Admin;
  dapat diberikan/dicabut per role di Konfigurasi Role. Master Admin tetap bypass.
- `set_advertiser_status('Resign')` menutup akses user terkait; status aktif kembali membuka akses.
- Hapus user hanya untuk akun tanpa data historis; selain itu `USER_HAS_DATA` dan gunakan Non-Aktifkan.

## 2. No Supabase Auth UI
Tidak ada:
- Sign Up
- Forgot Password public flow
- Magic Link
- OAuth
- Supabase Auth login page

Reset password jika lupa dilakukan oleh developer/Master Admin melalui internal admin process, bukan public flow.

## 3. Password storage
PBKDF2-SHA256:
- 600,000 iterations;
- 16+ byte random salt;
- derived key 32 bytes;
- encode hash/salt Base64URL;
- comparison constant-time.

## 4. Access JWT
Claims minimum:
```json
{
  "sub": "<users.id>",
  "role": "authenticated",
  "app_user_id": "<users.id>",
  "app_role": "admin",
  "exp": 0,
  "iat": 0
}
```

JWT private signing key:
- Worker secret only;
- never in repository;
- never in frontend environment;
- rotate through documented deployment process.

## 5. RLS principles
RLS must remain enabled on browser-readable tables.

Rules:
- direct browser reads require valid JWT;
- no anonymous read of orders/attendance;
- config write must verify app_role admin/master_admin;
- service/secret key only backend;
- frontend uses Supabase publishable key, never secret key.

## 6. Sensitive columns
Never expose through frontend query or API response:
- password_hash
- password_salt
- app_sessions.token_hash
- signing private key
- webhook secret
- Worker environment secrets

## 7. Cookies
Refresh cookie:
- HttpOnly
- Secure
- SameSite=Lax
- Path=/
- max-age aligned 7-day session

Production must use HTTPS.

## 8. CSRF
State-changing cookie-authenticated endpoints must require same-origin request and validate Origin/Host.
For endpoints also requiring Bearer access token, token validation remains primary.

## 9. XSS defense
- React escaping default must not be bypassed for webhook/user-controlled fields;
- avoid `dangerouslySetInnerHTML`;
- participant name/product/city rendered as text;
- use Content-Security-Policy where feasible.

## 10. Webhook trust boundary
Webhook input is untrusted.
Before DB write:
- body size limit;
- JSON validation;
- canonical type validation;
- numeric finite check;
- trim reasonable text sizes;
- never execute/interpret HTML/script;
- never interpolate raw payload into SQL.

## 11. Scanner trust boundary
QR is only an Order ID / checkin URL.
A valid-looking QR is not authorization.
Server always re-checks:
- authenticated operator;
- order exists;
- Paid;
- Seminar Offline;
- duplicate status.

## 12. Participant access security
Order ID alone is accepted by product requirement as participant access identifier.
Therefore:
- no extra token is added;
- participant page must expose minimum data;
- do not expose email/phone unless UI explicitly requires it;
- no admin actions on participant route.

## 13. Secrets inventory
Worker secrets required:
- SUPABASE_URL
- SUPABASE_SECRET_KEY (backend only)
- APP_JWT_PRIVATE_KEY
- APP_JWT_KEY_ID
- ORDERONLINE_WEBHOOK_SECRET
- SESSION_TOKEN_PEPPER optional if used

Frontend public env:
- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY
- VITE_API_BASE_URL

No secret-prefixed value in Vite public env.

## 14. Logging
Allowed:
- request id;
- route;
- error code;
- order id;
- duration;
- sanitized context.

Forbidden:
- password;
- raw access token;
- refresh token;
- JWT private key;
- webhook secret;
- full credential headers.

## 15. Security test must-pass
- anonymous Supabase orders SELECT fails;
- staff config mutation fails;
- admin config mutation succeeds;
- frontend bundle contains no backend secret;
- invalid login does not reveal account existence;
- revoked session cannot refresh;
- participant Pending denied;
- fake QR for unknown order denied;
- repeated seminar scan does not create second attendance row.
