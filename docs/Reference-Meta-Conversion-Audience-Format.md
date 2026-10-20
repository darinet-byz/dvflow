# Reference — Format Meta Conversion Audience (Offline Conversions)

**Status:** referensi tetap untuk export Meta  
**Tanggal:** 20 Oktober 2026  
**Dipakai oleh:** tombol **Export Meta (Paid)** di halaman Order  
**Sumber format:** contoh file CSV yang diberikan pengguna. File contoh asli **tidak disimpan di repo** karena berisi data pribadi.

Dokumen ini adalah kontrak format. Kalau format Meta berubah, ubah dokumen ini **dan** test `apps/web/test/meta-conversion.test.ts` dalam perubahan yang sama. Jangan mengubah header/urutan kolom secara diam-diam.

---

## 1. Header wajib

Urutan kolom persis:

```text
order_id,fn,email,phone,ct,country,value,currency,event_name,event_time,data_processing_options
```

- File CSV UTF-8 **tanpa BOM**.
- Pemisah koma.
- Quoting CSV standar: hanya field yang mengandung koma, tanda kutip, atau baris baru.
- **Tidak** memakai formula guard (`'` di depan nilai). Guard itu akan merusak nomor `+62...`.
- File diupload langsung ke Meta. Jangan dibuka lalu disimpan ulang di Excel, karena Excel bisa mengubah format nomor HP/tanggal.

---

## 2. Mapping kolom

| Kolom | Sumber | Aturan |
|---|---|---|
| `order_id` | `orders.order_id` | ID kanonik lengkap, mis. `MTIX-284129027` atau `OTS-000001`. Bukan hanya angka. |
| `fn` | `orders.name` | Nama lengkap (mengikuti contoh). Trim dan rapikan spasi ganda. Boleh kosong. |
| `email` | `orders.email` | Trim + lowercase. Kosongkan kalau tidak mengandung `@` dan `.`. |
| `phone` | `orders.phone` | Normalisasi ke `+62...`. Kosongkan kalau tidak valid. |
| `ct` | `orders.city` | Trim. Boleh kosong. |
| `country` | konstan | `ID` |
| `value` | `orders.gross_amount` | Total bayar order (bukan harga per tiket). Angka tanpa trailing `.00`. |
| `currency` | konstan | `IDR` |
| `event_name` | konstan | `Purchase` |
| `event_time` | `orders.paid_at` | Waktu WIB, format `YYYY-MM-DDTHH:mm:ss`. Fallback: `source_created_at`, lalu `created_at`. |
| `data_processing_options` | konstan | `[]` |

---

## 3. Aturan isi

1. **Hanya order `Paid`.**
   - `Pending` dan `Cancelled` tidak pernah masuk file, walaupun tabel Order sedang menampilkannya.
   - Kalau filter Status di halaman Order = `Pending`/`Cancelled`, tombol Export Meta dinonaktifkan karena hasilnya pasti kosong.
2. **Baris tanpa email dan tanpa No HP dilewati.**
   - Meta membutuhkan minimal satu identifier.
   - Baris dengan email kosong tetapi No HP valid tetap masuk.
3. **Plaintext, bukan hash.**
   - Mengikuti contoh: email/phone/nama dikirim apa adanya; Meta yang melakukan normalisasi/hash saat upload.
4. **Satu baris = satu order.**
   - Kalau satu orang membeli dua kali, ada dua baris dengan `order_id` berbeda.
   - OTS yang Paid ikut ter-export; emailnya biasanya kosong, phone-nya yang dipakai.
5. **Nilai `value` adalah total bayar.**
   - Order OTS dengan 2 tiket × Rp 150.000 → `value = 300000`.
6. **Filter halaman tetap berlaku.**
   - Tanggal, pencarian, produk, pengiklan, jenis acara, batch, sesi, kota, dan payment method mengikuti filter aktif.
   - Default tanggal halaman Order adalah **Hari Ini**; untuk audiens lebih besar, pilih rentang tanggal lain.

---

## 4. Normalisasi nomor HP

Tujuan: menghasilkan format Indonesia yang diterima Meta, `+62...`.

Contoh yang benar:

| Input | Output |
|---|---|
| `0812-3456-7890` | `+6281234567890` |
| `+62 812 3456 7890` | `+6281234567890` |
| `62812...` | `+62812...` |
| `812...` | `+62812...` |
| `021-1234567` | `+62211234567` |

Aturan:

1. Hapus spasi, `-`, `(`, `)`, dan `.`.
2. Kalau diawali `0` → ganti dengan `+62`.
3. Kalau diawali `62` → tambahkan `+` di depan.
4. Kalau diawali `8` → tambahkan `+62`.
5. Kalau diawali `+62` → pertahankan.
6. Hasil akhir harus `+` diikuti 9–15 digit. Kalau tidak, kosongkan.

---

## 5. Contoh baris (data palsu)

```csv
order_id,fn,email,phone,ct,country,value,currency,event_name,event_time,data_processing_options
284129027,Budi Santoso,budi@example.com,+6281234567890,Solo,ID,150000,IDR,Purchase,2026-10-20T20:56:36,[]
```

`fn` yang mengandung koma akan di-quote:

```csv
284129027,"Santoso, Budi",budi@example.com,+6281234567890,Solo,ID,150000,IDR,Purchase,2026-10-20T20:56:36,[]
```

---

## 6. Keamanan

- File export berisi **data pribadi** (nama, email, nomor HP).
- Jangan commit file export ke git.
- Hapus file setelah diupload ke Meta.
- Jangan memakai data pelanggan asli di test atau dokumentasi. Test memakai data palsu.
- File contoh asli yang diberikan pengguna sudah dihapus dari repo setelah format ini dicatat.

---

## 7. Change control

Setiap perubahan berikut wajib disertai update dokumen ini, test, dan verifikasi upload ke Meta:

- nama atau urutan kolom;
- format `event_time`;
- aturan `value`/`currency`;
- aturan hanya Paid;
- aturan normalisasi email/phone;
- penambahan kolom baru.

Kalau Meta menolak file, periksa dulu header dan format nomor HP sebelum mengubah mapping data.
