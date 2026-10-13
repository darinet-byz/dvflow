# @dvflow/web

Aplikasi web dvflow: dashboard admin (React + Tailwind) dan skrip QR untuk halaman tiket peserta.

## Menjalankan saat pengembangan

```bash
npm run db:start                     # Supabase lokal
npm run db:reset                     # migrations + seed

# Terminal 1 — backend (packages/api lewat Pages Functions / Worker)
#   APP_ALLOWED_ORIGINS wajib diisi karena backend memeriksa same-origin (K19):
#   permintaan lewat dev-server datang dengan Origin http://localhost:5173.
APP_ALLOWED_ORIGINS=http://localhost:5173 npx wrangler dev --port 8788

# Terminal 2 — aplikasi
cp .env.example .env                 # di ROOT repo; isi VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
npm -w @dvflow/web run dev           # http://localhost:5173
```

`vite.config.ts` memakai `envDir: '..'`, jadi `.env` dibaca dari root repo — sejajar dengan
`.env.example`, tidak perlu disalin per paket.

`vite.config.ts` mem-proxy `/api`, `/access`, dan `/checkin` ke `127.0.0.1:8788`, sehingga
frontend dan backend terlihat satu origin seperti di produksi (K2) dan cookie refresh terkirim.

## Build

```bash
npm -w @dvflow/web run build
```

Menghasilkan dua hal di `dist/`:

| Berkas | Isi |
|---|---|
| `index.html` + `assets/index-*.js` | aplikasi admin |
| `assets/ticket-qr.js` | skrip QR halaman peserta — **satu berkas klasik, tanpa impor** |

Skrip tiket dibangun terpisah (`vite.ticket.config.ts`) supaya keluar sebagai IIFE, sehingga
halaman peserta cukup memuatnya dengan `<script src>` biasa di browser apa pun. Path-nya dipaku
bersama `TICKET_QR_SCRIPT_PATH` di `packages/api/src/participant/pages.ts`.

## Test

```bash
npm -w @dvflow/web test          # 25 test: QR, sesi, sidebar
npm run verify:ticket-qr         # verifikasi ARTEFAK hasil build (butuh `npm run build`)
```

Bukti QR yang bisa diperiksa sendiri:

```text
test/qr.test.ts        sumber: payload -> SVG -> dibaca ulang -> didekode `jsqr` -> payload
verify-ticket-qr.mjs   artefak: bundel hasil build dijalankan dengan DOM tiruan,
                       SVG-nya didekode ulang `jsqr`, hasilnya payload yang sama
```

`jsqr` dipakai HANYA sebagai decoder pembanding di test/verifikasi, bukan di runtime.

## Aturan yang dijaga

- **Access JWT hanya di memori.** Tidak pernah `localStorage`/`sessionStorage`/cookie
  (CLAUDE.md §8); test sesi memasang spy yang akan gagal bila penyimpanan disentuh.
- **Token awal hanya dari refresh cookie** — memuat ulang halaman menukar cookie menjadi access
  token baru, bukan membaca token dari penyimpanan.
- **Data dibaca langsung dari Supabase** lewat RLS + access JWT (Order, Presensi, Dashboard,
  Report Tax, konfigurasi); yang lewat backend hanya penulisan (`packages/api`).
- **Tidak mendesain ulang per halaman.** Warna, radius, dan komponen berasal dari token di
  `src/styles.css` dan komponen di `src/ui/`.

## Halaman

| Rute | Halaman | Sumber data |
|---|---|---|
| `/login`, `/logout` | Login, Logout | `POST /api/auth/*` |
| `/` | Dashboard Resume | RPC `dashboard_summary` |
| `/scan-qr` | Scan QR + Manual Search | `POST /checkin/:id`, `/api/scanner/*` |
| `/order` | Order | RPC `orders_page` |
| `/presensi` | Presensi Acara | RPC `presensi_page` + `dashboard_summary` |
| `/konfigurasi-produk` | Produk, Pengiklan, Type, Sesi | `supabaseSelect` + `POST/PATCH/DELETE /api/config/*` |
| `/konfigurasi-tax` | Fee rule | idem (`payment-fee-rules`) |
| `/report-tax` | Report Tax (admin/master admin) | RPC `tax_report` |
| `/generator` | Product Name Generator | konfigurasi + logika `packages/shared` |
| `/profil` | Profil | `GET/PATCH /api/profile`, `POST /api/auth/change-password` |

Test render (jsdom) memeriksa kontrak yang berbentuk tampilan: urutan kolom Master Order,
T1–T10, tidak adanya kontrol signup, hasil generator persis kontrak, dan penolakan Report Tax
untuk staff.

## Catatan penting untuk pengembangan lokal

**Pembacaan data lewat browser belum bisa dijalankan terhadap Supabase lokal.** PostgREST
menolak access JWT yang ditandatangani Worker dengan
`PGRST301: No suitable key was found to decode the JWT`, karena Supabase lokal belum
mempercayai kunci kita (STATE.md K63).

Yang **masih** berjalan terhadap Supabase lokal: seluruh halaman auth (login/logout/sesi),
halaman peserta (`/access`, `/checkin`), webhook, dan scanner.

Untuk mengerjakan halaman data (Dashboard, Order, Presensi, Report Tax, konfigurasi), arahkan
`.env` ke **project Supabase dev sungguhan** yang sudah dipasangi signing key ES256
(STATE.md §6 langkah 2). Jangan mengaktifkan `signing_keys_path` di `supabase/config.toml`
tanpa menguji lebih dulu: percobaan itu membuat container `supabase_auth` tidak sehat.
