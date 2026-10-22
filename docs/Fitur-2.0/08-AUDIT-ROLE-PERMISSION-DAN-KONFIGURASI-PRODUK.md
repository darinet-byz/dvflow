# Audit Role, Permission, dan Konfigurasi Produk

Tanggal: 14 Oktober 2026. Cakupan: repository, database pengujian terpisah, browser lokal, serta inventaris baca-saja database aktif. Perubahan aplikasi dan migrasi **belum diterapkan ke deployment aktif**.

## Temuan dan perbaikan

| Temuan awal | Implementasi |
|---|---|
| Developer ditolak `requireConfigWriter`, karena hanya admin/master_admin diterima | Guard bersama membaca user aktif dan role terkini dari database; Developer/Owner mempunyai semua permission dan produk (master_admin legacy dihapus, A36) |
| Checklist permission tidak konsisten dengan backend | Guard permission untuk konfigurasi, tax, alias, integrasi, Zoom/tiket, scanner, remap, dan perubahan profil/password |
| JWT hanya menerima nama role lama | Role kustom dengan slug valid diterima; claim role tidak menentukan hak akses |
| Sidebar/route kembali ke fallback role saat permission kosong | Permission kosong menutup semua fitur; logout dan pemulihan profil sesi tetap tersedia |
| Pembacaan orders/attendance hanya memeriksa user aktif | RLS membatasi produk dan izin modul; setiap RPC halaman memeriksa permission modulnya |
| Service-role scanner dan konfigurasi acara melewati product scope | Daftar, pencarian, exact mapping, scoped mapping, dan check-in memeriksa penugasan produk |
| Permission dihapus lalu disisipkan satu per satu | `save_role_permissions` memvalidasi katalog, mengunci role, lalu mengganti daftar dalam satu transaksi |
| UI ketat tetapi API menerima kode alfanumerik sampai 32 karakter | Validator shared, form/generator ketat, normalisasi DB, dan constraint baru |
| Hapus permanen tanpa izin aksi/dependensi | Izin modul + `action.delete_master`; penghapusan kamus master memeriksa pemakaian, termasuk referensi historis |
| Reset memakai tabel Zoom/tiket yang tidak ada, melewatkan sesi, dan menghapus fee | Reset menggunakan mapping `app_settings`, mencakup sesi dan penugasan produk, mempertahankan fee dan transaksi |
| Integrasi nyata gagal 500 saat membuat master | Grant `EXECUTE` fungsi normalisasi untuk service_role ditambahkan; stored generated column memerlukannya |

Implementasi utama: `packages/api/src/permissions.ts`, `apps/web/src/lib/roles.ts`, migrasi `0027_permission_enforcement.sql` dan `0028_master_configuration_rules.sql`.

## Matriks role efektif

`P` berarti permission tersimpan yang diperlukan tersedia; `S` berarti produk dalam penugasan, atau flag semua produk bernilai true. Role kustom memakai pemeriksaan yang sama dengan role standar biasa.

| Role | Permission kosong | Permission diberikan/dicabut | Cakupan produk | Role & tim | Reset Data |
|---|---|---|---|---|---|
| developer | Semua fitur | Selalu penuh | Semua, mengabaikan flag terbatas | Ya | Ya |
| owner | Semua selain Reset Data | Selalu penuh | Semua | Ya | Tidak |
| manajer | Tidak ada fitur | P menentukan akses | S wajib | Tidak | Tidak |
| admin | Tidak ada fitur | P menentukan akses | S wajib | Tidak | Tidak |
| pimpro | Tidak ada fitur | P menentukan akses | S wajib | Tidak | Tidak |
| member | Tidak ada fitur | P menentukan akses | S wajib | Tidak | Tidak |
| role kustom | Tidak ada fitur | P menentukan akses | S wajib | Tidak | Tidak |

Semua baris di atas mensyaratkan user aktif. Role dan assignment terkini dibaca ulang oleh backend/RLS pada request berikutnya. JWT lama dengan claim Developer tidak menaikkan user yang sudah diturunkan. Pemberian `team.manage` atau `config.roles` kepada role biasa tidak mendelegasikan pengelolaan tim/role.

