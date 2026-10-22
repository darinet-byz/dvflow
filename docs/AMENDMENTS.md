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
**Diperbarui A24:** data produksi menunjukkan `source_created_at` memang UTC (selisih ~1 detik dari waktu terima),
dan filter tanggal kini memakai `coalesce(source_created_at, created_at)` dalam hari WIB.

### Yang MASIH KURANG sebelum adapter boleh disebut production-ready (`06 §13`)

1. sample status `processing`/`complete` dan `cancelled` — semua sample hanya `pending`.
   Pemetaannya sudah pasti (PRD §52) dan sudah diuji, tetapi belum pernah dilihat bentuk
   payload aslinya: bila provider menaruh data tambahan pada transisi itu, kita tidak tahu;
2. payment method kedua — semua sample hanya `bank_transfer`. **Informasi provider (15 Okt 2026,
   lihat A16):** e-payment dikirim sebagai `payment.method = "instant"`; payload `instant` nyata
   tetap dibutuhkan untuk memastikan bentuknya;
3. **granularitas `paymentIdentifier`** — sebagian terjawab oleh provider: kode channel ada di
   `payment.channels` (`bca_va`, `bri_va`, `bni_va`, `bsi_va`, `permata_va`, `echannel` = Mandiri,
   `gopay`, `ovo`, `dana`, `shopeepay`, `alfamart`, `credit_card`). Adapter memakai kode itu
   bila ada tepat satu; bentuk array nyata (string vs objek) belum terlihat, karena itu isinya
   dicatat di `webhook_logs.summary.payment_channels` dan selain satu kode dikenal identifier
   tetap `instant` + warning `payment_channel_undetermined` (tidak menebak);
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

## A14 — Jenis acara HYBRID, 14 Oktober 2026

Atas permintaan eksplisit pengguna (migrasi `0030_hybrid_event_kind.sql`).

**Konfigurasi.** Ada pilihan **Cara Hadir** ketiga untuk Type: `hybrid`. Satu Order ID Hybrid yang Paid berlaku untuk dua jalur.

**Link peserta `/access/[KODE/]{order_id}`:**
- Halaman tiket QR tampil seperti seminar, ditambah tombol **"Gabung via Zoom"** yang mengarah ke link yang sama dengan `?via=zoom`.
- Tombol hanya muncul bila link Zoom untuk order itu sudah dikonfigurasi. Sumbernya Konfigurasi Zoom, dengan aturan cakupan yang sama seperti webinar.
- Order Seminar Offline mengabaikan `?via=zoom`. Order Webinar Online tetap langsung diarahkan ke Zoom.

**Presensi:**
- Check-in di lokasi tetap satu kali per order (`attendance_type='seminar'`, idempoten).
- Setiap klik Zoom tercatat sebagai baris baru (`attendance_type='webinar'`).
- Peserta dianggap **hadir bila ada salah satu**. Aturan ini sudah dipakai presensi, dashboard, dan laporan (`has_attendance`), jadi tidak ada perubahan query.

**Validasi:**
- `checkin_seminar` dan pencarian Scan QR menerima order Seminar Offline maupun Hybrid.
- Rule Zoom berbasis nama produk menerima produk Online maupun Hybrid.

**Skema.** Tidak ada tabel atau kolom baru. Yang diperluas hanya `event_types.kind` (`hybrid`) dan `orders.event_type` (`Hybrid`).

**Perbaikan ikutan.** Pilihan filter "Event Type" di Order, Presensi, dan Dashboard kini memakai nilai yang benar-benar tersimpan di order (Seminar Offline/Webinar Online/Hybrid), bukan nama baris konfigurasi. Sebelumnya, Type dengan nama lain (mis. "Workshop") tidak pernah cocok saat difilter.

## A15 — Platform Fee, E-payment Fee Tax, dan laporan uang hanya order Paid (15 Oktober 2026)

Atas permintaan eksplisit pengguna (migrasi `0031_platform_fee_and_epayment_tax.sql`).

**Potongan per order.** Semua komponen disimpan sebagai snapshot dan dibulatkan 2 desimal. Mengubah tarif tidak mengubah order lama.

| Komponen | Rumus | Kapan |
|---|---|---|
| E-payment Fee (`tax_amount`, kolom lama) | flat Rp, atau % dari gross | rule metode bayar cocok |
| E-payment Fee Tax (`epayment_tax_amount`) | flat Rp, atau % dari E-payment Fee (mis. PPN 1% untuk VA) | rule punya tipe+nilai |
| Platform Fee (`platform_fee_amount`) | PLATFORM FEE % global × gross | order **Paid** dan rule dicentang "Kena Platform Fee" |
| Net | gross − tiga potongan di atas | |

**Konfigurasi.**
- PLATFORM FEE (%) adalah satu nilai global di Konfigurasi Tax, disimpan di `app_settings` dengan key `fee_setting::platform_fee_percent`.
- Tiap metode pembayaran memiliki Nama, Identifier, centang Platform Fee, E-payment Fee (flat/%), dan E-payment Fee Tax (flat/%, opsional).
- Form menampilkan contoh perhitungan untuk order Rp100.000, memakai rumus yang sama dengan server (`calculateFees` di shared).

**Kapan dihitung.**
- Aturan hitung ulang 01 §12 tetap berlaku.
- Ditambah satu kondisi: perhitungan ulang juga terjadi saat order **berubah menjadi Paid**. Dengan begitu platform fee memakai tarif saat order dibayar.

