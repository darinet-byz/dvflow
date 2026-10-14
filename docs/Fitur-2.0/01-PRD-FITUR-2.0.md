# PRODUCT REQUIREMENT DOCUMENT (PRD) — FITUR 2.0

> Pembaruan 14 Oktober 2026: aturan hasil implementasi dan matriks akses ada di [audit RBAC dan konfigurasi produk](./08-AUDIT-ROLE-PERMISSION-DAN-KONFIGURASI-PRODUK.md). Jika contoh rancangan lama berbeda, acuan terbaru adalah laporan tersebut dan AMENDMENTS A13.

## dvflow: Enterprise RBAC, Scoped Product Access & Flexible Scanner Architecture

Dokumen Versi: 2.0  
Status: Draf Spesifikasi Lengkap  
Tanggal: Oktober 2026  
Target Sistem: Cloudflare Workers, React Frontend, PostgreSQL (Supabase)

---

## 1. Latar Belakang & Ringkasan Eksekutif

Pada versi 1.0, aplikasi **dvflow** telah berhasil mengotomasi integrasi webhook OrderOnline, rekonsiliasi pembayaran, presensi webinar via redirect Zoom cerdas berjenjang, tiket barcode seminar 1x scan, serta laporan finansial/pajak.

Namun, seiring bertambahnya skala organisasi acara dan kebutuhan tata kelola tim yang lebih profesional, muncul kebutuhan operasional krusial:
1. **Fleksibilitas Perangkat Scanner Lapangan**: Panitia di pintu masuk (*gate*) memerlukan kecepatan pemindaian tinggi. Selain kamera bawaan ponsel/laptop, diperlukan kepastian dukungan untuk scanner barcode/QR eksternal berbasis USB atau Bluetooth (scanner gun/stand).
2. **Kustomisasi Role & Hak Akses (Dynamic RBAC)**: Role tidak boleh lagi dipaku kaku hanya pada 3 jenis (*master_admin, admin, staff*). Master Admin membutuhkan dashboard khusus untuk membuat role baru dan mencentang hak akses (*permission checklist*) per modul secara granular.
3. **Penyebutan Role Spesifik Organisasi**: Standarisasi penamaan role menjadi 6 tingkat hierarki: **Developer, Owner, Manajer, Admin, Pimpro, Member**.
4. **Kebersihan Antarmuka (Strict Menu Hiding)**: Anggota tim (*member*) yang login tidak boleh melihat menu yang dinonaktifkan (abu-abu/disabled). Menu yang tidak memiliki izin harus **disembunyikan sepenuhnya** dari sidebar untuk menjaga privasi fitur dan kesederhanaan visual.
5. **Pembatasan Data Berbasis Produk (*Product-Level Scoping*)**: Terutama untuk **Pimpro (Pimpinan Proyek)** dan **Member**, akses data harus dapat dibatasi hanya pada produk tertentu yang ditugaskan (misal: Pimpro hanya mengelola *Kuliner Masteri*, tidak boleh melihat order atau presensi *Bisnis Masteri*).

---

## 2. Aktor & Definisi 6 Role Standar

Sistem mendefinisikan 6 role acuan dengan karakteristik otoritas sebagai berikut:

| No | Nama Role | Deskripsi & Lingkup Otoritas | Rekomendasi Lingkup Produk |
|---|---|---|---|
| 1 | **Developer** | Tim teknis sistem. Akses penuh ke seluruh konfigurasi, log teknis, integrasi API & webhook, serta konfigurasi role & permission. | Semua Produk (*All*) |
| 2 | **Owner** | Pemilik bisnis / pimpinan tertinggi. Akses penuh ke seluruh data omzet, mutasi order, presensi, tax report, manajemen tim, dan konfigurasi operasional. | Semua Produk (*All*) |
| 3 | **Manajer** | Pengelola operasional multi-acara. Memantau dashboard, memeriksa order, presensi, mengatur tautan Zoom, dan konfigurasi tiket acara. | Semua Produk (*All*) |
| 4 | **Admin** | Tim administrasi harian. Menangani data order, presensi acara, scan QR di lapangan, serta tautan acara. | Semua Produk (*All*) |
| 5 | **Pimpro** *(Pimpinan Proyek)* | Penanggung jawab satu atau beberapa produk/acara spesifik. Hanya boleh memantau dashboard, order, dan presensi untuk **produk yang ditugaskan kepadanya**. | **Produk Tertentu (*Scoped*)** |
| 6 | **Member** *(Staff / Operator)* | Tim lapangan / petugas registrasi di gate acara. Bertugas memindai QR code tiket, presensi peserta, atau melihat data order terbatas untuk produk acaranya. | **Produk Tertentu (*Scoped*)** |

---

## 3. Spesifikasi Rinci 6 Fitur Baru

