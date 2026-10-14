# AMENDMENTS — deviasi terkunci dari dokumen kontrak

Versi: 1.0
Status: **Mengikat.** Dibaca bersama `docs/01-IMPLEMENTATION-DECISIONS.md`.

Dokumen ini mencatat **satu-satunya** tempat implementasi menyimpang dari dokumen sumber,
beserta alasannya. Tujuannya: mencegah agent berikutnya "memperbaiki" kode agar cocok dengan
dokumen lama, dan mencegah deviasi baru dibuat tanpa catatan.

Aturan: kalau kode berbeda dari dokumen sumber **dan** tidak ada di daftar ini, maka **kode
yang salah** (`00-AI-AGENT-BUILD-CONSTITUTION.md §1`).

---

## A1 — Algoritma password: PBKDF2 → bcrypt

**Menggantikan:** `01-IMPLEMENTATION-DECISIONS.md §1` dan `04-RBAC-AUTH-AND-SECURITY.md §3`
(PBKDF2-SHA256, 600.000 iterasi, Web Crypto, di Worker).

**Amendemen:** password di-hash dan diverifikasi di **PostgreSQL** memakai **bcrypt**
(`pgcrypto`, `gen_salt('bf', 12)`). Cloudflare Worker **tidak pernah** menghitung hash; ia
memanggil fungsi database `verify_login` / `admin_create_user` / `change_password`.

**Alasan (batas platform, bukan preferensi):**

1. `workerd` membatasi PBKDF2 pada **100.000 iterasi**; 600.000 akan melempar error runtime.
2. Cloudflare Workers free plan membatasi **CPU 10 ms per request**, sedangkan 600.000 iterasi
   PBKDF2-SHA256 memerlukan ratusan milidetik. Login akan gagal dengan *exceeded CPU time*.

Memindahkan hashing ke database menghilangkan keduanya sekaligus, tetap gratis, dan tetap
memenuhi standar (bcrypt cost 12 diterima OWASP sebagai alternatif PBKDF2).

**Yang TIDAK berubah:** password tetap case-sensitive, username case-insensitive + unik,
minimal 8 karakter, tanpa aturan kompleksitas tambahan, ganti password wajib menyertakan
password lama, dan ganti password mencabut seluruh session user.

**Konsekuensi keamanan yang harus dijaga:** hash hanya hidup di database. `password_hash`
di-REVOKE tingkat kolom dari `anon` + `authenticated`, dan fungsi verifikasi bersifat
`SECURITY DEFINER` yang hanya boleh dieksekusi `service_role`.

---

## A2 — Kolom kredensial di `users`

**Menggantikan:** `02-DATABASE-SCHEMA-AND-DATA-DICTIONARY.md §2`
(`password_hash`, `password_salt`, `password_iterations`).

**Amendemen:**

```text
password_hash   TEXT NOT NULL      -- string bcrypt lengkap: $2a$12$<salt><digest>
password_algo   TEXT NOT NULL DEFAULT 'bcrypt'
```

`password_salt` dan `password_iterations` **dihapus**.

**Alasan:** bcrypt menyimpan salt dan cost factor **di dalam** string hash, sehingga dua kolom
itu menjadi kolom mati yang menyesatkan (dan `password_iterations = 600000` akan salah
menggambarkan keadaan sebenarnya).

**Aturan yang tetap berlaku:** hash dan salt tidak pernah dapat di-SELECT dari browser; tidak
ada plaintext password di mana pun.

---

## A3 — Claim access JWT: tambah `iss` dan `aud`

**Menggantikan:** `04-RBAC-AUTH-AND-SECURITY.md §4` (claim: `sub`, `role`, `app_user_id`,
`app_role`, `exp`, `iat`).

**Amendemen:** token wajib memuat tambahan:

```json
{
  "iss": "https://<project-ref>.supabase.co/auth/v1",
  "aud": "authenticated",
  "kid": "<APP_JWT_KEY_ID>"
}
```

Header: `{ "alg": "ES256", "typ": "JWT", "kid": "<APP_JWT_KEY_ID>" }`.

