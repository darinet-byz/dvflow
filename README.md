# dvflow

Internal operational dashboard untuk OrderOnline: webhook ingestion, Master Order, konfigurasi
produk/tax, presensi webinar & seminar, scanner QR, dan reporting.

## Dokumen sumber (urutan baca)

1. `docs/PRD.md`
2. `docs/Blueprint.md`
3. `docs/UI-UX-Design-Guideline-OrderOnline-App.md`
4. `docs/Reference-Webhook-Order-From-Checkout-Form` (sample payload, bukan kontrak)
5. `docs/Reference-Webhook-Order-Form-Storefront` (sample payload, bukan kontrak)
6. `docs/00-AI-AGENT-BUILD-CONSTITUTION.md`
7. `docs/01-IMPLEMENTATION-DECISIONS.md`
8. `docs/02-DATABASE-SCHEMA-AND-DATA-DICTIONARY.md`
9. `docs/03-WORKER-API-CONTRACT.md`
10. `docs/04-RBAC-AUTH-AND-SECURITY.md`
11. `docs/05-EDGE-CASES-AND-ACCEPTANCE-TESTS.md`
12. `docs/06-DEPLOYMENT-ENV-AND-BUILD-RUNBOOK.md`

**Wajib dibaca sebelum menyentuh kode:** `docs/AMENDMENTS.md` — daftar deviasi terkunci dari
dokumen di atas (algoritma password, kolom kredensial, claim JWT, objek database tambahan) plus
`VA-1`, daftar yang masih kurang pada pemetaan payload webhook.
Kalau kode berbeda dari dokumen sumber **dan** tidak tercantum di sana, kode itu yang salah.

**Cara melanjutkan pekerjaan:** `STATE.md` — status tiap fase, keputusan yang sudah dikunci,
blocker, dan langkah berikutnya.

## Aturan bisnis yang tidak boleh dilanggar

Lihat `CLAUDE.md §4`. Ringkas: `1 Order ID = 1 Master Order`, mapping status persis
(`pending→Pending`, `processing/complete→Paid`, `cancelled→Cancelled`, status tak dikenal → 422),
tidak ada konfigurasi yang di-hardcode, presensi row-based di `attendance_events`, retensi
attendance 30 hari tanpa menghapus Master Order, akses peserta hanya untuk Order ID yang Paid,
dan QR dibuat client-side.

## Struktur

```text
packages/shared/   aturan bisnis murni (nol dependensi runtime) — diuji tanpa infrastruktur
packages/api/      handler HTTP (Request → Response); dipakai Worker maupun Pages Functions
apps/worker/       entry Cloudflare Worker (dipakai saat domain sendiri sudah aktif)
apps/web/          React + Tailwind: aplikasi admin + skrip QR halaman peserta
functions/         jembatan Pages Functions ke packages/api (satu origin dengan frontend)
supabase/          migrations, seed.sql, dan tests/ (pgTAP: RLS, idempotensi, paritas tax)
scripts/           provisioning Master Admin pertama, rotate JWT key, verifikasi artefak QR
```

Struktur folder sudah lengkap; yang belum adalah isi halaman adminnya (P8/P9) — lihat `STATE.md`.

Backend sengaja satu origin dengan frontend supaya cookie refresh (`HttpOnly` + `Secure` +
`SameSite=Lax`) terkirim tanpa konfigurasi CORS. Kode backend adalah handler murni, sehingga
dapat dipindah ke Worker terpisah tanpa ditulis ulang.

## Perintah

```bash
npm install
npm run typecheck     # shared + api + worker + functions + web
npm test              # unit test: 96 (shared) + 145 (api) + 101 (web, termasuk test render)
npm run build         # aplikasi web + assets/ticket-qr.js
npm run verify:ticket-qr   # bukti artefak QR dapat dijalankan browser & dipindai
npm audit             # 0 vulnerabilities
```

Database lokal (butuh Docker Desktop menyala):

```bash
npm run db:start      # supabase start (sekali per sesi)
npm run db:reset      # menerapkan migrations/ + seed.sql
npm run test:db       # pgTAP: 234 test (RLS, idempotensi, tax, RPC baca, Order)

# Auth end-to-end melawan Supabase lokal (lihat packages/api/README.md)
eval "$(supabase status -o env | sed -n 's/^\(API_URL\|SECRET_KEY\|DB_URL\)=/export /p')"
export SUPABASE_URL="$API_URL" SUPABASE_SECRET_KEY="$SECRET_KEY" SUPABASE_DB_URL="$DB_URL"
npm run test:integration
```

Provisioning dan kunci (butuh database hidup):

```bash
npm run create-master-admin   # Master Admin pertama; tanpa password default
npm run rotate-jwt-key        # generate ES256 key pair + public JWK untuk Supabase
```

## Menjalankan & men-deploy