**Laporan.**
- Report Tax dan nominal Dashboard (Gross, potongan, Net) hanya menjumlahkan order **Paid**.
- Leads, Pending, dan Cancelled di Dashboard tetap menghitung semua status.
- Label Blueprint dipertahankan. "Total Tax" di Report Tax sekarang berarti jumlah ketiga potongan, dan rinciannya ditampilkan di sebelahnya.

**Batasan.** Penentuan VA, QRIS, atau bank transfer dilakukan lewat identifier dan centang per rule, bukan deteksi otomatis. Sampel webhook nyata yang tersedia baru `bank_transfer` (VA-1).

## A16 — Kode metode bayar OrderOnline dan katalog Konfigurasi Tax (15 Oktober 2026)

Sumber: informasi provider OrderOnline yang diteruskan pengguna. Migrasi `0032_payment_methods_catalog.sql`.

**Identifier (adapter webhook).**
- Bank transfer: `payment.method = "bank_transfer"`, sehingga identifier `bank_transfer`. Bila storefront mengirim `providers.label`, label itu yang dipakai.
- E-payment: `payment.method = "instant"`, dan identifier diambil dari kode di `payment.channels`.
- Daftar kode channel: `credit_card`, `bsi_va`, `bca_va`, `bni_va`, `bri_va`, `permata_va`, `echannel` (Mandiri; kodenya hanya `echannel`), `gopay`, `ovo`, `dana`, `shopeepay`, `alfamart`.
- Hanya dipakai bila `channels` berisi tepat satu kode dari daftar ini. Selain itu identifier tetap `instant`. Daftar ada di `packages/shared/src/domain/payment-channels.ts`.

**Katalog.** Migrasi menulis 14 metode bayar dalam keadaan nonaktif dengan nilai 0, tanpa menimpa rule yang sudah ada. Isinya bank_transfer, 12 channel di atas, dan cadangan `instant`.
- Platform Fee dicentang untuk semua metode kecuali bank_transfer.
- E-payment Fee Tax awal 1% untuk VA (termasuk `echannel`).
- Operator menyalakan tiap metode lewat toggle dan mengisi nilainya.

**Fee kombinasi.**
- E-payment Fee boleh Flat, Persentase, atau Persentase + Flat (`percentage_flat` = gross × persen + `fee_flat_value`).
- Bagian flat dibekukan di `orders.fee_flat_value_snapshot`.
- E-payment Fee Tax tetap flat atau persentase.

**UI.**
- Kode metode dipilih dari daftar, tidak diketik bebas.
- Baris diurutkan sesuai katalog.
- Status aktif berupa toggle on/off di baris.

**Masih menunggu.** Payload `instant` nyata untuk memastikan bentuk `channels`. QRIS tidak ada di daftar provider; di Midtrans biasanya masuk `gopay`, sehingga dipastikan dari transaksi nyata.

## A17 — Pemetaan order dikunci walau alias dihapus (16 Oktober 2026)

Keputusan pengguna: alias produk tetap boleh dihapus, tetapi order yang sudah terpetakan tidak boleh menjadi Unmapped pada webhook berikutnya. Migrasi `0034_keep_order_mapping.sql`.

**Pengecualian terhadap aturan "parse invalid → kolom NULL" (CLAUDE.md §4).** Bila webhook berikutnya untuk order yang **sudah valid** membawa nama produk yang **sama** (tanpa membedakan huruf besar/kecil dan spasi tepi) dan hasil parse-nya invalid, misalnya karena alias sudah dihapus:
- pemetaan produk, pengiklan, tipe, batch, sesi, dan kota dipertahankan;
- status, pembayaran, dan potongan tetap diperbarui seperti biasa;
- `webhook_logs.payload_sanitized.mapping_kept = true`.

**Tetap mengikuti hasil parse:**
- order dengan nama produk yang **berbeda** (produk memang berganti);
- order **baru** dengan nama yang aliasnya sudah dihapus. Order seperti ini menjadi Unmapped.

## A18 — Kapasitas database, batas list 500 baris, default tanggal 30 hari (16 Oktober 2026)

**Kapasitas (Supabase Free, batas 500 MB).** Benchmark lokal dengan 20.000 order sintetis yang realistis lewat `upsert_connected_order`, semua migrasi aktif:

| Komponen | Ukuran | Masa simpan |
|---|---|---|
| Order (data + 29 indeks, termasuk 9 GIN trigram untuk pencarian, + baris sumber toko) | **±3,2 KB per order** | permanen |
| Log webhook | ±0,5 KB per webhook | 7 hari (cron) |
| Presensi | kecil per baris | 30 hari (cron) |

Database dasar di produksi ±13 MB. Setelah dikurangi ruang log webhook 7 hari dan cadangan aman 20%, kapasitas **±120.000 order dengan aman**, dan batas keras di sekitar **150.000 order**. Lewat dari 500 MB, Supabase membuat database read-only. Mulai rencanakan upgrade ke Pro (8 GB, ±2 juta order) atau arsip order lama saat ukuran database mendekati **400 MB** (Dashboard Supabase → Database → Usage).

**Batas list.**
- Pagination Order dan Presensi hanya bisa dibuka sampai **500 baris**: 10 halaman × 50, atau 5 × 100 (`MAX_LIST_ROWS`).
- Guard ada di server: `orders_page`/`presensi_page` → `DF011 PAGE_LIMIT` (0035). Order Unmapped juga ditolak setelah halaman 10.
- Kartu ringkasan tetap menampilkan total asli, dan UI menyarankan mempersempit filter.
- Export CSV tidak dibatasi.