**Alasan:** Supabase memvalidasi `iss` terhadap project dan memvalidasi `aud`. Token yang
hanya memuat claim versi dokumen akan **ditolak dengan 401 oleh PostgREST** — seluruh query
browser mati walaupun unit test hijau.

**Yang TIDAK berubah:** `role = "authenticated"`, `app_role`, `app_user_id = users.id`,
`sub = users.id`, masa hidup 30 menit, hanya di memori, dan privat key hanya di Worker.

**Cara trust:** public key di-import ke project Supabase sebagai signing key (memakai `kid`
yang sama). Tidak perlu hosting JWKS.

---

## A4 — Objek database tambahan (fungsi)

**Menggantikan:** `02-DATABASE-SCHEMA-AND-DATA-DICTIONARY.md §15` (urutan migrasi 16 langkah).

**Amendemen:** urutan migrasi diperluas untuk memuat objek berikut, yang **seluruhnya adalah
fungsi, bukan tabel** — sehingga tidak melanggar larangan "report source table" (`§16`) dan
tidak menyimpan data sendiri:

| Objek | Jenis | Alasan keberadaannya |
|---|---|---|
| `normalize_code`, `normalize_payment_identifier`, `app_role`, `is_app_user` | fungsi helper | satu definisi normalisasi, dipakai bersama RLS + RPC |
| `calc_tax_amount` | fungsi | aritmetika tax yang dipersist harus tunggal sumbernya |
| `presensi_page` | RPC baca (SECURITY INVOKER) | urut berdasarkan `total_activity` / `latest_activity` tidak mungkin lewat PostgREST biasa |
| `dashboard_summary` | RPC baca (SECURITY INVOKER) | seluruh KPI wajib mengikuti satu set filter yang sama (`PRD §41`) |
| `tax_report` | RPC baca (SECURITY INVOKER + cek peran) | breakdown 7 dimensi; RLS tidak bisa menolak satu halaman, jadi cek peran ada di dalam fungsi |
| `upsert_order_webhook` | RPC tulis (SECURITY DEFINER) | upsert idempoten + snapshot tax kondisional dalam satu transaksi |
| `checkin_seminar` | RPC tulis (SECURITY DEFINER) | idempotensi seminar bebas race (`ON CONFLICT`) |
| `verify_login`, `admin_create_user`, `change_password` | RPC tulis (SECURITY DEFINER) | A1: hashing dan verifikasi password di database |

**Alasan:** semuanya diperlukan oleh kontrak lain (idempotensi `M01`/`M02`, satu-set-filter
`PRD §41`, penolakan Report Tax untuk staff `04 §1`), tetapi `00 §5` melarang objek yang tidak
tercantum di Data Dictionary. Dicatat di sini supaya tidak dianggap pelanggaran.

**Aturan tetap:** tidak ada tabel baru, tidak ada kolom baru di luar Data Dictionary, dan
fungsi tulis di-REVOKE dari `anon`/`authenticated` (hanya `service_role`).

---

## A5 — Kolom `*_normalized` dihitung database (generated), bukan ditulis pemanggil

**Menggantikan:** cara tulis `02 §2` (`username_normalized`), `§4`/`§5`
(`code_normalized`), `§8` (`identifier_normalized`).

**Amendemen:** keempat kolom tetap ada dengan nama, tipe, `NOT NULL`, dan
`UNIQUE` persis seperti Data Dictionary, tetapi didefinisikan sebagai
`GENERATED ALWAYS AS (...) STORED` dan **tidak dapat ditulis** oleh pemanggil:

```text
users.username_normalized                = lower(trim(username))
products/advertisers/event_types/
sessions_config.code_normalized          = public.normalize_code(code)
payment_fee_rules.identifier_normalized  = public.normalize_payment_identifier(identifier)
```

**Alasan:** `01 §11` dan `(A4)` menuntut **satu** definisi normalisasi yang
dipakai bersama parser, RLS, dan RPC. Kalau kolomnya kolom biasa, setiap jalur
tulis (Worker dengan `service_role`, RPC, script developer) wajib menghitungnya
sendiri; satu kelalaian menghasilkan baris yang tidak pernah cocok dengan parser
— kegagalan yang sunyi dan sangat sulit dilacak. Sebagai generated column,
ketidakcocokan itu mustahil.

