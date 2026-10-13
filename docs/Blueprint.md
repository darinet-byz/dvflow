Siap. Ini versi blueprint yang sudah diperbarui dengan struktur menu terbaru dan keputusan teknis yang sudah kita sepakati.

# Blueprint App — dvflow

## 1. Tujuan Utama

Aplikasi ini menjadi pusat operasional untuk:

- menerima webhook OrderOnline
- mencatat leads/order
- mengubah status OrderOnline menjadi Pending/Paid
- menghitung tax/fee transaksi
- membuat struktur kode produk yang konsisten
- mengelola presensi webinar
- mengelola presensi seminar offline via QR
- membuat report order, payment, tax, dan attendance
- memfilter data berdasarkan produk, batch, sesi, kota, pengiklan, status, dan keyword custom

Arsitektur utama:

```text
OrderOnline
   ↓ webhook
Cloudflare Worker
   ↓
Supabase PostgreSQL
   ↓
Cloudflare Pages
   ↓
Admin App
```

---

# 2. Tech Stack

## Frontend
- Cloudflare Pages
- React
- Tailwind CSS
- QR generator berjalan client-side/browser

## Backend
- Cloudflare Workers

Worker dipakai untuk:
- menerima webhook OrderOnline
- validasi Order ID
- redirect webinar
- check-in seminar
- pencatatan attendance
- operasi backend sensitif

## Database
- Supabase PostgreSQL

## Scheduled jobs
- Supabase Cron / PostgreSQL cron
- terutama untuk hapus raw attendance setelah 30 hari

---

# 3. Authentication

Tidak ada signup publik.

Login hanya:

```text
Username
Password
```

User dibuat oleh:
- developer
- master admin

Password wajib disimpan dalam bentuk hash.

Tidak menggunakan tombol:
- Sign Up
- Register
- Create Account

Role minimal:

```text
Master Admin
Admin
Staff
```

---

# 4. Sidebar Final

Urutan sidebar:

```text
Scan QR

Dashboard Resume
Order
Presensi Acara

────────────

Konfigurasi Produk
Konfigurasi Tax
Report Tax
Product Name Generator

────────────

Profil
Logout
```

Menu utama dibuat sederhana dan operasional.

---

# 5. Scan QR

Ini menjadi menu paling atas.

Saat dibuka:

```text
SCAN PRESENSI SEMINAR
```

UI dibuat besar dan cepat digunakan di lapangan.

Flow:

```text
Panitia buka scanner
↓
Scan QR peserta
↓
QR menghasilkan Order ID / URL check-in
↓
Cloudflare Worker
↓
Cari order di Supabase
↓
Order valid?
↓
Status Paid?
↓
Catat timestamp
↓
Check-in berhasil
```

Jika tidak Paid:

```text
Akses / Check-in Ditolak
```

---

# 6. Dashboard Resume

Dashboard berfungsi sebagai ringkasan.

Card utama:

```text
Leads
Paid
Pending
Conversion Rate

Gross
Tax / Fee
Net

Sudah Hadir
Belum Hadir
Attendance Rate
```

Dashboard dapat difilter berdasarkan:

```text
Tanggal
Produk
Pengiklan
Seminar / Webinar
Batch
Sesi
Kota
```

Semua angka mengikuti filter yang aktif.

---

# 7. Order

Menu Order berisi **Master Table Order**.

Prinsip utama:

```text
1 Order ID = 1 row
```

Webhook berkali-kali untuk Order ID yang sama melakukan:

```text
UPSERT / UPDATE
```

bukan membuat row baru.

Kolom utama:

```text
Order ID
Nama
No WA
Email

Produk
Pengiklan
Seminar / Webinar
Batch
Sesi
Kota

Status
Payment Method
Provider

Gross
Tax
Net

Created At
Paid At
Updated At
```

---

# 8. Logic Leads dan Status

Satu Order ID baru:

```text
= 1 Lead
```

Mapping status:

```text
OrderOnline        App

pending         →  Pending
processing      →  Paid
complete        →  Paid
cancelled       →  Cancelled
```

Jadi:

```text
Paid = processing OR complete
```

Ini berlaku di seluruh aplikasi:
- Dashboard
- Order
- Presensi
- Redirect webinar
- QR seminar
- Report

---

# 9. Filter Master Order

Filter structured:

```text
Produk
Pengiklan
Seminar / Webinar
Batch
Sesi
Kota
Status
Tanggal
Payment Method
```

Filter dapat dikombinasikan.

Contoh:

```text
Kuliner Masteri
+
Batch 392
+
Zul
+
Paid
```

---

# 10. Custom Search

Selain filter structured, ada satu global search field.

Bisa mengetik:

```text
Solo
392
Zul
0812
Ahmad
KM01
283033796
```

Search dilakukan terhadap beberapa field sekaligus:

```text
Order ID
Nama
WA
Product Raw
Product Name
Batch
Sesi
Kota
Pengiklan
```

Tujuan utamanya menangani case khusus di lapangan.

---

# 11. Standar Nama Produk

Urutan kode:

```text
Nama Produk
Pengiklan
Seminar / Webinar
Batch
Sesi
Kota
```

Format:

```text
[KODE UTAMA] - [SESI] - [KOTA]
```

Kode utama:

```text
[PRODUK][PENGIKLAN][TIPE][BATCH]
```

Contoh:

```text
KM01SO392 - S1 - Solo
```

Artinya:

```text
KM  = Kuliner Masteri
01  = Zul
SO  = Seminar Offline
392 = Batch 392
S1  = Sesi 1
Solo = Kota
```

Sesi tunggal:

```text
KM01SO392 - ST - Solo
```

Webinar:

```text
KM01WO392 - ST - Online
```

---

# 12. Konfigurasi Produk

Menu ini menjadi pusat mapping kode.

## Produk

Contoh:

| Nama Produk | Kode |
|---|---|
| Kuliner Masteri | KM |
| Master TikTok Indonesia | MT |
| Webstore Academy | WA |

## Pengiklan

| Nama | Kode |
|---|---|
| Zul | 01 |
| Rahman | 02 |
| Andi | 03 |

## Type

```text
Seminar Offline → SO
Webinar Online → WO
```

## Sesi

```text
Sesi 1 → S1
Sesi 2 → S2
Sesi Tunggal → ST
```

Semua dapat dikelola oleh admin yang punya izin.

---

# 13. Product Name Generator

Menu ini membantu tim membuat kode valid.

Input:

```text
Produk
Pengiklan
Seminar / Webinar
Batch
Sesi
Kota
```

Contoh:

```text
Produk:
Kuliner Masteri

Pengiklan:
Zul

Type:
Seminar Offline

Batch:
392

Sesi:
Sesi 1

Kota:
Solo
```

Klik:

```text
GENERATE
```

Output:

```text
KM01SO392 - S1 - Solo
```

Disediakan tombol:

```text
COPY
```

Tujuannya menghindari typo dan kode yang tidak konsisten di OrderOnline.

---

# 14. Parsing Produk dari Webhook

Webhook memberikan nama/kode produk seperti:

```text
KM01SO392 - S1 - Solo
```

Aplikasi otomatis mengubahnya menjadi:

```text
product_code = KM
product_name = Kuliner Masteri

advertiser_code = 01
advertiser_name = Zul

event_type = Seminar Offline

batch = 392
session = S1
city = Solo
```

Semua disimpan sebagai field terpisah agar mudah difilter.

---

# 15. Konfigurasi Tax

Menu **Konfigurasi Tax** bersifat fleksibel.

Admin bisa membuat rule sebanyak yang dibutuhkan.

Field minimum:

```text
Nama
Identifier / Mapping Payment
Type
Value
Active
```

Type hanya:

```text
Flat
Percentage
```

Contoh:

| Nama | Type | Value |
|---|---|---:|
| VA BCA | Flat | 4000 |
| QRIS | Percentage | 0.7 |
| VA Mandiri | Flat | 4000 |

Tidak perlu hardcode metode pembayaran di source code.

---

# 16. Tax Calculation

Contoh percentage:

```text
Gross = Rp300.000
QRIS = 0,7%
```

Maka:

```text
Tax = Rp2.100
Net = Rp297.900
```

Contoh flat:

```text
Gross = Rp300.000
VA BCA = Rp4.000
```

Maka:

```text
Tax = Rp4.000
Net = Rp296.000
```

---

# 17. Report Tax

Menu khusus finance/reporting.

Summary:

```text
Jumlah transaksi
Gross
Total Tax
Net
```

Breakdown dapat berdasarkan:

```text
Payment Method
Produk
Batch
Pengiklan
Tanggal
Kota
Seminar / Webinar
```

Contoh:

| Payment | Transactions | Gross | Tax | Net |
|---|---:|---:|---:|---:|
| QRIS | 320 | Rp48 jt | Rp336 rb | Rp47,66 jt |
| VA BCA | 180 | Rp27 jt | Rp720 rb | Rp26,28 jt |

---

# 18. Link dari OrderOnline

Karena OrderOnline hanya bisa menggunakan variable yang sudah tersedia, link cukup membawa Order ID.

Contoh:

```text
https://app.domain/access/283033796
```

Tidak menggunakan token tambahan.

---

# 19. Security Rule Akses

Saat link dibuka:

```text
Order ID
↓
Cloudflare Worker
↓
Cari di Supabase
↓
Order ada?
↓
Status Paid?
```

Rule final:

```text
VALID ORDER ID
+
STATUS = PAID
=
ACCESS GRANTED
```

Jika:

```text
Pending
Cancelled
Order tidak ditemukan
```

maka akses ditolak.

---

# 20. Webinar Attendance

Flow:

```text
OrderOnline link
↓
Peserta klik
↓
Worker
↓
Cek Order ID
↓
Cek Paid
↓
Catat timestamp attendance
↓
302 Redirect
↓
Zoom
```

Jika user klik berkali-kali:

```text
setiap klik = attendance event baru
```

Ini memungkinkan melihat user keluar-masuk.

---

# 21. Seminar QR

Peserta membuka link dari OrderOnline:

```text
/access/[order_id]
```

Aplikasi:

```text
cek Order ID
↓
cek Paid
↓
tampilkan halaman tiket
↓
browser generate QR
```

QR dapat berisi:

```text
/checkin/[order_id]
```

Saat panitia scan:

```text
Worker
↓
Cek Order ID
↓
Cek Paid
↓
Catat timestamp
↓
Check-in berhasil
```

QR digenerate client-side sehingga Worker tidak perlu membuat file QR.

---

# 22. Presensi Acara

Menu ini berisi **Master Table Presensi** seluruh event.

Data webinar dan seminar digabung.

Default:

```text
semua event tampil
```

Jika 5 acara berjalan bersamaan, semua attendance dapat muncul dalam satu tabel.

Filter digunakan untuk memisahkannya.

---

# 23. Kolom Presensi

Urutan utama:

```text
Order ID
Nama
No WA

Timestamp 1
Timestamp 2
Timestamp 3
...
Timestamp 10

Total Activity

Produk
Batch
Sesi
Kota
Pengiklan
Seminar / Webinar
```

Informasi paling penting di lapangan ditempatkan paling depan.

---

# 24. Attendance Storage

Database tidak membuat:

```text
timestamp_1
timestamp_2
timestamp_3
...
```

Raw event disimpan sebagai row.

Contoh:

```text
attendance_events
```

| Order ID | Type | Timestamp |
|---|---|---|
| 10001 | webinar | 17:53 |
| 10001 | webinar | 18:01 |
| 10001 | webinar | 19:11 |

UI yang mengubahnya menjadi T1 sampai T10.

---

# 25. Rolling 10 Timestamp

Jika peserta memiliki 17 event:

```text
Total Activity = 17
```

Tabel hanya menampilkan:

```text
10 timestamp terbaru
```

Timestamp lama tetap tersimpan selama belum melewati retention.

---

# 26. Attendance Retention

Raw attendance disimpan maksimal:

```text
30 hari
```

Setelah itu otomatis dihapus.

Contoh cron:

```text
DELETE attendance_events
WHERE clicked_at < NOW() - INTERVAL '30 days'
```

Master Order tetap disimpan.

---

# 27. Hadir vs Belum Hadir

Status dihitung dari data.

```text
Paid + 0 attendance
=
Belum Hadir
```

```text
Paid + >=1 attendance
=
Hadir
```

Pending bukan kategori Belum Hadir.

Jadi:

```text
Pending
Belum Hadir
Hadir
```

adalah tiga kondisi berbeda.

---

# 28. Filter Presensi

Filter:

```text
Produk
Batch
Sesi
Kota
Pengiklan
Seminar / Webinar
Hadir / Belum Hadir
Tanggal
```

Plus custom search:

```text
Nama
WA
Order ID
Keyword produk
Batch
Kota
dll.
```

Filter aktif harus selalu terlihat.

Contoh:

```text
Active Filters:
Kuliner Masteri
Batch 392
Solo
S1

[Clear All]
```

---

# 29. Profil

Menu Profil sangat sederhana.

Isi:

```text
Nama
Username
Avatar Emoji
Ganti Password
```

Avatar tidak menggunakan upload gambar.

User cukup memilih emoji:

```text
😎 🚀 🐼 🦊 🐯 👨‍💻 🤖
```

Avatar emoji disimpan sebagai string biasa di database.

---

# 30. Logout

Menu Logout berada di bagian paling bawah sidebar.

Logout:
- hapus session
- redirect ke halaman login

---

# 31. Database Tables

Minimum tabel:

```text
users
orders
attendance_events
products
advertisers
payment_fee_rules
app_settings
```

Jika dibutuhkan:

```text
webhook_logs
```

tetapi webhook log jangan disimpan permanen.

---

# 32. Orders Table

Field utama kira-kira:

```text
id
order_id

name
phone
email

product_raw
product_code
product_name

advertiser_code
advertiser_name

event_type
batch
session
city

raw_status
app_status

payment_method
payment_provider

gross_amount
tax_amount
net_amount

created_at
paid_at
updated_at
```

---

# 33. Attendance Table

```text
id
order_id
attendance_type
clicked_at
```

Optional:

```text
source
scanner_user_id
```

`source` bisa:

```text
webinar_redirect
seminar_qr
```

---

# 34. Worker Request Strategy

Worker hanya digunakan jika memang perlu server-side logic:

```text
Webhook OrderOnline
Webinar attendance
Seminar check-in
Validasi akses
```

Halaman dashboard tidak perlu melewati Worker.

Flow dashboard:

```text
Cloudflare Pages
↓
Browser
↓
Supabase
```

Dengan permission database yang sesuai.

---

# 35. Supabase Strategy

Yang perlu dijaga:

- jangan simpan semua raw webhook selamanya
- gunakan field normalized
- attendance delete setelah 30 hari
- gunakan pagination
- filter dilakukan di database
- jangan download puluhan ribu row sekaligus

Pagination:

```text
50–100 rows/page
```

---

# 36. Database Index

Index penting:

```text
order_id
product_code
advertiser_code
event_type
batch
session
city
app_status
created_at
paid_at
```

Attendance:

```text
order_id
clicked_at
```

Search dapat ditambah index sesuai kebutuhan setelah data mulai besar.

---

# 37. Flow Besar Sistem

```text
                         ORDERONLINE
                              │
                              ▼
                     CLOUDFLARE WORKER
                              │
                  ┌───────────┴───────────┐
                  │                       │
               WEBHOOK                ACCESS
                  │                       │
                  ▼                       ▼
           Parse Product          Validate Order
           Normalize Status       Validate Paid
           Calculate Tax               │
                  │              ┌──────┴──────┐
                  │              ▼             ▼
                  │          Webinar        Seminar
                  │          Redirect       QR Check-in
                  │              │             │
                  └──────────────┼─────────────┘
                                 ▼
                              SUPABASE
                                 │
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
              ORDERS        ATTENDANCE        CONFIG
                 │               │               │
                 └───────────────┼───────────────┘
                                 ▼
                         CLOUDFLARE PAGES
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
          Dashboard            Order            Presensi
              │                                     │
              ▼                                     ▼
         Report Tax                              Scan QR
```

---

# 38. Prinsip Final

Ada beberapa rule yang harus tetap dijaga saat mulai build:

**Order ID adalah identitas transaksi utama.**

```text
1 Order ID = 1 Master Order
```

**Status internal app menjadi sumber keputusan.**

```text
processing / complete = Paid
```

**Semua laporan membaca sumber data yang sama.**

Tidak membuat database terpisah untuk:
- Leads
- Paid
- Report
- Attendance summary

Semuanya diturunkan dari:

```text
orders
+
attendance_events
```

**Kode produk dibuat dari konfigurasi, bukan hardcode.**

**Tax dibuat dari konfigurasi bebas, bukan hardcode.**

**Presensi hanya valid jika Order ID ada dan statusnya Paid.**

Versi ini menurutku sudah cukup kuat untuk dijadikan **dokumen acuan build MVP**.