**Default tanggal.**
- Dashboard, Order, Presensi, dan Report Tax dibuka dengan **30 Hari Terakhir**. "Clear All" kembali ke 30 hari.
- "Semua tanggal" masih bisa dipilih manual: lewat preset di panel tanggal, atau ✕ pada chip tanggal.

## A19 — Tiket QR disederhanakan, jumlah tiket, stempel check-in (16 Oktober 2026)

**Jumlah tiket.**
- `orders.quantity` (0036): bilangan bulat 1–10000, default 1.
- Sumbernya CO Form `payload.customer_data.quantity`; angka dalam string ikut dikonversi.
- Nilai tidak wajar (0, negatif, pecahan, teks) dari adapter menjadi `null` (tidak menebak). `null` berarti nilai tersimpan dipertahankan.
- RPC menolak quantity tidak valid dengan `INVALID_PAYLOAD`. Storefront tidak dipetakan (VA-1).

**Halaman tiket peserta** (`/access/:orderId`). Urutan tetap:
1. Nama Peserta (besar)
2. Order ID (sekali)
3. Produk
4. Batch
5. Kota
6. Sesi
7. Catatan (opsional)
8. QR
9. **N TIKET** (besar)

Yang tidak lagi ditampilkan: nama pengiklan, label jenis acara, dan Order ID besar di bawah QR.

**Sesudah check-in.**
- Semua info tetap tampil. QR diganti stempel **CHECK-IN BERHASIL** beserta waktu (WIB).
- Skrip `ticket-qr.js` memeriksa ulang halaman yang sama tiap 15 detik (GET tanpa efek samping; CSP ditambah `connect-src 'self'`) dan memuat ulang ketika muncul `data-checked-in="true"`.
- Tidak ada endpoint baru.

**Hybrid.** Tombol penuh **JOIN SECARA ONLINE (ZOOM)**. Tombol hanya muncul bila link Zoom dikonfigurasi.

**Scanner.**
- Respons check-in membawa `quantity`.
- Kartu hasil scan menampilkan jumlah tiket besar.
- Toast: "Check-in berhasil · N tiket" / "Sudah check-in sebelumnya · N tiket".

**Konfigurasi Barcode / Tiket.**
- Isinya cakupan (produk/batch/sesi) + **Catatan Opsional** saja. Lokasi, Jadwal, dan Aktif dihapus.
- Nilai lama yang sudah tersimpan diabaikan dan tidak dihapus.
- Aturan tiket tidak pernah lagi menolak peserta Paid (cabang "tiket nonaktif" dihapus).
- Konfigurasi Zoom tidak berubah.

## A20 — Role Advertiser: hanya order hasil iklannya sendiri (16 Oktober 2026)

**Kebutuhan.** Role baru **Advertiser** (`advertiser`):
- Seperti Pimpro: hanya produk yang ditugaskan (atau Semua Produk).
- Tambahan: hanya order dengan **kode pengiklan miliknya**. Produk dengan beberapa pengiklan tidak tercampur.
- Pimpro tidak berubah: tetap level produk dan melihat semua pengiklan di produknya.

**Keputusan pengguna.**
- 1 akun = 1 pengiklan (master Pengiklan).
- Produk dipilih seperti Pimpro.
- Yang terlihat = produk terpilih **DAN** `orders.advertiser_code` = kode pengiklannya.

**Implementasi (0037).**
- `users.advertiser_id` (FK `advertisers`, restrict) dengan CHECK: role `advertiser` ⇔ pengiklan terisi.
- Pengiklan yang dipegang akun dihitung "dipakai" (`master_is_used`), jadi tidak bisa dihapus atau diganti kodenya.
- Izin awal role = salinan izin Pimpro saat migrasi. Tetap bisa diubah di Konfigurasi Role.
- `actor_can_order(actor, product_code, advertiser_code)` / `can_access_order` dipasang di RLS `orders`. Presensi, Dashboard, Order, Report Tax, dan export ikut otomatis.
- `checkin_seminar` memakai pemeriksaan yang sama. Worker mencerminkannya (`ProductAccess.advertiserCode`, `productFilter`, `assertOrderAccess`) untuk scanner search dan check-in.
- Akun Advertiser hanya melihat pengiklannya sendiri di dropdown filter dan Product Name Generator (RLS `advertisers`).
- Order Unmapped tidak bisa dibuka akun Advertiser, karena order itu belum punya kode pengiklan.
- Add Team: pilihan **Pengiklan** muncul dan wajib diisi hanya untuk role Advertiser.

**Keamanan.** `admin_create_user`/`admin_update_user` versi 0024 ternyata masih bisa dieksekusi `PUBLIC`. Versi itu dihapus; versi baru hanya untuk `service_role`.

**Catatan.** Konfigurasi Zoom/Tiket tetap level produk. Role Advertiser bawaan tidak punya izin `config.*` (sama dengan Pimpro).

## A21 — Label role mengikuti Konfigurasi Role (16 Oktober 2026)

- Add Team menampilkan label lama "Team" (dari A10), padahal di Konfigurasi Role role itu bernama "Staff (Legacy)".
- Sumber nama role sekarang satu: `app_roles.name` (Konfigurasi Role).
  - Add Team mengambil nama dari `/api/roles`, untuk pilihan role maupun tabel.
  - Sidebar memakai `profile.role_name` dari server.
- Label A10 "staff = Team" dan "master_admin = Admin Master" diganti menjadi nama di Konfigurasi Role. ID role tidak berubah.
- Mengganti nama role di Konfigurasi Role otomatis mengubah labelnya di semua tempat.