Seed permission lama tetap menjadi nilai awal; migrasi audit tidak mengganti checklist role biasa yang sudah dipilih pengguna. Role penuh memperoleh seluruh katalog secara efektif, termasuk permission yang ditambahkan sesudah role dibuat.

## Inventaris menu, tombol, endpoint, dan query

| Halaman/aksi | Permission | Jalur data / mutasi | Cakupan tambahan |
|---|---|---|---|
| `/` Dashboard | `operasional.dashboard` | RPC `dashboard_summary` | RLS orders/attendance + S, termasuk KPI |
| `/order` daftar, detail, filter, pencarian | `operasional.order` | RPC `orders_page`; detail dari baris hasil | S |
| `/presensi` daftar/detail/riwayat | `operasional.presensi` | RPC `presensi_page` | S |
| `/report-tax` | `config.report_tax` | RPC `tax_report` | S |
| `/generator` | `operasional.generator` | SELECT products/advertisers/event_types/sessions_config | Produk dropdown memakai S; kode baru harus ketat |
| `/scan-qr`, HID/kamera | `operasional.scan_qr` | POST `/checkin/:orderId` → `checkin_seminar` | S, Paid, Seminar Offline, idempotensi |
| Pencarian scanner | `operasional.scan_qr` | GET `/api/scanner/search` | Filter produk eksplisit sebelum hasil dikembalikan |
| Check-in manual | scan + `action.manual_checkin` | POST `/api/scanner/manual-checkin` | Pemeriksaan yang sama dengan QR |
| `/konfigurasi-produk`, empat kamus | `config.produk` | SELECT lewat RLS; POST/PATCH/DELETE `/api/config/:resource` | Membuat produk/kamus global perlu akses semua produk; mengubah produk sendiri memakai S |
| Bagian alias pada halaman produk | `config.alias_produk` | GET/POST/DELETE `/api/product-aliases[/:id]` | Target lama dan baru harus dalam S |
| `/konfigurasi-tax` | `config.tax` | SELECT fee rules; `/api/config/payment-fee-rules[/:id]` | Penulisan global perlu semua produk |
| `/konfigurasi-zoom` | `config.zoom` | GET/POST/DELETE `/api/webinar-destinations`; `save_webinar_destination` | S; wildcard produk global hanya user semua produk |
| `/konfigurasi-tiket` | `config.tiket` | GET/POST/DELETE `/api/seminar-tickets`; `save_seminar_ticket` | S; wildcard produk global hanya user semua produk |
| `/integrasi` termasuk tes API/salin webhook | `config.integrasi` | GET/POST/PATCH/DELETE `/api/integrations/orderonline`, GET `/:id/webhook`, POST `/:id/test` | Konfigurasi koneksi global berdasarkan permission; rahasia tidak dikembalikan dalam daftar/export |
| `/order-unmapped`, batch remap | `operasional.order_unmapped` | GET `/api/orders/unmapped`, POST `/api/orders/batch-remap` → `batch_remap_orders` | Semua produk diperlukan karena sumber belum terpetakan; simpan alias juga perlu `config.alias_produk` |
| Export tabel | Permission halaman + `action.export_data` | Tombol bersama; Order/Presensi memakai `export_orders_page` / `export_presensi_page` | S, profil diperbarui sebelum export; perubahan akses membatalkan export data cache |
| Nonaktifkan/aktifkan | Permission modul | DELETE biasa / PATCH `active` | S untuk produk; global untuk kamus bersama |
| Hapus permanen konfigurasi/alias/Zoom/tiket/koneksi | Permission modul + `action.delete_master` | DELETE; kamus menggunakan `delete_config_master` | Scope yang sama; kamus yang dipakai ditolak `MASTER_IN_USE` |
| `/profil` dan perubahan password | `account.profile` | PATCH `/api/profile`, POST `/api/auth/change-password` | Akun sendiri |
| Sesi/login/refresh/logout | User/sesi sah | `/api/auth/login`, `/refresh`, `/logout`; GET `/api/profile` | GET profil tetap tersedia untuk mengetahui pencabutan seluruh permission |
| `/konfigurasi-role` | Khusus tingkat Master Admin | `/api/roles`, `/:id`, `/:id/permissions`, `/api/permissions`; `save_role_permissions` | Role sistem tidak dihapus; role penuh tidak dapat kehilangan akses |
| `/add-team` | Khusus tingkat Master Admin | `/api/internal/users[/:id]`; RPC admin_create_user/admin_update_user | Proteksi akun sendiri dan kebijakan pembuatan Master Admin tetap berlaku |
| `/reset-data` | Developer aktif | `/api/developer/data-summary`, `/reset-data`, `/purge-unmapped` | Password Developer tetap diperiksa untuk reset; reset master terpisah |