**Konsekuensi:** dua fungsi normalisasi (`normalize_code`,
`normalize_payment_identifier`) harus dibuat **sebelum** tabel yang memakainya,
sehingga keduanya berada di `0001_extensions.sql`, bukan `0014`. Keduanya
`IMMUTABLE` dan `search_path`-nya dipaku.

**Yang TIDAK berubah:** tidak ada kolom baru, tidak ada kolom yang hilang, dan
`orders.*` tetap kolom biasa karena nilainya berasal dari parser TypeScript.

---

## A6 — `set_updated_at()` dan trigger `updated_at`

**Menggantikan:** cara `updated_at` diisi pada `02 §2–§9`.

**Amendemen:** satu fungsi trigger `public.set_updated_at()` menetapkan
`updated_at = now()` pada `BEFORE UPDATE` di `users`, `products`, `advertisers`,
`event_types`, `sessions_config`, `payment_fee_rules`, `orders`, `app_settings`.

**Alasan:** alternatifnya adalah menulis `updated_at` di setiap RPC dan di
setiap `UPDATE` yang dilakukan Worker lewat PostgREST. Itu berarti kolom yang
sama dipelihara di banyak tempat, dan satu jalur tulis yang lupa akan
menghasilkan urutan data yang salah tanpa error. Trigger menghilangkan seluruh
kelas bug tersebut. `updated_at` adalah kolom Data Dictionary, jadi tidak ada
kolom baru yang diperkenalkan.

**Yang TIDAK berubah:** `created_at` dan `paid_at` **tidak** ikut disentuh
trigger — keduanya sengaja hanya berubah lewat jalur yang eksplisit
(`upsert_order_webhook`).

---

## A7 — Semantik merge webhook berulang

**Mengisi kekosongan:** dokumen menetapkan webhook berulang harus UPSERT pada
baris yang sama (C02, C14, M01), tetapi tidak menetapkan bagaimana field
opsional digabung.

**Amendemen:** pada `upsert_order_webhook`:

1. `null` pada field opsional kanonik (`customerName`, `phone`, `email`,
   `paymentMethod`, `paymentProvider`, `paymentIdentifier`) berarti
   **"tidak disebutkan"**, bukan "kosongkan" — nilai lama dipertahankan.
2. Blok hasil parsing produk hanya ditulis bila `productRaw` dikirim; itulah
   satu-satunya saat hasil parsing benar-benar berlaku. Saat parse invalid,
   field normalized menjadi `NULL` sesuai `01 §9`.
3. `grossAmount`, `rawStatus`, dan `appStatus` selalu ditulis.
4. `created_at` dan `paid_at` tidak pernah diturunkan setelah terisi.
5. Bila tax dihitung ulang karena `grossAmount` berubah sementara webhook
   **tidak** menyebut identifier pembayaran, pencocokan fee rule memakai
   identifier yang **tersimpan**, bukan `NULL`.

**Alasan:** poin (1) mengikuti preseden yang sudah dikunci di
`packages/shared/src/domain/tax.ts` — di sana identifier `null` juga berarti
"tidak disebutkan", bukan "berubah". Tanpa aturan ini, satu webhook parsial dari
provider akan menghapus data yang sudah benar — persis kegagalan yang dicegah
`shouldRecalculateTax()`.

**Yang TIDAK berubah:** status tetap "yang terakhir menang" (STATE.md O1), dan
`orders.created_at` tetap timestamp terima lokal yang pertama.

---

## A9 — RPC baca tambahan: `orders_page`

**Menambahkan:** objek database baru di luar daftar A4 dan `02 §15`.

**Amendemen:** satu fungsi baca `public.orders_page(...)` (SECURITY INVOKER, hanya
`authenticated` yang boleh mengeksekusi), ditulis di migrasi `0020_orders_page.sql`.

**Alasan:** tabel Master Order sebenarnya dapat dibaca browser langsung lewat
PostgREST, tetapi itu berarti memindahkan **empat** hal ke dalam JavaScript:

1. predikat filter yang sama dengan Dashboard (PRD §41: seluruh angka mengikuti
   satu set filter) — dua salinan yang bisa menyimpang;