## A22 — Status Scanner Stick berdasarkan data yang benar-benar diterima (16 Oktober 2026)

- Dulu mode Scanner Stick langsung menampilkan "SCANNER STICK AKTIF", padahal belum ada alat yang tersambung.
- Scanner USB/Bluetooth dikenali browser sebagai keyboard ("keyboard wedge"). Browser tidak bisa mendeteksi keyboard yang tersambung (WebHID memblokir perangkat keyboard).
- Status sekarang (`useScannerStick`):
  - **Menunggu scanner**: belum ada data dari alat. Petunjuk: scan QR apa saja untuk tes koneksi.
  - **Scanner terhubung**: halaman menerima tembakan scan secepat alat (rata-rata jeda ≤ 60 ms per karakter, minimal 4 karakter, diakhiri Enter), plus jam scan terakhir. Ketikan tangan tidak mengubah status.
  - **Halaman tidak fokus**: jendela/tab lain sedang aktif, jadi ketikan scanner tidak sampai ke halaman ini.
- Pemrosesan check-in tidak berubah.
- Lepasnya alat tidak bisa dideteksi browser. Status "terhubung" berarti pernah menerima scan di sesi halaman ini; jam scan terakhir yang menjadi petunjuk.

## A23 — Ringkasan Presensi tanpa izin Dashboard + QR Tes Scanner (16 Oktober 2026)

**Ringkasan Presensi.**
- Masalah: kartu Hadir/Belum Hadir/Attendance Rate di halaman Presensi memakai `dashboard_summary` yang mewajibkan izin Dashboard. Akun dengan izin Presensi saja (mis. Staff) melihat tabel, tetapi kartunya error "Anda tidak memiliki akses ke data ini".
- RPC baru `presensi_summary` (0038) cukup dengan izin `operasional.presensi`. Filter dan definisinya sama (Hadir dihitung dari order Paid yang punya presensi).
- RPC ini hanya mengembalikan `paid`, `sudah_hadir`, `belum_hadir`, `attendance_rate`. Angka keuangan Dashboard tetap butuh izin Dashboard.
- Scope produk/pengiklan ikut RLS.

**QR Tes Scanner.**
- Tombol "QR Tes Scanner" di halaman Scan QR menampilkan QR berisi `DVFLOW-TES-SCANNER`, bisa juga diunduh untuk dicetak.
- Payload ini dikenali sebelum parsing Order ID: tidak dikirim ke server dan tidak mencatat presensi, jadi bisa dipindai berulang.
- Hasilnya "QR tes terbaca". Pada mode Scanner Stick, scan ini sekaligus mengubah status menjadi "Scanner terhubung" (A22).

## A24 — Filter tanggal: tanggal order OrderOnline dalam hari WIB (16 Oktober 2026)

**Temuan.** Hari ini OrderOnline mencatat 54 leads, sedangkan aplikasi menampilkan 45.
- Tidak ada webhook yang gagal: 85 webhook hari ini, semuanya `accepted`.
- Database berisi 54 order dengan tanggal order hari ini.

**Penyebab 1: batas hari UTC.** Filter `o.created_at >= $2::date` dievaluasi di zona sesi database (UTC).
- Akibatnya "hari ini" baru mulai pukul 07:00 WIB.
- 10 order antara 00:00–06:59 WIB masuk ke hari sebelumnya, termasuk 4 order Paid (31 → 27).

**Penyebab 2: tanggal terima, bukan tanggal order.** `created_at` adalah waktu order diterima aplikasi.
- Contoh: `MTIX-283503758` dibuat di OrderOnline 12 Okt tetapi baru tersinkron 16 Okt, sehingga terhitung di 16 Okt.

**Perbaikan (0039).**
- Semua RPC baca dengan filter tanggal sekarang memakai `coalesce(source_created_at, created_at)` dengan batas 00:00–24:00 Asia/Jakarta: `orders_page`, `export_orders_page`, `presensi_page`, `export_presensi_page`, `dashboard_summary`, `presensi_summary`, `tax_report`.
- Ditambah indeks ekspresi `orders_order_date_idx`.
- Urutan default tabel tetap `created_at`.

**Catatan status.** "Paid" di aplikasi = status order `processing`/`complete` (PRD §52). OrderOnline dapat menampilkan order `processing` sebagai "unpaid" di sisi pembayaran. Karena itu Paid aplikasi bisa lebih besar daripada "paid" OrderOnline. Hari ini: 30 vs 27, dengan 3 order processing yang di OrderOnline masih unpaid.

## A25 — Jumlah Tiket di Dashboard (16 Oktober 2026)

- **Leads** = jumlah Order ID (tidak berubah).
- **Paid** = jumlah Order ID berstatus `processing`/`complete` (tidak berubah). Tidak pernah dobel: 1 Order ID = 1 baris, dan perubahan `processing` → `complete` hanya memperbarui baris yang sama.
- **Jumlah Tiket** (baru) = total `orders.quantity` (A19) dari order Paid, yaitu tiket terjual. Keputusan pengguna: order Pending/Cancelled tidak dihitung. `dashboard_summary` (0040) mengembalikan `paid_tickets`.
- **Batasan data lama:** order yang belum menerima webhook lagi sejak 0036 masih bernilai default 1, karena log webhook lama tidak menyimpan quantity. Nilainya otomatis benar saat order itu menerima webhook berikutnya. Mulai A25, `quantity` ikut dicatat di `webhook_logs`.

## A26 — Koreksi jumlah tiket order lama dari nominal: SEKALI JALAN (16 Oktober 2026)

