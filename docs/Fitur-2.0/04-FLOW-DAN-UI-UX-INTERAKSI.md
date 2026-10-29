# ALUR KERJA (FLOW) & PANDUAN UI/UX DETAIL (FITUR 2.0)

> Pembaruan 14 Oktober 2026: aturan hasil implementasi dan matriks akses ada di [audit RBAC dan konfigurasi produk](./08-AUDIT-ROLE-PERMISSION-DAN-KONFIGURASI-PRODUK.md). Jika contoh rancangan lama berbeda, acuan terbaru adalah laporan tersebut dan AMENDMENTS A13.

## dvflow: Tata Letak Antarmuka, Interaksi CRUD, Menu Hiding, dan Scoping Produk

Dokumen Versi: 2.0  
Fokus: Detail Interaksi Setiap Menu, Tombol, Modal, dan Validasi

---

## 1. Arsitektur Navigasi & Aturan *Strict Menu Hiding*

### A. Perubahan Perilaku Sidebar (`Sidebar.tsx`)
Pada versi 1.0, menu yang tidak memiliki izin ditampilkan dalam keadaan dinonaktifkan (abu-abu / disabled).  
Pada **Fitur 2.0**:
1. **Penyembunyian Mutlak**: Menu yang tidak memiliki izin **TIDAK DITAMPILKAN SAMA SEKALI** (elemen DOM `<li>` dihilangkan).
2. **Pembersihan Section Otomatis**: Jika seluruh item di dalam sebuah kategori/section (misal: `KONFIGURASI`) tersembunyi, maka judul header kategori tersebut juga **otomatis disembunyikan**.

### B. Simulasi Tampilan Sidebar Berdasarkan Role

#### 1. Tampilan Developer & Owner (Akses Penuh):
```
dvflow [Operasional event]
------------------------------
OPERASIONAL
  [ ] Scan QR
  [ ] Dashboard
  [ ] Order
  [ ] Presensi Acara
  [ ] Product Name Generator
KONFIGURASI
  [ ] Konfigurasi Produk
  [ ] Konfigurasi Tax
  [ ] Report Tax
  [ ] Konfigurasi Zoom
  [ ] Konfigurasi Barcode / Tiket
  [ ] API & Webhook
  [ ] Konfigurasi Role            <-- Hanya tampil untuk Master Admin
ACCOUNT
  [ ] Add Team
  [ ] Profil
  [ ] Logout
```

#### 2. Tampilan Pimpro (Fokus Kelola Acara):
*(Tidak memiliki akses Konfigurasi Teknis / Tax / Team)*
```
dvflow [Operasional event]
------------------------------
OPERASIONAL
  [ ] Dashboard            (Data otomatis ter-filter ke produknya)
  [ ] Order                       (Data otomatis ter-filter ke produknya)
  [ ] Presensi Acara              (Data otomatis ter-filter ke produknya)
ACCOUNT
  [ ] Profil
  [ ] Logout
```
> *Perhatikan: Kategori "KONFIGURASI" hilang total dari pandangan Pimpro.*

#### 3. Tampilan Member / Operator Gate (Fokus Registrasi Lapangan):
```
dvflow [Operasional event]
------------------------------
OPERASIONAL
  [ ] Scan QR
  [ ] Presensi Acara              (Untuk mengecek jika ada komplain peserta)
ACCOUNT
  [ ] Profil
  [ ] Logout
```
> *Tampilan super ringkas, bersih, dan bebas distraksi untuk panitia lapangan.*

---

## 2. Menu Baru: Konfigurasi Role & Permission (`/konfigurasi-role`)

### A. Hak Akses Masuk
- Hanya dapat dibuka oleh akun dengan role **Developer** atau **Owner** (role legacy master_admin dihapus di A36; `config.roles` tetap khusus tingkat Master Admin).
- Role lain yang mencoba membuka URL langsung akan otomatis diarahkan kembali ke `/` dengan toast merah: *"Akses ditolak: Menu ini khusus Master Admin"*.

### B. Tampilan Halaman Utama (`RoleConfigPage`)
1. **Header**:
   - Judul: `Konfigurasi Role & Hak Akses`
   - Subjudul: `Atur hak akses menu, tombol, dan kapabilitas fitur untuk setiap peran pengguna.`
   - Tombol Aksi Kanan: `[ + Tambah Role Baru ]` (Tombol primary warna ungu/biru gradien).
2. **Tabel Daftar Role**:
   - Kolom 1: **Nama Role** (Badge tebal: Developer, Owner, Manajer, Admin, Pimpro, Member, dll).
   - Kolom 2: **Slug / ID** (`developer`, `owner`, `pimpro`, dll).
   - Kolom 3: **Deskripsi**.
   - Kolom 4: **Jumlah User Aktif** (Badge netral: misal `3 Pengguna`).
   - Kolom 5: **Total Hak Akses** (misal `14 dari 17 fitur diizinkan`).
   - Kolom 6: **Aksi**:
     - Tombol `[ Atur Hak Akses ]` (Membuka modal checklist permission).
     - Tombol `[ Hapus ]` (Khusus role kustom buatan admin; dinonaktifkan untuk role sistem).