```bash
# Pengembangan (tiga terminal)
npm run db:start                 # Supabase lokal
npm run dev:vars                 # tulis .dev.vars (secret lokal + kunci JWT)
npm run build                    # build aplikasi + assets/ticket-qr.js
npm run dev:backend              # wrangler pages dev (Functions + aset)
npm run dev:web                  # vite dev server, proxy /api ke backend
```

Frontend dev server mem-proxy `/api`, `/access`, dan `/checkin` ke `127.0.0.1:8788`, sehingga
frontend dan backend terlihat satu origin seperti di produksi (K2) dan cookie refresh terkirim.

```bash
# Verifikasi jalur deploy tanpa men-deploy (18 langkah: header keamanan, prioritas
# routing Functions vs fallback SPA, webhook end-to-end lewat jalur deploy)
npm run smoke:local

# Deploy (butuh akun Cloudflare + secret produksi; lihat STATE.md §6)
npm run deploy
SMOKE_BASE_URL=https://<domain> npm run smoke:local
```

### Isian setup (GitHub, Supabase, Cloudflare)

```bash
node scripts/make-setup-file.mjs      # membuat .env.setup.local
```

`.env.setup.local` adalah **satu berkas isian** untuk nilai yang hanya pemilik
project yang tahu (kunci Supabase, akun Cloudflare, repo). Kunci JWT, webhook
secret, dan public JWK sudah diisi otomatis di dalamnya — tidak perlu disalin
manual.

Berkas itu **diabaikan git** (tercakup pola `.env.*`), sehingga tidak akan pernah
ikut ter-commit. Jangan menyalin isinya ke berkas lain di dalam repo.

Berkas `_headers` memasang CSP, `Permissions-Policy: camera=(self)`, `nosniff`, dan anti-framing
untuk aset statis; Pages Functions mengatur headernya sendiri (halaman peserta punya CSP lebih
ketat). Rute `/access/*` dan `/checkin/*` **memerlukan berkas fungsinya sendiri** — tanpa itu ia
jatuh ke fallback SPA dan mengembalikan `index.html` alih-alih halaman peserta.

## Endpoint yang sudah ada

```text
POST   /api/webhooks/orderonline/:webhookSecret  ingestion OrderOnline (secret di path; salah → 404)
POST   /api/auth/login                           username + password
POST   /api/auth/refresh                         cookie refresh -> access JWT baru
POST   /api/auth/logout                          idempoten
POST   /api/auth/change-password                 mencabut seluruh sesi user
GET    /api/profile                              profil sendiri
PATCH  /api/profile                              display_name + avatar_emoji
POST   /api/internal/users                       provisioning (master_admin saja)

GET    /access/:orderId                          halaman peserta: webinar → 302, seminar → tiket
GET    /checkin/:orderId                         halaman informasi (TIDAK mengubah apa pun)
POST   /checkin/:orderId                         check-in seminar oleh operator
GET    /api/scanner/search?q=                    kandidat seminar (maks 20, server-side)
POST   /api/scanner/manual-checkin               check-in manual, validasi sama dengan QR

POST   /api/config/:resource                     tambah konfigurasi (admin/master_admin)
PATCH  /api/config/:resource/:id                 ubah konfigurasi
DELETE /api/config/:resource/:id                 nonaktifkan (row TIDAK dihapus)
```

`:resource` = `products`, `advertisers`, `event-types`, `sessions`, `payment-fee-rules`.
Daftar (baca) konfigurasi tidak punya endpoint: aplikasi membacanya langsung dari Supabase lewat
RLS memakai access JWT. Hal yang sama berlaku untuk Order, Presensi, Dashboard, dan Report Tax.

Halaman aplikasi yang sudah ada: Login, Dashboard Resume, Scan QR (+ Manual Search), Order,
Presensi Acara, Konfigurasi Produk (produk/pengiklan/type/sesi), Konfigurasi Tax, Report Tax,
Product Name Generator, dan Profil. Yang belum: `wrangler.toml` dan deployment (P10).

## Status blocker

**`BLOCKED_BY_EXTERNAL_ORDERONLINE_PAYLOAD`** — sebagian besar terbuka. Adapter sudah memetakan
seluruh field yang dibutuhkan untuk berjalan, dan ingestion sudah diuji end-to-end (termasuk
idempotensi dan snapshot tax). Yang masih kurang: sample `processing`/`complete`/`cancelled`,
payment method kedua, dan — bila fee per bank diinginkan — field yang membawa nama bank/channel
(`payment.data`/`payment.channels` kosong di semua sample). Rinciannya di `docs/AMENDMENTS.md`
`VA-1`.

Integrasi webhook **belum production-ready** (`06 §13`), dan seluruh sistem juga belum: trust
custom JWT di project Supabase belum dikonfigurasi dan belum ada deployment.