- **Keputusan pengguna:** isi jumlah tiket order lama dari nominal, **hanya sekali ini**. Ke depan jumlah tiket selalu dari webhook (`customer_data.quantity`, A19). Nominal **tidak** dipakai untuk menghitung tiket di kode mana pun.
- **Rumus satu kali:** `floor(gross_amount / 150000)`. Harga tiket saat itu 150.000; kode unik transfer 3 digit ikut terbuang oleh pembulatan ke bawah.
- **Batasan:** hanya menaikkan nilai yang lebih kecil dari hasil hitung, jadi nilai dari webhook tidak ditimpa.
- **Pelaksanaan:** dijalankan langsung ke produksi dalam satu transaksi (bukan migrasi, supaya tidak terulang di database lain). Backup lokal ada di `.local-backups/quantity-backfill-*.json`. Skrip dihapus setelah dijalankan.
- **Hasil:** 2 order diubah dari 1 menjadi 2 tiket, keduanya masih Pending: `MTIX-283753354` (300.371) dan `MTIX-283760387` (300.000). Tidak ada order bernominal di bawah 150.000.

## A27 — Link peserta selalu memakai kode toko (16 Oktober 2026)

- **Keputusan awal** (Fitur 2.0 dok 07, A13): Order ID disimpan `KODE-nomor` dan link peserta `/access/{kodeToko}/{{order_id}}`, supaya order dua toko tidak pernah tertukar. Server dan halaman API & Webhook sudah mengikutinya.
- **Celah yang ditemukan:**
  - Konfigurasi Zoom dan Konfigurasi Tiket masih menampilkan template lama `/access/{{order_id}}`.
  - Drawer detail Order dan Presensi membuat link `/access/MTIX-283…`.
- **Perbaikan:**
  - Kedua halaman konfigurasi menampilkan satu link `/access/{KODE}/{{order_id}}` per koneksi OrderOnline aktif. Daftar Zoom dan Tiket kini mengembalikan `stores`: hanya nama dan kode, tanpa token atau secret.
  - Drawer membuat `/access/MTIX/283818331` (`participantAccessPath`). Order lama tanpa kode toko tetap `/access/<order_id>`.
- **Kompatibilitas:** link lama `/access/<nomor>` tetap dilayani hanya bila nomor itu unik di semua toko. Bila bentrok, link ditolak "tidak ditemukan", tidak pernah menebak toko.

## A28 — Bar filter seragam & default "Hari Ini" (17 Oktober 2026)

- **Satu komponen** `StandardFilterBar` untuk Dashboard, Order, Presensi, dan Report Tax. Susunannya:
  - **Baris 1:** Cari (bila ada) · Tanggal · kontrol tampilan (Report Tax: "Kelompokkan per").
  - **Baris 2:** Produk · Pengiklan · Seminar & Webinar · Batch · Sesi · Kota · filter khusus halaman (Order: Status, Payment method; Presensi: Hadir/Belum Hadir).
  - **Baris 3:** chip filter aktif · Clear All.
- Semua kontrol selebar 190px; di layar sempit selebar layar. "More Filters" di Order dihapus, jadi tidak ada filter yang tersembunyi.
- Default tanggal semua halaman bertanggal = **Hari Ini** (menggantikan 30 Hari Terakhir dari A18). Clear All kembali ke Hari Ini. Preset lain dan "Semua tanggal" tetap bisa dipilih.

## A29 — Peserta OTS: bayar di lokasi seminar (17 Oktober 2026)

**Keputusan pengguna.**
- Fitur tersendiri, tidak disambungkan ke order Pending: lokasi ramai, dan mencari nama terlalu lama.
- Pembayaran cukup dicatat di dvflow; OrderOnline tidak disentuh.
- Peserta langsung hadir.
- Data yang dicatat: nominal + metode bayar.
- Salah input bisa diedit langsung.

**Model data (0041).** Setiap pendaftaran OTS adalah satu order baru:
- `orders.source = 'ots'`, Order ID `OTS-000001` dari sequence `ots_order_seq`;
- Paid, `quantity = 1`, `gross = net = nominal`, tanpa e-payment fee, pajak, maupun platform fee;
- metode `ots_tunai` / `ots_transfer` / `ots_qris`; petugas di `ots_collected_by`;
- langsung check-in seminar dengan sumber `seminar_ots`.

Karena tersimpan sebagai order biasa, OTS otomatis masuk Leads, Paid, Jumlah Tiket, Gross/Net, Presensi, Report Tax, scope produk, dan filter tanggal.

**Pengecualian aturan.** "No Master Order edit/delete" tidak berlaku untuk order `source = 'ots'`:
- Edit lewat `save_ots_registration` (izin `action.ots`).
- Hapus lewat `delete_ots_registration` (izin `action.ots` + `action.delete_master`).
- Order OrderOnline tetap tidak bisa diedit atau dihapus.
- Webhook menolak menimpa order OTS.

**Keamanan dan izin.**
- Kode toko `OTS` dicadangkan (constraint di `orderonline_connections.slug`), sehingga Order ID OTS tidak pernah tabrakan dengan toko (A27).
- Izin baru `action.ots` ("Pendaftaran OTS") diberikan ke Manajer dan Admin; role lain diatur lewat Konfigurasi Role.
- Order OTS tidak punya pengiklan, jadi tidak terlihat oleh akun Advertiser (A20).

