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

Satu halaman dengan **tab** agar tidak perlu menggulir kartu:

1. **Koneksi**
2. **Produk & Grup**
3. **Template**
4. **Jadwal**
5. **Riwayat**

Tab memakai `Button` dengan `role="tab"` / `aria-selected`, konsisten dengan
halaman OTS. Komponen lain memakai design system: `Card`, `TextInput`,
`Textarea`, `Select`, `Badge`, `DataTable`, `Modal`, `Pagination`, `Toast`,
`SkeletonRows`, `ErrorState`.

## 3. Koneksi Fonnte

- Badge status **device**, bukan sekadar penanda token:
  `Terhubung` (hijau) / `Device terputus` (kuning) / `Fonnte tak terjangkau`
  (kuning) / `Token ditolak` (merah) / `Memeriksa…` (netral) /
  `Status tidak diketahui` (kuning) / `Token belum diatur` (kuning).
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
  - pilih jenis acara,
  - pilih **Siapa yang disebut** (semua pengiklan / hanya yang belum lapor),
  - pilih template,
  - **Preview** menampilkan grup tujuan, daftar pengiklan yang disebut, dan
    isi pesan final tanpa mengirim,
  - **Kirim ke Grup** baru benar-benar mengirim.
- Modal menjelaskan bahwa preview tidak mengirim apa pun, dan memberi tahu bila
  belum ada template.


## 4. Produk & Grup

Tabel: Produk (nama + kode), Grup WhatsApp, Pengiklan (chip nama), Status, Aksi.

Form modal:
- Produk (hanya yang belum punya grup; saat edit, produk dikunci).
- ID Grup Fonnte.
- Daftar **penerima otomatis** (read-only, chip nama).
- Checkbox “Bot aktif untuk produk ini”.

Semua pengiklan aktif yang ditugaskan ke produk otomatis disebut namanya di
pesan grup; tidak ada nomor yang perlu dilengkapi.

Hapus memakai modal konfirmasi; riwayat pengiriman tetap disimpan.

Keadaan kosong: “Belum ada produk. Tambahkan produk di Konfigurasi Produk
terlebih dahulu.”

## 5. Template Pesan

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

## 6. Jadwal

Tabel: Jam (WIB), Template, Hari, Aturan, Status, Aksi.

Modal:
- `input type=time` (HH:MM).
- Select template.
- Select **Siapa yang disebut**: “Semua pengiklan yang beraktivitas kemarin”
  atau “Hanya pengiklan yang belum lapor”.
- Checkbox tujuh hari.
- Checkbox “Kirim hanya jika laporan D-1 untuk produk tersebut belum diisi”
  (otomatis tercentang dan tidak bisa diubah saat mode “hanya yang belum lapor”).
- Checkbox aktif.

Contoh pemakaian: jadwal 09:00 memakai mode **semua**, jadwal 13:00/17:00
memakai mode **hanya yang belum lapor**. Mode terakhir tidak mengirim pesan bila
semua sudah lapor.

Catatan di header kartu: setiap jadwal bisa menyebut semua pengiklan atau hanya
yang belum lapor.

## 7. Riwayat Pengiriman

Filter: status, produk, jenis acara, tanggal awal/akhir. Perubahan
filter mereset halaman ke 1.

Tabel: Waktu, Produk, Pengiklan (daftar nama yang disebut), Jenis Acara, Grup,
Status (+ jumlah percobaan), Keterangan error, Aksi.
- **Lihat** membuka modal isi pesan + error.
- **Kirim Ulang** hanya muncul untuk baris `failed` dan pemegang
  `action.wa_bot_send`.

Header kartu: “Disimpan 3 hari, setelah itu dihapus otomatis. Riwayat lengkap
tetap ada di aplikasi WhatsApp.”

Pagination server-side (50/100). Keadaan kosong: “Belum ada riwayat pengiriman
pada filter ini.”

## 8. Keadaan loading/error

| Keadaan | Tampilan |
|---|---|
| Memuat awal | `SkeletonRows` 5 baris. |
| Gagal memuat | `ErrorState` + tombol **Coba lagi**. |
| Simpan/ganti token | Spinner pada tombol, toast sukses/gagal. |
| Validasi form | Teks galat di dalam modal, bukan `alert`. |
| Preview/kirim tes | Preview di modal; hasil kirim lewat toast. |

## 9. Responsif

- Kartu dan form satu kolom di layar sempit.
- Tab membungkus (`flex-wrap`) di layar sempit.
- Tabel menggulir horizontal; kolom aksi tetap terlihat.
- Modal membatasi tinggi dan menggulir sendiri (`max-h-[calc(100dvh-32px)]`).