2. whitelist kolom sort (CLAUDE.md §15) — di browser ia hanya kepercayaan pada UI,
   sedangkan di fungsi ia ditegakkan server;
3. teks pencarian yang harus disusun menjadi bahasa filter PostgREST — permukaan
   escaping kedua, padahal `packages/api` sudah punya satu;
4. ringkasan Total Result / Paid / Pending, yang harus konsisten dengan barisnya
   dalam satu transaksi.

**Yang TIDAK berubah:** tidak ada tabel atau kolom baru; RLS tetap berlaku
(fungsi SECURITY INVOKER); fungsi ini hanya dapat dibaca `authenticated`, sama
seperti RPC baca lain di A4.

---

## A8 — Nilai warna badge jenis acara (Seminar / Webinar)

**Mengisi kekosongan:** `UI-UX-Design-Guideline-OrderOnline-App.md` §18 menetapkan
"Seminar → purple soft" dan "Webinar → blue soft", tetapi §3 (Color System) **tidak memuat
kedua warna itu**, dan tidak ada nilai hex di mana pun.

**Amendemen:** dua pasang token ditambahkan di `apps/web/src/styles.css`:

```text
--color-webinar: #3b6fd4   --color-webinar-soft: #eaf2ff
--color-seminar: #6d4ad6   --color-seminar-soft: #f1ecff
```

**Alasan:** aturannya ada, nilainya tidak. Saturasi dipilih rendah supaya sejalan dengan soft
tone lain yang sudah ditetapkan (`success-soft`, `warning-soft`, `danger-soft`, `primary-soft`),
karena guideline §18 juga melarang badge dengan saturasi terlalu tinggi.

**Yang TIDAK berubah:** warna semantik lain tetap apa adanya (`#4f46f5`, `#35c96c`, `#ef5b5b`,
`#f5b94c`, dst.), batas pemakaian tiap warna tetap seperti §3, dan "Belum Hadir" sengaja memakai
netral — bukan kuning — karena kuning sudah bermakna Pending dan PRD §107 menegaskan keduanya
kondisi yang berbeda.

---

## VA-1 — Pemetaan payload OrderOnline yang sudah TERVERIFIKASI (dan yang belum)

Status: **sebagian.** Dua sample nyata sekarang ada di repo:

- `docs/Reference-Webhook-Order-From-Checkout-Form`
- `docs/Reference-Webhook-Order-Form-Storefront`

Keduanya **bukan kontrak** — hanya pengamatan. Yang boleh dipakai:

| yang diamati | checkout form | storefront |
|---|---|---|
| bentuk body | `{ type, action, payload }` | dokumen order langsung (tanpa envelope) |
| `type` | `"form"` (di dalam `payload`) | `"storefront"` |
| Order ID | `payload.order_id` (number) | `order_id` (number) |
| status | `payload.status` | `status` |
| payment | `payload.payment.method`, `.status` | `payment.method`, `.status`, `.providers.{name,label,account_name,account_number}` |
| nama/kontak | `customer_data.*` | `customer_data.*` |
| uang | `total_price`, `product_price` | `total_price`, `product_price` |
| waktu | `created_at`/`updated_at` string `"YYYY-MM-DD HH:mm:ss"` | `$date` ISO (Extended JSON) |
| produk | `product_data.name` / `.code` (tunggal) | `products[]` (jamak) |

### Keputusan pengguna, 2026-10-13

| Pertanyaan | Jawaban |
|---|---|
| Dari mana `product_raw` diambil? | **Nama produk di OrderOnline** — pada CO Form: `payload.product_data.name` |
| Pola `KM01SO392 - S1 - Solo` dipakai? | **Ya**, pola itu yang akan diterapkan. Semua produk di OrderOnline akan dinamai konsisten supaya aplikasi dapat membedahnya (event, batch, sesi, kota, pengiklan) |
| Webhook mana yang akan dipakai? | **CO Form** (`{ type, action, payload }`), karena 1 produk = 1 sesi seminar/webinar |

`product_data.code` (contoh `"121"`) BUKAN kode kanonik kita — itu id produk internal
OrderOnline. Yang dibaca hanya `product_data.name`.

