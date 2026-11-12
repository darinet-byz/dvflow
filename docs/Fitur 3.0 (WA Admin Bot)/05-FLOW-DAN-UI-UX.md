# 05 — Flow & UI/UX

## 1. Menu

Sidebar (Sistem, accordion):

```text
Sistem
  Add Team
  Konfigurasi Role
  API & Webhook
  WA Admin Bot   ← baru
  Reset Data
```

- Path: `/wa-bot`.
- Izin halaman: `config.wa_bot` (dipetakan di `PATH_PERMISSION_MAP`).
- Role tanpa izin mendapat halaman “Tidak punya akses” dari `RoleGuard`, bukan
  menu yang disembunyikan diam-diam.

## 2. Struktur halaman

Satu halaman dengan **tab** agar tidak perlu menggulir lima kartu:

1. **Koneksi**
2. **Produk & Grup**
3. **Nomor WA Pengiklan**
4. **Template**
5. **Jadwal**
6. **Riwayat**

Tab memakai `Button` dengan `role="tab"` / `aria-selected`, konsisten dengan
halaman OTS. Komponen lain memakai design system: `Card`, `TextInput`,
`Textarea`, `Select`, `Badge`, `DataTable`, `Modal`, `Pagination`, `Toast`,
`SkeletonRows`, `ErrorState`.

## 3. Koneksi Fonnte

- Badge status **device**, bukan sekadar penanda token:
  `Terhubung` (hijau) / `Device terputus` (kuning) / `Token ditolak` (merah) /
  `Memeriksa…` (netral) / `Status tidak diketahui` (kuning) /
  `Token belum diatur` (kuning).
- Panel status di bawah judul menampilkan nomor device, nama, paket, kuota, dan
  masa aktif saat terhubung; saat gagal menampilkan alasan dari Fonnte.
  Status diperiksa otomatis setiap kali token disimpan dan lewat tombol
  **Cek Ulang** (`POST /api/wa-bot/settings/verify`).
- Input `type=password`, tombol **Simpan Token**. Nilai tidak pernah
  dikembalikan setelah disimpan.
- Keterangan waktu perubahan terakhir + pengingat bahwa WA putus cukup ganti token.
- Tombol **Kirim Tes** (hanya pemegang `action.wa_bot_send`) selalu dapat diklik
  dan menjelaskan lewat toast bila prasyarat belum lengkap: token belum disimpan
  atau belum ada produk dengan grup aktif. Saat prasyarat lengkap modal berisi:
  - pilih produk yang punya grup aktif,
  - pilih pengiklan yang ditugaskan + punya nomor,
  - pilih jenis acara,
  - pilih template,
  - **Preview** menampilkan grup tujuan + isi pesan final tanpa mengirim,
  - **Kirim ke Grup** baru benar-benar mengirim.
- Modal menjelaskan bahwa preview tidak mengirim apa pun, dan memberi tahu bila
  belum ada template atau pengiklan tanpa nomor.


## 4. Produk & Grup

Tabel: Produk (nama + kode), Grup WhatsApp, Pengiklan (chip nama + nomor),
Status, Aksi.

Form modal:
- Produk (hanya yang belum punya grup; saat edit, produk dikunci).
- ID Grup Fonnte.
- Daftar **penerima otomatis** (read-only) dengan badge merah bila nomor kosong.
- Checkbox “Bot aktif untuk produk ini”.

Aktivasi ditolak server bila ada pengiklan aktif yang ditugaskan tetapi belum
punya nomor. Banner di atas tabel menghitung pengiklan yang belum punya nomor.

Hapus memakai modal konfirmasi; riwayat pengiriman tetap disimpan.

Keadaan kosong: “Belum ada produk. Tambahkan produk di Konfigurasi Produk
terlebih dahulu.”

## 5. Nomor WA Pengiklan

Tabel: Pengiklan (nama + kode), Produk, Nomor WA (input inline), Status, Aksi.

- Setiap baris punya tombol **Simpan** sendiri.
- Nomor boleh diketik `08xxx`; server menyimpan `628xxx`.
- Banner: “X pengiklan aktif belum punya nomor WA.” atau “Semua pengiklan aktif
  sudah punya nomor WA.”
- Kolom Produk hanya menampilkan kode produk yang ditugaskan (label).

## 6. Template Pesan

Tabel: Nama, cuplikan isi (2 baris), Status, Aksi.

Editor memakai **modal** agar konsisten dengan bagian lain:
- Nama template.
- Textarea 8 baris + batas 4.000 karakter.
- Chip placeholder yang dapat diklik untuk menambahkan ke akhir teks.
- Kotak **Preview** yang dirender dengan data contoh.
- Checkbox aktif.
- Validasi placeholder dilakukan di klien **dan** server.

Template lama yang masih memakai `{{leads}}`/`{{paid}}`/`{{store_name}}` diberi
badge **data lama**. Ketiganya tetap dirender agar tidak terkirim mentah, tetapi
tidak lagi ditawarkan di picker.

Hapus ditolak bila template masih dipakai jadwal.

## 7. Jadwal

Tabel: Jam (WIB), Template, Hari, Aturan, Status, Aksi.

Modal:
- `input type=time` (HH:MM).
- Select template.
- Checkbox tujuh hari.
- Checkbox “Kirim hanya jika laporan D-1 untuk produk tersebut belum diisi”.
- Checkbox aktif.

Catatan di header kartu: pengingat hanya untuk produk yang punya order kemarin
dan belum lapor.

## 8. Riwayat Pengiriman

Filter: status, produk, pengiklan, jenis acara, tanggal awal/akhir. Perubahan
filter mereset halaman ke 1.

Tabel: Waktu, Produk, Pengiklan, Jenis Acara, Grup, Status (+ jumlah percobaan),
Keterangan error, Aksi.
- **Lihat** membuka modal isi pesan + error.
- **Kirim Ulang** hanya muncul untuk baris `failed` dan pemegang
  `action.wa_bot_send`.

Header kartu: “Disimpan 3 hari, setelah itu dihapus otomatis. Riwayat lengkap
tetap ada di aplikasi WhatsApp.”

Pagination server-side (50/100). Keadaan kosong: “Belum ada riwayat pengiriman
pada filter ini.”

## 9. Keadaan loading/error

| Keadaan | Tampilan |
|---|---|
| Memuat awal | `SkeletonRows` 5 baris. |
| Gagal memuat | `ErrorState` + tombol **Coba lagi**. |
| Simpan/ganti token | Spinner pada tombol, toast sukses/gagal. |
| Validasi form | Teks galat di dalam modal, bukan `alert`. |
| Preview/kirim tes | Preview di modal; hasil kirim lewat toast. |

## 10. Responsif

- Kartu dan form satu kolom di layar sempit.
- Tab membungkus (`flex-wrap`) di layar sempit.
- Tabel menggulir horizontal; kolom aksi tetap terlihat.
- Modal membatasi tinggi dan menggulir sendiri (`max-h-[calc(100dvh-32px)]`).