Seluruh endpoint yang terdaftar di `packages/api/src/routes.ts` masuk inventaris ini. Endpoint publik peserta `GET /access/[kodeToko/]:orderId` dan `GET /checkin/:orderId` tetap memakai kontrak akses peserta yang sudah ada; GET tidak melakukan check-in seminar. Webhook memakai secret jalur/koneksi, bukan role operator. POST check-in tetap memerlukan JWT operator dan scope produk.

### Batas database

- Browser tidak mendapat hak INSERT/UPDATE/DELETE pada tabel. RPC tulis dengan parameter actor hanya dapat dieksekusi service_role, sehingga browser tidak dapat mengirim actor milik Developer.
- `orders` dapat dibaca jika salah satu modul yang memang memerlukan baris order diberikan (Order, Presensi, Dashboard, Report Tax), selalu dibatasi S. RPC setiap halaman tetap memerlukan key modul yang tepat. Permission antarmodul ini bukan pembatasan kolom pada tabel orders.
- `attendance_events` dibatasi modul yang memakai kehadiran serta order yang terlihat. Master produk dibatasi S; kamus pengiklan/tipe/sesi dibaca oleh modul yang menggunakannya. Fee rule dibatasi modul tax/laporan/data operasional.
- `users` hanya profil sendiri dan kolom aman; permission-role hanya role sendiri atau tingkat Master Admin; assignment hanya sendiri atau tingkat Master Admin. Katalog nama role/permission hanya untuk user aktif.
- `app_sessions`, `app_settings`, `webhook_logs`, `product_aliases`, koneksi dan sumber webhook tetap tanpa akses browser langsung. Jalur service-role memeriksa permission/scope secara eksplisit.
- Export resmi diperiksa server untuk Order/Presensi. Izin export tidak dapat mencegah seseorang menyimpan sendiri data yang memang sudah boleh dibacanya.

## Standar konfigurasi

| Master | Aturan penulisan |
|---|---|
| Produk | Tepat empat huruf ASCII kapital, contoh `BOMM`, `KULI` |
| Pengiklan | Tepat dua digit, string; `01` tetap `01` |
| Tipe | Tepat dua huruf kapital; `kind` wajib `seminar` atau `webinar` |
| Sesi | `ST`, `S1` sampai `S8` |
| Nama | Dipangkas spasi tepinya; wajib, maksimal 200 karakter |

Huruf kode dikapitalisasi dan spasi tepi dibuang. Kode empat kamus unik termasuk baris nonaktif. Identifier fee tetap mengikuti aturan terpisah: unik di antara rule aktif. Parser tetap membaca kamus, termasuk baris nonaktif untuk order historis; nama produk/pengiklan bisnis tidak di-hardcode.

Generator baru menggunakan validator ketat. Parser historis dan remap transisi tetap dapat membaca kamus legacy; tidak ada penulisan ulang otomatis `product_raw` atau snapshot transaksi. Pemeriksaan kombinasi ambigu API tetap dipertahankan. Kode/kind master yang sudah dipakai tidak dapat diganti, untuk menjaga arti transaksi lama.