### Pemetaan yang DIPAKAI adapter (`packages/api/src/webhooks/adapter.ts`)

Hanya key yang teramati pada sample. Nilai yang tidak ada menjadi `null` — tidak pernah
dicari "yang mirip".

| Kanonik | CO Form | storefront | Catatan |
|---|---|---|---|
| `orderId` | `payload.order_id` | `order_id` | dikirim sebagai angka; teks juga diterima |
| `customerName` | `payload.customer_data.name` | `customer_data.name` | |
| `phone` | `payload.customer_data.phone` | idem | |
| `email` | `payload.customer_data.email` | idem | |
| `productRaw` | `payload.product_data.name` | **`null`** | storefront memuat banyak produk (lihat di bawah) |
| `rawStatus` | `payload.status` | `status` | PRD §52 |
| `paymentMethod` | `payload.payment.method` | `payment.method` | |
| `paymentProvider` | — (tidak ada di CO Form) | `payment.providers.label`, fallback `.name` | |
| `paymentIdentifier` | `paymentProvider` bila ada, jika tidak `paymentMethod` | idem | ↓ lihat konsekuensinya |
| `grossAmount` | `payload.total_price` | `total_price` | termasuk ongkos kirim — lihat catatan |
| `sourceCreatedAt` | `payload.created_at` | `created_at` | |
| `sourceUpdatedAt` | `payload.updated_at` | `updated_at` | |

**Status order, bukan status pembayaran.** `payment.status` (`unpaid`/`paid`) **tidak dipakai
untuk apa pun** dan tidak disimpan. `app_status` diturunkan dari `status` ORDER
(`pending`→Pending, `processing`/`complete`→Paid, `cancelled`→Cancelled — PRD §52). Sudah
diimplementasikan di `packages/shared/src/domain/status.ts` dan diuji C03–C07.

**Konsekuensi `paymentIdentifier` pada CO Form.** Karena CO Form tidak memuat
`payment.providers`, identifier yang dihasilkan adalah `payment.method` **apa adanya**:
`bank_transfer`, `qris`, dan seterusnya. Operator karena itu mendaftarkan identifier di
Konfigurasi Tax dengan nilai yang persis sama — memang itu alur yang diminta `06 §15`
("capture exact canonical payment identifier; add fee rule"). `supabase/seed.sql` sudah
diselaraskan (`bank_transfer`, bukan `bank transfer`) supaya tidak ada tax `unmapped` palsu
saat pengembangan.

**Konsekuensi `grossAmount`.** `total_price` adalah nilai transaksi yang dibayar pelanggan
(termasuk ongkir); `total_product_price` hanya produk. Untuk fee pembayaran, basis yang benar
adalah yang dibayar. Bila ternyata fee seharusnya dihitung dari nilai produk saja, satu baris
di adapter berubah — dan itu perlu keputusan, bukan tebakan.

**Zona waktu.** Format `"2026-09-15 02:31:33"` tidak memuat keterangan zona dan diperlakukan
sebagai **UTC**. Belum terverifikasi apakah platform mengirim waktu lokal (WIB). Dampaknya kecil:
kolom `source_*_at` tidak dipakai untuk filter, sort, maupun perhitungan apa pun —
`orders.created_at` (waktu terima lokal) yang memegang peran itu.

### Yang MASIH KURANG sebelum adapter boleh disebut production-ready (`06 §13`)

1. sample status `processing`/`complete` dan `cancelled` — semua sample hanya `pending`.
   Pemetaannya sudah pasti (PRD §52) dan sudah diuji, tetapi belum pernah dilihat bentuk
   payload aslinya: bila provider menaruh data tambahan pada transisi itu, kita tidak tahu;
2. payment method kedua — semua sample hanya `bank_transfer`;
3. **granularitas `paymentIdentifier`.** Bila rule per bank dibutuhkan ("VA BCA" vs
   "VA Mandiri"), perlu diketahui field mana yang membawa nama bank/channel:
   `payment.data` dan `payment.channels` **kosong di semua sample**, jadi isinya belum boleh
   ditebak. Bukan penghambat untuk berjalan — hanya penghambat untuk fee per bank;