**UI.** Tidak ada menu baru. Halaman Scan QR punya tombol **Peserta OTS** yang membuka drawer berisi:
- form dengan pilihan Acara (dari order seminar/hybrid 30 hari terakhir); acara dan nominal diingat per perangkat;
- Nama, No WA (opsional), Nominal, dan Metode;
- daftar **OTS hari ini** (total nominal, nama petugas) dengan tombol Edit/Hapus.

Order/Presensi menampilkan badge OTS. Detail order OTS tidak menampilkan link tiket.

## A30 — Tampilan Apps Lapangan di HP (17 Oktober 2026)

**Keputusan pengguna.**
- Tampilan seperti aplikasi hanya untuk petugas lapangan: role **Pimpro, Staff, Member**.
- Diatur lewat izin **"Tampilan Apps Lapangan"** (`ui.field_app`) yang bisa dicentang atau dilepas di Konfigurasi Role.
- Role lain tidak mendapat opsi ini dan tetap memakai tampilan web responsif, termasuk di HP. Tidak perlu PWA/install.

**Izin (0042).**
- `ui.field_app`, modul "Tampilan", default dicentang untuk pimpro/staff/member.
- `save_role_permissions` menolaknya untuk role lain, dan role master tidak pernah menerimanya walaupun "semua izin".
- Worker memberi pesan "hanya untuk role Pimpro, Staff, dan Member". Konfigurasi Role hanya menampilkan checkbox ini untuk tiga role tersebut.

**Kapan aktif.** Role ∈ {pimpro, staff, member} **dan** izin dicentang **dan** layar < 768px.

**Kerangka.** `FieldAppShell`:
- header ringkas, konten selebar layar, safe-area iPhone;
- tab bawah **Presensi · OTS · [SCAN] · Cari Peserta · Akun**, dengan tombol Scan besar di tengah; tab tanpa izin tidak tampil;
- halaman di luar tab (mis. Dashboard) diarahkan ke Scan.

**Layar.**
- **Scan:** tanpa tombol OTS dan pencarian manual (keduanya punya tab sendiri).
- **OTS** `/ots`: `OtsPanel` layar penuh.
- **Cari Peserta** `/cari-peserta`: `ManualSearch` + kartu hasil; logika sama dengan Scan lewat `useCheckin`.
- **Presensi:** kartu, bukan tabel; filter dilipat di balik tombol "Filter (n)"; KPI sebaris.
- **Akun:** profil, password, **Buka tampilan web lengkap** (preferensi per perangkat, kembali lewat tombol "Tampilan aplikasi"), dan Logout.

**Sidebar tidak berubah.** `/ots` dan `/cari-peserta` adalah layar lapangan, bukan menu sidebar baru; keduanya dijaga `RoleGuard` (`action.ots`, `action.manual_checkin`).

## A31 — Filter Kota & Batch tidak membedakan huruf besar/kecil (18 Oktober 2026)

- **Laporan pengguna:** filter Kota membedakan "Solo" dan "solo".
- **Penyebab:** tujuh RPC baca (`orders_page`, `export_orders_page`, `presensi_page`, `export_presensi_page`, `dashboard_summary`, `presensi_summary`, `tax_report`) memakai `o.city = $9` dan `o.batch = $7`, yaitu sama persis. Data produksi sendiri sudah konsisten; masalahnya ada pada teks filter yang diketik bebas.
- **Perbaikan (0043):** `lower(btrim(o.city)) = lower(btrim($9))` dan hal yang sama untuk batch, sehingga konsisten dengan Payment method yang sejak awal mengabaikan huruf besar/kecil.
- Pencocokan tetap utuh, bukan sebagian: "Sol" tidak menemukan "Solo". Frontend dan Worker tidak berubah.

## A32 — Batch berbagai panjang & cakupan Zoom/Tiket (18 Oktober 2026)

**Pertanyaan pengguna:** batch bisa 1, 2, 3, 4 karakter atau lebih. Apakah aman?

**Hasil uji parser:**
- Awalan kode berlebar tetap: produk 4 huruf + pengiklan 2 digit + tipe 2 huruf, dikunci `MASTER_CODE_RULES`. Seluruh sisa blok kode menjadi batch, tanpa batas panjang.
- Terbaca benar: `5`, `58`, `392`, `1001`, `123456`, `001` (nol di depan utuh), dan `58A`, juga tanpa spasi atau dengan huruf kecil.
- Batch kosong ditolak.
- Dikunci di `packages/shared/test/batch-length.test.ts`.

**Aturan tetap:** batch adalah teks, jadi `058` ≠ `58` (CLAUDE.md §4). Penulisan batch di nama produk OrderOnline harus konsisten.

**Penyamaan cakupan Zoom/Tiket:**
- Batch pada cakupan dicocokkan tanpa membedakan huruf besar/kecil (`candidateSettingKeys` dan penyimpanan memakai huruf besar), sehingga `58a` = `58A`, konsisten dengan filter (A31).
- Batch cakupan kini boleh huruf/angka, maksimal 10 karakter. Sebelumnya hanya angka, sehingga batch seperti `58A` tidak bisa dibuatkan aturan.
- Aturan lama tidak terpengaruh, karena batch produksi berupa angka.

## A33 — Nol di depan batch diabaikan (18 Oktober 2026)

**Keputusan pengguna.** Menggantikan CLAUDE.md §4 ("batch harus teks agar `001` tidak kehilangan nol") dan aturan A32 "058 ≠ 58".
- Nol **di depan** batch tidak berarti: `058` = `0058` = `00058` = `58`.
- Nol di tengah/belakang tetap berarti: `508`, `580`, `100`, `101`.