---

### C. Alur Tambah Role Baru (`Modal Tambah Role`)
1. Klik tombol `[ + Tambah Role Baru ]`.
2. Muncul modal dialog:
   - **Nama Role**: Input teks (Wajib, misal: `Koordinator Konsumsi`).
   - **Kode Role (Slug)**: Terisi otomatis dari nama (huruf kecil & garis bawah: `koordinator_konsumsi`).
   - **Deskripsi**: Textarea opsional (misal: `Petugas pembagian konsumsi di seminar`).
   - **Checklist Hak Akses (Matrix Grouping)**:
     - Disusun rapi per kategori kotak (*card*):
       - **Kategori Operasional**: Checkbox untuk Scan QR, Dashboard, Order, Presensi, Generator.
       - **Kategori Konfigurasi**: Checkbox untuk Produk, Tax, Zoom, Tiket, Integrasi.
       - **Kategori Manajemen Akun**: Checkbox untuk Team & Profil.
       - **Kategori Aksi Khusus**: Checkbox untuk Export Data & Manual Check-in.
     - Setiap kategori memiliki tombol shortcut: `[ Centang Semua ]` / `[ Kosongkan ]`.
3. Klik tombol `[ Simpan Role ]`:
   - Validasi: Nama role tidak boleh kosong dan tidak boleh kembar.
   - Mengirim request `POST /api/roles`.
   - Tabel langsung ter-refresh dan muncul notifikasi hijau: *"Role Koordinator Konsumsi berhasil dibuat"*.

---

### D. Alur Edit Hak Akses Role (`Modal Atur Hak Akses`)
1. Pada baris role yang ingin diubah (misal: `Member`), klik tombol `[ Atur Hak Akses ]`.
2. Muncul modal berisi checklist hak akses yang saat ini aktif untuk role tersebut.
3. Master Admin dapat mencentang fitur baru (misal: memberi izin `operasional.generator` kepada Member) atau mencopot fitur tertentu.
4. Klik `[ Perbarui Hak Akses ]`:
   - Mengirim request `PUT /api/roles/:id/permissions`.
   - Seluruh pengguna yang sedang login dengan role tersebut akan langsung terpengaruh pada request berikutnya tanpa perlu relogin.

---

### E. Alur Hapus Role
1. Pada baris role kustom, klik tombol `[ Hapus ]`.
2. **Validasi Pengaman (Safety Safeguards)**:
   - Jika role tersebut adalah role sistem (`Developer, Owner, Manajer, Admin, Pimpro, Member`): Tombol hapus tidak dapat diklik dengan tooltip: *"Role bawaan sistem tidak dapat dihapus"*.
   - Jika role tersebut masih digunakan oleh 1 atau lebih user: Muncul dialog peringatan merah:  
     *"Tidak dapat menghapus role ini karena masih digunakan oleh 2 anggota tim. Ubah role anggota tim terkait terlebih dahulu."*
3. Jika aman (tidak ada user yang memakai): Muncul modal konfirmasi hapus standar -> Role dihapus dari database.

---

## 3. Penyesuaian Menu Add Team (`/add-team`): Penugasan Produk

Pada menu **Add Team** dan drawer **Edit Anggota Tim**, form input diperbarui dengan komponen penugasan produk (*Product Scoping Selector*).

### A. Tampilan Form Tambah / Edit Tim
1. **Username**: Input teks (huruf kecil, tanpa spasi).
2. **Display Name**: Nama lengkap pengguna (misal: *Budi Santoso*).
3. **Password**: Input kata sandi (minimal 8 karakter).
4. **Pilihan Role**: Dropdown dinamis mengambil seluruh role dari `app_roles`:
   - Developer
   - Owner
   - Manajer
   - Admin
   - **Pimpro**
   - **Member**
   - *(Role kustom lainnya jika ada)*
5. **Cakupan Akses Produk (Radio Selector Baru)**:
   - `(o) Semua Produk (All Products)`:
     - Direkomendasikan untuk Owner, Developer, Manajer, Admin.
     - User dapat melihat seluruh order dan seluruh data presensi di sistem.
   - `( ) Produk Tertentu (Specific Products)`:
     - Direkomendasikan untuk **Pimpro** dan **Member**.
     - Ketika radio ini dipilih, form menampilkan bagian **Daftar Produk yang Diizinkan**:
       - Kotak pilihan multi-checkbox yang memuat seluruh produk aktif dari tabel `products`:
         - `[v] Kuliner Masteri (KM)`
         - `[ ] Bisnis Masteri (BM)`
         - `[v] Make Up Training (MT)`
       - Terdapat tombol shortcut `[ Pilih Semua Produk ]` dan `[ Bersihkan Pilihan ]`.
       - Validasi: Jika memilih *Produk Tertentu*, minimal harus memilih 1 produk.