4. Order storefront berisi banyak produk. Tidak menghambat selama CO Form yang dipakai
   (keputusan pengguna), tetapi tetap **tidak boleh dikarang** bila order seperti itu muncul.
   Perilaku sekarang: order tersimpan, `product_raw` NULL, parse `invalid`, akses acara ditolak —
   yaitu perilaku yang memang sudah dikontrak untuk produk tak terbaca (01 §9).

### Soal urutan/struktur pola (rekomendasi: JANGAN diubah)

Pertanyaan yang diajukan pengguna: apakah tiap field dipisah `-`, dan apakah urutannya
diubah (mis. Nama Event sebelum Batch)? Rekomendasinya **tetap seperti dokumen**:

1. **Mapping kode → nama sudah configuration-driven**, jadi tidak perlu fitur baru.
   `KM` berarti "Kuliner Masteri" karena ada baris di tabel `products`; `01` karena ada
   baris di `advertisers`; `SO`/`WO` di `event_types`; `S1`/`S2`/`ST` di `sessions_config`.
   Semuanya dapat di-CRUD dari layar Konfigurasi tanpa mengubah kode (CLAUDE.md §4).
   Yang **tidak** dapat dikonfigurasi adalah *struktur* pola — dan itu memang sebaiknya
   tetap begitu.
2. **Pola ini adalah kontrak dengan manusia yang menamai produk di OrderOnline.** Aplikasi
   hanya bisa membedah nama bila penulisannya mekanis. Setiap derajat kebebasan tambahan
   menambah cara manusia menghasilkan string yang akhirnya ditolak parser
   (`product_parse_status = invalid`), dan penolakan itu berarti peserta yang sudah
   membayar kehilangan akses. Struktur yang dapat dikonfigurasi akan membuat aturan
   "kode ambigu = invalid" (K9) jauh lebih sulit ditalar dan sulit diuji.
3. **Generator yang menghapus risiko penulisan tangan.** Menu Product Name Generator
   menghasilkan string ini persis, jadi operator cukup menyalin-tempel ke OrderOnline.
   Keterbacaan string mentah karena itu tidak perlu dibayar dengan mengubah pola.
4. **Mengubahnya berarti menulis ulang parser, generator, dan test**, serta membuat produk
   yang sudah dinamai dengan pola lama tidak lagi terbaca. Itu biaya nyata untuk manfaat
   yang sudah ditutup oleh generator.

Konsekuensi yang harus disadari: bagian `[BATCH]` menempel pada segmen pertama **tanpa
pemisah** (`KM01SO392`), jadi batch wajib berupa deretan karakter tanpa ` - `. Itu sudah
ditangani parser (batch tetap string, `001` tidak kehilangan leading zero) dan sudah diuji.

Bila pengguna tetap ingin struktur lain, itu **perubahan requirement**: harus dicatat di
`AMENDMENTS.md`, diikuti penulisan ulang parser + generator + test, dan sebaiknya dilakukan
sebelum ada produk nyata yang dinamai memakai pola lama.

---

## Blocker (bukan amendemen)

`BLOCKED_BY_EXTERNAL_ORDERONLINE_PAYLOAD` — **sebagian besar terbuka**. Adapter sudah memetakan
seluruh field yang dibutuhkan untuk berjalan (`VA-1`), dan ingestion sudah diuji end-to-end
termasuk idempotensi dan snapshot tax. Yang masih kurang adalah butir 1–3 di `VA-1`: verifikasi
bentuk payload pada transisi status lain, payment method kedua, dan granularitas identifier
untuk fee per bank. Karena itu integrasi webhook **tetap tidak boleh** disebut production-ready
(`06 §13`).


## A10 ? Revisi operasional pengguna, 13 Oktober 2026

Permintaan pengguna menggantikan pembatasan MVP terkait export, sidebar, provisioning, dan retensi:

- Semua tabel memiliki export CSV UTF-8 sesuai filter/pencarian dan sort aktif, mencakup seluruh halaman hasil. Export hanya kolom operasional yang ditampilkan; kredensial tidak pernah diekspor.
- Konfigurasi Zoom memetakan nama produk webinar persis ke URL HTTPS Zoom di app_settings. Link followup adalah /access/{{order_id}}; tetap menggunakan pemeriksaan Paid, parsing produk, dan pencatatan presensi yang sudah ada. Endpoint GET/POST /api/webinar-destinations hanya untuk pengguna aktif. Team boleh memakai menu ini sesuai daftar pembatasan pengguna.
- Add Team hanya untuk Admin Master: daftar profil aman (GET /api/internal/users), tambah username/password/role lewat endpoint provisioning yang sudah ada. Display name awal memakai username. Admin Master dapat membuat ketiga role; ALLOW_MASTER_ADMIN_CREATE_MASTER=true di produksi.
- Label role: master_admin = Admin Master, admin = Admin, staff = Team. Identifier database/JWT tetap agar akun dan sesi lama kompatibel. Admin tidak dapat Add Team; Team tidak dapat Add Team, Konfigurasi Produk, Konfigurasi Tax, Report Tax. Route guard dan menu disabled melengkapi backend/RLS. Pembacaan kode untuk filter/generator tetap tersedia.
- Retensi attendance_events menjadi 60 hari melalui migrasi 0021; master order dan retensi webhook_logs 7 hari tetap. Data yang sudah terhapus sebelumnya tidak dipulihkan.
- Mobile: kontrol dapat membungkus, field mengikuti kontainer, modal dapat digulir, tabel tetap menggulir di dalam kontainernya. Warna, tipografi, dan alur selain revisi ini tetap.


## A11 ? Multi-connection OrderOnline API & Webhook (2026-10-13)

User requested API/webhook settings supporting more than one connection. Admin Master and Admin can create/edit named connections, enable/disable delivery, save a personal access token, test authentication and copy a per-connection webhook URL. Team cannot access these credentials. API tokens are optional for inbound webhooks, encrypted with AES-256-GCM using backend-only INTEGRATION_ENCRYPTION_KEY (base64 32 bytes); retain this key across deployments and back it up securely. Tokens and webhook secrets are excluded from lists and CSV exports. Blank token edits preserve the saved token.

POST https://api.orderonline.id/v1/auth tests the saved personal access token according to https://developers.orderonline.id/reference/auth (checked 2026-10-13). No automatic historical import or remote webhook registration is implied: paste the generated URL into OrderOnline's order webhook settings. Tests discard upstream JWTs and sanitize provider errors.

Migration 0022 adds service-only connection/source tables and a wrapper around existing ingestion. Multiple managed connections cannot overwrite each other's Order IDs. Existing global Order ID participant links and legacy environment-secret webhook remain compatible; legacy webhook order ownership cannot be inferred retroactively. Existing payload/status limitations still apply. Last received time tracks successful managed ingestion. Deployment requires migration 0022 and INTEGRATION_ENCRYPTION_KEY before publishing the new app.


## A12 — Scoped Zoom & Seminar Barcode/QR Ticket Configuration, Full CRUD, and Sidebar Placement (2026-10-13)

Atas permintaan eksplisit pengguna:

1. **Konfigurasi Link Zoom Berjenjang (`/konfigurasi-zoom`)**:
   - Selain pemetaan `product_raw` persis (`webinar_destination::<product_raw>`), `app_settings` kini mendukung aturan cakupan (`webinar_destination::__scope__::<product_code|*>:<batch|*>:<session_code|*>`).
   - Operator dapat mengatur 1 link Zoom untuk semua produk & sesi (`*:*:*`), per produk, per batch, per sesi, atau kombinasinya.
   - Saat peserta membuka `GET /access/:orderId` untuk order `Webinar Online` yang `Paid`, sistem mencari aturan yang paling spesifik (`exact product_raw` > `product+batch+session` > `product+batch` > `product+session` > `product` > `batch+session` > `batch` > `session` > `global *:*:*`).
