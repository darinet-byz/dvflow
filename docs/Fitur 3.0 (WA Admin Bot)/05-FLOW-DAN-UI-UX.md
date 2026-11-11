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

Satu halaman, lima kartu bertumpuk (pola halaman konfigurasi lain):

1. **Koneksi Fonnte**
2. **Grup & PIC**
3. **Template Pesan**
4. **Jadwal Pengingat**
5. **Riwayat Pengiriman**

Komponen memakai design system yang sudah ada: `Card`, `Button`, `TextInput`,
`Textarea`, `Select`, `Badge`, `DataTable`, `Modal`, `Pagination`, `Toast`,
`SkeletonRows`, `ErrorState`.

## 3. Koneksi Fonnte

- Badge: `Token terpasang` (hijau) / `Token belum diatur` (kuning).
- Input `type=password`, tombol **Simpan Token**. Nilai tidak pernah
  dikembalikan setelah disimpan.
- Keterangan waktu perubahan terakhir + pengingat bahwa WA putus cukup ganti token.
- Tombol **Kirim Tes** (hanya pemegang `action.wa_bot_send`) membuka modal:
  - pilih pengiklan yang punya grup aktif,
  - pilih produk (dari konfigurasi aktif),
  - pilih template,
  - hasil menampilkan isi pesan final + status kirim/gagal.
- Modal menjelaskan bahwa pesan memakai angka leads/paid kemarin yang sebenarnya.

## 4. Grup & PIC

Tabel: Pengiklan (nama + kode), ID Grup Fonnte, PIC (nama + nomor), Status, Aksi.

Form modal:
- Pengiklan (hanya yang belum punya grup; saat edit, pengiklan saat ini tetap muncul).
- ID Grup Fonnte.
- Nomor WA PIC (placeholder `08xxx atau 628xxx`).
- Nama PIC (opsional, maks. 50).
- Checkbox “Bot aktif untuk grup ini”.

Hapus memakai modal konfirmasi; riwayat pengiriman tetap disimpan.

Keadaan kosong: “Belum ada grup terdaftar. Tambahkan pengiklan, ID grup Fonnte,
dan nomor PIC.”

## 5. Template Pesan

Tabel: Nama, cuplikan isi (2 baris), Status, Aksi.

Editor tampil **inline di dalam kartu** (bukan modal), karena formulirnya panjang:
- Nama template.
- Textarea 8 baris + batas 4.000 karakter.
- Chip placeholder yang dapat diklik untuk menambahkan ke akhir teks.
- Kotak **Preview** yang dirender dengan data contoh.
- Checkbox aktif.
- Validasi placeholder dilakukan di klien **dan** server; pesan galat server
  ditampilkan di dalam modal.

Hapus ditolak bila template masih dipakai jadwal (pesan dari server:
“Template masih dipakai jadwal…”).

## 6. Jadwal

Tabel: Jam (WIB), Template, Hari, Aturan, Status, Aksi.

Modal:
- `input type=time` (HH:MM).
- Select template.
- Checkbox tujuh hari.
- Checkbox “Kirim hanya jika laporan D-1 untuk produk tersebut belum diisi”.
- Checkbox aktif.

Catatan di header kartu: pengingat hanya untuk produk yang punya leads kemarin.

## 7. Riwayat Pengiriman

Filter: status, pengiklan, tanggal awal/akhir. Perubahan filter mereset halaman ke 1.

Tabel: Waktu, Pengiklan/Produk, Grup, Status (+ jumlah percobaan), Keterangan error,
Aksi.
- **Lihat** membuka modal isi pesan.
- **Kirim Ulang** hanya muncul untuk baris `failed` dan pemegang
  `action.wa_bot_send`.

Pagination server-side (50/100). Keadaan kosong: “Belum ada riwayat pengiriman
pada filter ini.”

## 8. Keadaan loading/error

| Keadaan | Tampilan |
|---|---|
| Memuat awal | `SkeletonRows` 5 baris. |
| Gagal memuat | `ErrorState` + tombol **Coba lagi**. |
| Simpan/ganti token | Spinner pada tombol, toast sukses/gagal. |
| Validasi form | Teks galat di dalam modal, bukan `alert`. |
| Kirim tes | Hasil ditampilkan di modal (pesan + status), toast ringkas. |

## 9. Responsif

- Kartu dan form satu kolom di layar sempit.
- Tabel menggulir horizontal; kolom aksi tetap terlihat.
- Modal membatasi tinggi dan menggulir sendiri (`max-h-[calc(100dvh-32px)]`).