**KHUSUS batch.**
- Kode pengiklan tetap 2 angka dengan nol di depan (`01`, `02`, …). Parser memotong awalan berlebar tetap (produk 4 + pengiklan 2 + tipe 2) **sebelum** menormalkan sisanya, sehingga pengiklan tidak pernah tersentuh.
- Kode sesi, produk, Order ID, kode toko, dan payment identifier juga tidak berubah.

**Satu definisi di dua lapisan.**
- TypeScript: `normalizeBatch()` di `packages/shared/src/domain/text.ts`.
- SQL: `public.normalize_batch()` (0044).
- Aturannya: trim → hapus nol di depan selama masih ada karakter sesudahnya → huruf besar. `000` menjadi `0`, tidak pernah kosong.

**Dipakai di:**
- Parser (batch order dari webhook). `product_raw` tetap disimpan apa adanya.
- Product Name Generator (`058` menghasilkan `…SO58 - …`).
- Cakupan Zoom/Tiket (aturan `058` = `58`).
- Filter Batch di tujuh RPC baca (0044).
- Pengaman: `update orders` menormalkan batch lama; di produksi saat migrasi 0 baris berubah, karena belum ada batch diawali 0.

**Pemisah ` - `** tetap penanda tiga bagian **[kode+batch] - [sesi] - [kota]**. Penulisan tanpa spasi juga dibaca. Nama kota tidak boleh mengandung ` - ` (generator menolaknya). `Solo-Baru` tanpa spasi tetap aman.

## A34 — OTS cepat untuk meja registrasi (20 Oktober 2026)

**Keputusan pengguna.** Form OTS dibuat untuk meja registrasi acara tatap muka yang ramai, tanpa dropdown 200 produk.

**Konteks acara — sekali per perangkat.**
- Produk dipilih lewat pencarian/combobox (kode atau nama), bukan dropdown panjang.
- Pilihan **Acara Terakhir** (order seminar/hybrid 30 hari terakhir) mengisi produk + batch + sesi + kota sekaligus.
- Batch, sesi, dan kota wajib. Batch disimpan lewat `normalize_batch` (`058` = `58`).
- Konteks diingat per perangkat; ditampilkan sebagai satu baris `Meja: ...`.
- Jenis acara OTS selalu `Seminar Offline`.

**Data peserta.**
- Nama, No HP, Jumlah Tiket, Harga per tiket, dan Metode.
- Harga per tiket memakai 4 preset UI: 99.000, 100.000, 149.000, 150.000.
- Jumlah tiket 1–100; total bayar = harga × jumlah tiket.
- Metode memakai kode OTS yang sudah ada: `ots_tunai`, `ots_transfer`, `ots_qris` dengan label Tunai / Bank Transfer / QRIS. Bukan identifier fee OrderOnline (`bank_transfer`/`instant`).
- Simpan = order OTS Paid, `quantity = N`, `gross = net = harga × N`, langsung check-in `seminar_ots`.

**Akses baca konfigurasi (0046).** `can_read_configuration()` juga menerima `action.ots`, sehingga role yang hanya diberi izin OTS tetap bisa memuat daftar produk/sesi untuk form. Ini bukan izin menulis konfigurasi; produk tetap dibatasi `can_access_product`.

**RPC (0045).**
- `save_ots_registration` menerima `p_quantity` dan `p_unit_price` (dua parameter default di akhir).
- Pemanggil lama (11 argumen) tetap bisa memanggil fungsi yang sama selama masa transisi.
- Server menghitung ulang total dari harga satuan × jumlah tiket; total dari browser tidak dipercaya.
- Order OTS tetap tanpa e-payment fee, tax, atau platform fee.

**Edit.** OTS lama dengan nominal di luar 4 preset menampilkan opsi sementara `Tersimpan: Rp X` agar nominal tidak berubah diam-diam.

## A35 — Export Meta Conversion Audience (20 Oktober 2026)

**Keputusan pengguna.** Export data konversi untuk Meta Ads dari halaman Order, mengikuti filter yang aktif.

**Perilaku.**
- Tombol baru **Export Meta (Paid)** di samping Export CSV pada tabel Order. Tidak ada menu baru.
- Filter tanggal, pencarian, produk, pengiklan, jenis acara, batch, sesi, kota, dan payment method tetap berlaku.
- `app_status` selalu **dipaksa Paid**. Pending/Cancelled tidak pernah masuk file, walaupun tabel sedang menampilkannya.
- Kalau filter Status = Pending/Cancelled, tombol dinonaktifkan karena hasilnya pasti kosong.
- Format mengikuti `docs/Reference-Meta-Conversion-Audience-Format.md`:
  `order_id,fn,email,phone,ct,country,value,currency,event_name,event_time,data_processing_options`.
- CSV UTF-8 tanpa BOM, tanpa formula guard `'` (agar `+62` tidak rusak), plaintext (Meta yang menghash).
- Baris tanpa email dan tanpa No HP dilewati.
- Izin tetap `action.export_data`. Tidak ada migrasi database untuk fitur ini.

**Keamanan.** File contoh asli berisi PII dan sudah dihapus dari repo setelah formatnya dicatat di dokumen referensi. File export tidak boleh di-commit.


## A36 — Role legacy Admin Master & Staff dihapus (22 Oktober 2026)

**Keputusan pengguna.** Role `master_admin` ("Admin Master (Legacy)") dan `staff` ("Staff (Legacy)") dihapus. Keduanya sisa role MVP yang di-seed ulang di 0024 hanya untuk kompatibilitas. User-nya dipindah ke role yang setara.