Constraint baru dipasang `NOT VALID`: data legacy tidak dihapus atau dinormalisasi massal saat migrasi, tetapi INSERT/UPDATE baru wajib memenuhi constraint. Konsekuensinya, baris legacy dengan kode tidak standar tidak bisa diedit atau dinonaktifkan sebelum masalah kode diselesaikan; bila sudah direferensikan transaksi, penyelesaiannya memerlukan migrasi data tersendiri. Jangan mengubah transaksi untuk meloloskan constraint tanpa keputusan pengguna. Cleanup aman memvalidasi constraint kode setelah master lama dibersihkan.

Hapus kamus mengambil lock, memeriksa order/snapshot, alias, aturan acara, dan assignment; referensi yang mungkin ambigu ditolak secara konservatif. Nonaktifkan tetap tersedia untuk master yang memenuhi standar. HTTP 409 `MASTER_IN_USE` digunakan bila masih dipakai. Endpoint, metode, dan envelope `{ok,data}` / `{ok:false,error}` yang ada dipertahankan.

## Pembaruan UI dan sesi

- Sidebar, route, dan tombol memakai permission efektif yang sama. Tanpa permission tidak ada fallback berbasis nama role.
- Profil dimuat ulang saat navigasi, window focus, dan penolakan akses. Jika pembacaan profil gagal, profil UI dikosongkan sehingga role penuh yang basi tidak membuka fitur; focus berikutnya dapat memulihkan sesi.
- Perubahan role/permission/produk meremount isi aplikasi agar data cache dari cakupan lama tidak ditampilkan.
- User terbatas tidak ditawarkan pembuatan master global, pilihan Zoom/tiket global, atau menu unmapped. Tombol hapus memerlukan izin aksi. Checklist alias remap hanya tampil jika izinnya tersedia.

## Inventaris aktif dan cleanup

Inventaris baca-saja dilakukan pada project `szceinidcebvzulbdwek`. Tidak ada penghapusan atau migrasi yang dijalankan pada database tersebut.

| Data | Jumlah saat inventaris |
|---|---:|
| orders | 1 |
| attendance_events | 0 |
| products | 2 |
| advertisers | 1 |
| event_types | 2 |
| sessions_config | 9 |
| product_aliases | 0 |
| user_product_access | 0 |
| mapping Zoom/tiket di app_settings | 1 |

Cadangan konfigurasi tersimpan lokal dan diabaikan Git: `.local-backups/product-configuration-1791960831411.json`. SHA256: `16893e5cb714ade59be8fceb4d729057d2f8c9b3fb1c9711a4bc33b7ed70b887`.

**Cleanup diblokir karena masih ada satu order.** Pemeriksaan konservatif menolak reset master selama ada transaksi, termasuk order belum terpetakan yang mungkin memerlukan kamus lama. Izin membersihkan konfigurasi tidak digunakan untuk menghapus order/presensi. Cadangan ini mencakup konfigurasi, bukan backup transaksi lengkap.

Riwayat migrasi database aktif hanya mencatat sampai 0023, sedangkan objek fitur 0024–0026 telah ditemukan. Ini adalah ketidaksesuaian riwayat/skema yang harus direkonsiliasi sebelum deployment; jangan menjalankan ulang seed permission 0024 secara membabi buta atau sekadar menandai migrasi applied tanpa memeriksa definisi aktual.

Script `scripts/reset-product-configuration.mjs` secara default hanya melakukan inventaris dan backup. Mode `--apply` memerlukan project tujuan tepat dan UUID Developer, mengambil lock serta backup sebelum penghapusan, lalu menjalankan reset dalam transaksi. Flag `has_all_product_access` user tidak diubah: assignment kosong tetap terbatas. Reset hanya menghapus empat kamus, alias, mapping Zoom/tiket, dan assignment, kemudian mengisi sembilan sesi; akun, permission, koneksi, tax, orders, dan presensi dipertahankan.

## Pengujian dan penerapan