2. **Konfigurasi Barcode / Tiket QR Seminar (`/konfigurasi-tiket`)**:
   - Menu baru `Konfigurasi Barcode / Tiket` di bawah `KONFIGURASI` (terbuka untuk seluruh role aktif termasuk `Team`, sama seperti `Konfigurasi Zoom`).
   - Menyimpan aturan cakupan tiket seminar (`seminar_ticket::__scope__::<product_code|*>:<batch|*>:<session_code|*>`) berisi info opsional (`venue`, `schedule`, `notes`, `active`) serta menyediakan template link `/access/{{order_id}}` dan fitur **Preview Tiket QR** di browser.
   - Saat peserta membuka `GET /access/:orderId` untuk order `Seminar Offline` yang `Paid`, halaman tiket QR menampilkan `Lokasi`, `Jadwal`, dan `Catatan` dari aturan yang paling spesifik. Drawer detail `Order` dan `Presensi Acara` juga menampilkan pintasan salin/buka link `/access/:orderId`.
3. **Kelengkapan CRUD (Edit & Delete Permanen)**:
   - **Add Team**: Admin Master dapat mengedit (`PATCH /api/internal/users/:id`) dan menghapus permanen (`DELETE /api/internal/users/:id`) member lain (tidak boleh menghapus/menonaktifkan akun sendiri).
   - **Konfigurasi Produk & Tax**: selain tombol `Nonaktifkan`/`Aktifkan` (soft-deactivate), tersedia tombol `Hapus` dengan modal konfirmasi yang memanggil `DELETE /api/config/:resource/:id?permanent=true`. FK `orders.fee_rule_id` diubah menjadi `ON DELETE SET NULL` di migrasi `0023` agar snapshot tax order historis tetap utuh.
   - **Konfigurasi Zoom, Konfigurasi Tiket, dan API & Webhook**: masing-masing dilengkapi tombol `Hapus` dengan modal konfirmasi (`DELETE /api/webinar-destinations`, `DELETE /api/seminar-tickets`, `DELETE /api/integrations/orderonline/:id`).
4. **Penempatan Menu Sidebar**:
   - `Product Name Generator` (`/generator`) dipindahkan dari kategori `KONFIGURASI` ke kategori `OPERASIONAL`.


## A13 — Perbaikan pasca-audit, 14 Oktober 2026

Lengkapnya ada di `docs/Fitur-2.0/09-RUNBOOK-MIGRASI-PRODUKSI.md` dan dok 08 bagian "Audit lanjutan".

1. **Kode tidak boleh mendahului database.**
   - Migrasi 0029 menambah `schema_version()`.
   - CI menahan deploy bila versi database lebih kecil dari migrasi tertinggi.
   - Objek skema yang hilang (`PGRST202`/`PGRST205`/`42883`/`42703`/`42P01`) kini menjadi `503 SCHEMA_OUT_OF_DATE`, bukan 500 bisu.
2. **Remap order unmapped bersifat permanen.**
   - `batch_remap_orders` hanya menyentuh order `invalid`.
   - Nama produk asli order disimpan sebagai alias ke target remap. Tanpa itu, webhook berikutnya (mis. Pending → Paid) mem-parse ulang nama asli dan membatalkan remap, sehingga peserta Paid ditolak.
   - Ini satu-satunya perubahan perilaku produk di A13. Mekanismenya memakai tabel alias yang sudah ada, tanpa kolom baru.
3. **Kode toko koneksi tidak dapat diubah setelah dibuat.** Kode itu menjadi awalan Order ID; mengubahnya akan memecah satu order menjadi dua baris.
4. **Hapus anggota tim memakai RPC `admin_delete_user`.** Role penuh (developer/owner/master_admin) hanya dapat dihapus Developer.
5. **Edit rule Zoom/tiket yang mengganti scope membuang key lama** (`original_key`), sehingga tidak ada rule ganda.
6. **Data trial dihapus total atas keputusan pengguna** (`scripts/wipe-trial-data.mjs`). Kode legacy (`KM`/`BM`) tidak lagi dipertahankan, dan constraint kode ketat 0028 divalidasi penuh.
7. **Kode error kontrak Fitur 2.0 dipakai:** `ROLE_IN_USE`, `SYSTEM_ROLE_CANNOT_BE_DELETED`, `FORBIDDEN_PRODUCT_ACCESS`. `USERNAME_TAKEN`/`IDENTIFIER_TAKEN` dibedakan dari `CODE_TAKEN`.
8. **Masih terbuka (keputusan produk):** sidebar 15 item menyimpang dari CLAUDE.md §5 (10 item).