### Fitur 1: Fleksibilitas Scanner QR (Skema B: Mode Kamera HP vs Mode Scanner Stick USB)
- **Tujuan**: Memastikan meja registrasi dapat beroperasi super cepat menggunakan laptop + scanner stick/gun fisik (USB/Bluetooth), tablet, maupun smartphone.
- **Implementasi Skema B (Dua Mode & Tombol Terpisah)**:
  1. **Mode 1: `Kamera HP / Webcam` (Tombol: `[ Nyalakan Kamera ]`)**:
     - Membuka stream kamera menggunakan HTML5 `getUserMedia` (ada preview video kotak).
     - Menampilkan dropdown pemilih kamera jika laptop terhubung dengan webcam USB eksternal.
     - Cocok untuk panitia yang memegang smartphone atau tablet di lapangan.
  2. **Mode 2: `Scanner Stick USB / Bluetooth` (Tombol: `[ Aktifkan Scanner Stick ]`)**:
     - **Tanpa izin kamera browser** dan **tanpa preview video** (hemat baterai & 0% beban CPU laptop).
     - Bekerja menggunakan mode input keyboard berkecepatan tinggi (HID Keyboard Wedge).
     - Saat laser scanner menembak QR tiket, scanner otomatis mengetikkan payload dan menekan `Enter`.
     - Halaman `/scan-qr` menangkap input ini secara instan dan memproses check-in dengan suara *beep* sukses.

### Fitur 2: Menu Konfigurasi Role & Permission (Eksklusif Master Admin)
- **Tujuan**: Memberikan kendali penuh kepada Developer & Owner untuk mendefinisikan peran tim.
- **Lokasi Menu**: Di bawah kategori **KONFIGURASI** -> **Konfigurasi Role** (`/konfigurasi-role`).
- **Visibilitas**: **HANYA tampil** jika user yang login memiliki hak akses Master Admin (`Developer` atau `Owner`).
- **Kemampuan CRUD**:
  - **Create**: Menambah role baru dengan input Nama Role, Kode Role, dan deskripsi.
  - **Read**: Menampilkan tabel seluruh role, jumlah user yang memakai role tersebut, dan ringkasan hak aksesnya.
  - **Update**: Mengedit nama role dan mengubah centang hak akses (*permission checklist*).
  - **Delete**: Menghapus role non-sistem (hanya jika tidak ada user yang sedang menggunakan role tersebut).

### Fitur 3: Strict Menu Hiding (Sembunyikan Menu Tanpa Izin)
- **Tujuan**: Menghilangkan polusi visual dan menjaga keamanan informasi.
- **Perilaku UI**:
  - Menu yang **tidak diizinkan** bagi user yang sedang login **TIDAK DITAMPILKAN SAMA SEKALI** di Sidebar (bukan sekadar di-*disable* atau diwarnai abu-abu).
  - Jika seluruh item di dalam satu grup kategori (misal: grup *KONFIGURASI*) tidak ada yang diizinkan untuk role tersebut, maka judul kategori *KONFIGURASI* otomatis **hilang**, sehingga sidebar tampak rapi dan ringkas.
  - **Route Protection**: Jika user mencoba mengetikkan URL manual di address bar browser untuk halaman yang tidak diizinkan, aplikasi otomatis me-redirect ke halaman utama yang diizinkan (misal: `/scan-qr` atau `/order`) dengan alert peringatan.

### Fitur 4: Kustomisasi Checklist Permission per Fitur
- **Tujuan**: Fleksibilitas penentuan hak akses hingga level tombol/menu.
- **Kategori Checklist Permission**:
  1. **Modul Operasional**:
     - `operasional.scan_qr` (Akses halaman Scan QR)
     - `operasional.dashboard` (Melihat Dashboard Resume & KPI)
     - `operasional.order` (Melihat & memfilter daftar Order)
     - `operasional.presensi` (Melihat tabel Presensi Acara T1-T10)
     - `operasional.generator` (Akses Product Name Generator)
  2. **Modul Konfigurasi**:
     - `config.produk` (CRUD Konfigurasi Produk, Pengiklan, Sesi)
     - `config.tax` (CRUD Konfigurasi Tax & Fee Payment)
     - `config.report_tax` (Membuka Laporan Pajak / Report Tax)
     - `config.zoom` (Mengatur Mapping Link Zoom Webinar)
     - `config.tiket` (Mengatur Konfigurasi Tiket Seminar & Lokasi)
     - `config.integrasi` (Mengelola API Token & Webhook OrderOnline)
     - `config.roles` (Mengelola Role & Permission — Khusus Master Admin)
  3. **Modul Manajemen Akun & Tim**:
     - `team.read` (Melihat daftar anggota tim)
     - `team.create` (Menambah anggota tim baru)
     - `team.edit` (Mengedit akun & mengubah password anggota tim)
     - `team.delete` (Menghapus akun anggota tim)
     - `account.profile` (Melihat & mengubah profil/password pribadi)
  4. **Modul Aksi Spesifik**:
     - `action.export_data` (Download CSV pada tabel yang diizinkan; Order dan Presensi memakai key yang sama)
     - `action.manual_checkin` (Melakukan check-in manual via Order ID/No HP)

