# @dvflow/api

Handler HTTP murni dvflow: `Request -> Response`. Nol dependensi runtime.

Paket ini dipakai oleh dua entry tanpa perubahan kode:

- `apps/worker/src/index.ts` — Cloudflare Worker (saat domain sendiri sudah aktif);
- `functions/api/[[path]].ts` — Pages Functions (jalur produksi MVP, satu origin
  dengan frontend supaya cookie refresh terkirim; STATE.md K2).

## Isi

```text
src/env.ts              binding environment backend (secret — 04 §13)
src/router.ts           pencocokan rute + satu-satunya tempat error -> response
src/routes.ts           tabel rute (bandingkan dengan docs/03 §4–§7, §13, §14)
src/auth/jwt.ts         mint + verify access JWT ES256 (claim A3)
src/auth/session-token.ts  token sesi acak 32 byte + hash SHA-256
src/auth/handlers.ts    login / refresh / logout / change-password
src/profile/            GET + PATCH /api/profile
src/internal-users/     POST /api/internal/users (provisioning master_admin)
src/webhooks/adapter.ts SATU-SATUNYA berkas yang menyentuh nama key provider
src/webhooks/handlers.ts  POST /api/webhooks/orderonline/:webhookSecret
src/participant/pages.ts  halaman tiket + halaman error peserta (HTML minimal, escaping, CSP)
src/participant/handlers.ts  GET /access/:orderId, GET+POST /checkin/:orderId
src/scanner/handlers.ts  search + manual check-in
src/config/              deskriptor + validasi + penulisan konfigurasi
src/http/               cookie, Origin/CSRF, bentuk response, katalog error,
                        pembersih teks pencarian (filter PostgREST)
src/db/                 port `Db` + implementasi PostgREST
src/users.ts            bentuk user + `requireActiveUser`
```

Aturan yang dijaga paket ini:

- password **tidak pernah** dibandingkan di sini — selalu lewat RPC `verify_login`
  (A1: bcrypt di database);
- database menyimpan **hash** token sesi, bukan tokennya (04 §6);
- response error hanya memuat `{ code, message }`; pesan internal hanya ada di
  `logContext` dan dibuang di `router.ts` (03 §1);
- webhook: secret salah → 404 (gagal-tertutup bila env kosong), status tak dikenal → 422,
  `webhook_logs` **tanpa PII** pelanggan;
- tidak ada `dangerouslySetInnerHTML`, tidak ada secret yang dikembalikan.

Binding environment yang dipakai: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`APP_JWT_PRIVATE_KEY`, `APP_JWT_KEY_ID`, `ORDERONLINE_WEBHOOK_SECRET`,
`ALLOW_MASTER_ADMIN_CREATE_MASTER` (opsional), `APP_ALLOWED_ORIGINS` (opsional).
Semuanya secret backend (04 §13).

## Test

```bash
npm -w @dvflow/api test          # unit: 50 test, tanpa infrastruktur
npm -w @dvflow/api run typecheck
```

Test unit memakai `Db` tiruan in-memory: yang diuji adalah perilaku HTTP
handler (status, bentuk response, cookie, CSRF, batas peran). Semantik database
diuji di `supabase/tests/` (pgTAP) dan oleh test integrasi di bawah.

### Test integrasi (butuh Supabase lokal)

Membuktikan hal-hal yang hanya muncul melawan PostgREST/PostgreSQL sungguhan:
nama argumen RPC cocok, SQLSTATE kustom (`DF0xx`) dipetakan dengan benar,
bcrypt di database benar-benar memverifikasi, dan `app_sessions` menyimpan hash.

```bash
npm run db:start

# bash
eval "$(supabase status -o env | sed -n 's/^\(API_URL\|SECRET_KEY\|DB_URL\)=/export /p')"
export SUPABASE_URL="$API_URL"
export SUPABASE_SECRET_KEY="$SECRET_KEY"
export SUPABASE_DB_URL="$DB_URL"

npm -w @dvflow/api run test:integration
```

Bila ketiga variabel itu tidak diset, berkas integrasi di-skip (bukan gagal),
supaya `npm test` tetap dapat dijalankan tanpa Docker.

Catatan: pada Supabase versi ini, `apikey` harus memakai kunci format baru
(`sb_secret_...`) — kunci JWT `service_role` lama ditolak dengan 401.
