# STATE — status eksekusi build

> **Cara pakai file ini:** ini satu-satunya tempat untuk melanjutkan pekerjaan. Baca bagian
> **Status**, lalu **Perintah cepat**, lalu **Pekerjaan berikutnya**. Perbarui tabel Status dan
> tambahkan satu baris di **Log** setiap kali satu fase selesai — jangan biarkan file ini basi.
>
> Dokumen yang mengikat tetap `CLAUDE.md` + `docs/`. File ini hanya mencatat **sejauh mana**
> pekerjaan sudah berjalan, bukan aturan baru.

Terakhir diperbarui: 2026-10-29
Repo: `C:\Users\MyBook Z Series\dvflow` (git `main`, sudah di-push ke `origin/main`; production live di https://dvflow.pages.dev)
Rencana lengkap: `~/.claude/plans/baca-file-claude-md-dan-glowing-pike.md`
Nama aplikasi: **dvflow** (`OrderOnline` tetap nama provider, bukan nama aplikasi)

---

## 1. Status

| Fase | Isi | Status |
|---|---|---|
| **P0** | Scaffold workspace (npm workspaces, tsconfig, docs AMENDMENTS, git init) | ✅ **PASS** |
| **P1** | `packages/shared` — aturan bisnis murni + unit test | ✅ **PASS** |
| **P2** | Migrasi SQL, RLS, RPC, seed, cron, CLI Master Admin | ✅ **PASS** |
| **P3** | Backend skeleton + auth (bcrypt via RPC, JWT ES256, sesi) | ✅ **PASS** |
| **P4** | Webhook intake + upsert order + adapter | ✅ **PASS** (adapter belum production-ready — VA-1) |
| **P5** | Akses peserta + scanner + check-in | ✅ **PASS** (1 butir tertunda: gambar QR — lihat §4) |
| **P6** | Config CRUD + profil + provisioning user | ✅ **PASS** |
| **P7** | Frontend: design system + shell + auth + halaman tiket peserta (QR) | ✅ **PASS** |
| **P8** | Dashboard, Order, Presensi | ✅ **PASS** |
| **P9** | Scanner, Generator, Report Tax, Profil, Konfigurasi Produk & Tax | ✅ **PASS** |
| **P10** | Cron, deploy, hardening | ✅ **PASS** — live di Cloudflare Pages (https://dvflow.pages.dev); deploy via GitHub Actions; migrasi 0057 sudah diterapkan di Supabase produksi |

**Tidak ada satu pun klaim production-ready.** Webhook belum terpetakan penuh dan custom JWT
Supabase belum dapat diverifikasi penuh; deployment sudah berjalan, tetapi kesiapan produksi
tetap mengikuti blocker di dokumen Acceptance Tests/Runbook.

---

## 2. Perintah cepat

```bash
# Tidak butuh Docker
npm install
npm run typecheck          # → PASS (shared, api, worker, functions, web)
npm test                   # -> 643 test lulus (277 api + 133 shared + 233 web)
npm run build              # → aplikasi web + assets/ticket-qr.js
npm run verify:ticket-qr   # → membuktikan artefak QR dapat dijalankan & dipindai
npm audit                  # → 0 vulnerabilities

# Database lokal (BUTUH Docker Desktop menyala)
npm run db:start                      # supabase start
npm run db:reset                      # migrasi 0001-0056 + seed.sql (untuk integration)
npm run test:integration              # 37 test (butuh SUPABASE_URL/SECRET_KEY/DB_URL; skip bila kosong)
npx supabase db reset --no-seed       # pgTAP mengasumsikan DB tanpa seed
npm run test:db                       # pgTAP -> 639 test lulus / 27 berkas

# Tooling developer (butuh database hidup)
npm run create-master-admin
npm run rotate-jwt-key
```

Bukti gate yang terakhir dijalankan (2026-10-13):

```text
supabase db reset        → 19 migrasi diterapkan tanpa error, seed.sql dimuat
supabase test db         → Files=5, Tests=187, Result: PASS
npm run typecheck        → PASS (termasuk functions/tsconfig.json)
npm test                 → shared: 96 lulus / 8 file | api: 145 lulus / 9 file
                           web: 86 lulus / 8 file (QR round-trip, sesi, sidebar, filter,
                             format, umpan balik scanner, dan test render seluruh halaman)
npm run build            → PASS; dist/assets/ticket-qr.js = 24,3 KB, IIFE klasik tanpa impor
npm run verify:ticket-qr → bundel hasil build dijalankan dengan DOM tiruan, SVG-nya
                           didekode ulang oleh `jsqr` → "/checkin/283033796" (29x29 modul)
npm run test:integration → 34 lulus / 3 file, dan LULUS JUGA saat dijalankan dua kali
                           tanpa `db reset` (bukti test membersihkan datanya sendiri):
                           auth (9): login bcrypt nyata, refresh, logout, ganti password,
                             provisioning via RPC, SQLSTATE DF0xx dipetakan, CSRF
                           webhook (10): 1 webhook = 1 Master Order, 10x ulang + 2x BERSAMAAN
                             tetap 1 baris, paid_at sekali, 422 status tak dikenal,
                             tax mapped (flat 4000 & percentage 0,7%), parse invalid,
                             webhook_logs tanpa PII
                           peserta/scanner/config (15): halaman tiket, 302 webinar +
                             presensi, 503 tanpa destination, check-in QR + manual,
                             DUA SCAN BERSAMAAN tetap 1 baris, filter `or=(ilike)`
                             PostgREST nyata, code_normalized dihitung database,
                             CODE_TAKEN / CODE_AMBIGUOUS, DELETE = nonaktif
npm audit                → found 0 vulnerabilities
create-master-admin.mjs  → user master_admin dibuat; verify_login('MASTERADMIN', ...) berhasil
```

---

## 3. Keputusan terkunci

Keputusan yang diambil bersama pengguna. Jangan diubah tanpa keputusan baru.

| # | Keputusan | Alasan ringkas |
|---|---|---|
| K1 | **Password pakai bcrypt di PostgreSQL**, bukan PBKDF2 di Worker | `workerd` memotong PBKDF2 di 100.000 iterasi dan CPU free plan hanya 10ms; 600k ≈ 250ms → login pasti gagal. Detail: `docs/AMENDMENTS.md` A1 |
| K2 | **Backend satu origin dengan frontend** (Cloudflare Pages Functions) sampai domain sendiri tersedia | Cookie refresh `HttpOnly`+`Secure`+`SameSite=Lax` tidak terkirim antar situs; `*.pages.dev` ↔ `*.workers.dev` akan merusak login. Kode tetap handler murni sehingga bisa pindah ke Worker terpisah tanpa ditulis ulang |
| K3 | **Halaman peserta = halaman tiket ringan terpisah** | Worker validasi → 302. Webinar langsung ke Zoom (server-side), Seminar ke halaman tiket kecil + QR client-side |
| K4 | **KPI**: Conversion Rate = Paid ÷ Leads, Attendance Rate = Hadir ÷ Paid | PRD menamai KPI tapi tidak memberi formula; ini turunan paling langsung dari rule yang ada. Keduanya `NULL` bila penyebut 0, bukan 0 |
| K5 | **Deploy lewat GitHub → Cloudflare auto-deploy** | Disiplin migrasi (`06 §7`) butuh file berversi; Pages Git memberi preview per branch + rollback |
| K6 | **Verifikasi DB pakai Supabase lokal via Docker** | Membuktikan migration, RLS, dan idempotency tanpa menyentuh data nyata |
| K7 | `orders.event_type` **diturunkan dari `kind`** ("seminar"→"Seminar Offline"), bukan dari nama baris konfigurasi | CHECK constraint Data Dictionary memaku dua literal itu, jadi mengganti nama event type di konfigurasi tidak merusak ingestion |
| K8 | Parser memakai **SEMUA baris konfigurasi (termasuk nonaktif)** | Menonaktifkan produk tidak boleh mencabut akses peserta yang sudah Paid. `active` hanya menggerbangi selector/generator dan rule tax baru |
| K9 | **Ambiguitas kode = invalid**, bukan dipilih salah satu | Parser dilarang fuzzy guess; kandidat dicatat di `webhook_logs` untuk diagnosa |
| K10 | Aritmetika tax yang **dipersist dihitung di SQL**; TypeScript hanya cermin untuk tampilan | Satu sumber kebenaran; keduanya diuji terhadap angka 05 §E01/E02 yang sama |
| K11 | **Semua penulisan lewat backend**; browser hanya membaca | `02 §14` memaksa memilih satu implementasi konsisten. Menghapus lima permukaan policy UPDATE |
| K12 | `vitest` dipatok **4.1.11**, bukan 3.2.7 | Versi 3 menarik `tinypool`/`@vitest/mocker` dengan 2 advisory critical; 4.1.11 di luar rentang terdampak |
| K13 | Kolom `*_normalized` adalah **generated column**, bukan kolom yang ditulis pemanggil | Menghapus seluruh kelas bug "normalisasi ditulis tidak konsisten". Detail: A5 |
| K14 | **Semantik merge webhook berulang**: `null` = "tidak disebutkan", bukan "kosongkan" | Sejalan dengan `shouldRecalculateTax()` di `packages/shared`; mencegah satu webhook parsial menghapus data benar. Detail: A7 |
| K15 | `upsert_order_webhook` menerima **satu argumen `jsonb` berbentuk objek kanonik** | Antarmuka RPC tetap stabil saat field kanonik bertambah, dan memaksa pemanggil mengirim objek kanonik (bukan key provider) |
| K16 | Sort/group RPC memakai **dynamic SQL dengan whitelist**, bukan nama kolom dari pemanggil | Delapan kolom sort presensi tidak dapat dinyatakan sebagai `ORDER BY` statis tanpa CASE raksasa; whitelist menjaga larangan "arbitrary DB-column sorting" |
| K17 | **Teks pencarian diperlakukan literal**: `%`, `_`, `\` di-escape | Mengetik `%` tidak boleh berarti "tampilkan semua baris" (melengkapi L06 di sisi perilaku) |
| K18 | Handler backend hanya berbicara dengan **port `Db`**, bukan PostgREST langsung | Membuat handler dapat diuji tanpa infrastruktur dan membuat perpindahan Worker ↔ Pages Functions tidak menyentuh logika |
| K19 | **CSRF strict**: endpoint cookie-authenticated wajib mengirim header `Origin` yang cocok | `SameSite=Lax` saja tidak cukup sebagai satu-satunya pertahanan (04 §8). Login dikecualikan karena belum terautentikasi cookie, dan mewajibkannya akan mematikan login dari klien non-browser tanpa menambah pertahanan |
| K20 | Hash token sesi memakai **SHA-256**, bukan bcrypt/PBKDF2 | Token 256 bit acak tidak dapat ditebak, jadi KDF lambat hanya membakar CPU di setiap refresh (free plan) tanpa menambah keamanan |
| K21 | Access JWT **diverifikasi sendiri** dengan public key yang diturunkan dari private key | Tidak perlu hosting JWKS atau secret tambahan; `kid` tetap diperiksa sehingga rotasi kunci mematikan token lama |
| K22 | Unit test memakai `Db` **tiruan in-memory**; integrasi memakai PostgREST nyata | Unit test menguji perilaku HTTP handler (cepat, tanpa Docker); semantik database diuji oleh pgTAP + test integrasi. Pembagian ini eksplisit supaya tidak ada klaim cakupan yang berlebihan |
| K23 | **`app_status` diturunkan dari status ORDER**, tidak pernah dari `payment.status` | PRD §52: `pending`→Pending, `processing`/`complete`→Paid, `cancelled`→Cancelled. `payment.status` (`unpaid`/`paid`) tidak dipakai dan tidak disimpan. Ditegaskan pengguna 2026-10-13 |
| K24 | `product_raw` = **nama produk di OrderOnline** (`payload.product_data.name`) | Keputusan pengguna 2026-10-13; memakai key yang teramati pada sample, bukan ditebak |
| K25 | Adapter hanya membaca **key yang teramati**; nilai yang tidak ada menjadi `null` | 03 §2 dan 06 §13. Tidak ada fallback "cari yang mirip" di lapisan mana pun |
| K26 | Storefront banyak produk → `product_raw` **NULL**, order tetap tersimpan, parse `invalid` | Perilaku ini bukan tebakan: itu jalur yang sudah dikontrak untuk produk tak terbaca (01 §9). Akses acara ikut tertutup, jadi tidak ada peserta yang dilayani berdasarkan data karangan |
| K27 | `paymentIdentifier` = label provider bila ada, jika tidak `payment.method` | Key keduanya teramati. Konsekuensinya didokumentasikan di VA-1: pada CO Form identifier = `payment.method` apa adanya (`bank_transfer`), jadi operator mendaftarkan nilai itu di Konfigurasi Tax |
| K28 | `webhook_logs` **tanpa PII**: hanya Order ID, status, produk, pembayaran, dan alasan kegagalan | 04 §14 dan 02 §12 meminta konteks seperlunya. Log bukan tempat menyimpan nama/WA/email; `parse_candidates` tetap dicatat supaya ambiguitas kode dapat didiagnosa (K9) |
| K29 | Konfigurasi: **baca langsung lewat RLS, tulis lewat backend**. Tidak ada `GET /api/config/*` | `02 §14` dan K11. Menambah GET hanya akan menduplikasi permukaan akses yang sudah ada, karena RLS sudah memberi `authenticated` hak baca |
| K30 | `DELETE` konfigurasi = `active=false`, tanpa endpoint hard delete | `01 §8` dan `03 §12`; order historis harus tetap dapat dijelaskan baris lama |
| K31 | Pemeriksaan identitas & ambiguitas dilakukan **eksplisit di handler** sebelum menulis | Pesannya jadi tepat (`CODE_TAKEN` vs `CODE_AMBIGUOUS`), dan guard ambiguitas tidak salah melaporkan duplikat sebagai ambiguitas. Unique index database tetap jaring terakhir (dipetakan ke `CODE_TAKEN`) |
| K32 | Peran untuk menulis konfigurasi dibaca dari **baris `users`**, bukan dari claim token | Klaim yang berbohong tidak menolong (04 §5); sama seperti pola `admin_create_user` |
| K33 | Halaman peserta dirender server sebagai HTML minimal: escaping eksplisit + CSP tanpa `script-src` | React tidak meng-escape di jalur ini, jadi L07 harus dijaga manual (04 §9). Nama/kota/produk berasal dari webhook — input tak terpercaya |
| K34 | Pencarian scanner memfilter **hanya `Seminar Offline`**, bukan status | `03 §10` hanya melarang order webinar muncul. Order Pending justru perlu terlihat supaya operator tahu sebab penolakannya; check-in-nya tetap ditolak server (`ORDER_NOT_PAID`) |
| K35 | `GET /checkin/:orderId` **tidak pernah mengubah apa pun** | `03 §9`: mutasi hanya lewat POST. Halaman itu untuk orang yang membuka isi QR dengan kamera biasa |
| K36 | `webinar_destination` wajib HTTPS; pengecualian localhost hanya lewat `ALLOW_INSECURE_WEBINAR_DESTINATION=true` | `05 §F08`. Destination yang tidak aman diperlakukan sama seperti destination yang tidak ada: tanpa presensi, tanpa redirect |
| K37 | **QR = SVG satu `<rect>` per modul gelap**, dibuat di browser | SVG dirender semua browser tanpa canvas/WASM/API khusus. Satu rect per modul membuat hasilnya dapat DIPERIKSA: test membaca markupnya kembali, menyusun matriks, lalu mendekodenya (K38) |
| K38 | `jsqr` dipakai **hanya sebagai decoder pembanding** di test & verifikasi, bukan saat runtime | Encoder boleh dari library (`qrcode`), tetapi keyakinannya harus datang dari implementasi LAIN. Tanpa decoder independen, "QR-nya benar" hanya klaim |
| K39 | Skrip QR dibangun **terpisah** sebagai IIFE klasik satu berkas (`vite.ticket.config.ts`) | Sebagai bagian build multi-entry, skrip itu keluar sebagai ES module yang mengimpor chunk runtime — gagal bila dimuat `<script src>` biasa. Satu berkas klasik juga lebih tahan gagal di Wi-Fi acara |
| K40 | **Access JWT hanya di memori**; token awal hanya dari refresh cookie | `CLAUDE.md §8`. Tidak ada `localStorage`/`sessionStorage`/cookie yang ditulis JavaScript; memuat ulang halaman menukar cookie menjadi token baru |
| K41 | **Tidak ada endpoint baca di backend** untuk Order/Presensi/Dashboard/Report Tax/konfigurasi | `02 §14` + K29: browser membaca langsung dari Supabase lewat RLS memakai access JWT. Yang lewat backend hanya penulisan dan hal yang butuh service key |
| K42 | Warna badge jenis acara (Seminar ungu, Webinar biru) memakai nilai yang **dipilih di sini** | Guideline §18 menyebut keduanya tanpa memberi hex, dan §3 tidak memuatnya. Nilainya dipilih dengan saturasi rendah agar sejalan soft tone lain, dan dicatat supaya tidak dianggap bahasa visual baru |
| K43 | Tabel Order dibaca lewat RPC `orders_page`, bukan query PostgREST yang disusun di browser | Satu definisi filter (PRD §41), whitelist sort ditegakkan server (CLAUDE.md §15), ringkasan dihitung dari himpunan yang sama, dan tidak ada permukaan escaping kedua. Dicatat sebagai A9 |
| K44 | Produk/Pengiklan/Event Type/Sesi = **pilihan dari konfigurasi aktif**; Batch, Kota, Payment Method = teks | Yang pertama tidak boleh diketik bebas maupun di-hardcode (CLAUDE.md §4) dan hanya baris aktif ditawarkan (D02). Yang kedua nilainya berasal dari order, dan dokumen tidak menentukan sumber daftar pilihannya — jadi tidak dikarang |
| K45 | Payment method dicocokkan **sama persis** (mengabaikan besar/kecil huruf dan spasi tepi), tanpa pencocokan mendekati | Sejalan dengan aturan identifier tax (01 §11). Saran ejaan ditampilkan dari identifier fee rule yang aktif |
| K46 | KPI Presensi memakai filter yang sama **tanpa** filter Hadir/Belum Hadir | Filter itu pemilih BARIS, bukan filter KPI: kalau ikut menyaring, memilih "Hadir" akan selalu menampilkan "Belum Hadir = 0" dan angkanya kehilangan arti. Pembuangannya eksplisit lewat `toCommonFilters`, bukan tersembunyi |
| K47 | Dashboard menyorot **satu** KPI: Paid | Guideline §43 membolehkan satu atau maksimal dua; Paid adalah angka yang paling menentukan tindakan operasional |
| K48 | Test render (jsdom + testing-library) menguji **kontrak tampilan**: urutan kolom PRD §45, T1–T10 §103, dan tidak adanya kontrol signup/forgot (A10) | Kontrak yang berbentuk tampilan tidak tertangkap test logika. Ini menutup butir yang ditunda di P7 |
| K49 | Pembacaan QR memakai **`jsqr`**, bukan `BarcodeDetector` | `BarcodeDetector` tidak ada di Firefox dan Safari. Satu jalur yang jalan di semua browser lebih penting daripada kecepatan yang tidak terasa bedanya untuk scan tiket. Konsekuensinya `jsqr` naik dari devDependency menjadi dependency runtime |
| K50 | QR yang sama tidak diproses ulang selama **3 detik** | Ini jeda TEKNIS, bukan aturan produk: server tetap idempoten dan scan berulang tetap sah (peserta boleh keluar-masuk). Tanpa jeda, QR yang masih di depan kamera mengirim puluhan permintaan per detik dan operator tidak sempat membaca hasilnya |
| K51 | Penolakan Report Tax untuk staff ditampilkan sebagai halaman **"Tidak punya akses"**, bukan dengan menyembunyikan menu | Sidebar dipaku dokumen (CLAUDE.md §5) dan tidak boleh diubah per peran. Pagarnya di dalam RPC `tax_report`; menyembunyikan menu hanya memberi rasa aman palsu (CLAUDE.md §9) |
| K52 | Halaman konfigurasi memakai **bagian bertumpuk**, bukan tab | Guideline tidak mendefinisikan pola tab, jadi tidak ada komponen baru yang dikarang. Satu bagian = satu sumber daya = satu aksi `+ Tambah`, sesuai PRD §62 |
| K53 | `Delete` konfigurasi dilabeli **"Nonaktifkan"**, dan barisnya tetap terlihat dengan status | Baris tidak dihapus (01 §8); menyebutnya "Hapus" akan membuat operator mengira datanya hilang, padahal ia masih dipakai untuk menjelaskan order lama |
| K54 | `eventTypes` (KODE) dan `eventTypeNames` (NAMA) dipisah di daftar konfigurasi | Generator butuh kode (`SO`) karena nama kanonik memakai kode; filter butuh nama (`Seminar Offline`) karena itulah isi kolom `orders.event_type`. Menukar keduanya membuat generator menolak semua input dan filter tidak pernah cocok — bug ini ditemukan test, bukan di produksi |
| K55 | Pencarian & pengurutan daftar konfigurasi dikerjakan **di klien** | Tabel konfigurasi adalah data acuan yang jumlahnya kecil dan sudah dibaca utuh untuk pilihan filter. Aturan "jangan memuat seluruh database" (CLAUDE.md §14) menyasar data operasional tak terbatas (Order, Presensi) |
| K56 | Setiap rute di luar `/api` memerlukan **berkas Pages Function sendiri** | `/access/*` dan `/checkin/*` tidak tertutup oleh `functions/api/[[path]].ts`. Tanpa berkasnya, keduanya jatuh ke fallback SPA dan mengembalikan `index.html` — bukan halaman peserta. Ditemukan `scripts/smoke-pages-local.mjs`, bukan setelah deploy. Handler bersama ada di `functions/_lib/handler.ts` (folder berawalan `_` tidak dirutekan) |
| K57 | `_headers` hanya berlaku untuk **aset statis** | Response Pages Functions mengatur headernya sendiri, sehingga halaman peserta tetap memakai CSP-nya yang lebih ketat (tanpa `unsafe-inline` untuk skrip) |
| K58 | `.dev.vars` **wajib** memakai nilai satu baris (bentuk dotenv), bukan blok multi-baris | Bentuk multi-baris membuat berkas "terbaca" tetapi nilainya tidak sampai ke Worker: gejalanya webhook selalu 404 dengan secret yang sebenarnya benar. Nilai PEM ditulis lewat `JSON.stringify` sehingga `\n` menjadi escape |
| K59 | Perubahan konfigurasi deploy diuji lewat `scripts/smoke-pages-local.mjs` terhadap `wrangler pages dev` | Inilah satu-satunya cara membuktikan prioritas routing Functions vs fallback SPA, penerapan `_headers`, dan webhook end-to-end lewat jalur deploy — tanpa menunggu deploy sungguhan |
| K60 | Kamera: kegagalan dibedakan per sebab (konteks tidak aman / izin ditolak / tanpa kamera / kamera sibuk) | Aplikasi berjalan di BROWSER, jadi kamera hanya ada di konteks aman (HTTPS) dan setelah izin diberikan. "Gagal" generik tidak memberi panitia langkah apa pun; setiap jenis punya langkahnya sendiri, dan tombol coba lagi hanya muncul bila percobaan ulang memang masuk akal |
| K61 | Assertion pgTAP **tidak boleh** ditulis di dalam blok `DO` | pgTAP menghitungnya sebagai bagian rencana tetapi tidak mencetak hasilnya, sehingga berkas gagal dengan "Bad plan. You planned N tests but ran M". Assertion cron ditulis sebagai pernyataan biasa, dan berkas itu memang memerlukan pg_cron (retensi adalah syarat, bukan pelengkap) |
| K62 | `wrangler` dinaikkan ke **4.149.0**, lebih baru dari batas "2 minggu" | Versi 4.102–4.143 membawa advisory `undici` (3 high). Batas 2 minggu ada untuk menghindari rilis yang belum teruji, bukan untuk mempertahankan versi yang sudah diketahui rentan. `wrangler` adalah devDependency — ia tidak pernah masuk bundle produksi — dan smoke test jalur deploy dijalankan ulang setelah kenaikan ini untuk memastikan perilakunya tidak berubah |
| K63 | `signing_keys_path` di Supabase **lokal** dibiarkan nonaktif | Sudah dicoba: menunjuk berkas JWK ES256 buatan kita sendiri membuat container `supabase_auth` UNHEALTHY di CLI 2.90, sehingga seluruh stack gagal start. **Efek sampingnya penting:** pembacaan data lewat browser (K41) belum dapat dijalankan terhadap Supabase lokal — PostgREST menolak access JWT kita dengan `PGRST301`. Di project sungguhan jalur ini didukung lewat Dashboard. Untuk pengembangan frontend lokal, arahkan `VITE_SUPABASE_*` ke project dev sungguhan yang signing key-nya sudah dipasang, atau teliti dulu format JWK yang diterima CLI versi ini |

### Pertanyaan yang SENGAJA belum diputuskan (jangan dikarang)

| # | Pertanyaan | Status saat ini |
|---|---|---|
| O1 | Webhook terlambat (Paid lalu datang Pending): ikut dokumen apa adanya, atau ada aturan "Paid tidak boleh turun"? | Mengikuti dokumen apa adanya (status terakhir menang) + transisi dicatat di `webhook_logs`. Perlu keputusan pengguna bila ingin berbeda |
| O2 | `net_amount` bisa negatif bila flat fee > gross | Formula diikuti apa adanya, tidak diklem; skema tidak memberi CHECK pada `net_amount` |
| O3 | `ALLOW_MASTER_ADMIN_CREATE_MASTER` | Tetap `false` (default dokumen) — sudah diuji: `MASTER_ADMIN_CREATE_FORBIDDEN` |
| O4 | Apakah KPI **Gross/Tax/Net** di Dashboard menjumlah seluruh order atau hanya Paid? | Sementara menjumlah **seluruh order yang lolos filter** (konsisten dengan "semua KPI mengikuti filter aktif"); perlu keputusan pengguna. Terdokumentasi di `0016_read_rpcs.sql` |
| O5 | Order storefront memuat **banyak produk**, sedangkan Master Order hanya punya satu `product_raw` | **Dianggap selesai secara praktis** (2026-10-13): webhook yang dipakai adalah **CO Form**, dan satu produk = satu sesi seminar/webinar. Order storefront berisi banyak produk tetap belum ditangani — jangan dikarang bila nanti muncul |
| O6 | Asal `product_raw` pada payload | **Dijawab pengguna (2026-10-13):** `product_raw` = nama produk di OrderOnline (`payload.product_data.name` pada CO Form). Pola `KM01SO392 - S1 - Solo` dikonfirmasi sebagai pola yang akan diterapkan |
| O7 | **Urutan/struktur pola** produk: tetap `[P][A][T][BATCH] - [SESSION] - [CITY]`, atau diubah? | **Diputuskan pengguna 2026-10-13: pakai pola dokumen apa adanya.** Mapping kode→nama tetap dari Konfigurasi Produk. Alasan lengkap di `VA-1` |
| O8 | **`payment_identifier` diturunkan dari apa?** | **Terjawab sebagian:** identifier = label provider bila ada, jika tidak `payment.method` (`bank_transfer`, `qris`, …). Operator mendaftarkan nilai itu di Konfigurasi Tax (06 §15) — sudah diuji end-to-end dengan fee rule nyata. Sisa pertanyaan hanya **granularitas** (fee per bank) yang menunggu `payment.data`/`channels` terisi di sample |
| O9 | Apakah fee dihitung dari `total_price` (termasuk ongkir) atau nilai produk saja? | Sementara memakai `total_price` — basis fee pembayaran adalah yang dibayar pelanggan. Satu baris di adapter bila keputusannya berbeda |
| O10 | ~~Gambar QR pada halaman tiket peserta belum dirender~~ | **Selesai di P7** (K37–K39), termasuk verifikasi artefaknya (`npm run verify:ticket-qr`) |

---

## 4. Blocker

### Blocker

| Blocker | Menghambat | Yang dibutuhkan |
|---|---|---|
| **Deploy ke Cloudflare** | P10 selesai | Akun Cloudflare + nama project Pages + secret produksi (`SUPABASE_*`, `APP_JWT_*`, `ORDERONLINE_WEBHOOK_SECRET`). Konfigurasi dan verifikasinya sudah siap; yang belum hanya menjalankannya |
| **Project Supabase nyata** | Trust JWT, RLS teruji, cron terverifikasi | URL + publishable/secret key project; import public key hasil `npm run rotate-jwt-key` sebagai signing key ES256 |
| `BLOCKED_BY_EXTERNAL_ORDERONLINE_PAYLOAD` (**sebagian besar terbuka**) | Klaim production-ready P4 | Ingestion berjalan dan teruji end-to-end. Masih kurang: sample `processing`/`complete`/`cancelled`, payment method kedua, dan sample paid dengan `payment.data`/`channels` terisi bila fee per bank diinginkan |
| **Belum di-push ke remote** | Backup & kolaborasi | Commit lokal sudah ada (seluruh pekerjaan aman di git), tetapi belum ada remote. Risiko kehilangan hanya bila mesinnya hilang: siapkan repo GitHub lalu `git push -u origin main` |

### Butir yang sengaja belum selesai (bukan blocker)

| Butir | Alasan |
|---|---|
| **Uji kamera di perangkat nyata** | jsdom tidak punya kamera, jadi jalur `getUserMedia` + loop decode tidak tercakup test otomatis. Yang terbukti: decoder `jsqr` (round-trip dari sumber dan artefak), ekstraksi Order ID, pemetaan kegagalan izin, dan jalur Manual Search. Wajib dicoba di ponsel sebelum acara pertama |
| Variasi browser halaman peserta | Halaman tiket memakai HTML + SVG sederhana tanpa framework; sudah diverifikasi di tingkat markup, tetapi belum dibuka di Safari/Firefox sungguhan |

Catatan: `.claude/settings.local.json` memuat API key OpenRouter plaintext. Sudah di-`.gitignore`
sehingga tidak ikut ter-commit, tetapi key itu sudah muncul di transkrip sesi — sebaiknya
dirotasi bila file itu pernah dibagikan.

Catatan platform (bukan blocker, tapi harus diketahui): pada image Supabase lokal ini
(PostgreSQL 17.6) **memanggil fungsi yang hak `EXECUTE`-nya dicabut membuat backend segfault**.
Tidak dapat dicapai lewat PostgREST (fungsi tanpa EXECUTE tidak diekspos), jadi tidak menghambat
aplikasi — tetapi membuat test harus memakai `has_function_privilege`. Detail:
`supabase/tests/README.md`.

---

## 5. Yang sudah dibangun

### Root

| File | Fungsi |
|---|---|
| `package.json` | npm workspaces (`packages/*`, `apps/*`), script `typecheck`/`test`/`lint`/`build` + `db:start`/`db:reset`/`test:db`/`create-master-admin`/`rotate-jwt-key`. `pg` sebagai devDependency untuk script provisioning |
| `tsconfig.base.json` | Konfigurasi TS bersama. `strict` + `noUncheckedIndexedAccess` — sengaja, karena akses array adalah tempat bug parser bersembunyi |
| `.env.example` | Hanya `VITE_*` (publik). Tidak boleh ada secret backend |
| `README.md` | Ringkasan + urutan baca dokumen + struktur + perintah + status blocker |
| `.gitignore` | `.env*`, `node_modules/`, `dist/`, `build/`, `.claude/settings.local.json`, `supabase/.temp/` |

### `docs/AMENDMENTS.md`

Delapan deviasi terkunci dari dokumen kontrak:

- **A1** PBKDF2 600k → bcrypt di PostgreSQL
- **A2** kolom `users`: `password_hash` + `password_algo`
- **A3** claim JWT: tambah `iss` + `aud` + header `kid`
- **A4** objek database tambahan: seluruhnya **fungsi**, bukan tabel
- **A5** kolom `*_normalized` dihitung database (generated), bukan ditulis pemanggil
- **A6** `set_updated_at()` + trigger `updated_at`
- **A7** semantik merge webhook berulang (5 butir)
- **VA-1** pemetaan payload yang sudah terverifikasi **dan daftar yang masih kurang**
  (bukan amendemen; catatan pengamatan)

### `packages/shared` — aturan bisnis murni, nol dependensi runtime

| File | Isi |
|---|---|
| `src/types.ts` | `CanonicalOrderWebhook`, `AppStatus`, `EventKind`, `ProductConfigSet`, `MatchedFeeRule`, `EVENT_TYPE_NAME_BY_KIND` |
| `src/domain/constants.ts` | Semua angka dokumen: 50/100 baris, 300ms debounce, min 2 karakter, 20 hasil scanner, T1..T10=10, retensi 30 hari / log 7 hari, sesi 7 hari, JWT 30 menit, password min 8, batas panjang teks |
| `src/domain/text.ts` | `toTrimmedOrNull`, `collapseWhitespace`, `normalizeCode` (trim+uppercase, tanpa buang spasi tengah), `CODE_PATTERN` |
| `src/domain/status.ts` | Mapping kanonik + `UnsupportedOrderStatusError` (`UNSUPPORTED_ORDER_STATUS`) + `isPaidStatus` |
| `src/domain/payment-identifier.ts` | Normalisasi trim/lowercase/collapse; exact-only, tanpa fuzzy |
| `src/domain/product-name.ts` | `buildProductName` + `validateProductNameInput` + `PRODUCT_SEGMENT_SEPARATOR` |
| `src/domain/product-parser.ts` | **Modul paling kritis.** `parseProductRaw`, `listCodeCombinations`, `findAmbiguousCodeCombinations`, `describeCodeCombination` |
| `src/domain/tax.ts` | `roundMoney`, `calcTaxAmount`, `calculateTax`, `shouldRecalculateTax` |
| `src/domain/attendance.ts` | `attendanceStatusLabel` (Hadir/Belum Hadir/Pending/Cancelled), `selectLatestTimestamps` |
| `src/domain/checkin-qr.ts` | `buildCheckinPath`, `buildCheckinUrl`, `extractOrderIdFromQrPayload` |
| `src/domain/validate.ts` | Validator objek kanonik webhook, ganti password, dan kode konfigurasi |
| `src/index.ts` | Re-export seluruh permukaan publik |

Test `packages/shared/test` — 96 test, dinamai mengikuti acceptance case (C03–C11, D01–D06, E01–E09,
I02–I07, G03, C08/C09, plus round-trip generator↔parser).

### `supabase/` — database (P2)

| Berkas | Isi |
|---|---|
| `config.toml` | Konfigurasi Supabase lokal (`project_id = "dvflow"`, API 54321, DB 54322) |
| `migrations/0001_extensions.sql` | pgcrypto, pg_trgm, pg_cron + `normalize_code`, `normalize_payment_identifier`, `set_updated_at` |
| `migrations/0002…0012` | `users` (A2), `app_sessions`, `products`, `advertisers`, `event_types` (+seed SO/WO), `sessions_config` (+seed S1/S2/ST), `payment_fee_rules` (unique parsial `where active`), `orders` (semua kolom + CHECK), `attendance_events` (unique parsial seminar, FK RESTRICT), `app_settings` (CHECK key `webinar_destination::%`), `webhook_logs` |
| `migrations/0013_indexes.sql` | Index minimum `02 §13` + pendukung sort/pagination |
| `migrations/0014_functions_domain.sql` | `app_role()`, `is_app_user()`, `calc_tax_amount()` |
| `migrations/0015_rls_policies_and_grants.sql` | **Paling keamanan-kritis.** RLS di 11 tabel, `revoke all` dari anon/authenticated, 7 policy SELECT, revoke kolom kredensial, cabut EXECUTE default PUBLIC, `alter default privileges` untuk migrasi berikutnya |
| `migrations/0016_read_rpcs.sql` | `presensi_page`, `dashboard_summary`, `tax_report` (SECURITY INVOKER, whitelist sort/dimensi, escape wildcard) |
| `migrations/0017_write_rpcs.sql` | `upsert_order_webhook`, `checkin_seminar`, `verify_login`, `admin_create_user`, `change_password` (SECURITY DEFINER, hanya `service_role`; kode error DF001–DF014) |
| `migrations/0018_cron_retention.sql` | Retensi attendance 30 hari + webhook_logs 7 hari, dijadwalkan defensif bila pg_cron absen |
| `migrations/0019_search_indexes.sql` | 9 index GIN pg_trgm untuk pencarian substring |
| `seed.sql` | **Data development saja** (produk/pengiklan/fee rule contoh). Tidak membuat user — larangan "password default" |
| `tests/01…05_*.sql` | 187 test pgTAP: RLS/grant, idempotensi webhook, check-in seminar, snapshot tax, RPC baca + paritas filter |
| `tests/README.md` | Cara menjalankan + dua jebakan image (segfault EXECUTE, pgtap di `public`) + cakupan yang belum tertutup |

### `packages/api` — handler HTTP murni (P3), nol dependensi runtime

| Berkas | Isi |
|---|---|
| `src/router.ts` | Pencocokan rute (mendukung `:param` untuk P4/P5), pemeriksaan same-origin, verifikasi Bearer, dan **satu-satunya** tempat error berubah menjadi response |
| `src/routes.ts` | Tabel rute: login, refresh, logout, change-password, profile GET/PATCH, internal users |
| `src/auth/jwt.ts` | Mint + verify access JWT ES256 (Web Crypto), claim lengkap + `iss`/`aud`/`kid` (A3), `alg: none` ditolak, `kid` asing ditolak |
| `src/auth/session-token.ts` | Token sesi 32 byte CSPRNG + hash SHA-256 |
| `src/auth/handlers.ts` | Empat endpoint auth; password selalu lewat RPC (A1) |
| `src/profile/`, `src/internal-users/` | Profil sendiri (hanya `display_name` + `avatar_emoji`) dan provisioning master_admin |
| `src/http/` | Cookie refresh (atribut 04 §7), CSRF Origin, bentuk response, katalog error (13 kode) |
| `src/db/` | Port `Db` + implementasi PostgREST (`fetch` mentah, tanpa `supabase-js`) |
| `src/users.ts` | Bentuk user + `requireActiveUser` (token 30 menit tidak boleh hidup lebih lama dari akun) |
| `test/` | 50 test unit (A01–A10, B01–B07, L01/L02, CSRF, JWT) + 9 test integrasi |

### `packages/api/src/webhooks` — ingestion (P4)

| Berkas | Isi |
|---|---|
| `adapter.ts` | **Satu-satunya berkas yang menyentuh nama key provider.** Memetakan kedua bentuk sample ke objek kanonik; nilai yang tidak ada menjadi `null`; `productRaw` storefront sengaja NULL (K26); normalisasi timestamp Extended JSON / `YYYY-MM-DD HH:mm:ss` |
| `handlers.ts` | `POST /api/webhooks/orderonline/:webhookSecret`: secret dibandingkan tanpa keluar lebih awal (salah → **404**, gagal-tertutup bila env kosong), batas body 64 KiB, validasi kanonik, status tak dikenal → **422**, parse produk dengan konfigurasi apa adanya (K8), upsert lewat RPC, `webhook_logs` best-effort tanpa PII (K28) |

### `packages/api/src/participant`, `scanner`, `config` (P5, P6)

| Berkas | Isi |
|---|---|
| `participant/pages.ts` | Halaman tiket + halaman error peserta (03 §15): HTML minimal, escaping eksplisit (`escapeHtml`), CSP `default-src 'none'` tanpa script, `no-store`, `noindex`, tanpa email/WA |
| `participant/handlers.ts` | `GET /access/:orderId` (tolak bila bukan Paid / parse invalid; webinar → presensi + **302**, destination hilang atau non-HTTPS → 503 **tanpa** presensi; seminar → halaman tiket), `GET /checkin/:orderId` (tanpa mutasi), `POST /checkin/:orderId` lewat RPC `checkin_seminar` |
| `scanner/handlers.ts` | `GET /api/scanner/search` (hanya Seminar Offline, maks 20, `or=(ilike)`, teks dibersihkan, status check-in disertakan) dan `POST /api/scanner/manual-checkin` (validasi identik dengan QR — H09) |
| `config/resources.ts` | Satu tabel deskriptor untuk kelima sumber daya + validasi (kode wajib alfanumerik, `kind`, `fee_type`, `fee_value`) |
| `config/handlers.ts` | `POST`/`PATCH`/`DELETE(=nonaktifkan)`; pemeriksaan identitas & ambiguitas **sebelum** menulis; peran dibaca dari baris `users` |
| `http/postgrest-filter.ts` | Pembersih teks pencarian + penyusun filter `or=(ilike)` — satu tempat untuk mencegah teks pengguna mengubah arti filter (L06) |

### `apps/web` — aplikasi (P7)

| Berkas | Isi |
|---|---|
| `src/styles.css` | Token desain dari guideline §3/§5/§4 sebagai `@theme` Tailwind v4 (warna, radius, bayangan, font) |
| `src/ui/` | Design system bersama: Button, Field (Input/Select), Card/KpiCard, Badge + pemetaan warna status, DataTable, FilterBar/FilterChip, Modal/Drawer, Skeleton/EmptyState/ErrorState, Toast |
| `src/layout/` | AppShell (sidebar 230px, panel untuk layar sempit), Sidebar, PageHeader, dan `navigation.ts` yang memaku urutan menu |
| `src/lib/` | `api.ts` (klien backend), `session.ts` (access token di memori + refresh), `supabase-rest.ts` (baca langsung lewat RLS), `env.ts`, `useSession.ts` |
| `src/pages/` | Login, Logout, dan `PlaceholderPage` untuk halaman P8/P9 |
| `src/ticket/` | `qr.ts` (payload → SVG) + `entry.ts` (skrip halaman peserta) |
| `test/` | 25 test: QR round-trip lewat `jsqr`, mesin sesi, dan daftar menu |
| `public/_redirects` | Fallback SPA untuk Cloudflare Pages (prioritasnya diuji di P10) |

### `apps/worker` dan `functions/`

Dua entry tipis ke `@dvflow/api` — tanpa logika. `functions/api/[[path]].ts` adalah jalur
produksi MVP (satu origin dengan frontend → cookie refresh terkirim, tanpa CORS); `apps/worker`
dipakai saat domain sendiri aktif. Handler di-cache per objek `env`, sehingga kunci JWT tidak
diimpor ulang setiap permintaan.

### `scripts/`

| File | Fungsi |
|---|---|
| `create-master-admin.mjs` | Master Admin pertama lewat `SUPABASE_DB_URL`; bcrypt di database; tidak punya password default; bekerja di TTY maupun pipe |
| `rotate-jwt-key.mjs` | Generate pasangan kunci ES256 (P-256), cetak PKCS#8 PEM untuk Worker secret + public JWK untuk Supabase, plus langkah rotasi |

### Model RLS yang terpasang (K11)

Browser hanya SELECT. `orders`, `attendance_events`, tujuh tabel konfigurasi: policy SELECT
`is_app_user()`. `users`: hanya baris sendiri **dan** hanya kolom aman (`password_hash`,
`password_algo` di-REVOKE tingkat kolom). `app_sessions`, `webhook_logs`, `app_settings`: tanpa
grant dan tanpa policy. Tidak ada satu pun policy tulis; seluruh penulisan lewat RPC
`SECURITY DEFINER` milik `service_role`.

---

## 6. Pekerjaan berikutnya — menyelesaikan P10 di lingkungan nyata

Konfigurasi deploy sudah ada dan **sudah diverifikasi secara lokal** lewat
`npm run smoke:local` (18 langkah, termasuk webhook end-to-end melalui jalur deploy). Yang
tersisa adalah menjalankannya terhadap akun & project nyata.

**Langkah 0 — isi `.env.setup.local`.** Dibuat dengan `node scripts/make-setup-file.mjs`.
Isinya delapan nilai yang hanya pemilik project yang tahu (repo GitHub, project Supabase,
akun Cloudflare); kunci JWT, webhook secret, dan public JWK sudah diisi otomatis. Berkas itu
tercakup pola `.env.*` di `.gitignore` sehingga **tidak pernah ikut ter-commit** — jangan
menyalin isinya ke berkas lain di dalam repo.

1. **Project Supabase** — buat project, lalu:
   - `node scripts/rotate-jwt-key.mjs`: import public JWK sebagai signing key ES256 dengan `kid`
     yang sama. Tanpa ini setiap query browser ditolak 401 oleh PostgREST;
   - `supabase db push` lalu `supabase db reset --linked` **tidak** dipakai di produksi —
     jalankan migrasi saja;
   - `SUPABASE_DB_URL=<project> npm run create-master-admin` untuk Master Admin pertama.
2. **Cloudflare Pages** — buat project dengan build command `npm run build` dan output
   `apps/web/dist`, lalu set secret:
   ```text
   wrangler pages secret put SUPABASE_URL
   wrangler pages secret put SUPABASE_SECRET_KEY
   wrangler pages secret put APP_JWT_PRIVATE_KEY
   wrangler pages secret put APP_JWT_KEY_ID
   wrangler pages secret put ORDERONLINE_WEBHOOK_SECRET
   ```
   `VITE_*` diset sebagai build-time env (bukan secret).
3. **Verifikasi di produksi** (jangan diasumsikan):
   - `node scripts/smoke-pages-local.mjs` dengan `SMOKE_BASE_URL=https://<domain>` — langkah 1–4
     berlaku apa adanya di produksi;
   - RLS diuji terhadap project nyata (skrip pgTAP ada di `supabase/tests/`);
   - cron retensi benar-benar berjalan (`select * from cron.job` di project);
   - **kamera dicoba di ponsel panitia sungguhan** — ini satu-satunya bagian yang tidak dapat
     diuji otomatis.
4. **Smoke test manual `06 §10`** untuk hal yang butuh mata manusia: login → Dashboard → Order →
   Presensi → Generator (hasil `KM01SO392 - S1 - Solo`) → Konfigurasi → Report Tax → Scanner
   (kamera + Manual Search) → Profil (ganti password, lalu login ulang).

Belum boleh diklaim production-ready sampai butir 1–3 selesai **dan** adapter webhook lengkap
(VA-1 butir 1–3).

---

## 7. Aturan yang mengikat (jangan dilanggar saat melanjutkan)

Rujukan penuh: `CLAUDE.md §4` dan `docs/00-AI-AGENT-BUILD-CONSTITUTION.md §2`. Yang paling
sering terlanggar:

1. `1 Order ID = 1 Master Order` — selalu UPSERT, tidak pernah INSERT baris baru per webhook.
2. Mapping status persis; status tak dikenal → 422 `UNSUPPORTED_ORDER_STATUS`, tidak dipetakan.
3. Tidak ada hardcode Product/Advertiser/Event Type/Session/Tax.
4. Presensi row-based; dilarang kolom `timestamp_1..timestamp_10`.
5. Webinar: setiap klik = baris baru. Seminar: idempotent per `order_id`.
6. Retensi attendance 30 hari; Master Order **tidak** ikut terhapus.
7. Akses peserta = order ada + Paid + event valid. QR **bukan** otorisasi.
8. QR dibuat client-side; Worker tidak pernah membuat gambar QR.
9. Tidak memuat seluruh database ke browser; pagination/filter/search/sort server-side.
10. Permission ditegakkan server-side, bukan dengan menyembunyikan tombol.
11. Dilarang menambah menu/scope: tanpa User Management page, notifikasi, export, audit log,
    chart, edit/delete Master Order, signup publik, OAuth.
12. Kalau kode berbeda dari dokumen **dan** tidak tercantum di `docs/AMENDMENTS.md`, **kode yang salah**.

---

## 8. Log

| Tanggal | Fase | Kejadian |
|---|---|---|
| 2026-10-12 | — | Membaca seluruh `CLAUDE.md` + 11 dokumen `docs/`; menetapkan plan eksekusi 11 fase (P0–P10) dengan gate verifikasi per fase |
| 2026-10-12 | — | Audit desain menemukan 2 konflik dokumen vs platform, diverifikasi ke sumber: batas PBKDF2 workerd 100.000 iterasi, dan claim `iss`/`aud` wajib untuk PostgREST. Dikunci sebagai amendemen A1 dan A3 |
| 2026-10-12 | P0 | Scaffold workspace selesai. `git init -b main` (belum commit) |
| 2026-10-12 | P1 | `packages/shared` selesai: 96 test lulus, typecheck PASS, 0 vulnerabilities, 0 dependensi runtime. Test menemukan 1 bug parser (trim sebelum split) — diperbaiki |
| 2026-10-13 | — | Aplikasi dinamai resmi **dvflow**; nama lama ("OrderOnline Event Operations App") diganti di `CLAUDE.md`, `README.md`, `package.json`, docs, dan judul berkas kontrak. `OrderOnline` tetap dipakai untuk provider/webhook |
| 2026-10-13 | — | Dua sample payload webhook nyata ditambahkan pengguna (`docs/Reference-Webhook-*`). Dianalisis dan dicatat sebagai `VA-1`: bentuk envelope, status, payment, customer, nominal untuk dua mode pengiriman; `product_raw` **belum** dapat dipastikan (BLOCKED_BY_REQUIREMENT) |
| 2026-10-13 | P2 | 19 migrasi + `seed.sql` + 2 script developer selesai. Gate lulus: `db reset` tanpa error, **187 test pgTAP PASS** |
| 2026-10-13 | P2 | Test menemukan 3 masalah nyata, semuanya diperbaiki: (a) webhook parsial tanpa identifier menghapus snapshot tax → lookup rule kini memakai identifier tersimpan (A7 butir 5); (b) wildcard `%` pada pencarian berarti "tampilkan semua" → input sekarang di-escape (K17); (c) satu asersi C07 salah menuntut SQL memetakan status provider — pemetaan itu milik Worker (P3), asersi diganti |
| 2026-10-13 | P2 | Ditemukan bug platform: memanggil fungsi dengan `EXECUTE` dicabut membuat backend Supabase lokal (PG 17.6) segfault; juga `create extension pgtap with schema public`. Dicatat di `supabase/tests/README.md`; test memakai `has_function_privilege` |
| 2026-10-13 | — | Pengguna menjawab `product_raw` = **nama produk di OrderOnline** (`payload.product_data.name`), mengonfirmasi pola `KM01SO392 - S1 - Solo`, dan menyatakan webhook yang akan dipakai adalah **CO Form** (satu produk = satu sesi). Dicatat di `VA-1`; O5/O6 selesai, muncul O7 (urutan pola) dan O8 (`payment_identifier`) |
| 2026-10-13 | P3 | `packages/api` (+ `apps/worker`, `functions/`) selesai: login/refresh/logout/change-password, profil, provisioning, JWT ES256 dengan verifikasi sendiri, CSRF strict. Gate lulus: typecheck PASS, **50 test unit** + **9 test integrasi** (melawan Supabase lokal) PASS |
| 2026-10-13 | P3 | Test integrasi membuktikan yang tidak dapat dibuktikan tiruan: nama argumen RPC cocok, PostgREST mengembalikan SQLSTATE kustom kita sebagai `code` (DF004 → 401), bcrypt database benar-benar memverifikasi, dan `app_sessions` menyimpan hash — bukan token mentah |
| 2026-10-13 | P3 | Catatan platform: pada Supabase versi ini `apikey` harus memakai format kunci baru (`sb_secret_...`); kunci JWT `service_role` lama ditolak 401 |
| 2026-10-13 | — | Pengguna mengonfirmasi pola produk dipakai apa adanya (O7 selesai). Diklarifikasi pula bahwa `Paid` berasal dari **status order** (`processing`/`complete`), bukan `payment.status` — sudah sesuai implementasi sejak P1 (PRD §52, K23) |
| 2026-10-13 | P4 | Adapter + endpoint webhook selesai: pemetaan kedua bentuk sample, secret salah → 404, status tak dikenal → 422, parse produk dengan konfigurasi apa adanya, `webhook_logs` tanpa PII |
| 2026-10-13 | P4 | Gate lulus: typecheck PASS, **86 test unit api** (+96 shared), **19 test integrasi** (9 auth + 10 webhook), 187 pgTAP. Termasuk **M01 dua webhook identik BERSAMAAN → satu baris** dan tax `mapped` dengan fee rule nyata |
| 2026-10-13 | P4 | Ditemukan saat integrasi: `seed.sql` memakai identifier `bank transfer` (spasi) sedangkan provider mengirim `bank_transfer` → tax `unmapped` palsu. Seed diselaraskan dengan nilai yang benar-benar dikirim provider (06 §15); konsekuensinya dicatat di `VA-1` |
| 2026-10-13 | P5 | Rute peserta + scanner selesai: `GET /access/:orderId` (302 webinar / halaman tiket seminar), `GET`+`POST /checkin/:orderId`, `/api/scanner/search`, `/api/scanner/manual-checkin`. Halaman peserta dirender server dengan escaping eksplisit dan CSP tanpa script |
| 2026-10-13 | P5 | Test menemukan 1 bug di test saya sendiri: asersi pencarian memakai order webinar yang memang tidak boleh muncul di scanner seminar. Diperbaiki |
| 2026-10-13 | P5 | Ditemukan juga bahwa encoder QR tidak dapat saya verifikasi di lingkungan ini (tidak ada decoder untuk memeriksa hasilnya). Gambar QR ditunda ke P7 memakai library; dicatat di §4 sebagai butir yang sengaja belum selesai |
| 2026-10-13 | P6 | CRUD tulis konfigurasi selesai untuk products/advertisers/event-types/sessions/payment-fee-rules, plus guard ambiguitas kode (D07) yang menolak sebelum menulis |
| 2026-10-13 | P6 | Test integrasi awalnya meninggalkan baris konfigurasi (pembersihan berbasis pola kode peka huruf besar/kecil). Pembersihan diubah berbasis id, dan test sekarang dibuktikan lulus dua kali berturut-turut tanpa `db reset` |
| 2026-10-13 | P5/P6 | Gate lulus: typecheck PASS, **143 test unit api** (+96 shared), **187 pgTAP**, **34 test integrasi** (auth 9, webhook 10, peserta/scanner/config 15) |
| 2026-10-13 | P7 | Design system (token guideline + 15 komponen bersama), AppShell + sidebar dengan urutan menu dipaku, login/logout, sesi (access token di memori + refresh cookie), klien baca Supabase |
| 2026-10-13 | P7 | QR halaman tiket selesai dengan bukti yang dapat diperiksa: sumber (`test/qr.test.ts`) dan ARTEFAK hasil build (`npm run verify:ticket-qr`) sama-sama didekode ulang oleh `jsqr` dan menghasilkan payload yang sama |
| 2026-10-13 | P7 | Ditemukan saat memeriksa artefak: `ticket-qr.js` keluar sebagai ES module yang mengimpor chunk runtime, sehingga `<script src>` biasa akan gagal. Build skrip dipisah menjadi IIFE satu berkas (K39). Karena build pertama tampak "berhasil", temuan ini hanya muncul dari memeriksa isi berkasnya |
| 2026-10-13 | P7 | Segfault/kesalahan lain yang dihindari: `minify: 'esbuild'` gagal di Vite 8 karena esbuild tidak lagi ikut dipasang. Dibiarkan memakai minifier bawaan |
| 2026-10-13 | P7 | Gate lulus: typecheck PASS, **266 test unit** (96 shared + 145 api + 25 web), build PASS, verifikasi artefak QR OK, **187 pgTAP**, **34 test integrasi** |
| 2026-10-13 | P8 | RPC baca `orders_page` (migrasi 0020) + halaman Dashboard Resume, Order, dan Presensi Acara. 47 test pgTAP baru untuk `orders_page`, termasuk paritas filter dengan `dashboard_summary` |
| 2026-10-13 | P8 | Test menemukan fixture yang gagal-hidup-hidup (flaky): `now() - interval '1 hour'` bisa jatuh ke hari sebelumnya bila dijalankan dekat tengah malam UTC. Fixture diubah memakai `date_trunc('day', now())`, lalu dijalankan 3x berturut-turut untuk memastikan stabil |
| 2026-10-13 | P8 | Test menemukan kesalahan kutip di test saya sendiri: `''` di awal literal SQL dibaca sebagai string kosong, bukan kutip ter-escape → dipakai dollar-quoting |
| 2026-10-13 | P8 | Butir yang ditunda di P7 ditutup: 9 test render (jsdom + testing-library) menguji urutan kolom Master Order, T1–T10, dan tidak adanya kontrol signup/forgot |
| 2026-10-13 | P8 | Gate lulus: typecheck PASS, **299 test unit** (96 shared + 145 api + 58 web), build PASS, verifikasi artefak QR OK, **234 pgTAP**, **34 test integrasi** |
| 2026-10-13 | P9 | Selesai: Scan QR (kamera + `jsqr` + Manual Search), Product Name Generator, Report Tax, Profil, plus Konfigurasi Produk & Konfigurasi Tax (CRUD UI untuk kelima sumber daya P6) |
| 2026-10-13 | P9 | **Bug nyata ditemukan test**: dropdown Event Type memberi NAMA (`Seminar Offline`) padahal generator butuh KODE (`SO`) — nama mengandung spasi sehingga selalu ditolak validator kode, artinya generator tidak akan pernah bisa menghasilkan apa pun. Diperbaiki dengan memisahkan `eventTypes` (kode) dan `eventTypeNames` (nama) |
| 2026-10-13 | P9 | Kerapuhan test juga ditemukan: memilih pada `<select>` sebelum daftar konfigurasi selesai dimuat tidak mengubah state (opsi belum ada). Test menunggu opsi tersedia lebih dulu |
| 2026-10-13 | P9 | `PlaceholderPage` dihapus — tidak ada lagi halaman yang belum dikerjakan, jadi penanda fase itu menjadi kode mati |
| 2026-10-13 | P9 | Gate lulus: typecheck PASS, **327 test unit** (96 shared + 145 api + 86 web), build PASS, verifikasi artefak QR OK, **234 pgTAP**, **34 test integrasi** |
| 2026-10-13 | P9 | Penanganan izin kamera (permintaan pengguna): kegagalan dibedakan per sebab dengan langkah konkret, karena aplikasi berjalan di browser — kamera hanya ada di konteks aman (HTTPS) dan setelah izin diberikan |
| 2026-10-13 | P10 | Konfigurasi deploy: `wrangler.toml` (Pages), `_headers` (CSP, Permissions-Policy kamera, nosniff, anti-framing, HSTS), `_redirects`, dan tooling lokal (`write-dev-vars`, `smoke-pages-local`) |
| 2026-10-13 | P10 | **Bug kritis ditemukan verifikasi jalur deploy**: `/access/*` dan `/checkin/*` tidak punya berkas Pages Function, sehingga mengembalikan `index.html` — halaman peserta tidak akan pernah sampai ke backend di produksi. Ditambahkan `functions/access/[orderId].ts`, `functions/checkin/[orderId].ts`, dan handler bersama `functions/_lib/handler.ts` |
| 2026-10-13 | P10 | Prioritas `_redirects` vs Pages Functions **terjawab**: Functions diprioritaskan bila berkas fungsinya ada; rute SPA tetap dilayani `index.html`. Diuji, bukan diasumsikan |
| 2026-10-13 | P10 | Smoke test jalur deploy lulus seluruhnya: header keamanan, aset, prioritas routing, `401` tanpa token, webhook (secret salah → 404, benar → 200, ulang → 200, status tak dikenal → 422), dan halaman tiket tanpa nomor WA |
| 2026-10-13 | P10 | Dua jebakan yang memakan waktu dan dicatat: (a) `.dev.vars` dengan nilai multi-baris membuat secret tidak sampai ke Worker (gejala: webhook selalu 404 dengan secret yang benar); (b) proses `wrangler`/`workerd` lama tetap memegang port sehingga yang menjawab adalah konfigurasi lama |
| 2026-10-13 | P10 | Assertion pgTAP di dalam blok `DO` dihitung sebagai rencana tetapi tidak dicetak → berkas gagal "Bad plan". Ditulis ulang sebagai pernyataan biasa: **238 pgTAP** lulus |
| 2026-10-13 | P10 | Audit menemukan advisory `undici` lewat `wrangler` (dev-only). Dinaikkan ke 4.149.0 — lebih baru dari batas 2 minggu, dengan alasan dicatat (K62) — lalu smoke test jalur deploy dijalankan ulang dan tetap lulus seluruhnya |
| 2026-10-13 | P10 | Gate lulus: typecheck PASS, **342 test unit** (96 shared + 145 api + 101 web), build PASS, verifikasi artefak QR OK, **238 pgTAP**, **34 test integrasi**, **smoke jalur deploy 18/18**, **npm audit 0 vulnerabilities** |
| 2026-10-13 | — | **Pekerjaan disimpan**: commit pertama di `main` (203 berkas, 38.401 baris). Diverifikasi sebelum commit: tidak ada secret di antara berkas yang di-commit, `.dev.vars`/`.env`/`.wrangler`/`node_modules`/`dist` tidak ikut, dan `.gitattributes` memaku LF supaya `\r` tidak pernah masuk ke nilai secret. Belum di-push (pilihan pengguna) |
| 2026-10-14 | F2.0 | Audit role/permission + kode master ketat (0027/0028) di-commit `2d2674c`. Push memicu deploy produksi sementara DB produksi masih di 0023 → tombol Hapus dll. 500 |
| 2026-10-14 | F2.0 | Audit menyeluruh + perbaikan: 0029 (`schema_version`, `master_is_used` terstruktur, remap persisten via alias, `admin_delete_user`), error DB terpetakan (503 `SCHEMA_OUT_OF_DATE`), rute `/access/:kodeToko/:orderId` (`functions/access/[[path]].ts`), gate CI versi skema, skrip `wipe-trial-data.mjs`, runbook dok 09. DB lokal dimigrasi ke 0029 dan data trial dibersihkan. **Produksi menunggu runbook dok 09** |
| 2026-10-14 | F2.0 | **Runbook dok 09 dijalankan di produksi**: backup (`.local-backups/prod-*-20261014-184636.sql`), skema prod = repo 0001–0026 (335/335 item identik), `migration repair` 0024–0026, `db push` 0027–0029, `schema_version()=29`, data trial dihapus (1 order, 2 produk; backup JSON lokal), seed SO/WO + ST/S1–S8, constraint kode tervalidasi. Akun (3), koneksi (1), fee rule (1) dipertahankan |
| 2026-10-14 | F2.0 | Jenis acara Hybrid (A14, 0030); label Cara Hadir; perbaikan sesi frontend (gangguan sesaat tidak lagi menampilkan "Akses belum dapat diverifikasi") |
| 2026-10-15 | F2.0 | Platform Fee + E-payment Fee Tax (A15, 0031); Report Tax & nominal Dashboard hanya order Paid |
| 2026-10-15 | F2.0 | Kode metode bayar OrderOnline (A16, 0032): instant + payment.channels, katalog 14 metode (toggle), e-payment fee kombinasi persen + flat |
| 2026-10-16 | F2.0 | A17 (0034): pemetaan order dikunci walau alias dihapus; Report Tax per channel (0033); link akses peserta {{order_id}} |
| 2026-10-16 | F2.0 | A18 (0035): kapasitas ±3,2 KB/order -> ±120 ribu order aman di Supabase Free; list maks 500 baris; default tanggal 30 hari; filter tanggal satu field (preset + kalender) |
| 2026-10-16 | F2.0 | A19 (0036): `orders.quantity` dari CO Form; tiket QR disederhanakan (nama, Order ID, produk, batch, kota, sesi, catatan, QR, N TIKET), stempel CHECK-IN BERHASIL otomatis, tombol JOIN SECARA ONLINE (ZOOM), scanner menampilkan jumlah tiket, Konfigurasi Tiket hanya Catatan |
| 2026-10-16 | F2.0 | A20 (0037): role Advertiser (1 akun = 1 pengiklan + produk terpilih; RLS `can_access_order`, check-in & scanner ikut); `admin_create_user`/`admin_update_user` 0024 yang terbuka PUBLIC dihapus |
| 2026-10-16 | F2.0 | A21: label role di Add Team & sidebar = nama di Konfigurasi Role (`app_roles.name`, `profile.role_name`); label lama "Team" dihapus |
| 2026-10-16 | F2.0 | A22: Scanner Stick tidak lagi langsung "Aktif"; status Menunggu → Terhubung setelah scan pertama dari alat, plus peringatan halaman tidak fokus |
| 2026-10-16 | F2.0 | A23 (0038): `presensi_summary` — kartu Hadir/Belum Hadir Presensi cukup izin Presensi (tanpa angka keuangan); QR Tes Scanner `DVFLOW-TES-SCANNER` (tidak ke server, bisa berulang) |
| 2026-10-16 | F2.0 | A24 (0039): filter tanggal = tanggal order OrderOnline (`coalesce(source_created_at, created_at)`) dalam hari WIB; sebelumnya batas hari UTC membuat 54 leads tampil 45 |
| 2026-10-16 | F2.0 | A25 (0040): Dashboard kartu Jumlah Tiket = total quantity order Paid (`paid_tickets`); Paid tetap per Order ID tanpa dobel; quantity dicatat di webhook_logs |
| 2026-10-16 | F2.0 | A26: koreksi SEKALI JALAN quantity order lama dari nominal (150.000/tiket) di produksi: 2 order (Pending) 1 → 2 tiket; ke depan hanya dari webhook |
| 2026-10-16 | F2.0 | A27: link peserta di Konfigurasi Zoom/Tiket (per toko) & drawer Order/Presensi memakai `/access/{KODE}/{nomor}` sesuai dok 07 |
| 2026-10-17 | F2.0 | A28: StandardFilterBar (urutan & lebar sama di Dashboard/Order/Presensi/Report Tax, tanpa More Filters), default tanggal Hari Ini |
| 2026-10-17 | F2.0 | A29 (0041): Peserta OTS — order source 'ots' (OTS-000001), Paid + langsung hadir, edit/hapus khusus OTS, izin action.ots, drawer di Scan QR |
| 2026-10-17 | F2.0 | A30 (0042): Tampilan Apps Lapangan di HP untuk Pimpro/Staff/Member berizin ui.field_app — tab bawah Presensi · OTS · SCAN · Cari Peserta · Akun; role lain tetap tampilan web |
| 2026-10-18 | F2.0 | A31 (0043): filter Kota & Batch tidak membedakan huruf besar/kecil (7 RPC baca) |
| 2026-10-18 | F2.0 | A32: batch berbagai panjang terverifikasi (tes parser); cakupan Zoom/Tiket menerima batch huruf/angka & tidak membedakan huruf besar/kecil |
| 2026-10-18 | F2.0 | A33 (0044): nol di depan batch diabaikan (058 = 58; 508/100 tetap) di parser, generator, cakupan Zoom/Tiket, dan filter; kode pengiklan 01 tidak tersentuh; CLAUDE.md §4 diperbarui |
| 2026-10-20 | F2.0 | A34 (0045/0046): OTS cepat - konteks meja (produk/batch/sesi/kota) diisi sekali per perangkat, produk searchable, harga per tiket 4 preset, jumlah tiket, total otomatis, tiga metode OTS lama, selalu Seminar Offline. RPC save_ots_registration menerima p_quantity/p_unit_price dan tetap kompatibel dengan pemanggil lama |
| 2026-10-20 | F2.0 | A35: Export Meta (Paid) di halaman Order - filter aktif + paksa Paid; format docs/Reference-Meta-Conversion-Audience-Format.md; CSV tanpa BOM & tanpa formula guard; file contoh PII dihapus dari repo |
| 2026-10-20 | - | Gate: typecheck PASS; unit test 611 lulus (271 api + 133 shared + 207 web); pgTAP 498 PASS (reset --no-seed); integration 37 PASS (termasuk OTS e2e baru); build PASS; verifikasi artefak QR PASS |
| 2026-10-20 | - | Tiga ekspektasi test integrasi lama diselaraskan dengan perilaku/seed saat ini: label jenis acara di halaman tiket (memang dihapus A19), nama fee rule `Bank Transfer` (katalog 0032), dan E02 memakai `GoPay` (satu-satunya rule persentase yang aktif di seed) |
| 2026-10-24 | F2.0 | A39 (0049): menu Resume Batch - tiket Paid per sesi + kota dalam satu produk + batch, gabungan semua pengiklan + OTS, drawer rincian per pengiklan; izin operasional.resume_batch; RPC batch_session_summary |
| 2026-10-24 | F2.0 | A39 revisi (0050): Resume Batch diurutkan per kota lalu sesi. A40 (0051): hapus massal Order Unmapped lewat checklist (izin action.delete_master), RPC delete_unmapped_orders; retensi otomatis 90 hari tetap |
| 2026-10-24 | F2.0 | A41 (0052): retensi attendance_events kembali 30 hari (sebelumnya 60 hari, A10) |
| 2026-10-27 | F2.0 | A45 (0055): Report Spend Iklan — kartu Paid diganti Jumlah Tiket (sum quantity, sama dengan tabel sesi) dan tabel report menambah kolom Total Tiket per report; `summary`/`sessions` RPC tidak berubah |
| 2026-10-27 | F2.0 | A46 (0056): menu Performa / Analitik - dashboard semua pengiklan (kartu/tabel) + detail track record per pengiklan; spend prorata harian, tiket/omzet Paid, closing rate tiket/leads, ROAS omzet/(spend+PPN), top 2 produk by tiket; Report Spend menambah kartu Perbandingan Pengiklan. Izin operasional.analytics (default Manajer + Admin) |
| 2026-10-27 | F2.0 | A47: sidebar accordion - hanya satu grup terbuka, grup halaman aktif otomatis terbuka, status disimpan di localStorage; route/izin/urutan menu tidak berubah |
| 2026-10-27 | - | Gate A46/A47: typecheck PASS; unit test 643 lulus (277 api + 133 shared + 233 web); pgTAP 639 PASS (27 berkas); build PASS |
| 2026-10-28 | F2.0 | A48 (0057): Performa / Analitik - akun Advertiser hanya melihat pengiklannya sendiri, Pimpro melihat semua pengiklan di produknya, Admin/Manajer/Owner/Developer melihat seluruhnya; A44 dan Report Spend tidak berubah; default izin analytics ditambah untuk Advertiser + Pimpro |
| 2026-10-28 | - | Gate A48: typecheck PASS; unit test 645 lulus (277 api + 133 shared + 235 web); pgTAP 660 PASS (28 berkas); build PASS |
| 2026-10-28 | F2.0 | A49: revisi tampilan - badge "Tertinggi" dihapus; baris Total tabel lebih tinggi (padding 14px vs 8px), bold, latar indigo lembut, dipakai di Report Spend + Resume Batch; Add Team tidak lagi menampilkan pengiklan di kolom Akses Produk dan membatasi 4 badge produk + ringkasan; sidebar item & header accordion 12px, teks ink, hover indigo 30%, item aktif tetap |
| 2026-10-28 | - | Gate A49: typecheck PASS; unit test 647 lulus (277 api + 133 shared + 237 web); pgTAP 660 PASS (28 berkas); build PASS |
| 2026-10-28 | - | Deploy production: commit `dda949e` di-push ke `origin/main`; GitHub Actions **Deploy to Cloudflare Pages** sukses; migrasi `0057` diterapkan ke Supabase produksi (`schema_version` = 57); https://dvflow.pages.dev live |
| 2026-10-28 | F2.0 | A50 (0058): delegasi `team.manage` - Manajer dapat menambah anggota dan assign produk yang ia pegang; role Admin/Manajer/Owner/Developer diblokir; edit/hapus dan Konfigurasi Role tetap master |
| 2026-10-28 | F2.0 | A51: Performa/Analitik - tabel periode dihapus, diganti tiga grafik soft line (Spend, Omzet, Profit x waktu); profit negatif didukung |
| 2026-10-28 | F2.0 | A52 (0059): halaman Status Produk + Status Pengiklan; kolom status, mapping label `product_advertisers`, Resign menutup akses dan status aktif kembali membuka akses |
| 2026-10-28 | F2.0 | A53: seluruh label menu/accordion sidebar uppercase, font tetap 12px, label panjang boleh 2 baris |
| 2026-10-28 | F2.0 | A54 (0060): hapus user hanya jika tanpa data; user berdata mendapat `USER_HAS_DATA` dan opsi Non-Aktifkan; deaktivasi mencabut sesi |
| 2026-10-28 | - | Gate A50-A54: typecheck PASS; unit test 658 lulus (283 api + 133 shared + 242 web); pgTAP 697 PASS (29 berkas); build PASS |
| 2026-10-28 | - | Deploy production A50-A54: migrasi `0058`-`0060` diterapkan (`schema_version` = 60); commit `255b795` di-push; GitHub Actions **Deploy to Cloudflare Pages** sukses; https://dvflow.pages.dev live |
| 2026-10-28 | F2.0 | Report Spend: tabel Perbandingan Pengiklan dipindah ke bawah tabel Tiket Paid per Sesi |
| 2026-10-28 | F2.0 | A55: anak menu accordion sidebar menjorok `ml-2`/`pl-2` dengan garis pemandu `border-primary/20`; Dashboard tetap rata kiri; route/izin/urutan tidak berubah |
| 2026-10-28 | - | Deploy production A55: commit `a5f6323` di-push; GitHub Actions **Deploy to Cloudflare Pages** sukses; https://dvflow.pages.dev live (aset `index-Cph5gYCI.js` / `index-BBdkGipe.css`) |
| 2026-10-29 | F2.0 | A56 (0061): Performa/Analitik - tiga grafik diganti satu grafik **Total Spend (spend + PPN) + Tiket Terjual** (dual axis, tooltip angka real, rentang mengikuti filter); grafik per batch & per produk memakai **semua waktu** lewat RPC `advertiser_breakdown` (tanpa parameter tanggal, scope A44/A48 tetap), spend per produk dihitung, produk/batch spend-only ikut tampil |
| 2026-10-29 | - | Gate A56: typecheck PASS; unit test web 244 PASS (36 berkas); pgTAP 731 PASS (30 berkas, termasuk 34 assertion baru); build PASS |
| 2026-10-29 | - | Deploy production A56: migrasi `0061` diterapkan (`schema_version` = 61); commit `7ec051c` di-push; GitHub Actions **Deploy to Cloudflare Pages** sukses; https://dvflow.pages.dev live (aset `index-BoSDbRJi.js` / `index-DtWlV-rp.css`) |
| 2026-10-29 | F2.0 | A57 (0062): Performa/Analitik - legenda tanpa "(kanan)"; grafik per batch & per produk semuanya batang berkelompok (Total Spend + Omzet sumbu kiri, Tiket sumbu kanan); Per Batch wajib pilih produk lalu menampilkan 5 batch terakhir berdasarkan tanggal aktivitas terbaru (kolom Aktivitas Terakhir); Per Produk memakai 2 batch terakhir tiap produk untuk grafik dan tabel |
| 2026-10-29 | - | Gate A57: typecheck PASS; unit test web 244 PASS (36 berkas); pgTAP 755 PASS (31 berkas, termasuk 24 assertion baru); build PASS |
| 2026-10-29 | - | Deploy production A57: migrasi `0062` diterapkan (`schema_version` = 62); commit `6d0b685` di-push; GitHub Actions **Deploy to Cloudflare Pages** sukses; https://dvflow.pages.dev live (aset `index-BZd0Qbc9.js` / `index-DtWlV-rp.css`) |
| 2026-10-29 | - | Dev lokal: port Supabase digeser ke `54690`-`54696` karena Windows/Hyper-V memblokir `54320`-`54329` (excluded port range). `apps/web/.env` dan `.dev.vars` ikut disesuaikan (keduanya tidak di-commit). Kalau port default dibebaskan, cukup kembalikan `supabase/config.toml` |
| 2026-10-29 | A58 | Reschedule & Refund selesai: status order `Refund` (penuh, dapat dibatalkan dengan audit), acara efektif reschedule (`event_*` + generated `effective_*`) tanpa mengubah omzet/atribusi, menu **Order Refund**, izin `operasional.order_refund`/`action.reschedule`/`action.refund`, kolom Presensi baru (status + timestamp paling kanan). Migrasi `0063`, pgTAP 31, unit API, dan render test web lulus |
| 2026-10-29 | A59 | Dashboard: menu/judul "Dashboard Resume" -> "Dashboard"; Resume Batch dilebur jadi kartu **Data per Sesi** di antara Order dan Kehadiran; produk+batch wajib (tabel kosong + pesan "Pilih spesifik produk dan batch"), seluruh filter Dashboard berlaku; izin `operasional.resume_batch` dihapus dan card memakai `operasional.dashboard`; `/resume-batch` redirect ke `/`. Migrasi `0064`, pgTAP 32, unit/render web, build, dan QR PASS |