Perintah reproduksi dari root repository:

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build
# Docker + Supabase lokal harus berjalan; database lokal yang ada tidak di-reset.
npm run db:start
npm run test:rbac:db
npm run test:rbac:integration
npx playwright install chromium
npm run test:rbac:browser
# Alternatif browser yang sudah terpasang di Windows:
$env:RBAC_BROWSER_CHANNEL='msedge'
npm run test:rbac:browser
```

Harness membuat database PostgreSQL sementara, menerapkan semua 28 migrasi, menjalankan pgTAP, dan menghapus database sementara setelah selesai. Pengujian integrasi menggunakan PostgREST terpisah; browser memakai React dan handler API asli dengan key uji sementara. Browser dibatasi ke localhost. Empat pemeriksaan pg_cron dilewati karena extension itu hanya tersedia pada database utama cluster; tes cron asli tetap ada untuk `supabase test db` pada database yang sesuai.

Bukti yang diuji: matriks role biasa/kustom diberi izin, dicabut, dan kosong; tiga role penuh; user nonaktif dan claim role basi; scope baca/RPC/KPI/export/check-in; penolakan konfigurasi global; validasi kode/nama/kind/duplikat; rollback kegagalan INSERT permission setelah DELETE; cleanup ditolak saat ada transaksi, sembilan sesi, perlindungan tax, dan rollback. Browser membuktikan Developer login/membuat/mengedit/menonaktifkan produk, akun custom hanya membaca produk sendiri, penolakan URL/API langsung, serta pencabutan izin tanpa login ulang. Screenshot lokal ada di `.local-backups/browser-audit/`.

Urutan penerapan yang masih diperlukan di deployment aktif:

1. Rekonsiliasi definisi skema dan riwayat migrasi 0024–0026; backup database penuh sebelum perubahan skema aktif.
2. Terapkan 0027 dan 0028 setelah prasyarat sesuai, lalu reload schema cache PostgREST. Migrasi tidak menjalankan cleanup.
3. Deploy backend dan frontend dari revisi yang sama; ulangi login Developer, buat kode empat huruf, dan uji user terbatas pada deployment tujuan.
4. Selesaikan dependensi satu order melalui keputusan migrasi data tersendiri. Selama masih ada transaksi, cleanup tetap berhenti. Jangan gunakan opsi reset transaksi sebagai jalan pintas.

Hasil lokal bukan bukti deployment aktif sudah berubah. Pengujian ini juga tidak memverifikasi perangkat scanner fisik atau payload OrderOnline eksternal baru.

## Penyelesaian lanjutan (14 Oktober 2026)

- Reset konfigurasi kini mengisi kembali tipe acara kanonik SO/WO (parser tidak dapat bekerja tanpanya, lihat 0006), selain sembilan sesi; constraint panjang nama ikut divalidasi.
- `master_is_used` memakai pencocokan token utuh (`master_code_in_text`); sebelumnya sesi `ST` dan tipe seperti `TI`/`IN` salah terdeteksi "dipakai" oleh teks prefix kunci Zoom/tiket.
- `tax_report` memakai satu guard (`DF006`); cabang `DF012` lama tidak pernah tercapai.
- Add Team menolak kode produk yang tidak dikenal (sebelumnya RPC melewatinya diam-diam).
- Guard ganda pada hapus Zoom/tiket/koneksi digabung (`requirePermissions`, satu pencarian user).
- Edit master memvalidasi kode ketat hanya untuk baris baru atau kode yang berubah, sehingga baris legacy tetap dapat diganti nama/dinonaktifkan; Pengiklan hanya menerima digit; sidebar fail-closed tanpa profil.
- Catatan terbuka: sidebar aplikasi (15 item) menyimpang dari CLAUDE.md §5 (10 item) sejak sebelum perubahan ini — perlu keputusan produk. Profil dikosongkan saat pembacaan gagal adalah keputusan fail-closed yang disengaja.
- Verifikasi lokal: typecheck, lint, test (api 203, shared 100, web 117), `npm run test:rbac:db` (7 berkas pgTAP, 0 gagal) lulus. Belum diterapkan ke deployment aktif.

## Audit lanjutan dan perbaikan (14 Oktober 2026, sore)

**Gejala:** tombol seperti Hapus di Konfigurasi Produk menampilkan "Terjadi kesalahan pada server".

**Akar masalah:** push ke `main` otomatis di-deploy, sedangkan database produksi belum menerapkan 0027/0028 (riwayatnya pun baru tercatat sampai 0023). RPC yang dipanggil kode tidak ada, dan error PostgREST `PGRST202` tidak dipetakan. Router juga tidak me-log penyebab 500.

| Area | Temuan | Perbaikan |
|---|---|---|
| Deploy | Kode bisa ter-deploy di atas DB lama | `schema_version()` (0029) + langkah CI `scripts/check-schema-version.mjs` |
| Error | Objek skema hilang, FK, dan format UUID → 500 | `SCHEMA_OUT_OF_DATE` 503, `23503`→`MASTER_IN_USE`, `22P02`→`INVALID_ARGUMENT`; 23505 dibedakan per constraint; router me-log SQLSTATE + rute saja |
| Error | Pesan validasi (Zoom, alias, role, fee, integrasi, Add Team, reset) hilang | Dikirim sebagai `publicMessage` |
| Router | `/access/%E0%A4` melempar `URIError` | Percent-encoding rusak → 404 |
| Pages | `/access/:kodeToko/:orderId` jatuh ke `index.html` | `functions/access/[[path]].ts`; smoke test ditambah |
| Peserta | Error DB pada halaman peserta → JSON 500 | Halaman `GENERIC_ACCESS_ERROR` |
| Peserta | Order beralias tidak cocok dengan rule Zoom/tiket exact | Target alias ikut menjadi kandidat key |
| Remap | Webhook berikutnya membatalkan remap; order valid ikut ter-remap | Alias nama asli disimpan; filter `invalid` (0029) |
| Kamus | `master_is_used` meloloskan pengiklan/tipe di dalam blok kode | Parse struktur nama kanonik dan key scope (0029) |
| Kamus | Edit nama baris legacy ditolak karena kode dikirim ulang | Kode yang tidak berubah tidak divalidasi ulang |
| Tax | Aktifkan ulang fee rule duplikat → pesan salah | Pemeriksaan identifier aktif → `IDENTIFIER_TAKEN` |
| Integrasi | Mengganti kode toko memecah Order ID | Kode toko immutable (API + UI) |
| Tim | Hapus user tanpa hierarki; ID non-UUID → 500 | RPC `admin_delete_user`; `22P02` terpetakan |
| Tim | Role kustom tidak muncul di Add Team | Opsi dari `GET /api/roles`; default role baru `member` |
| Role | Hapus Role aktif walau masih dipakai | Tombol nonaktif bila `user_count > 0`; kode `ROLE_IN_USE`/`SYSTEM_ROLE_CANNOT_BE_DELETED` |
| Zoom/Tiket | Edit scope meninggalkan rule lama | `original_key` dibuang setelah rule baru tersimpan |
| Unmapped | Pencarian mentah ke filter PostgREST; tanpa paging/debounce | `buildIlikeOrFilter`, `has_more`, debounce 300 ms, pilihan direset |
| Reset Data | Checkbox tidak bisa dicentang lewat kartu; hitungan maksimum 1000 | `onChange` pada input; `countRows` (COUNT exact) |
| UI | Daftar kode alias basi setelah master berubah; error daftar kode tidak tampil; form profil kosong | `configVersion`; `ErrorState`; sinkronisasi profil |
| Kode mati | `profileFromRow`, `profileFromVerified`, `identityErrorCode` | Dihapus |

**Data:** atas keputusan pengguna, seluruh data trial dihapus (`scripts/wipe-trial-data.mjs`). DB lokal sudah dimigrasi ke 0029 dan dibersihkan. Untuk produksi, ikuti dok 09.

**Belum dikerjakan:**

- Ekstraksi komponen bersama untuk pembangun nama kanonik (Alias + Unmapped) dan form scope (Zoom + Tiket). Ini refactor tanpa perubahan perilaku dan ditunda supaya tidak menambah risiko.
- Modal panjang (checklist permission, remap, edit tim) belum dipindah ke drawer.
- `npm run lint` tidak memeriksa apa pun karena tidak ada workspace yang punya skrip lint.