**Pemetaan (migrasi 0047).**
- `master_admin` → `owner`. Aksesnya identik: penuh, semua produk, kelola Role & Tim, tanpa Reset Data.
- `staff` → `member`. User eks-Staff **ikut checklist izin Member yang sekarang**. Izin tidak digabung; perbedaannya dicatat di `RAISE NOTICE` migrasi.
- Penugasan produk per-user (`user_product_access`, `has_all_product_access`) tidak berubah. Sesi tetap berlaku karena role dibaca ulang dari database pada request berikutnya (0027).

**Keamanan.** ID `master_admin` dihapus dari semua daftar role penuh yang di-hardcode (`actor_has_permission`, `actor_can_product`, `save_role_permissions`, `admin_*_user`, `isMasterAdminRole`). Tanpa itu, role kustom baru ber-ID `master_admin` akan otomatis mendapat akses penuh.

**Lain-lain.**
- Tingkat "Master Admin" sekarang = `developer` atau `owner`. `scripts/create-master-admin.mjs` membuat akun `owner`.
- `ui.field_app` (A30) hanya untuk `pimpro` dan `member`.
- Klaim JWT `app_role = master_admin | admin | staff` di dokumen MVP (CLAUDE.md §8, 01/04) sudah digantikan role dinamis Fitur 2.0. Klaim itu hanya informasi; otorisasi selalu dari database.
- Deploy tertahan oleh `check-schema-version` sampai 0047 diterapkan di database produksi.

## A37 — Report Spend Iklan (22 Oktober 2026)

**Kebutuhan pengguna.**
- Pengiklan melaporkan biaya iklan per **batch**, lalu apps menghitung performanya dari order realtime.
- Satu batch mencakup semua sesi (seminar maupun webinar) dengan produk + kode pengiklan + batch yang sama.
- Diakses oleh akun Advertiser (hanya pengiklannya sendiri, A20) dan role managerial.

**Keputusan pengguna.**
- **Input:** pilih produk, isi batch, rentang tanggal (default kemarin s/d kemarin, karena yang dilaporkan H-1; bisa diubah dan dirapel beberapa hari), dan biaya iklan.
- **Pajak Iklan (PPN):** PPN tiap akun iklan berbeda, jadi pengiklan mengisinya per report dalam persen (mis. 11; 0 bila tanpa PPN). Spend yang diinput adalah angka **sebelum PPN**. Pajak = Spend × PPN%, Total Spend = Spend + Pajak. Form mengisi otomatis PPN dari report terakhir pengiklan itu.
- **Siapa:** input hanya role Advertiser. Role lain hanya melihat; role yang boleh melihat dipilih lewat checklist Konfigurasi Role. Checkbox "Input Biaya Iklan" hanya muncul untuk role Advertiser.
- **Order yang dihitung:** tanggal order (WIB, A24) di dalam rentang report.
  - Leads = jumlah Order ID (semua status).
  - Paid = order di rentang itu yang statusnya Paid **sekarang** (live; ikut naik bila order Pending dibayar belakangan).
  - Omzet = gross order Paid.
- **Turunan:** Profit/Boncos = Omzet − Total Spend (spend + PPN). Persentase = Profit ÷ Total Spend × 100 (total spend 0 → "-").
- **Data kosong:** tidak ada order = **0**, tidak pernah "tidak valid".
- **Rentang bertumpuk** (produk + batch + pengiklan sama): muncul notif "Tanggal, produk, dan batch sudah ada" dengan tombol **Cek Report** (tampilkan report yang ada) dan **Tambahkan Data Ini** (tetap simpan).
- **Total:** spend, PPN, dan Total Spend dijumlahkan; setiap order dihitung **sekali** walau tercakup beberapa report.
- **Koreksi:** Advertiser bisa edit dan hapus report miliknya sendiri.
- **Belum termasuk:** dashboard level produk + batch + semua pengiklan. Tata letaknya dibahas terpisah.

**Implementasi (0048).**
- Tabel baru `ad_spend_reports` (Data Dictionary §12a). Batch disimpan ternormalisasi (A33). Produk/pengiklan yang punya report dianggap dipakai (`master_is_used`).
- Izin baru:
  - `operasional.report_spend` "Report Spend Iklan".
  - `action.input_spend` "Input Biaya Iklan", dibatasi ke role `advertiser` di `save_role_permissions` (seperti `ui.field_app`) dan tidak ikut diberikan otomatis ke developer/owner.
  - Keduanya diberikan bawaan ke role `advertiser`.
- RPC `save_ad_spend_report` / `delete_ad_spend_report` (service_role, lewat Worker) mewajibkan akun memegang pengiklan. Cek tumpang tindih memakai advisory lock per (pengiklan, produk, batch).
- RPC baca `ad_spend_report` (security definer): scope produk + pengiklan diterapkan ulang persis seperti RLS, karena role yang hanya punya izin report ini tidak lolos RLS `orders`.
- `can_read_configuration()` ditambah `operasional.report_spend` supaya dropdown produk terbaca.
- Worker: `POST/PATCH/DELETE /api/ad-spend-reports` (API Contract §12a), error `AD_SPEND_OVERLAP` (409) dan `AD_SPEND_NOT_FOUND` (404).

**Menu baru.** "Report Spend Iklan" di seksi OPERASIONAL, setelah Product Name Generator (perubahan sidebar atas permintaan pengguna).

**Catatan deploy.** Deploy tertahan oleh `check-schema-version` sampai 0048 diterapkan di database produksi.
