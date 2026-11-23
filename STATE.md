# STATE — status eksekusi build

> **Cara pakai file ini:** ini satu-satunya tempat untuk melanjutkan pekerjaan. Baca bagian
> **Status**, lalu **Perintah cepat**, lalu **Pekerjaan berikutnya**. Perbarui tabel Status dan
> tambahkan satu baris di **Log** setiap kali satu fase selesai — jangan biarkan file ini basi.
>
> Dokumen yang mengikat tetap `CLAUDE.md` + `docs/`. File ini hanya mencatat **sejauh mana**
> pekerjaan sudah berjalan, bukan aturan baru.

Terakhir diperbarui: 2026-11-21
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
npm test                   # -> 747 test lulus (323 api + 143 shared + 3 wa-cron + 278 web)
npm run build              # → aplikasi web + assets/ticket-qr.js
npm run verify:ticket-qr   # → membuktikan artefak QR dapat dijalankan & dipindai
npm run deploy:wa-cron     # → deploy Worker cron WA Admin Bot (Fitur 3.0)
npm audit                  # → 0 vulnerabilities produksi (dev deps punya advisory lama)

# Database lokal (BUTUH Docker Desktop menyala)
npm run db:start                      # supabase start
npm run db:reset                      # seluruh migrasi + seed.sql (untuk integration)
npm run test:integration              # 39 test (butuh SUPABASE_URL/SECRET_KEY/DB_URL; skip bila kosong)
supabase db reset --no-seed           # pgTAP mengasumsikan DB tanpa seed
npm run test:db                       # pgTAP -> 1000 test lulus / 38 berkas

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
| `src/domain/text.ts` | `toTrimmedOrNull`, `collapseWhitespace`, `normalizeCode` (trim+uppercase, tanpa buang spasi tengah), `normalizeProductName` (A75), `CODE_PATTERN` |
| `src/domain/status.ts` | Mapping kanonik + `UnsupportedOrderStatusError` (`UNSUPPORTED_ORDER_STATUS`) + `isPaidStatus` |
| `src/domain/payment-identifier.ts` | Normalisasi trim/lowercase/collapse; exact-only, tanpa fuzzy |
| `src/domain/product-name.ts` | `buildProductName` + `buildProductNameVariants` + `validateProductNameInput` + `validateProductNameVariants` + `PRODUCT_SEGMENT_SEPARATOR` |
| `src/domain/product-parser.ts` | **Modul paling kritis.** `parseProductRaw`, `listCodeCombinations`, `findAmbiguousCodeCombinations`, `describeCodeCombination` |
| `src/domain/tax.ts` | `roundMoney`, `calcTaxAmount`, `calculateTax`, `shouldRecalculateTax` |
| `src/domain/attendance.ts` | `attendanceStatusLabel` (Hadir/Belum Hadir/Pending/Cancelled), `selectLatestTimestamps` |
| `src/domain/checkin-qr.ts` | `buildCheckinPath`, `buildCheckinUrl`, `extractOrderIdFromQrPayload` |
| `src/domain/follow-up.ts` | A76: placeholder + validasi/render template Follow Up, `toWhatsAppNumber`, `whatsAppSendUrl` (`api.whatsapp.com`) |
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
| 2026-10-29 | - | Dev lokal: port Supabase digeser ke `55100`-`55106` karena Windows/Hyper-V memblokir `54320`-`54329` dan kemudian `54690`-`54696` (excluded port range). `apps/web/.env` dan `.dev.vars` ikut disesuaikan (keduanya tidak di-commit). Kalau port default dibebaskan, cukup kembalikan `supabase/config.toml` |
| 2026-10-29 | A58 | Reschedule & Refund selesai: status order `Refund` (penuh, dapat dibatalkan dengan audit), acara efektif reschedule (`event_*` + generated `effective_*`) tanpa mengubah omzet/atribusi, menu **Order Refund**, izin `operasional.order_refund`/`action.reschedule`/`action.refund`, kolom Presensi baru (status + timestamp paling kanan). Migrasi `0063`, pgTAP 31, unit API, dan render test web lulus |
| 2026-10-29 | A59 | Dashboard: menu/judul "Dashboard Resume" -> "Dashboard"; Resume Batch dilebur jadi kartu **Data per Sesi** di antara Order dan Kehadiran; produk+batch wajib (tabel kosong + pesan "Pilih spesifik produk dan batch"), seluruh filter Dashboard berlaku; izin `operasional.resume_batch` dihapus dan card memakai `operasional.dashboard`; `/resume-batch` redirect ke `/`. Migrasi `0064`, pgTAP 32, unit/render web, build, dan QR PASS |
| 2026-10-29 | A60 | Status Produk: kolom pengiklan sekarang menampilkan nama (bukan kode), dengan tooltip kode — nama; Status Pengiklan tetap menampilkan kode produk. Tanpa migrasi |
| 2026-10-29 | A61 | Presensi per tiket (migrasi `0065`): KPI Hadir/Belum Hadir dari quantity, list hanya Paid, status Hadir Sebagian + Data presensi tidak tersedia, kolom Tiket, nomor urut semua tabel, tabel maks 20 baris/70vh, dialog jumlah tiket untuk scan multi-tiket (aman untuk Scanner Stick). Gate: typecheck PASS; unit 680 lulus (292 api + 135 shared + 253 web); pgTAP 863 lulus / 34 berkas; integration 37 lulus. Klien lama tetap check-in seluruh order (kompatibilitas mundur migrasi). |
| 2026-10-29 | - | Deploy production A61: backup `prod-pre-a61-schema/data-20261029-221922.sql`; migrasi `0065` diterapkan (`schema_version` = 65, PostgREST reload); commit `21db48f` di-push dan workflow Deploy sukses; bundle production memuat dialog jumlah tiket, Hadir Sebagian, dan Data presensi tidak tersedia. |
| 2026-11-02 | A62 | Presensi: kolom **Di-scan oleh** (nama operator, webinar kosong), e-tiket bertahap (QR tetap tampil sampai semua tiket check-in; progress `data-checkin-count` memicu reload), dan koreksi manual **Tandai Hadir** / **Batalkan Check-in** sebagian atau seluruh tiket. Migrasi `0066`, izin `operasional.presensi` + `action.manual_checkin`, nomor tiket memakai slot kosong pertama. Gate: typecheck PASS; unit 301 api + 258 web; pgTAP 882 lulus / 35 berkas; build PASS. |
| 2026-11-02 | - | Deploy production A62: backup `prod-schema-before-0066.sql` + `prod-data-before-0066.sql`; migrasi `0066` diterapkan (`schema_version` = 66, PostgREST reload); commit `25e55a0` di-push dan workflow Deploy sukses; smoke test production semua langkah lulus. |
| 2026-11-04 | A63 | Revisi operasional: filter per tab (sessionStorage), sesi 14 hari, QR cache/kompatibilitas, Report Spend + jenis acara (migrasi `0067`), menu & daftar OTS semua tanggal, pencarian menu Ctrl/Cmd+K, dan nama pengiklan di Data per Sesi. Gate: typecheck PASS; unit 302 api + 135 shared + 262 web; pgTAP 887 PASS / 35 berkas; integration 37 PASS; build + verify QR PASS. Migrasi 0067 diterapkan ke Supabase produksi (schema_version=67, PostgREST reload). |
| 2026-11-04 | - | Gate A63: typecheck PASS; unit 302 api + 135 shared + 262 web; pgTAP 887 PASS / 35 berkas; integration 37 PASS; build + verify QR PASS. |
| 2026-11-04 | - | Deploy production A63: backup `prod-schema-before-0067.sql` + `prod-data-before-0067.sql`; migrasi `0067` diterapkan (`schema_version` = 67, PostgREST reload); commit `c1483eb` di-push dan workflow Deploy sukses. |
| 2026-11-04 | - | Perbaikan header cache `ticket-qr.js`: wildcard `/assets/*` ternyata DIGABUNG Cloudflare dengan rule khusus, sehingga `immutable` tetap menang. Rule diubah ke `/assets/index-*`; commit `756e2f6` di-push dan deploy sukses. Header production sekarang `max-age=0, must-revalidate`. |
| 2026-11-06 | A64 | Pemisahan sumber Online/OTS: filter **Sumber Pendaftaran** (Dashboard default Online; Order/Presensi/Refund/Report Tax default Semua), ringkasan per sumber, rekap OTS desktop/mobile + filter dan riwayat, konfirmasi nomor HP duplikat. Migrasi `20261106062419_ots_source_separation.sql` (`schema_version` 68) menambah argumen akhir opsional `p_source` pada 10 RPC baca, plus RPC service-only `ots_registrations_page`/`ots_duplicate_candidates`. Gate: typecheck PASS; unit 304 api + 135 shared + 265 web; pgTAP 919 PASS / 36 berkas; integration 37 PASS; browser PASS (desktop/mobile, duplikat, reset sumber); build + verify QR PASS. |
| 2026-11-06 | - | Gate A64 sempat berhenti karena test `36_ots_source_separation.sql` memanggil RPC service-only sebagai `authenticated` → segfault PostgreSQL 17.6 lokal (K63). Diganti dengan `has_function_privilege`; skrip `test-rbac-db.mjs` kini memakai port Supabase lokal `54691` (atau `RBAC_DB_URL`), sehingga tidak perlu container verifikasi ad hoc. |
| 2026-11-06 | - | Deploy production A64: backup `prod-schema-before-0068.sql` + `prod-data-before-0068.sql`; migrasi `20261106062419` diterapkan (`schema_version` = 68, riwayat migrasi dicatat, PostgREST reload). `supabase link` gagal karena token tidak punya `project_admin_read`, jadi migrasi dijalankan langsung via `psql` dengan `SUPABASE_DB_URL` + CA. Commit `3d090d4` di-push; workflow Deploy sukses; smoke production 23/23 lulus; order uji smoke dihapus kembali. |
| 2026-11-06 | A65 | Advertiser Notes + OTS utama + filter ringkas: sidebar Title Case (menggantikan A53), OTS jadi menu utama dengan tab Pendaftaran/Transaksi/Laporan (rincian sesi+kota), saran 3 batch terbaru dari data order (produk+pengiklan, tetap boleh diketik), filter sekunder dilipat ke `Filter Lain`, dan panel kanan Advertiser Notes (minimize ke tombol Notes, docked >=1440px, form di panel, advertiser read-only sesuai produk). Migrasi `20261106090000_advertiser_notes_and_recent_batches.sql` (`schema_version` 69), izin `operasional.advertiser_notes` + `action.manage_advertiser_notes`. Gate: typecheck PASS; lint PASS; unit 309 api + 135 shared + 269 web; build PASS. pgTAP/integration belum dijalankan karena Supabase lokal tidak aktif. |
| 2026-11-06 | - | Deploy production A65: migrasi `20261106090000_advertiser_notes_and_recent_batches.sql` diterapkan ke Supabase produksi (`schema_version` 69); `check-schema-version` OK; commit `9e5a313` di-push dan workflow **Deploy to Cloudflare Pages** sukses; bundle production memuat Advertiser Notes, saran batch, dan laporan OTS. |
| 2026-11-11 | A66 | **WA Admin Bot** (Fitur 3.0) selesai di kode: tabel `wa_bot_settings`/`wa_reminder_groups`/`wa_reminder_templates`/`wa_reminder_schedules`/`wa_reminder_logs` + RPC `wa_reminder_claim`/`mark`/`preview` (migrasi `20261111120000_wa_admin_bot.sql`, `schema_version` 70), izin `config.wa_bot` + `action.wa_bot_send`, backend `packages/api/src/wa-bot/*`, cron Worker `apps/wa-cron` (`* * * * *`, secret header), halaman `/wa-bot` (5 kartu), dan workflow `deploy-wa-cron.yml`. Aturan: grup per pengiklan, cek laporan per produk tanpa batch, satu pesan per produk, token Fonnte terenkripsi di DB, idempoten per jadwal/produk/tanggal, retry maks 3. Gate: typecheck PASS; unit **737** (320 api + 142 shared + 3 wa-cron + 272 web); build PASS. **pgTAP belum dijalankan** karena Docker Desktop tidak aktif. |
| 2026-11-11 | - | Langkah produksi A66: terapkan migrasi (`supabase db push`), set `WA_CRON_SECRET` di Pages + Worker, isi token Fonnte & ID grup dari halaman WA Admin Bot, deploy Worker (`npm run deploy:wa-cron`), lalu smoke test satu pesan + pastikan tidak ada pesan kedua. Runbook: `docs/Fitur 3.0 (WA Admin Bot)/07-RUNBOOK-DEPLOY-DAN-OPERASIONAL.md`. |
| 2026-11-11 | - | Gate A66 di database nyata: `supabase db reset --no-seed` menerapkan seluruh migrasi termasuk `20261111120000` (schema_version 70); **pgTAP 950 PASS / 37 berkas** (37_wa_admin_bot: 31 assertion), `supabase db reset` + **integration 39 PASS / 5 berkas** (termasuk `wa-bot.e2e.test.ts`), dijalankan dua kali tanpa reset. Port lokal digeser ke `55100`-`55106` karena excluded range Windows mencakup `54690`-`54696`. |
| 2026-11-11 | - | Deploy production A66: migrasi `20261111120000_wa_admin_bot.sql` diterapkan via `supabase db push` setelah `supabase migration repair --status applied 20261106090000` (A65 dulu diterapkan manual, belum tercatat). Verifikasi produksi: `schema_version` = 70, 2 izin WA terdaftar, tabel WA dapat dibaca service_role. Pages deploy sukses (`https://dvflow.pages.dev`, aset `index-Swv6rhG6.js`); Worker `dvflow-wa-cron` live di akun OAuth `e85eb36d�` dengan cron `* * * * *`; `WA_CRON_SECRET` sudah dipasang di Pages dan Worker. Smoke: `/api/wa-bot` tanpa auth 401, cron tanpa secret 404, cron dengan secret 200 `skipped=NO_TOKEN` (token Fonnte belum diisi). Workflow Worker dibuat manual karena token Pages tidak punya izin Workers. |
| 2026-11-12 | A67 | **WA Admin Bot level produk**: grup pindah dari pengiklan ke produk (`wa_product_groups`), penerima dari `product_advertisers`, nomor tag di `advertisers.wa_phone` (backfill dari `pic_phone`, wajib saat produk diaktifkan), cek laporan per **pengiklan + produk + jenis acara** (seminar vs webinar terpisah), halaman `/wa-bot` menjadi 6 tab (Koneksi/Produk & Grup/Nomor WA Pengiklan/Template/Jadwal/Riwayat), kirim tes dua langkah (preview lalu kirim), dan retensi log **3 hari** (`pg_cron` + `wa_reminder_purge` di klaim). Migrasi `20261112090000_wa_bot_product_level.sql` (`schema_version` 71). Gate: typecheck PASS; lint PASS; unit **743** (322 api + 144 shared + 3 wa-cron + 274 web); build PASS; pgTAP **38 berkas / 964 PASS** (37_wa_admin_bot 45 assertion). |
| 2026-11-12 | - | Deploy production A67: backup `prod-schema-before-0071.sql` + `prod-data-before-0071.sql`; migrasi `20261112090000_wa_bot_product_level.sql` diterapkan via `supabase db push --db-url` (CA `supabase-ca.crt`), `schema_version` = 71 dan riwayat remote tercatat; commit `53ccab3` di-push ke `origin/main`; workflow **Deploy to Cloudflare Pages** run `43157087329` sukses; aset produksi `index-vwkSO7gH.js` memuat tab WA baru. Verifikasi: tabel/kolom baru (`wa_product_groups`, `advertisers.wa_phone`, `wa_reminder_logs.event_type`) dapat dibaca service_role; endpoint baru `test-preview`/`product-groups`/`advertisers/:id` membalas 401 tanpa auth; cron tanpa secret 404; smoke production 23/23 lulus; order uji `smoke-58928782` dihapus kembali. |
| 2026-11-12 | A68 | Presensi Acara punya 2 tab: **Berdasarkan Order** (tanggal order) dan **Realtime Presensi** (tanggal scan/check-in, hanya peserta yang sudah hadir pada rentang). KPI per tiket: Jumlah Tiket/Jumlah Hadir/Belum Hadir pada tab Order; Total Peserta Hari Ini/Order Hadir/Sisa Tiket pada tab Realtime. Kartu kehadiran menampilkan rincian **Online X � OTS Y**; `presensi_summary` menambah `paid_tickets_online`/`paid_tickets_ots`/`sudah_hadir_online`/`sudah_hadir_ots`/`attending_orders`. Migrasi `20261112150000_presensi_realtime_dan_total_kehadiran.sql` (`schema_version` 72) menambah `p_date_mode` pada `presensi_page`/`export_presensi_page`/`presensi_summary`. Gate: typecheck PASS; lint PASS; unit 745 (322 api + 144 shared + 3 wa-cron + 276 web); build PASS; pgTAP **38 berkas / 990 PASS**; integration **39 PASS**. |
| 2026-11-12 | - | Deploy production A68: backup `prod-schema-before-0072.sql` + `prod-data-before-0072.sql`; migrasi `20261112150000_presensi_realtime_dan_total_kehadiran.sql` diterapkan via `supabase db push --db-url` (`schema_version` 72, riwayat remote tercatat); commit `7cf3894` di-push; workflow **Deploy to Cloudflare Pages** run `43172714058` sukses; aset produksi `index-C5__Bk7o.js` memuat **Realtime Presensi**, **Berdasarkan Order**, **Total Peserta Hari Ini**, dan **Tanggal presensi**; `check-schema-version` OK. |
| 2026-11-12 | - | Realtime Presensi: polling dipercepat dari 30 detik menjadi **5 detik**, berhenti saat tab browser tidak terlihat, langsung refresh saat tab aktif kembali, dan tidak menumpuk permintaan bila tick sebelumnya belum selesai; teks **terakhir HH:MM:SS** ditambahkan. Commit `28de596`; workflow **Deploy to Cloudflare Pages** run `43174611522` sukses; aset produksi `index-C6NNX7AW.js` memuat teks "tiap 5 detik" dan teks 30 detik sudah hilang. |
| 2026-11-12 | A69 | **Status koneksi Fonnte yang sebenarnya**: endpoint `POST /api/wa-bot/settings/verify` memanggil `POST api.fonnte.com/device` (token didekripsi server-side, tidak pernah dikirim ke browser) dan mengembalikan `has_token/reachable/connected/status/device/error`. Halaman WA Admin Bot menampilkan badge **Terhubung / Device terputus / Token ditolak / Memeriksa / Status tidak diketahui** + nomor, nama, paket, kuota, masa aktif device, tombol **Cek Ulang**, dan memeriksa otomatis setiap token disimpan. Tombol **Kirim Tes** tidak lagi disabled diam-diam: selalu bisa diklik dan memberi tahu prasyarat yang kurang (token / grup produk / template / nomor pengiklan). Gate: typecheck PASS; unit **324 api + 278 web** (749 total); build PASS. Tanpa migrasi. |
| 2026-11-12 | - | Diagnosis A69: penyebab "tidak ada status" bukan penyimpanan token - `wa_bot_settings` sudah berisi token (07:52:26Z) dan `GET /api/wa-bot` mengembalikan `has_token: true`. Panggilan `POST /api/wa-bot/settings/verify` gagal `NETWORK` karena `fetch` memakai `redirect: 'error'`, nilai yang DITOLAK runtime Cloudflare Workers ("Invalid redirect value"). Bug yang sama ada di kirim Fonnte, cron Worker, dan tes koneksi OrderOnline. |
| 2026-11-12 | - | Perbaikan A69: seluruh panggilan keluar memakai redirect default (`follow`); detail error jaringan dikembalikan sebagai `detail` dan ditampilkan di panel status; badge **Fonnte tak terjangkau** dipisahkan dari **Token ditolak**. Commit `19c4b63`; deploy Pages run `43179672173` sukses; Worker `dvflow-wa-cron` di-deploy ulang (version `74da4c18`), secret `WA_CRON_SECRET` terpasang. Verifikasi production: verify -> `connected: true`, device `6285887711009` (Galuh), status `connect`, kuota 1000, aktif s/d 13 Desember 2026. |
| 2026-11-12 | A70 | **Mention memakai nama pengiklan**: Fonnte tidak punya parameter tag WhatsApp, jadi placeholder `{{mention}}` dirender `@Nama Pengiklan` (bukan `@nomor`); signature `wa_render_reminder` tidak berubah dan `p_mention` diabaikan; template baru tidak lagi menduplikasi `{{advertiser_name}}`. Migrasi `20261112170000_wa_mention_advertiser_name.sql` (`schema_version` 73) diterapkan ke produksi via `supabase db push`; commit `4a02ffb`; deploy Pages run `43182999115` sukses. Verifikasi production: preview KMXX/Alfa -> "Mas @Alfa, sampai malam ini..." tanpa nomor HP. |
| 2026-11-12 | A71 | **Nomor HP dihapus + mention seluruh pengiklan per grup**: kolom `advertisers.wa_phone`, endpoint `PATCH /api/wa-bot/advertisers/:id`, tab **Nomor WA Pengiklan**, dan validasi nomor dihapus. Pengingat kini **satu pesan per produk + jenis acara** yang menyebut semua pengiklan beraktivitas kemarin (`Mas @Andre, @Yosef, ...`), dengan gate `only_if_missing_report` tetap (kirim bila minimal satu belum lapor). Idempotensi pindah ke `(schedule_id, product_code, event_type, reminder_date)` untuk baris grup (`advertiser_id` null). `wa_reminder_preview` berubah signature (tanpa pengiklan) dan mengembalikan `advertisers[]`; Kirim Tes tidak lagi memilih pengiklan; filter pengiklan di Riwayat dihapus. Migrasi `20261112180000_wa_group_mentions.sql` (`schema_version` 74) diterapkan ke produksi. Gate: typecheck PASS; unit **746** (323 api + 143 shared + 3 wa-cron + 277 web); pgTAP **992 PASS / 38 berkas**; integration **39 PASS**; build PASS. |
| 2026-11-12 | - | Deploy production A71: commit `4318749`; workflow **Deploy to Cloudflare Pages** run `43185893985` sukses. Verifikasi production: `schema_version` = 74; `GET /api/wa-bot` tidak lagi memuat `wa_phone`; preview KMXX/Webinar -> "Mas @Andre, @Yosef, sampai malam ini belum ada report masuk yaa.." (menyebut semua pengiklan yang beraktivitas). |
| 2026-11-12 | A72 | **Audiens per jadwal**: kolom `wa_reminder_schedules.mention_scope` (`all` default / `missing`). Jadwal pagi bisa menyebut semua pengiklan beraktivitas; jadwal siang/sore hanya yang belum lapor. Mode `missing` memaksa `only_if_missing_report=true` dan tidak mengirim bila semua sudah lapor. `wa_reminder_claim` memilih daftar nama sesuai mode; `wa_reminder_preview` menerima `p_mention_scope` dan mengembalikan `mention_scope`/`NO_MISSING_REPORT`. UI: Select **Siapa yang disebut** di modal Jadwal dan Kirim Tes; kolom Aturan menampilkan mode. Migrasi `20261112190000_wa_schedule_mention_scope.sql` (`schema_version` 75) diterapkan ke produksi. Gate: typecheck PASS; unit **747** (323 api + 143 shared + 3 wa-cron + 278 web); pgTAP **1000 PASS / 38 berkas**; integration **39 PASS**; build PASS. |
| 2026-11-12 | - | Deploy production A72: commit `221a981`; workflow **Deploy to Cloudflare Pages** run `43189791794` sukses. Verifikasi production: schedule 11:00 = `all`; preview KMXX/Webinar mode `all` -> Andre, Yosef; mode `missing` -> Yosef saja (Andre sudah lapor). |
| 2026-11-13 | A73 | **Drill-down Sisa Tiket**: kartu KPI **Sisa Tiket** di tab Realtime Presensi menjadi tombol yang menyetel filter status ke **Hadir Sebagian** (klik lagi membersihkan), sehingga order penyumbang langsung terlihat; baris Hadir Sebagian menyebut `sisa N` di samping progres `X/Y`, dan kartu mode lapangan ikut menyebut sisa. `KpiCard` mendapat prop opsional `onClick`/`pressed`/`ariaLabel` tanpa mengubah struktur kartu lain. Tanpa migrasi. Gate: typecheck PASS; lint PASS; unit **750** (323 api + 143 shared + 3 wa-cron + 281 web); build PASS. |
| 2026-11-13 | - | Deploy production A73: commit `3d2c61f`; workflow **Deploy to Cloudflare Pages** run `43354892597` sukses; aset produksi `index-y5KL9MYe.js` memuat tombol "Tampilkan order penyumbang Sisa Tiket" dan teks "klik untuk lihat ordernya"; `schema_version` = 75 (tidak ada migrasi baru, `check-schema-version` OK). |
| 2026-11-13 | A74 | **Status sesi khusus Developer + sesi OTS wajib dipilih**: ST (344 order, 8 alias) tidak dihapus, cukup dinonaktifkan lewat toggle yang hanya bisa digeser Developer; role lain boleh menambah sesi dan hasilnya selalu aktif. Reset konfigurasi menanam ST nonaktif. OTS menolak sesi nonaktif untuk pendaftaran baru (edit boleh mempertahankan sesi lama), membuang sesi nonaktif dari cache perangkat, dan menampilkan tanggal & jam scan WIB di ringkasan Meja serta di samping pilihan sesi. Migrasi `20261113120000_session_active_dev_toggle.sql` (`schema_version` 76). Gate: typecheck PASS; lint PASS; unit **760** (328 api + 143 shared + 3 wa-cron + 286 web); build PASS; pgTAP belum dijalankan (Docker Desktop tidak aktif). |
| 2026-11-13 | - | Deploy production A74: backup targeted `.local-backups/prod-pre-a74-2026-11-13T07-48-42-614Z.sql`; migrasi `20261113120000_session_active_dev_toggle.sql` diterapkan (`schema_version` = 76, riwayat migrasi tercatat); commit `6389669` + `35065d0`; workflow **Deploy to Cloudflare Pages** run `43388524127` dan `43388786282` sukses. Verifikasi production: `sessions_config` tetap 9 baris (ST masih aktif, menunggu toggle Developer), order ST 344 dan alias 18 utuh, `save_ots_registration` memuat aturan sesi aktif, aset produksi `index-Cl_ayWea.js` memuat "Tanggal & jam scan" dan "Hanya Developer yang dapat mengubah status sesi". `supabase/config.toml` diperbarui `[inbucket]` → `[local_smtp]` agar Supabase CLI 3.1 dapat membaca konfigurasi. |
| 2026-11-14 | A75 | **Dua format nama produk**: generator menghasilkan format kode (`MTIX01SO60 - S1 - Tegal`) dan format nama (`01 - SO60 - Master Tiktok Indonesia - S1 - Tegal`), keduanya dapat diparse (3 vs 5 segmen). Nama produk wajib unik, tanpa ` - `, dan terkunci setelah produk dipakai (hanya nonaktifkan). Migrasi `20261114090000_dual_product_name_format.sql` (`schema_version` 77): `normalize_product_name`, `master_detailed_parts`, `master_setting_parts`/`master_is_used` dua format, index unik nama. Gate: typecheck PASS; lint PASS; unit **782** (333 api + 160 shared + 3 wa-cron + 286 web); build PASS; pgTAP belum dijalankan (CLI menolak `supabase/config.toml`: `local_smtp` invalid). |
| 2026-11-14 | - | Deploy production A75: backup targeted `.local-backups/prod-pre-a75-2026-11-14T04-33-29-446Z.json`; pre-check produksi bersih (0 nama duplikat, 0 nama ber-` - `, 10 produk); migrasi `20261114090000_dual_product_name_format.sql` diterapkan via `npx supabase@3.1.0 db push --db-url` (`schema_version` = 77, history tercatat, fungsi/index/constraint terverifikasi, `master_detailed_parts('02 - SO60 - Kuliner Mastery - S1 - Tegal')` -> `KMXX`); commit `b74fbaa`; workflow **Deploy to Cloudflare Pages** run `43557288417` sukses; aset produksi `index-D-EumNVm.js` memuat "Format 1"/"Format 2". |
| 2026-11-14 | - | Gate pgTAP A75 di database lokal: A74+A75 diterapkan ke DB lokal (schema 75 -> 77) lewat `npx supabase@3.1.0 migration up`; **pgTAP 40 berkas / 1028 assertion PASS** (termasuk `40_dual_product_name_format.sql`). Ditemukan & diperbaiki `37_wa_admin_bot.sql`: assertion versi dipaku `= 75` dan query log WA tidak membatasi produk sehingga terganggu 1 baris log lama lokal (kini `>= 75` + scoping `product_code`). Backup data lokal `.local-backups/local-pre-a75-2026-11-14T04-51-35-551Z.json`; jumlah baris semua tabel dan log lama diverifikasi identik sebelum/sesudah. |
| 2026-11-14 | A76 | **Follow Up Manual via WhatsApp**: template 4 bubble `F1`-`F4` per **produk x jenis acara** (kode `SO`/`WO`/`WS`; Workshop tetap terpisah walau kind hybrid), dipakai bersama, tanpa label nama. Modal Order: klik bubble -> preview -> Kirim membuka `api.whatsapp.com/send` (aplikasi tidak mengirim); bubble yang sudah dipakai berwarna hijau (penanda per order+slot, tanpa riwayat isi). OTS ikut bisa FU dengan `{link}` kosong. Halaman baru **Produk & Acara -> Template Follow Up**; siapa pun dengan izin Order + akses produk boleh mengubah template (tercatat `updated_by`). Migrasi `20261114095000_follow_up_templates.sql` (`schema_version` 78). Gate: typecheck PASS; lint PASS; unit **800** (341 api + 166 shared + 3 wa-cron + 290 web); pgTAP **41 berkas / 1048 assertion PASS** di lokal; data lokal tidak berubah. |
| 2026-11-14 | - | Deploy production A76: backup targeted `.local-backups/prod-pre-a76-2026-11-14T05-48-38-853Z.json`; pre-check prod 77 + tabel baru belum ada; migrasi `20261114095000_follow_up_templates.sql` diterapkan via `npx supabase@3.1.0 db push --db-url` (`schema_version` = 78, history tercatat; tabel baru kosong; 10 produk / 3 event type / 1617 order / 15 user **tidak berubah**; kedua RPC security definer dan tertutup untuk authenticated). Commit `0be31e7`; workflow **Deploy to Cloudflare Pages** run `43563340321` sukses; aset `index-CmRbn22n.js` memuat "Template Follow Up", "Follow Up via WA", "api.whatsapp.com/send"; endpoint `GET /api/follow-up-templates` membalas 401 tanpa auth. |
| 2026-11-14 | A77 | **Koreksi tampilan HP**: tab Apps Lapangan menjadi **Presensi · OTS · Scan · Order · Cari**; `Akun` pindah ke menu avatar kanan atas (Profil/Ganti Password/Tampilan Web/Logout); Profil & Template Follow Up tetap dapat dibuka dari lapangan. Order di semua HP memakai **kartu**: No · Order ID · Status / Nama (ellipsis) · No HP / **kode produk** · Sesi · Kota / **F1-F4 selalu tampil** (hijau bila sudah dipakai; slot kosong membuka WhatsApp kosong). Endpoint baru `GET /api/orders/follow-up-summary` (maks 50 order) supaya warna bubble tidak perlu 50 request. Tanpa migrasi. Gate: typecheck PASS; lint PASS; unit **808** (344 api + 167 shared + 3 wa-cron + 294 web); build PASS. |
| 2026-11-14 | - | Deploy production A77: commit `443ed6a`; workflow **Deploy to Cloudflare Pages** run `43567318755` sukses; aset `index-Co0BHkQZ.js` memuat "Menu akun", "Ganti Password", "Tampilan Web", "follow-up-summary", "dibuka tanpa template"; endpoint `GET /api/orders/follow-up-summary` membalas 401 tanpa auth; tanpa migrasi (`schema_version` tetap 78). |
| 2026-11-14 | A78 | **Satu kartu untuk Order & Presensi + FU di Presensi**: `No · Nama (ellipsis) · Jumlah Tiket · Status` / `Nama Produk · Sesi · Kota` / `F1-F4`; sesi diterjemahkan (ST → Sesi Tunggal, S1-S8 → Sesi 1-8); kartu tidak lagi menampilkan Order ID/No HP (Order) atau progres hadir/scanner (Presensi) — semua tetap di drawer. Follow Up muncul di kedua tab Presensi lewat hook bersama `useFollowUpActions`; `Jumlah Tiket` Order diambil dari `quantity` di endpoint ringkas (tanpa migrasi). Gate: typecheck PASS; lint PASS; unit **809** (344 api + 167 shared + 3 wa-cron + 295 web); build PASS. |
| 2026-11-14 | - | Deploy production A78: commit `7f7468e`; workflow **Deploy to Cloudflare Pages** run `43568686892` sukses; aset `index-BxNekRNn.js` memuat "mobile-order-cards", "presensi-cards", "Sesi Tunggal", "follow-up-summary", " tiket"; endpoint ringkas tetap 401 tanpa auth; tanpa migrasi (`schema_version` tetap 78). |
| 2026-11-16 | A79 | **Notes menjadi Chat Internal + Kalender Event**: Advertiser Notes lama dihapus total (tabel, 3 RPC, 2 izin), diganti chat 1:1 dua arah dengan pemilihan role → "Semua [Role]" atau satu nama; kiriman "Semua" di-fan-out per penerima, bukan thread grup. Panel kanan memakai ikon chat tanpa label + badge belum dibaca. Menu baru **Kalender Event** (Seminar/Webinar/Workshop; produk, tanggal, jam mulai, lokasi/platform) dengan izin baru di checklist. Migrasi `20261116120000_chat_dan_kalender_event.sql` (`schema_version` 79). Gate: typecheck PASS; lint PASS; unit **822** (353 api + 167 shared + 3 wa-cron + 299 web); pgTAP **1095 PASS / 43 berkas**; build PASS. |
| 2026-11-16 | - | Deploy production A79: backup targeted `.local-backups/prod-pre-a79-2026-11-15T22-30-03-041Z.json` (2 catatan lama); migrasi `20261116120000_chat_dan_kalender_event.sql` diterapkan via `supabase db push --remote` (`schema_version` 79, history tercatat; 10 produk / 3 event type / 1729 order / 15 user **tidak berubah**; tabel notes lama tidak ada; RPC chat tertutup untuk authenticated). Commit `2eac5dc`; workflow **Deploy to Cloudflare Pages** run `43769797112` sukses; aset `index-DBaE9JFD.js` memuat "Chat Internal", "Kalender Event", "Buka Chat"; endpoint `/api/chat/threads`, `/api/chat/recipients`, `/api/event-calendar` membalas 401 tanpa auth, `/api/advertiser-notes` 404. |
| 2026-11-16 | - | Revisi tampilan Kalender Event (A79): chip grid = **kode produk + jenis berwarna + lokasi/platform** (jam tetap di agenda & modal); warna **Seminar merah soft, Webinar biru, Workshop amber** + legend; maksimal **3 event per tanggal**, sisanya **"+N lainnya"**; klik tanggal membuka modal daftar lengkap hari itu; agenda menampilkan kode + nama produk. Tanpa migrasi (`schema_version` tetap 79). Gate: typecheck PASS; lint PASS; unit **823** (353 api + 167 shared + 3 wa-cron + 300 web); build PASS. |
| 2026-11-16 | - | Deploy revisi Kalender Event A79: commit `9e7096d`; workflow **Deploy to Cloudflare Pages** run `43774956479` sukses; aset `index-BBZkpcg3.js` / `index-D33cdgRu.css` memuat "lainnya", "Tambah Event", `border-l-danger`, `border-l-warning`; endpoint `/api/event-calendar` tetap 401 tanpa auth; tanpa migrasi (`schema_version` tetap 79). |
| 2026-11-16 | - | Revisi kecil Kalender Event: ukuran teks chip disamakan **9px** untuk kode produk (bold), jenis (berwarna), dan lokasi/platform (normal); teks "+N lainnya" ikut 9px. Tanpa migrasi (`schema_version` tetap 79). Gate: typecheck PASS; lint PASS; unit **823**; build PASS. |
| 2026-11-16 | - | Deploy revisi teks Kalender Event: commit `d3c66fc`; workflow **Deploy to Cloudflare Pages** run `43776295203` sukses; aset `index-94Y-ERgo.js` / `index-D33cdgRu.css` memuat `text-[9px]`, `border-l-danger`, "lainnya"; tanpa migrasi (`schema_version` tetap 79). |
| 2026-11-16 | - | Revisi agenda Kalender Event: urutan kolom **Tanggal - Produk - Jenis - Jam - Lokasi/Platform**; tanggal satu baris (`whitespace-nowrap`, lebar 122px); agenda diurutkan per tanggal lalu produk lalu jam agar event produk yang sama berurutan. Tanpa migrasi (`schema_version` tetap 79). Gate: typecheck PASS; lint PASS; unit **824** (353 api + 167 shared + 3 wa-cron + 301 web); build PASS. |
| 2026-11-16 | - | Deploy revisi agenda Kalender Event: commit `50527dc`; workflow **Deploy to Cloudflare Pages** run `43779205187` sukses; aset `index-sk1bWiKN.js` / `index-B0QYAHGk.css` memuat `whitespace-nowrap`, `w-[122px]`, "lainnya"; endpoint `/api/event-calendar` tetap 401; tanpa migrasi (`schema_version` tetap 79). |
| 2026-11-16 | - | Revisi agenda Kalender Event (2): urutan kolom **Tanggal - Produk - Lokasi/Platform - Jam - Jenis**; lokasi diberi lebar **42ch / min 260px**, teks utuh dan boleh turun baris (tidak dipotong). Tanpa migrasi (`schema_version` tetap 79). Gate: typecheck PASS; lint PASS; unit **824**; build PASS. |
| 2026-11-16 | - | Deploy revisi agenda Kalender Event (2): commit `145b0ae`; workflow **Deploy to Cloudflare Pages** run `43781014956` sukses; aset `index-BaHlnr4x.js` / `index-BWefywTB.css` memuat `w-[42ch]`, `min-w-[260px]`, `break-words`; endpoint `/api/event-calendar` tetap 401; tanpa migrasi (`schema_version` tetap 79). |
| 2026-11-16 | - | Revisi chip Kalender Event: chip grid kini hanya **kode produk + jenis berwarna**; lokasi/platform tetap tersedia di modal detail harian dan agenda. Tanpa migrasi (`schema_version` tetap 79). Gate: typecheck PASS; lint PASS; unit **824**; build PASS. |
| 2026-11-16 | - | Deploy revisi chip Kalender Event: commit `527df8e`; workflow **Deploy to Cloudflare Pages** run `43782077877` sukses; aset `index-Cc2LmPaW.js` / `index-BWefywTB.css`; endpoint kalender tetap 401; tanpa migrasi (`schema_version` tetap 79). |
| 2026-11-16 | - | Revisi Konfigurasi Zoom: kolom Aksi kini selalu menampilkan **Edit** dan **Hapus** untuk pemegang `config.zoom` (syarat `action.delete_master` dicabut khusus Zoom; scope produk tetap dijaga `assertProductAccess`). Tiket, integrasi, dan kamus master tetap butuh `action.delete_master`. Tanpa migrasi (`schema_version` tetap 79). Gate: typecheck PASS; lint PASS; unit **825** (353 api + 167 shared + 3 wa-cron + 302 web); build PASS. |
| 2026-11-16 | - | Deploy revisi Konfigurasi Zoom: commit `1072cbb`; workflow **Deploy to Cloudflare Pages** run `43808903085` sukses; aset `index-Q03twxJZ.js` memuat "Konfigurasi Zoom", "Konfigurasi link Zoom dihapus", "Hapus Konfigurasi Link Zoom"; tanpa migrasi (`schema_version` tetap 79). |
| 2026-11-19 | A80 | **Kalender Iklan + kedisiplinan pengiklan**: menu `Kalender` dua tab (Event + Iklan); deadline tayang per **pengiklan + produk + batch**, tanggal tayang diturunkan dari lead pertama lalu `date_from` report; skor batch 10/8/6/4/2/0 dan `discipline_rate`; kartu Performa = Tiket + delta bulan lalu, ROAS, Kedisiplinan, Top 2 Event, Lihat Detail; detail menampilkan Total Spend/Omzet/Tiket/Profit, Closing Rate, ROAS, Kedisiplinan, Top 3 Event. Migrasi `20261119120000_ad_calendar_dan_performance_discipline.sql` (`schema_version` 80) **diterapkan ke Supabase produksi**; backup targeted `.local-backups/prod-pre-a80-2026-11-19T01-04-43-288Z.json`. Verifikasi produksi: `schema_version`=80, tabel `ad_calendar` ada (0 baris), izin `action.manage_ad_calendar` + 2 role default, RPC `ad_calendar_page`/`advertiser_performance` berjalan sebagai manajer, data lama tidak berubah (produk 10 / pengiklan 10 / user 15 / report spend 75). Gate: typecheck PASS; lint PASS; unit **836** (361 api + 167 shared + 3 wa-cron + 305 web); build PASS. **pgTAP belum dijalankan** karena Docker Desktop/supabase lokal tidak aktif. |
| 2026-11-19 | - | Deploy production A80: commit `ebdc17e`; workflow **Deploy to Cloudflare Pages** run `44434288807` sukses; aset produksi `index-TrUP8OuT.js` memuat "Kalender Iklan", "Kedisiplinan", "Top 3 Event", "Tambah Deadline"; `GET`/`POST /api/ad-calendar` membalas 401 tanpa auth, `/api/event-calendar` 401, `/api/advertiser-notes` 404; `schema_version` = 80. |
| 2026-11-19 | - | **Perbaikan A80**: tab Kalender Iklan membalas FORBIDDEN karena `ad_calendar_page` dipanggil backend dengan service key sehingga `auth.uid()` kosong. Migrasi `20261119130000_ad_calendar_page_actor.sql` (`schema_version` 81) mengubah RPC menjadi `ad_calendar_page(p_actor, p_from, p_to)`, service-only, memakai `actor_has_permission` + `actor_can_product`; handler mengirim `p_actor` dari sesi. Backup definisi lama `.local-backups/prod-pre-a81-2026-11-19T01-16-08-895Z.json`. Verifikasi produksi: `schema_version`=81, overload lama hilang, `authenticated` tidak bisa EXECUTE, `service_role` bisa, RPC mengembalikan 10 produk + 10 pengiklan. |
| 2026-11-19 | - | Deploy perbaikan A81: commit `5000904`; workflow **Deploy to Cloudflare Pages** run `44435705043` sukses; probe access token developer: `GET /api/ad-calendar` **200** (sebelumnya 403), `/api/event-calendar` 200, `/api/chat/recipients` 200; `schema_version` = 81. |
| 2026-11-19 | A82 | **Citta - DVFLOW AI via grup WhatsApp**: hanya `/add` dan `/delete`; produk dari `wa_product_groups` + `ai_enabled`; preview server -> `YA` -> RPC atomik; `/delete` menolak event ber-ad-calendar dan menyimpan snapshot. Migrasi `20261119140000_citta_ai_grup.sql` (`schema_version` 82): role/user sistem `citta_ai`, `event_calendar.city/source/ai_draft_id`, `ai_settings`/`ai_drafts`/`ai_runs`/`wa_ai_inbox`, izin `config.ai_citta`. API `packages/api/src/ai/*` + `POST /api/webhooks/fonnte/:webhookSecret`. Web: tab **Citta AI** (key terenkripsi + Tes Koneksi) dan checkbox Citta per grup. Gate: typecheck PASS; lint PASS; unit **848** (372 api + 167 shared + 3 wa-cron + 306 web); build PASS. **Migrasi belum diterapkan** dan pgTAP belum dijalankan (Docker tidak aktif). |
| 2026-11-20 | A83 | **KPI Performa + detail tahun + snapshot bulanan**: KPI tiket global per bulan (`performance_kpi_targets`) + badge Memenuhi/Tidak Memenuhi KPI di kartu; detail tahun kalender berjalan dengan filter hanya pengiklan/produk, tabel 12 bulan, live = bulan berjalan + 2 sebelumnya, bulan lama dibekukan (`performance_monthly`/`performance_frozen_months` + `performance_freeze()` cron 01.00 WIB). Migrasi `20261120100000_performance_kpi_dan_snapshot.sql` (`schema_version` 83) dan A82 **diterapkan ke Supabase produksi**; backup `.local-backups/prod-pre-a82a83-2026-11-19T05-42-54-556Z.json`. Deploy commit `f097340` (workflow `44467337033`) sukses; smoke API + aset produksi lolos; `FONNTE_WEBHOOK_SECRET` dipasang. Freeze awal 8 bulan (Jan–Agu) berjalan; `performance_monthly` kosong karena belum ada order Jan–Agu. Gate: typecheck PASS; lint PASS; unit **854**; build PASS; pgTAP **46 file / 1183 tes PASS**. |
| 2026-11-19 | A84 | **Kalender Iklan otomatis dari Citta + data belum lengkap**: saat `/add` dikonfirmasi, Citta membuat deadline dari event paling awal - 21 hari; bila H-21 lewat memakai H-14. Batch/pengiklan tidak wajib disebut: batch kosong menjadi `?`, `advertiser_id` NULL, baris tetap disimpan dan diberi tanda `!` di UI Kalender Iklan untuk dilengkapi lewat edit. Baris `source='manual'` tidak pernah ditimpa AI; `/delete` hanya diblokir deadline manual dan deadline AI ikut terhapus bersama event. Dashboard Citta mendapat tombol **Konfirmasi** + modal (tanpa memanggil AI) yang juga mengirim ringkasan ke grup; endpoint `POST /api/ai/drafts/:id/confirm`. Migrasi `20261120110000_ad_calendar_auto_incomplete.sql` (`schema_version` 84) diterapkan ke DB lokal dan produksi (`schema_version` 84). Gate: typecheck PASS; lint PASS; unit **859** (380 api + 167 shared + 3 wa-cron + 309 web); build PASS; pgTAP **47 berkas / 1218 tes PASS**. |
| 2026-11-19 | - | **Deploy production A84**: backup targeted `.local-backups/prod-pre-a84-2026-11-19T07-11-50-824Z.json`; pre-check schema 83, `ad_calendar` 0 baris, `advertiser_id` NOT NULL, tanpa `source`/`ai_draft_id`. Migrasi `20261120110000_ad_calendar_auto_incomplete.sql` diterapkan via `pg` (dry-run + apply); `schema_version` = 84, history tercatat, `advertiser_id` nullable, `source` default manual, index incomplete + `ai_draft_id` ada; counts users 16 / products 10 / advertisers 10 / event 9 / orders 2076 / ad_spend 77 / wa groups 8 / ai_drafts 3 / ai_runs 4 tidak berubah; `ad_calendar_page` aktor developer mengembalikan 0 rows + 10 produk + 10 pengiklan + 9 event; RPC `ai_confirm_draft`/`ad_calendar_page` service-only. Commit `78910f6`; workflow **Deploy to Cloudflare Pages** run `44477834303` sukses; smoke produksi: `schema_version` 84, asset `index-CCzV-JOt.js` memuat "Konfirmasi Draft", "Kalender iklan", "lengkapi di web", "Batch/pengiklan belum lengkap"; endpoint `/api/ai/drafts`, `/api/ai/drafts/:id/confirm`, `/api/ai/drafts/:id/cancel`, `/api/ad-calendar` membalas 401 tanpa auth. |
| 2026-11-19 | - | **Backfill A84 (data)**: baris `ad_calendar` untuk batch lama `7UW9` (8 event, draft `e98a65af-b4e2-40f5-9dd3-eb75430b1245`) dibuat: event paling awal `70cb4158-346d-4d13-ab0a-9ba2fd2bd4fa` (1 Des 2026 09:00, Hotel Prime Biz Tegal), batch `?`, `advertiser_id` NULL, deadline **17 Nov 2026** (H-14 karena H-21 lewat), `source='ai'`, `ai_draft_id` 7UW9; `ad_calendar` 0 -> 1, `event_calendar` tetap 9. Halaman Kalender Iklan mengembalikan 1 baris dengan `incomplete=true`, `advertiser_code=null`, `batch='?'`. Event Pekalongan dari draft `CA38` (1 event) belum punya deadline. |
| 2026-11-20 | A85 | **Perapian toolbar KPI Performa + hapus penanda beku**: field KPI memakai placeholder "Atur KPI Pengiklan" + `aria-label` bulan (label visual "KPI Nov 2026" dihapus); header "Semua Pengiklan" jadi dua baris dengan kontrol cari/urut/Kartu-Tabel di kanan dan KPI + Simpan di baris bawah, semua kontrol 36px sejajar; badge "Beku" dihapus dari tabel Rincian Bulanan detail pengiklan dan deskripsi snapshot tidak lagi ditampilkan, badge "Berjalan" tetap; `is_frozen` tetap dikirim RPC tanpa dirender. Tanpa migrasi (`schema_version` tetap 84). Gate: typecheck PASS; lint PASS; unit **859** (380 api + 167 shared + 3 wa-cron + 309 web); build PASS. |
| 2026-11-20 | - | **Deploy production A85**: commit `84e418e`; workflow **Deploy to Cloudflare Pages** run `44628843122` sukses; aset produksi `index-B4SvCoPL.js` memuat "Atur KPI Pengiklan", "Cari pengiklan", dan "Rincian Bulanan"; teks "Beku" dan label lama "KPI tiket / pengiklan / bulan" tidak ada; tanpa migrasi (`schema_version` tetap 84). |
| 2026-11-20 | A86 | **Perbaikan konfirmasi YA Citta**: webhook Fonnte mengirim `inboxid`/`timestamp` sebagai angka, sehingga kunci dedupe jatuh ke hash isi pesan dan `YA` kedua dari grup+member yang sama selalu dibuang diam-diam (draft tetap pending, tidak ada balasan, konfirmasi manual lewat web). Kunci kini `inbox:<id>` -> hash+timestamp -> hash berjendela 60 detik, klaim dilepas bila pemrosesan gagal, duplikat dicatat di log. Pesan chat kini memuat nama hari (`formatDateIdWithDay`) di preview, ringkasan simpan/hapus, preview delete, dan deadline iklan; ringkasan simpan/hapus menampilkan jenis acara sehingga `Workshop` ditandai jelas. Tanpa migrasi (`schema_version` tetap 84). Gate: typecheck PASS; unit **863** (384 api + 167 shared + 3 wa-cron + 309 web); build PASS. |
| 2026-11-21 | A87 | **Card Report Iklan**: satu card = pengiklan + produk + batch + jenis acara; card berisi banyak baris budget (`ad_spend_reports`) dengan PPN masing-masing, status `berjalan`/`selesai`, dan order dihitung sekali per card. Card berjalan di grid atas, card selesai di tabel resume; advertiser/owner/manajer/developer bisa edit (izin baru `action.manage_spend`), buat card tetap advertiser. Migrasi `20261121120000_ad_spend_cards.sql` (`schema_version` 85): tabel `ad_spend_cards`, `card_id` + trigger kompatibilitas, backfill card per batch, 2 batch terakhir per produk + jenis acara (Offline/Online/Hybrid terpisah, report + order) jadi Berjalan, sisanya Selesai, RPC `save_ad_spend_card`/`delete_ad_spend_card` + `ad_spend_report` baru (`cards`, `rows`, `spends`). Web: grid card, modal multi-budget, tabel resume. Gate: typecheck PASS; lint PASS; unit **871** (390 api + 167 shared + 3 wa-cron + 311 web); build PASS; pgTAP **48 berkas / 1270 tes PASS**. |
| 2026-11-21 | - | **Migrasi + deploy production A87**: backup `.local-backups/prod-pre-a87-2026-11-21T06-43-59-148Z.json`; migrasi `20261121120000_ad_spend_cards.sql` diterapkan via `pg` (dry-run + apply), `schema_version` = 85 dan history tercatat. Data lama tidak berubah: 84 baris `ad_spend_reports`, spend 80.075.795,00, PPN 5.317.272,42; menjadi 16 card (14 Berjalan, 2 Selesai, 5 template order-only), 0 duplikat scope, 0 baris tanpa card. Izin manajer/owner/developer `action.manage_spend` ada; RPC dibaca sebagai developer mengembalikan 14 cards + 2 rows + summary 16. Commit `4e03646`; workflow **Deploy to Cloudflare Pages** run `44877031425` sukses; aset produksi `index-f7ToGXHU.js` memuat "Buat Card Report", "Report Berjalan", "Tambah Budget"; `POST/PATCH /api/ad-spend-cards` membalas 401 tanpa auth; `GET /report-spend` 200; `check-schema-version` = 85. |
| 2026-11-21 | A88 | **Card Report template + laporan harian + resume draft 3 bulan + sync produk**: card hanya setting (tanpa budget), tombol Tambah Laporan, tab Laporan Berjalan/Selesai, Selesai membuat resume snapshot, resume draft read-only sampai Aktifkan (timer 3 bulan dari Selesai baru), cron purge 3 bulan menyisakan resume Final. Migrasi 0086-0089: sync dua arah Add Team ? Status Produk/Pengiklan (advertiser wajib produk eksplisit; Riyan/05 dikosongkan), tabel entry + resume, backfill entry/resume, card transisi 2 batch terakhir hanya advertiser dengan produk + data, RPC baca baru. Produksi: backup `.local-backups/prod-pre-a88-2026-11-21T08-09-00-201Z.json`; dry-run + apply via `pg`; `schema_version` 89. Data lama tidak berubah: 84 baris, spend 80.075.795,00, PPN 5.317.272,42; 16 card (14 Berjalan, 2 Selesai), 84 entry, 2 resume draft, 0 entry bertumpuk; mapping 11 ? 17; advertiser Semua Produk 0. Commit `376aeda`; workflow **Deploy to Cloudflare Pages** run `44883581096` sukses; aset `index-nkG4-Fy8.js` memuat "Tambah Laporan", "Laporan Berjalan", "Laporan Selesai", "Aktifkan"; endpoint card/report/finish/activate 401 tanpa auth; `check-schema-version` = 89. Gate: typecheck PASS; lint PASS; unit **876** (392 api + 167 shared + 3 wa-cron + 314 web); build PASS; pgTAP **49 berkas / 1302 tes PASS**. |
| 2026-11-22 | A89 | **Card Report privat + Tambah Deadline multi-pengiklan**: grid Card Report kini hanya menampilkan card milik akun Advertiser; Laporan Berjalan/Selesai, KPI, sesi, dan perbandingan tetap bersama dalam scope produk (A44). Form Tambah Deadline Kalender Iklan menerima `advertiser_codes[]` dan membuat satu baris per pengiklan; pengiklan yang sudah punya deadline produk+batch dilewati dan dilaporkan, PATCH tetap satu pengiklan. Migrasi `20261122120000_ad_spend_card_privacy.sql` (`schema_version` 90) hanya mengganti `ad_spend_report` dengan CTE `visible_cards` untuk `cards[]`; tanpa perubahan tabel/data. Gate: typecheck PASS; lint PASS; unit **881** (396 api + 167 shared + 3 wa-cron + 315 web); build PASS; pgTAP **49 berkas / 1307 tes PASS**. |
| 2026-11-22 | A90 | **Reminder WA Admin Bot: sapaan semua pengiklan produk**: `mention_scope` baru `assigned` menyebut semua pengiklan aktif yang ditugaskan ke produk grup, termasuk yang tidak punya order pada jenis acara itu; `all`/`missing` lama tetap. Kolom baru `advertisers.salutation` (maks 20, diisi di Config > Pengiklan) membuat `{{mention}}` menjadi `Mas Zul, Mbak Rina` tanpa `@`; `{{advertiser_name}}` tetap nama tanpa sapaan. Satu pesan per grup + jenis acara; Citta AI `/add`/`/delete` tidak berubah. Migrasi `20261122130000_wa_reminder_assigned_salutation.sql` (`schema_version` 91): kolom sapaan + constraint, perluasan constraint `mention_scope`, `wa_reminder_claim`/`wa_reminder_preview` versi baru. Web: opsi **Semua pengiklan yang ditugaskan ke produk** di Jadwal/Kirim Tes + field **Sapaan**. Gate: typecheck PASS; lint PASS; unit **883** (398 api + 167 shared + 3 wa-cron + 315 web); build PASS; pgTAP **49 berkas / 1312 tes PASS**. |
| 2026-11-22 | - | **Migrasi + deploy production A89/A90**: backup `.local-backups/prod-pre-a89a90-2026-11-21T22-44-45-133Z.json`; migrasi 90/91 diterapkan via `pg` (dry-run + apply); `schema_version` = 91. Data lama tidak berubah: 15 card, 84 report, 84 entry, 4 resume, spend 80.075.795,00, PPN 5.317.272,42. Verifikasi RPC `ad_spend_report` sebagai akun Advertiser: card terbaca = card berjalan miliknya, `all_own` true. A90: 10 pengiklan aktif diisi `salutation` = 'Mas'; jadwal aktif 08:00 diubah ke `assigned`; template 'Pagi' menjadi 'Pagi {{mention}}, hari ini jangan lupa report yaa..'; preview produksi `found=true`, `mention_scope=assigned`, 4 pengiklan, memuat 'Mas', tanpa '@'. Commit `1eb6fb3`; workflow **Deploy to Cloudflare Pages** run `44958513887` sukses; aset produksi `index-BwDNMqDV.js` memuat 'Semua pengiklan yang ditugaskan ke produk', 'Sapaan', 'advertiser_codes', 'Card Report'; `GET /report-spend` 200; `POST /api/ad-calendar` dan `/api/ad-spend-cards` 401 tanpa auth; `check-schema-version` = 91. |
| 2026-11-22 | A91 | **Satu variabel sapaan**: `{{advertiser_name}}` kini satu-satunya placeholder yang ditawarkan untuk menyebut pengiklan dan nilainya sudah memakai sapaan, mis. `Mas Zul, Mas Andre`; `{{mention}}` tetap dikenali sebagai alias lama tetapi tidak lagi muncul di picker. Preview modal Template memakai contoh `Mas Zul, Mas Andre`, bukan `@Zul`, dan template default baru memakai `{{advertiser_name}}`. Migrasi `20261122140000_wa_advertiser_name_salutation.sql` (`schema_version` 92) mengganti `wa_render_reminder` agar `advertiser_name`, `mention`, dan `store_name` memakai daftar label bersapaan. Gate: typecheck PASS; lint PASS; unit **883** (398 api + 166 shared + 3 wa-cron + 316 web); build PASS; pgTAP **49 berkas / 1312 tes PASS**. |
| 2026-11-22 | - | **Migrasi + deploy production A91**: migrasi `20261122140000_wa_advertiser_name_salutation.sql` diterapkan via `pg` (dry-run + apply); `schema_version` = 92; tanpa perubahan data (15 card, 84 report, 84 entry, spend 80.075.795,00, PPN 5.317.272,42). Preview produksi template **Pagi** yang memakai `{{advertiser_name}}`: `found=true`, `mention_scope=assigned`, 4 pengiklan, memuat 'Mas', tanpa '@'. Commit `82fa6ae`; workflow **Deploy to Cloudflare Pages** run `44960899313` sukses; aset produksi `index-DIyMpSrS.js` memuat 'Mas Zul, Mas Andre', tidak memuat '@Zul', dan tetap memuat 'advertiser_name'; `check-schema-version` = 92. |
| 2026-11-23 | A92 | **Laporan Selesai: kolom Ditandai Selesai + arsip tanpa filter tanggal**: tabel Selesai menampilkan `finished_at` (tanggal + jam, terpisah dari Periode) dan `resumes[]` tidak lagi mengikuti filter tanggal; filter produk/pengiklan/batch/jenis acara tetap. KPI/summary tetap mengikuti rentang tanggal, Laporan Berjalan tetap terfilter. Migrasi `20261123120000_ad_spend_resume_finished_at.sql` (`schema_version` 93) memakai CTE `resume_list` untuk daftar arsip dan `resume_base` untuk KPI. Web: kolom **Ditandai Selesai** (`formatDateTime`), keterangan arsip, teks kosong diperbarui. Gate: typecheck PASS; lint PASS; unit **883** (398 api + 166 shared + 3 wa-cron + 316 web); build PASS; pgTAP belum dijalankan (Docker Desktop/supabase lokal tidak aktif). |
| 2026-11-23 | - | **Migrasi + deploy production A92**: backup `.local-backups/prod-pre-a92-2026-11-23T04-42-07-732Z.json`; dry-run + apply via `pg`; `schema_version` = 93. Data lama tidak berubah: 15 card, 87 report, 87 entry, 4 resume, spend 88.188.867,00, PPN 6.069.783,90. Verifikasi produksi: `ad_spend_report('2026-11-22','2026-11-22','MTIX')` mengembalikan 2 resume Batch 59 (finished_at 21 Nov 2026 13:44 WIB) walau ringkasan tanggal itu tidak memuat resume; rentang di luar semua data (`2027-12-01..02`) tetap mengembalikan 4 resume dengan `summary.reports = 0`. Commit `4f48dbe`; workflow **Deploy to Cloudflare Pages** run `45113544500` sukses; aset produksi `index-Cu48ZvMp.js` memuat 'Ditandai Selesai' dan 'Arsip semua laporan selesai'; `check-schema-version` = 93. |