### Fitur 5: Penugasan Akses Berbasis Produk (*Product-Level Scoping*)
- **Tujuan**: Memisahkan kerahasiaan data antar produk dan mencegah tim salah mengelola acara lain.
- **Implementasi pada Menu Add Team / Edit Team**:
  - Terdapat pilihan **Cakupan Akses Produk**:
    - **Pilihan 1: `Semua Produk (All Products)`** (Default untuk Owner, Manajer, Admin, Developer). User dapat mengakses data order & presensi lintas semua produk.
    - **Pilihan 2: `Produk Tertentu (Specific Products)`** (Ditujukan untuk Pimpro & Member).
  - Ketika memilih *Produk Tertentu*, muncul daftar *checkbox* berisi seluruh produk aktif yang terdaftar di **Konfigurasi Produk** (misal: `[v] Kuliner Masteri (KM)`, `[ ] Bisnis Masteri (BM)`).
  - Admin/Master Admin dapat mencentang 1 atau lebih produk yang diizinkan untuk user tersebut.

### Fitur 6: Penegakan Scoping Data di Seluruh Halaman (*Data Level Enforcement*)
- **Tujuan**: Menjamin bahwa user berpembatasan produk tidak bisa melihat data di luar otoritasnya melalui cara apa pun.
- **Perilaku di Sisi Frontend & Backend (Berlaku di Semua Fitur Berbasis Produk)**:
  1. **Presensi Acara (`/presensi`)**: Tabel kehadiran hanya menampilkan peserta dari produk yang diizinkan. Dropdown filter produk hanya memuat produk miliknya, dan kartu KPI (Hadir, Belum Hadir, Attendance Rate) dihitung murni dari produk tersebut.
  2. **Halaman Order (`/order`)**: Tabel order hanya memuat baris order dari produk yang diizinkan. Filter dropdown dan ekspor data hanya mencakup produk tersebut.
  3. **Dashboard Resume (`/`)**: Kartu KPI (Leads, Paid, Pending, Gross Revenue, Net Revenue) dan grafik omzet otomatis hanya menghitung transaksi dari produk yang diizinkan.
  4. **Report Tax (`/report-tax`)**: Jika role diizinkan membuka Report Tax, tabel rekapitulasi omzet dan potongan pajak hanya menampilkan data produk yang diizinkan.
  5. **Konfigurasi Zoom & Tiket**: Jika role diizinkan mengatur Zoom/Tiket, dropdown produk dan daftar mapping hanya menampilkan produk yang menjadi wewenangnya.
  6. **Halaman Scan QR (`/scan-qr`)**: Jika operator memindai tiket peserta dari produk lain di luar wewenangnya, server menolak check-in dengan pesan: *"Akses ditolak: Tiket ini milik produk lain ([Nama Produk]) dan di luar wewenang acara Anda."*
  7. **Keamanan Database (SQL & RLS)**: Pembatasan dieksekusi di level query database (klausa SQL `WHERE o.product_code IN (...)`), sehingga tidak dapat dimanipulasi melalui inspect element / request browser.

---

## 4. Kriteria Keberhasilan & Penerimaan (*Acceptance Criteria*)

1. **AC-01 (Scanner Hardware)**: Barcode scanner USB/Bluetooth tipe HID dapat langsung dipakai di `/scan-qr` tanpa perlu klik tombol izin kamera browser, dan berhasil melakukan check-in instan.
2. **AC-02 (Role Configuration UI)**: Master Admin dapat membuat role baru (misal: *Koordinator Lapangan*), memilih checklist permission, lalu meng-assign role tersebut ke akun tim.
3. **AC-03 (Menu Hiding)**: Member yang hanya memiliki permission `operasional.scan_qr` saat login HANYA melihat menu *Scan QR* dan *Profil* di sidebar; menu *Dashboard*, *Order*, *Presensi*, dan seluruh *Konfigurasi* tidak tampak sama sekali.
4. **AC-04 (Product Scoping Pimpro/Member)**: Akun Pimpro yang hanya di-assign produk `KM` tidak dapat melihat data omzet atau order produk `BM`, baik melalui tampilan tabel, pencarian, maupun kartu ringkasan KPI.
5. **AC-05 (Integritas Base Code)**: Seluruh 375 automated tests yang sudah ada tetap berjalan hijau, dan migrasi skema database baru tidak merusak data user atau transaksi lama.