### B. Tampilan Tabel Anggota Tim
Tabel tim diperkaya dengan kolom baru:
- **Nama & Username**: Budi Santoso (`@budi`)
- **Role**: Badge `Pimpro`
- **Akses Produk**:
  - Jika Semua: Badge hijau `Semua Produk`
  - Jika Terbatas: Badge pill biru menampilkan kode produk yang diizinkan (misal: `[ KM ] [ MT ]`)
- **Status**: Aktif / Nonaktif
- **Aksi**: Edit (Pensil) & Hapus (Tong Sampah)

---

## 4. Alur Kerja Lapangan di Halaman Scan QR (`/scan-qr`) — Skema B

Halaman `/scan-qr` dirancang dengan **Skema B (Dua Mode & Dua Tombol Terpisah)** untuk kenyamanan maksimal operator:

```
+-------------------------------------------------------------+
|  [ 📷 Mode Kamera (HP / Webcam) ]   [ 🔫 Mode Scanner Stick ]|
+-------------------------------------------------------------+
```

### A. Mode 1: Kamera Laptop / HP (`[ Nyalakan Kamera ]`)
1. Operator memilih tab **Mode Kamera (HP / Webcam)**.
2. Operator menekan tombol `[ Nyalakan Kamera ]`.
3. Browser meminta izin kamera (*Allow*), dan preview video kotak muncul di layar.
4. Jika laptop terhubung ke USB Webcam eksternal, muncul dropdown:  
   `Pilih Kamera: [ USB HD Webcam v ]`
5. Operator mengarahkan HP peserta ke lensa kamera.
6. Kamera mendeteksi QR, memproses check-in, dan memunculkan kartu hasil.

### B. Mode 2: Scanner Stick USB / Bluetooth (`[ Aktifkan Scanner Stick ]`)
1. Operator mencolokkan scanner stick USB / dongle Bluetooth ke laptop.
2. Operator memilih tab **Mode Scanner Stick (USB / Bluetooth)**.
3. Kamera laptop otomatis nonaktif (**0% beban video/CPU, hemat baterai, tanpa izin browser**).
4. Layar menampilkan visual radar standby siap tembak:
   ```
   +-------------------------------------------------------+
   |                    🟢 SCANNER AKTIF                   |
   |         Arahkan laser scanner stick ke tiket...        |
   |              [ Menunggu tembakan scan ]               |
   +-------------------------------------------------------+
   ```
5. Operator menembakkan laser scanner stick ke tiket HP peserta:
   - Scanner membaca QR dan mengetikkan teks secara instan (< 0,1 detik) diakhiri tombol `Enter`.
   - Global listener menangkap data, memvalidasi Order ID, dan memanggil API check-in.
   - Komputer membunyikan audio *beep* sukses, dan layar menampilkan kartu hasil:
     ```
     -----------------------------------------
     ✓ CHECK-IN BERHASIL
     Ahmad Fauzi
     Kuliner Masteri (Sesi 1 - Solo)
     Order ID: 283033796 | Waktu: 08:15 WIB
     -----------------------------------------
     ```
6. Layar langsung siap menerima tembakan peserta berikutnya tanpa jeda.

---

## 5. Perilaku Pembatasan Produk Tertentu (*Product Scoping*) di Seluruh Fitur

Untuk akun dengan akses *Produk Tertentu* (terutama **Pimpro** dan **Member**):

| Fitur / Halaman | Tampilan & Perilaku untuk Akun Terbatas Produk |
|---|---|
| **Presensi Acara (`/presensi`)** | - Tabel hanya menampilkan baris peserta dari produk yang diizinkan.<br>- Dropdown filter produk hanya menampilkan produk miliknya.<br>- Kartu KPI (Hadir, Belum Hadir, Attendance Rate) dihitung murni dari produk tersebut. |
| **Data Order (`/order`)** | - Tabel hanya menampilkan order dari produk yang diizinkan.<br>- Dropdown filter produk hanya berisi produk miliknya.<br>- Tombol Export Data hanya mengekspor transaksi produk miliknya. |
| **Dashboard (`/`)** | - Kartu KPI (Leads, Paid, Omzet Kotor, Omzet Bersih) hanya menjumlahkan transaksi dari produk yang diizinkan.<br>- Kartu Data per Sesi (A59) menampilkan tiket Paid per sesi/kota; produk + batch wajib dipilih.<br>- Ringkasan persentase murni mencerminkan produk miliknya. |
| **Report Tax (`/report-tax`)** | - Jika role diizinkan membuka Report Tax, tabel rekap omzet dan potongan pajak hanya menampilkan data produk yang diizinkan. |
| **Konfigurasi Zoom & Tiket** | - Jika role diizinkan mengatur Zoom/Tiket, dropdown produk dan daftar mapping hanya menampilkan produk yang menjadi wewenangnya. |
| **Scan QR Tiket (`/scan-qr`)** | - Jika operator memindai tiket peserta dari produk lain di luar wewenangnya, server menolak check-in dengan alert merah: *"Akses ditolak: Tiket ini milik produk lain ([Nama Produk]) dan di luar wewenang acara Anda."* |


