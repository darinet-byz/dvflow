# PRODUCT REQUIREMENTS DOCUMENT

# DVFLOW

**Fungsi dokumen:** Panduan utama vibe coding dan implementasi aplikasi\
**Basis requirement:** Blueprint App --- dvflow +
UI/UX Design Guideline dvflow\
**Prinsip dokumen:** Tidak menambahkan business requirement di luar
kedua sumber

------------------------------------------------------------------------

# 1. TUJUAN PRODUK

dvflow adalah aplikasi internal yang menjadi
pusat operasional untuk:

- menerima webhook dari OrderOnline;
- mencatat leads/order;
- mengubah status OrderOnline menjadi status internal aplikasi;
- menghitung tax/fee transaksi;
- membuat struktur kode produk yang konsisten;
- mengelola presensi webinar;
- mengelola presensi seminar offline melalui QR;
- membuat report order;
- membuat report payment;
- membuat report tax;
- membuat report attendance;
- memfilter data berdasarkan produk;
- batch;
- sesi;
- kota;
- pengiklan;
- status;
- keyword custom.

Aplikasi adalah operational dashboard.

Bukan halaman marketing.

Fokus utamanya adalah:

- data;
- pencarian;
- filter;
- monitoring;
- konfigurasi;
- attendance;
- reporting.

------------------------------------------------------------------------

# 2. ARSITEKTUR UTAMA

Arsitektur wajib mengikuti:

``` text
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

Pembagian tanggung jawab utama:

## OrderOnline

Sumber transaksi/order.

Mengirim webhook menuju aplikasi.

OrderOnline juga menyediakan link untuk peserta event dengan membawa
Order ID.

------------------------------------------------------------------------

## Cloudflare Worker

Digunakan untuk logic yang membutuhkan server-side processing:

- menerima webhook OrderOnline;
- validasi Order ID;
- redirect webinar;
- check-in seminar;
- pencatatan attendance;
- validasi akses;
- operasi backend sensitif.

Worker **tidak digunakan secara default untuk query dashboard biasa**.

------------------------------------------------------------------------

## Supabase PostgreSQL

Digunakan sebagai database utama aplikasi.

Data utama meliputi:

- user;
- order;
- attendance;
- produk;
- pengiklan;
- tax/fee configuration;
- setting aplikasi.

------------------------------------------------------------------------

## Cloudflare Pages

Digunakan untuk menjalankan frontend/admin application.

Flow dashboard:

``` text
Cloudflare Pages
↓
Browser
↓
Supabase
```

dengan permission database yang sesuai.

------------------------------------------------------------------------

# 3. TECH STACK

Tech stack yang ditetapkan oleh blueprint adalah sebagai berikut.

## Frontend

``` text
Cloudflare Pages
React
Tailwind CSS
```

QR Generator:

``` text
Client-side / Browser
```

QR tidak perlu dibuat sebagai image/file oleh Worker.

------------------------------------------------------------------------

## Backend

``` text
Cloudflare Workers
```

------------------------------------------------------------------------

## Database

``` text
Supabase PostgreSQL
```

------------------------------------------------------------------------

## Scheduled Jobs

``` text
Supabase Cron
atau
PostgreSQL Cron
```

Fungsi yang sudah ditentukan:

``` text
hapus raw attendance setelah 30 hari
```

------------------------------------------------------------------------

# 4. PRINSIP SUMBER DATA

Ada dua sumber data utama di aplikasi:

``` text
orders
+
attendance_events
```

Tidak membuat database/table terpisah sebagai source of truth untuk:

- Leads;
- Paid;
- Report;
- Attendance Summary.

Semua informasi tersebut diturunkan dari data:

``` text
orders
attendance_events
```

------------------------------------------------------------------------

# 5. IDENTITAS TRANSAKSI

Rule utama:

``` text
1 Order ID = 1 Master Order
```

Order ID adalah identitas transaksi utama.

Artinya:

``` text
Order ID 283033796
```

hanya boleh mempunyai:

``` text
1 row
```

di Master Order.

Webhook berikutnya dengan Order ID yang sama:

``` text
UPDATE / UPSERT
```

bukan:

``` text
INSERT row baru
```

------------------------------------------------------------------------

# 6. AUTHENTICATION

Aplikasi tidak mempunyai public signup.

Halaman login hanya memiliki:

``` text
Username
Password
```

Tidak boleh mempunyai:

``` text
Sign Up
Register
Create Account
```

------------------------------------------------------------------------

# 7. PEMBUATAN USER

User hanya dapat dibuat oleh:

``` text
Developer
Master Admin
```

Blueprint tidak mendefinisikan halaman khusus User Management.

Karena itu PRD tidak menambahkan menu User Management.

------------------------------------------------------------------------

# 8. PASSWORD

Password wajib disimpan dalam bentuk:

``` text
HASH
```

Jenis algoritma hashing **belum ditentukan oleh blueprint**.

Coding agent tidak boleh menyimpan password dalam plain text.

------------------------------------------------------------------------

# 9. ROLE

Role minimal:

``` text
Master Admin
Admin
Staff
```

Detail permission matrix untuk masing-masing role **belum ditentukan
secara lengkap oleh blueprint**.

Satu rule yang disebut secara eksplisit:

``` text
Konfigurasi dapat dikelola oleh admin yang mempunyai izin.
```

Karena itu coding agent tidak boleh mengarang permission detail yang
belum ditentukan.

------------------------------------------------------------------------

# 10. SESSION

Logout harus:

``` text
hapus session
↓
redirect ke halaman login
```

Teknis format session, durasi session, cookie/token, dan lifecycle
session **belum ditentukan oleh blueprint**.

------------------------------------------------------------------------

# 11. STRUKTUR SIDEBAR FINAL

Sidebar harus mengikuti urutan berikut.

## OPERASIONAL

``` text
Scan QR
Dashboard Resume
Order
Presensi Acara
```

## KONFIGURASI

``` text
Konfigurasi Produk
Konfigurasi Tax
Report Tax
Product Name Generator
```

## ACCOUNT

``` text
Profil
Logout
```

Jangan menambahkan menu baru yang tidak ada dalam struktur ini.

------------------------------------------------------------------------

# 12. SIDEBAR --- UX

Desktop:

``` text
width: 230px
min-width: 230px
padding: 24px 16px
```

Background:

``` text
#fafbff
```

Border kanan:

``` text
1px solid #eceef4
```

Menu item:

``` text
height: 44px
gap icon/text: 12px
padding horizontal: 14px
margin-bottom: 4px
border-radius: 11px
font-size: 14px
font-weight: 500
```

Normal color:

``` text
#656a79
```

Hover:

``` text
background: #f0f1f7
color: #22242d
```

Active menu menggunakan primary indigo.

Active navigation harus terlihat jelas.

Tidak menggunakan border tebal.

------------------------------------------------------------------------

# 13. DESIGN DIRECTION GLOBAL

Style:

``` text
Modern Soft SaaS Dashboard
```

Karakter:

- clean;
- ringan;
- premium;
- data-heavy;
- mudah digunakan tim operasional;
- tidak ramai;
- nyaman digunakan lama.

Visual:

- page background abu-abu kebiruan muda;
- floating app container;
- sidebar off-white;
- card putih;
- rounded corner;
- border sangat tipis;
- shadow lembut;
- primary indigo / blue-violet;
- hijau untuk positif;
- merah untuk error/negative;
- typography sederhana;
- spacing lega;
- icon minimal.

Visual hierarchy diutamakan melalui:

1.  spacing;
2.  font weight;
3.  ukuran text;
4.  background;
5.  warna.

Bukan border tebal.

------------------------------------------------------------------------

# 14. GLOBAL COLOR SYSTEM

Gunakan token berikut:

``` css
:root {
  --bg-page: #e9edf5;
  --bg-app: #f5f6fb;
  --bg-sidebar: #fafbff;
  --bg-card: #ffffff;
  --bg-soft: #f4f5fa;

  --primary: #4f46f5;
  --primary-hover: #4338e8;
  --primary-soft: #eef0ff;

  --text-primary: #171821;
  --text-secondary: #737786;
  --text-muted: #a5a9b5;

  --border: #eceef4;

  --success: #35c96c;
  --success-soft: #e7faee;

  --danger: #ef5b5b;
  --danger-soft: #fff0f0;

  --warning: #f5b94c;
  --warning-soft: #fff7e8;

  --shadow-app:
    0 20px 50px rgba(65,72,100,.12);

  --shadow-card:
    0 4px 16px rgba(50,55,80,.035);
}
```

------------------------------------------------------------------------

# 15. COLOR USAGE

Primary digunakan untuk:

- active sidebar;
- primary button;
- CTA;
- selected state;
- link penting;
- highlight KPI utama;
- focus state.

Success digunakan untuk:

- Paid;
- Hadir;
- berhasil;
- positive state.

Danger digunakan untuk:

- Cancelled;
- failed;
- error;
- negative state;
- check-in ditolak.

Warning digunakan untuk:

- Pending;
- butuh perhatian;
- data belum lengkap.

Jangan memenuhi satu layar dengan terlalu banyak warna.

------------------------------------------------------------------------

# 16. TYPOGRAPHY

Font:

``` css
font-family:
  Inter,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  Roboto,
  Arial,
  sans-serif;
```

Scale:

## Page Title

``` text
22–24px
700
```

## Section Title

``` text
16–18px
650–700
```

## Card Title

``` text
14–16px
600–650
```

## KPI Number

``` text
26–30px
700
```

## Body

``` text
13–14px
400
```

## Label

``` text
11–12px
500–600
```

## Caption

``` text
10–11px
400
```

Gunakan maksimal tiga kelompok font weight utama:

``` text
400
500/600
700
```

------------------------------------------------------------------------

# 17. BORDER RADIUS

``` css
--radius-xs: 8px;
--radius-sm: 10px;
--radius-md: 14px;
--radius-lg: 18px;
--radius-xl: 24px;
```

Pemakaian:

``` text
Button          10px
Input           10px
Sidebar menu    11px
Badge           999px
Small card      14px
Main card       18px
App shell       24px
```

Tidak membuat radius berbeda secara random.

------------------------------------------------------------------------

# 18. SPACING

Gunakan sistem kelipatan 4px.

``` text
4
8
12
16
20
24
32
40
```

Recommended:

``` text
Main app padding      28–30px
Card padding          18–20px
Gap antar card        16–18px
Gap antar section     24–32px
Sidebar padding       16px
Gap icon/text         10–12px
```

------------------------------------------------------------------------

# 19. APP SHELL

Desktop:

``` css
width: calc(100% - 64px);
max-width: 1440px;
min-height: calc(100vh - 64px);
margin: 32px auto;
display: flex;
background: var(--bg-app);
border-radius: 24px;
overflow: hidden;
box-shadow: var(--shadow-app);
```

Main content:

``` css
flex: 1;
min-width: 0;
padding: 28px 30px 32px;
```

Jangan memenuhi seluruh layar dengan card.

Negative space tetap dipertahankan.

------------------------------------------------------------------------

# 20. PAGE HEADER

Struktur umum:

``` text
Page Title                         Actions
Subtitle / description
```

Guideline memberi contoh area kanan berisi:

``` text
Search
Notification
Profile
```

Namun fungsi notification sendiri **tidak dijelaskan dalam blueprint**.

Jangan membuat workflow notification baru hanya berdasarkan contoh
layout.

------------------------------------------------------------------------

# 21. CARD SYSTEM

Default:

``` text
background: white
border: 1px solid #eceef4
border-radius: 18px
padding: 20px
soft shadow
```

Jangan:

- shadow tebal;
- border gelap;
- gradient pada seluruh card;
- membuat seluruh dashboard terlihat berat.

------------------------------------------------------------------------

# 22. BADGE SYSTEM

Status menggunakan pill badge.

General:

``` text
padding: 4px 7px
border-radius: 999px
font-size: 10px
font-weight: 600
```

Mapping:

``` text
Paid          green
Pending       yellow
Cancelled     red

Hadir         green
Belum Hadir   gray / orange soft

Seminar       purple soft
Webinar       blue soft
```

------------------------------------------------------------------------

# 23. BUTTON SYSTEM

Primary:

``` text
height: 40px
padding: 0 16px
radius: 10px
primary indigo
white text
font-size: 13px
font-weight: 600
```

Secondary:

``` text
height: 40px
white background
border tipis
radius 10px
```

Danger button merah penuh hanya untuk destructive action seperti:

``` text
Delete permanen
```

------------------------------------------------------------------------

# 24. INPUT SYSTEM

Input:

``` text
height: 40px
padding: 0 13px
background: #f6f7fa
border-radius: 10px
font-size: 13px
```

Focus:

``` text
background white
border indigo-soft
focus ring indigo sangat lembut
```

------------------------------------------------------------------------

# 25. SELECT / DROPDOWN

Select:

``` text
height: 40px
background: #f6f7fa
radius: 10px
font-size: 13px
```

Mini select:

``` text
height: 34px
radius: 9px
font-size: 11px
```

------------------------------------------------------------------------

# 26. GLOBAL LOADING STATE

Gunakan:

``` text
Skeleton
```

untuk:

- KPI;
- table rows;
- chart jika chart digunakan.

Jangan memakai spinner besar untuk satu dashboard penuh.

Spinner hanya digunakan untuk action kecil seperti:

``` text
Save
Update
Generate
Check-in
```

------------------------------------------------------------------------

# 27. GLOBAL EMPTY STATE

Pattern:

``` text
[Icon]

Belum ada data

Data akan muncul setelah order masuk.

[Optional Action]
```

UI:

- icon muted;
- title 14px / 600;
- description 12px;
- maximum width ±300px;
- center aligned.

------------------------------------------------------------------------

# 28. GLOBAL ERROR STATE

Pattern:

``` text
Gagal memuat data

Tidak dapat mengambil data.
Silakan coba lagi.

[Coba Lagi]
```

Jangan hanya menampilkan:

``` text
Error 500
```

------------------------------------------------------------------------

# 29. TOAST

Toast digunakan untuk feedback seperti:

- konfigurasi tersimpan;
- kode produk berhasil dicopy;
- check-in berhasil;
- password berhasil diubah.

Posisi:

``` text
top right
atau
bottom right
```

Durasi:

``` text
3–5 detik
```

Success toast:

``` text
green icon
+
white neutral card
```

Bukan seluruh card hijau.

------------------------------------------------------------------------

# 30. MODAL

Modal hanya digunakan untuk:

- confirmation;
- edit sederhana;
- delete confirmation;
- detail cepat.

Jangan menggunakan modal untuk form panjang.

Form panjang:

``` text
Page
atau
Drawer / Side Panel
```

------------------------------------------------------------------------

# 31. DRAWER

Drawer direkomendasikan untuk:

- detail order;
- detail attendance;
- quick edit;
- inspection data.

Desktop width:

``` text
420–520px
```

Tujuan:

``` text
user tidak kehilangan context tabel
```

------------------------------------------------------------------------

# 32. TABLE SYSTEM

Master Order dan Master Presensi merupakan area data utama.

Table wrapper:

``` text
white
18px radius
thin border
overflow hidden
```

Table:

``` text
width 100%
font-size 13px
border-collapse collapse
```

Header:

``` text
background #f8f9fc
padding 14px 16px
11px
600
uppercase
```

Cell:

``` text
padding 15px 16px
border bottom tipis
```

Hover row:

``` text
#fafbfe
```

------------------------------------------------------------------------

# 33. TABLE DATA BESAR

Wajib:

- sticky header;
- horizontal scroll jika diperlukan;
- pagination;
- jangan load seluruh database;
- filter server-side;
- search server-side;
- sort server-side jika data besar.

Pagination:

``` text
Default 50 rows/page
Optional 100 rows/page
```

Kolom penting dapat sticky kiri:

``` text
Order ID
Nama
```

------------------------------------------------------------------------

# 34. FILTER SYSTEM

Filter bar:

``` text
Search

[Filter]
[Filter]
[Filter]

Active Filters:
Filter A ×
Filter B ×

Clear All
```

Container:

``` text
display flex
gap 10px
flex-wrap
padding 14px
background white
border tipis
radius 16px
```

------------------------------------------------------------------------

# 35. FILTER CHIP

``` text
height: 30px
padding: 0 10px
pill radius
primary-soft background
font-size: 11px
```

Active filters **harus selalu terlihat**.

------------------------------------------------------------------------

# 36. HAPUS FILTER INDIVIDUAL

Guideline menampilkan active filter sebagai:

``` text
Kuliner Masteri ×
Batch 392 ×
Solo ×
Paid ×
```

Karena terdapat `×`, masing-masing active filter harus dapat dilepas
secara individual.

Flow:

``` text
User klik × pada chip
↓
filter tersebut tidak lagi aktif
↓
table/summary mengikuti filter yang tersisa
```

------------------------------------------------------------------------

# 37. CLEAR ALL FILTER

Tombol:

``` text
Clear All
```

Flow:

``` text
Klik Clear All
↓
semua active filter dilepas
↓
data kembali mengikuti kondisi tanpa filter structured aktif
```

Detail apakah search ikut di-clear atau tidak **tidak disebut
blueprint**.

Coding agent tidak boleh membuat rule bisnis baru tanpa keputusan
tambahan.

------------------------------------------------------------------------

# 38. SEARCH

Search dilakukan server-side.

Search Master Order meliputi:

``` text
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

Contoh keyword:

``` text
Solo
392
Zul
0812
Ahmad
KM01
283033796
```

Tujuan:

memungkinkan tim mencari kasus tertentu secara cepat.

------------------------------------------------------------------------

# 39. SORT

Guideline menentukan:

``` text
sort server-side jika data besar
```

Kolom mana yang sortable dan default sort **belum ditentukan
blueprint**.

Jangan menetapkan business sorting tambahan tanpa keputusan baru.

------------------------------------------------------------------------

# 40. MENU: DASHBOARD RESUME

Tujuan:

memberikan ringkasan kondisi operasional.

KPI:

``` text
Leads
Paid
Pending
Conversion Rate
```

Financial:

``` text
Gross
Tax / Fee
Net
```

Attendance:

``` text
Sudah Hadir
Belum Hadir
Attendance Rate
```

------------------------------------------------------------------------

# 41. DASHBOARD FILTER

Filter:

``` text
Tanggal
Produk
Pengiklan
Seminar / Webinar
Batch
Sesi
Kota
```

Semua angka harus mengikuti filter aktif.

Tidak boleh ada KPI yang memakai filter berbeda diam-diam.

------------------------------------------------------------------------

# 42. DASHBOARD HIERARCHY

Recommended hierarchy dari guideline:

``` text
Dashboard Resume

Filters

KPI:
Leads
Paid
Pending
Conversion Rate

Financial:
Gross
Tax
Net

Attendance:
Hadir
Belum Hadir
Attendance Rate

Chart / Trend

Breakdown
```

Chart/Trend dan Breakdown disebut dalam UI guideline sebagai bagian
hierarchy dashboard, tetapi jenis chart, metric, dimensi dan dataset
detail **tidak ditentukan blueprint**.

Jangan mengarang chart baru tanpa requirement lanjutan.

------------------------------------------------------------------------

# 43. KPI HIGHLIGHT

Hanya satu atau maksimal dua KPI yang diberikan visual primary.

Contoh yang disebut guideline:

``` text
Paid
atau
Net
```

Tidak semua KPI menggunakan background warna.

------------------------------------------------------------------------

# 44. MENU: ORDER

Menu Order berisi:

``` text
Master Table Order
```

Rule:

``` text
1 Order ID = 1 row
```

------------------------------------------------------------------------

# 45. KOLOM MASTER ORDER

Kolom:

``` text
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

------------------------------------------------------------------------

# 46. ORDER PAGE STRUCTURE

``` text
Order

Search + Filters

Active Filters

Summary kecil:
Total Result
Paid
Pending

Master Table

Pagination
```

Toolbar tidak boleh terlalu tinggi.

Jika filter terlalu banyak:

``` text
More Filters
```

boleh digunakan untuk filter sekunder.

------------------------------------------------------------------------

# 47. MASTER ORDER FILTER

Structured filters:

``` text
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

``` text
Kuliner Masteri
+
Batch 392
+
Zul
+
Paid
```

Data yang tampil harus memenuhi kombinasi filter aktif.

------------------------------------------------------------------------

# 48. ORDER DETAIL

UI guideline menyatakan:

``` text
klik row order
→ gunakan detail drawer
```

Tidak langsung berpindah halaman.

Detail field di drawer mengikuti data Order yang tersedia.

PRD tidak menambahkan field baru di luar Order.

------------------------------------------------------------------------

# 49. EDIT ORDER

Blueprint **tidak mendefinisikan fitur edit Master Order**.

UI guideline memang menyebut drawer dapat dipakai untuk `quick edit`,
tetapi tidak menyatakan Master Order mana yang boleh diedit.

Maka:

``` text
Edit Master Order:
BELUM DITENTUKAN
```

Coding agent tidak boleh membuat fungsi edit Order berdasarkan asumsi.

------------------------------------------------------------------------

# 50. DELETE ORDER

Blueprint **tidak mendefinisikan delete Master Order**.

Karena itu:

``` text
Delete Order:
BELUM DITENTUKAN
```

Jangan menambahkan tombol Delete pada Order berdasarkan asumsi.

------------------------------------------------------------------------

# 51. LEADS LOGIC

Satu Order ID baru:

``` text
= 1 Lead
```

Tidak menghitung jumlah webhook sebagai jumlah lead.

------------------------------------------------------------------------

# 52. STATUS MAPPING

Status OrderOnline:

``` text
pending
→ Pending
```

``` text
processing
→ Paid
```

``` text
complete
→ Paid
```

``` text
cancelled
→ Cancelled
```

Formula:

``` text
Paid = processing OR complete
```

Logic ini berlaku konsisten di:

- Dashboard;
- Order;
- Presensi;
- Redirect Webinar;
- QR Seminar;
- Report.

------------------------------------------------------------------------

# 53. WEBHOOK ORDER

Ketika webhook masuk:

``` text
Webhook diterima Worker
↓
ambil Order ID
↓
parse product
↓
normalize status
↓
calculate tax
↓
simpan/update Order
```

Jika Order ID baru:

``` text
buat row Order baru
```

Jika Order ID sudah ada:

``` text
update / upsert row tersebut
```

Tidak membuat duplikat transaksi.

------------------------------------------------------------------------

# 54. STANDAR PRODUCT NAME

Urutan informasi:

``` text
Nama Produk
Pengiklan
Seminar / Webinar
Batch
Sesi
Kota
```

Format:

``` text
[KODE UTAMA] - [SESI] - [KOTA]
```

Kode utama:

``` text
[PRODUK][PENGIKLAN][TIPE][BATCH]
```

Contoh:

``` text
KM01SO392 - S1 - Solo
```

Meaning:

``` text
KM  = Kuliner Masteri
01  = Zul
SO  = Seminar Offline
392 = Batch 392
S1  = Sesi 1
Solo = Kota
```

------------------------------------------------------------------------

# 55. SESI TUNGGAL

Format:

``` text
KM01SO392 - ST - Solo
```

`ST`:

``` text
Sesi Tunggal
```

------------------------------------------------------------------------

# 56. WEBINAR PRODUCT NAME

Contoh:

``` text
KM01WO392 - ST - Online
```

------------------------------------------------------------------------

# 57. MENU: KONFIGURASI PRODUK

Menu ini merupakan pusat mapping kode.

Konfigurasi yang dikelola di sini:

``` text
Produk
Pengiklan
Type
Sesi
```

------------------------------------------------------------------------

# 58. PRODUK CONFIG

Contoh:

``` text
Kuliner Masteri        KM
Master TikTok Indonesia MT
Webstore Academy        WA
```

Minimum data:

``` text
Nama Produk
Kode
```

------------------------------------------------------------------------

# 59. PENGIKLAN CONFIG

Contoh:

``` text
Zul      01
Rahman   02
Andi     03
```

Minimum:

``` text
Nama
Kode
```

------------------------------------------------------------------------

# 60. TYPE CONFIG

Contoh:

``` text
Seminar Offline → SO
Webinar Online  → WO
```

------------------------------------------------------------------------

# 61. SESSION CONFIG

Contoh:

``` text
Sesi 1        → S1
Sesi 2        → S2
Sesi Tunggal  → ST
```

------------------------------------------------------------------------

# 62. CONFIGURATION PAGE UX

Gunakan CRUD sederhana.

Pattern:

``` text
Page Header                  [+ Tambah]

Search

Table

Edit action
Delete action
Status
```

Jangan membuat seluruh konfigurasi dalam satu form panjang.

------------------------------------------------------------------------

# 63. ADD CONFIGURATION FLOW

Sumber menyatakan konfigurasi menggunakan CRUD dan tombol:

``` text
+ Tambah
```

Flow UI:

``` text
Klik + Tambah
↓
form tambah dibuka
↓
user mengisi data konfigurasi
↓
Save
↓
loading kecil pada action Save
↓
jika berhasil tampilkan toast
↓
table menampilkan konfigurasi terbaru
```

Field mengikuti jenis konfigurasi.

Tidak menambahkan field baru yang tidak ditentukan.

------------------------------------------------------------------------

# 64. EDIT CONFIGURATION FLOW

``` text
Pilih Edit pada row
↓
edit sederhana
↓
modal dapat digunakan
↓
field existing ditampilkan
↓
user mengubah data
↓
Update
↓
loading kecil
↓
toast sukses
↓
table ter-update
```

------------------------------------------------------------------------

# 65. DELETE CONFIGURATION FLOW

Guideline secara eksplisit menetapkan:

``` text
Delete action
Delete confirmation
```

Flow:

``` text
User klik Delete
↓
confirmation modal
↓
user memilih Cancel atau Delete
```

Jika Cancel:

``` text
modal ditutup
tidak ada perubahan
```

Jika Delete:

``` text
jalankan delete
↓
loading pada action
↓
jika berhasil:
modal tutup
toast
table refresh
```

Apakah delete berupa:

``` text
hard delete
soft delete
disable
```

**tidak ditentukan blueprint**.

Jangan mengarang behavior penyimpanan delete.

------------------------------------------------------------------------

# 66. STATUS CONFIGURATION

Guideline menyebut kolom:

``` text
Status
```

Blueprint konfigurasi Tax secara eksplisit mempunyai:

``` text
Active
```

Untuk konfigurasi Produk/Pengiklan/Type/Sesi, detail struktur status
database belum dijelaskan.

Jangan menyimpulkan struktur field di luar sumber.

------------------------------------------------------------------------

# 67. PARSING PRODUCT WEBHOOK

Input:

``` text
KM01SO392 - S1 - Solo
```

Output normalized:

``` text
product_code = KM
product_name = Kuliner Masteri

advertiser_code = 01
advertiser_name = Zul

event_type = Seminar Offline

batch = 392
session = S1
city = Solo
```

Data normalized disimpan sebagai field terpisah.

Tujuannya agar mudah difilter.

------------------------------------------------------------------------

# 68. PRODUCT RAW

Master Order mempunyai:

``` text
product_raw
```

Jadi original product string dari OrderOnline tetap disimpan.

------------------------------------------------------------------------

# 69. PRODUCT PARSE FAILURE

Behavior jika kode produk tidak valid / tidak dapat diparse **tidak
dijelaskan blueprint**.

Coding agent jangan mengarang fallback business rule.

------------------------------------------------------------------------

# 70. MENU: PRODUCT NAME GENERATOR

Tujuan:

membantu tim membuat kode produk valid dan konsisten.

Input:

``` text
Produk
Pengiklan
Seminar / Webinar
Batch
Sesi
Kota
```

------------------------------------------------------------------------

# 71. PRODUCT NAME GENERATOR UI

Layout:

``` text
Product Name Generator

Produk
[Select]

Pengiklan
[Select]

Event Type
[Select]

Batch
[Input]

Sesi
[Select]

Kota
[Input]

[GENERATE]

Generated Product Name

KM01SO392 - S1 - Solo

[COPY]
```

Generated result harus menjadi focal point.

Style:

- primary-soft background;
- monospace optional;
- font 16--18px;
- copy button jelas.

------------------------------------------------------------------------

# 72. GENERATOR WORKFLOW

``` text
User buka Product Name Generator
↓
pilih Produk
↓
pilih Pengiklan
↓
pilih Event Type
↓
isi Batch
↓
pilih Sesi
↓
isi Kota
↓
klik GENERATE
↓
system mengambil kode sesuai konfigurasi
↓
gabungkan sesuai format
↓
tampilkan hasil
```

Formula:

``` text
[PRODUCT CODE]
+
[ADVERTISER CODE]
+
[TYPE CODE]
+
[BATCH]
+
" - "
+
[SESSION CODE]
+
" - "
+
[CITY]
```

------------------------------------------------------------------------

# 73. COPY PRODUCT NAME

``` text
User klik COPY
↓
generated product name disalin
↓
toast sukses
```

Toast dapat menggunakan copy feedback sebagaimana guideline.

------------------------------------------------------------------------

# 74. GENERATOR ERROR / EMPTY

Blueprint tidak mendefinisikan validation text spesifik.

Namun accessibility/UI guideline menetapkan:

``` text
form mempunyai label
error message dekat input
```

Maka bila input wajib untuk generate belum tersedia:

- action tidak boleh menghasilkan kode salah;
- error harus muncul dekat field terkait.

Copywriting exact error **belum ditetapkan**.

------------------------------------------------------------------------

# 75. MENU: KONFIGURASI TAX

Tujuan:

membuat aturan tax/fee fleksibel.

Admin dapat membuat rule sebanyak yang dibutuhkan.

Field minimum:

``` text
Nama
Identifier / Mapping Payment
Type
Value
Active
```

------------------------------------------------------------------------

# 76. TAX TYPE

Hanya dua:

``` text
Flat
Percentage
```

Tidak menambah type lain.

------------------------------------------------------------------------

# 77. CONTOH TAX CONFIG

``` text
VA BCA       Flat         4000
QRIS         Percentage   0.7
VA Mandiri   Flat         4000
```

Payment fee tidak di-hardcode dalam source code.

------------------------------------------------------------------------

# 78. ADD TAX

Configuration CRUD pattern berlaku.

Flow:

``` text
Konfigurasi Tax
↓
+ Tambah
↓
isi:
Nama
Identifier / Mapping Payment
Type
Value
Active
↓
Save
↓
toast
↓
table refresh
```

------------------------------------------------------------------------

# 79. EDIT TAX

``` text
Tax row
↓
Edit
↓
modal edit sederhana
↓
ubah field
↓
Update
↓
toast
↓
table refresh
```

------------------------------------------------------------------------

# 80. DELETE TAX

Pattern mengikuti global delete configuration:

``` text
Delete
↓
confirmation
↓
Cancel / Delete
```

Behavior data historical setelah rule tax dihapus **tidak didefinisikan
blueprint**.

Jangan membuat tax snapshot, retroactive recalculation, atau rule
tambahan kecuali nantinya ditentukan.

------------------------------------------------------------------------

# 81. PERCENTAGE CALCULATION

Example:

``` text
Gross = Rp300.000
QRIS = 0,7%
```

Result:

``` text
Tax = Rp2.100
Net = Rp297.900
```

Formula:

``` text
Tax = Gross × Percentage
Net = Gross - Tax
```

------------------------------------------------------------------------

# 82. FLAT CALCULATION

Example:

``` text
Gross = Rp300.000
VA BCA = Rp4.000
```

Result:

``` text
Tax = Rp4.000
Net = Rp296.000
```

Formula:

``` text
Tax = Flat Value
Net = Gross - Tax
```

------------------------------------------------------------------------

# 83. PAYMENT MAPPING

Tax configuration mempunyai:

``` text
Identifier / Mapping Payment
```

Digunakan untuk menghubungkan metode pembayaran ke fee/tax rule.

Detail algoritma string matching-nya **tidak ditentukan blueprint**.

Jangan mengarang fuzzy matching, priority rule, fallback rule, dsb.

------------------------------------------------------------------------

# 84. MENU: REPORT TAX

Menu khusus finance/reporting.

Summary:

``` text
Jumlah transaksi
Gross
Total Tax
Net
```

------------------------------------------------------------------------

# 85. REPORT TAX BREAKDOWN

Breakdown dapat berdasarkan:

``` text
Payment Method
Produk
Batch
Pengiklan
Tanggal
Kota
Seminar / Webinar
```

Contoh output:

``` text
Payment   Transactions   Gross   Tax   Net

QRIS      320            ...     ...   ...
VA BCA    180            ...     ...   ...
```

------------------------------------------------------------------------

# 86. REPORT TAX UX

Visual harus mengikuti standard:

``` text
Page Header
Filters
Summary
Main Data
```

Gunakan table compact dan filter yang sama konsistennya dengan aplikasi.

Exact chart atau visual tambahan **tidak ditentukan blueprint**.

------------------------------------------------------------------------

# 87. ORDERONLINE ACCESS LINK

OrderOnline hanya perlu membawa:

``` text
Order ID
```

Contoh:

``` text
https://app.domain/access/283033796
```

Tidak menggunakan token tambahan.

------------------------------------------------------------------------

# 88. ACCESS VALIDATION

Ketika link dibuka:

``` text
Order ID
↓
Cloudflare Worker
↓
Cari order di Supabase
↓
Order ada?
↓
Status Paid?
```

Rule:

``` text
VALID ORDER ID
+
STATUS = PAID
=
ACCESS GRANTED
```

------------------------------------------------------------------------

# 89. ACCESS DENIED

Jika:

``` text
Pending
Cancelled
Order tidak ditemukan
```

hasil:

``` text
ACCESS DENIED
```

Tidak boleh memberikan akses event.

------------------------------------------------------------------------

# 90. WEBINAR ATTENDANCE

Workflow:

``` text
OrderOnline Link
↓
Peserta klik
↓
Cloudflare Worker
↓
Cek Order ID
↓
Cek status Paid
↓
Catat timestamp attendance
↓
302 Redirect
↓
Zoom
```

------------------------------------------------------------------------

# 91. WEBINAR REPEATED CLICK

Jika user klik berulang:

``` text
setiap klik
=
attendance event baru
```

Tujuan:

melihat user keluar/masuk.

Jangan deduplicate attendance webinar menjadi satu record.

------------------------------------------------------------------------

# 92. ZOOM DESTINATION

Blueprint menyebut redirect:

``` text
302 Redirect
↓
Zoom
```

Tempat penyimpanan/configuration URL Zoom **tidak dijelaskan
blueprint**.

Jangan membuat sistem Event Management baru untuk menjawab gap ini.

------------------------------------------------------------------------

# 93. SEMINAR ACCESS

Peserta membuka:

``` text
/access/[order_id]
```

Flow:

``` text
cek Order ID
↓
cek Paid
↓
tampilkan halaman tiket
↓
browser generate QR
```

------------------------------------------------------------------------

# 94. SEMINAR QR CONTENT

QR dapat berisi:

``` text
/checkin/[order_id]
```

QR dibuat:

``` text
client-side/browser
```

Worker tidak membuat file QR.

------------------------------------------------------------------------

# 95. MENU: SCAN QR

Ini adalah menu paling atas.

Title utama:

``` text
SCAN PRESENSI SEMINAR
```

UI dibuat:

- besar;
- cepat;
- mudah dilihat;
- minim distraction.

------------------------------------------------------------------------

# 96. SCANNER PAGE LAYOUT

``` text
SCAN PRESENSI

[ Camera Scanner ]

Status scanner

Hasil terakhir:

✅ Ahmad
Order #123456
Check-in berhasil
20:14:03
```

Success:

``` text
area hijau soft
```

Failed:

``` text
area merah soft
```

Operator tidak boleh dipaksa melakukan banyak klik.

------------------------------------------------------------------------

# 97. SCAN QR WORKFLOW

``` text
Panitia buka scanner
↓
Scan QR peserta
↓
QR menghasilkan Order ID / URL check-in
↓
Cloudflare Worker
↓
Cari Order di Supabase
↓
Order valid?
↓
Status Paid?
↓
Catat timestamp
↓
Check-in berhasil
```

------------------------------------------------------------------------

# 98. SCAN INVALID

Jika status bukan Paid:

``` text
Akses / Check-in Ditolak
```

Jika Order tidak valid:

akses tidak memenuhi security rule dan harus ditolak.

------------------------------------------------------------------------

# 99. SCANNER MANUAL SEARCH

UI guideline menyebut:

``` text
Scanner = Primary
Manual Search = Secondary
```

Namun workflow detail Manual Search **tidak dijelaskan blueprint**.

Karena itu PRD hanya menetapkan keberadaan sebagai secondary action dari
guideline.

Detail field pencarian, check-in manual, dan result logic tidak boleh
dikarang sampai requirement ditentukan.

------------------------------------------------------------------------

# 100. CHECK-IN SEMINAR

Saat QR discan:

``` text
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

Satu check-in menghasilkan:

``` text
attendance event
```

------------------------------------------------------------------------

# 101. REPEATED SEMINAR SCAN

Blueprint attendance menyatakan raw event disimpan sebagai row, tetapi
tidak secara eksplisit menjelaskan apakah repeated seminar scan harus
dicegah atau selalu dicatat.

Karena itu:

``` text
Repeated Seminar Scan Behavior:
BELUM DITENTUKAN
```

Jangan mengarang duplicate-scan rule.

------------------------------------------------------------------------

# 102. MENU: PRESENSI ACARA

Berisi:

``` text
Master Table Presensi
```

Semua event digabung:

``` text
Webinar
+
Seminar
```

Default:

``` text
semua event tampil
```

Jika lima event berjalan bersamaan:

``` text
semuanya dapat muncul dalam table yang sama
```

Filter digunakan untuk memisahkan data.

------------------------------------------------------------------------

# 103. PRESENSI TABLE COLUMNS

Urutan utama:

``` text
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

Informasi penting di lapangan ditempatkan di depan.

------------------------------------------------------------------------

# 104. ATTENDANCE STORAGE

Database **tidak** membuat:

``` text
timestamp_1
timestamp_2
timestamp_3
...
```

Setiap attendance disimpan sebagai row:

``` text
attendance_events
```

Contoh:

``` text
Order ID   Type      Timestamp

10001      webinar   17:53
10001      webinar   18:01
10001      webinar   19:11
```

UI melakukan transformasi menjadi:

``` text
Timestamp 1
Timestamp 2
...
Timestamp 10
```

------------------------------------------------------------------------

# 105. ROLLING 10 TIMESTAMP

Jika user memiliki:

``` text
17 attendance events
```

maka:

``` text
Total Activity = 17
```

Tetapi table hanya menampilkan:

``` text
10 timestamp terbaru
```

Timestamp lama tetap ada selama belum melewati retention.

------------------------------------------------------------------------

# 106. ATTENDANCE RETENTION

Raw attendance maksimal:

``` text
30 hari
```

Setelah itu otomatis dihapus.

Example:

``` sql
DELETE attendance_events
WHERE clicked_at < NOW() - INTERVAL '30 days'
```

Master Order:

``` text
TETAP DISIMPAN
```

------------------------------------------------------------------------

# 107. ATTENDANCE STATUS

Status dihitung dari data.

## Belum Hadir

``` text
Paid
+
0 attendance
=
Belum Hadir
```

## Hadir

``` text
Paid
+
>= 1 attendance
=
Hadir
```

## Pending

``` text
Pending bukan Belum Hadir
```

Tiga kondisi berbeda:

``` text
Pending
Belum Hadir
Hadir
```

------------------------------------------------------------------------

# 108. PRESENSI FILTER

Filter:

``` text
Produk
Batch
Sesi
Kota
Pengiklan
Seminar / Webinar
Hadir / Belum Hadir
Tanggal
```

------------------------------------------------------------------------

# 109. PRESENSI SEARCH

Custom search:

``` text
Nama
WA
Order ID
Keyword Produk
Batch
Kota
dan field relevan lainnya sebagaimana blueprint
```

------------------------------------------------------------------------

# 110. PRESENSI ACTIVE FILTER

Active filter harus selalu terlihat.

Example:

``` text
Active Filters:

Kuliner Masteri
Batch 392
Solo
S1

[Clear All]
```

Pattern chip dan individual remove mengikuti global filter system.

------------------------------------------------------------------------

# 111. PRESENSI PAGE UX

Hierarchy:

``` text
Presensi Acara

Search + Filters

KPI:
Hadir
Belum Hadir
Attendance Rate

Master Table

Order ID
Nama
WA
Timestamp
Total Activity
Product
Batch
Session
City
Event
```

Timestamp boleh memakai horizontal scrolling.

------------------------------------------------------------------------

# 112. DETAIL ATTENDANCE

Guideline menyebut:

``` text
detail attendance
→ drawer
```

Jadi ketika user perlu inspection data attendance, drawer harus
digunakan agar context table tetap terjaga.

Exact field tambahan selain data Presensi **tidak ditentukan**.

------------------------------------------------------------------------

# 113. MENU: PROFIL

Profil dibuat sederhana.

Isi:

``` text
Nama
Username
Avatar Emoji
Ganti Password
```

------------------------------------------------------------------------

# 114. AVATAR

Tidak menggunakan upload gambar.

User memilih emoji.

Contoh:

``` text
😎 🚀 🐼 🦊 🐯 👨‍💻 🤖
```

Avatar emoji disimpan sebagai:

``` text
string biasa
```

di database.

------------------------------------------------------------------------

# 115. AVATAR UI

Avatar berada dalam circle.

Selected emoji menggunakan:

- primary-soft background;
- primary border;
- subtle shadow.

------------------------------------------------------------------------

# 116. GANTI PASSWORD

Blueprint hanya menetapkan bahwa Profile mempunyai:

``` text
Ganti Password
```

UI guideline menyebut:

``` text
password berhasil diubah
→ toast
```

Detail field seperti current password, confirmation password, minimum
character, dan policy password **tidak ditentukan sumber**.

Jangan menambah policy tanpa requirement.

------------------------------------------------------------------------

# 117. LOGOUT

Menu berada:

``` text
paling bawah sidebar
```

Flow:

``` text
User klik Logout
↓
hapus session
↓
redirect halaman login
```

------------------------------------------------------------------------

# 118. MINIMUM DATABASE TABLES

Minimum:

``` text
users
orders
attendance_events
products
advertisers
payment_fee_rules
app_settings
```

Optional:

``` text
webhook_logs
```

Webhook log:

``` text
tidak disimpan permanen
```

------------------------------------------------------------------------

# 119. ORDERS TABLE

Field utama:

``` text
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

Tidak menambahkan field database lain sebagai requirement wajib.

------------------------------------------------------------------------

# 120. ATTENDANCE TABLE

Field:

``` text
id
order_id
attendance_type
clicked_at
```

Optional:

``` text
source
scanner_user_id
```

Source dapat berupa:

``` text
webinar_redirect
seminar_qr
```

------------------------------------------------------------------------

# 121. PRODUCTS TABLE

Blueprint menyebut tabel:

``` text
products
```

dan Konfigurasi Produk menyimpan mapping seperti:

``` text
Nama Produk
Kode
```

Schema teknis lengkap `products` di luar itu **tidak didefinisikan**.

------------------------------------------------------------------------

# 122. ADVERTISERS TABLE

Blueprint menyebut:

``` text
advertisers
```

Mapping:

``` text
Nama
Kode
```

Schema tambahan tidak boleh diasumsikan sebagai requirement.

------------------------------------------------------------------------

# 123. PAYMENT FEE RULES TABLE

Digunakan untuk menyimpan konfigurasi tax/fee:

``` text
Nama
Identifier / Mapping Payment
Type
Value
Active
```

------------------------------------------------------------------------

# 124. APP SETTINGS

Tabel:

``` text
app_settings
```

disebut dalam blueprint.

Isi setting apa saja **belum dirinci**.

Jangan mengarang configurable settings baru.

------------------------------------------------------------------------

# 125. WEBHOOK LOGS

Optional:

``` text
webhook_logs
```

Jika digunakan:

``` text
jangan disimpan permanen
```

Retention detail tidak ditetapkan.

------------------------------------------------------------------------

# 126. DATABASE INDEX

Index penting:

``` text
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

``` text
order_id
clicked_at
```

Search dapat diberi index tambahan setelah volume data membesar.

Jenis index spesifik tidak ditentukan.

------------------------------------------------------------------------

# 127. SUPABASE STRATEGY

Wajib dijaga:

- jangan menyimpan semua raw webhook selamanya;
- gunakan normalized fields;
- attendance dihapus setelah 30 hari;
- gunakan pagination;
- filter dilakukan di database;
- jangan download puluhan ribu row sekaligus.

Pagination:

``` text
50–100 rows/page
```

UI default:

``` text
50
```

optional:

``` text
100
```

------------------------------------------------------------------------

# 128. WORKER REQUEST STRATEGY

Worker digunakan jika membutuhkan server-side logic:

``` text
Webhook OrderOnline
Webinar Attendance
Seminar Check-in
Validasi Access
```

Dashboard biasa:

``` text
tidak perlu melewati Worker
```

Flow:

``` text
Cloudflare Pages
↓
Browser
↓
Supabase
```

dengan database permission yang sesuai.

------------------------------------------------------------------------

# 129. FULL WEBHOOK FLOW

``` text
ORDERONLINE
    ↓
CLOUDFLARE WORKER
    ↓
WEBHOOK
    ↓
Parse Product
Normalize Status
Calculate Tax
    ↓
SUPABASE
    ↓
ORDERS
```

------------------------------------------------------------------------

# 130. FULL ACCESS FLOW

``` text
OrderOnline Access Link
↓
Cloudflare Worker
↓
Validate Order
↓
Validate Paid
↓
determine Seminar / Webinar
```

Webinar:

``` text
record attendance
↓
302 Redirect
↓
Zoom
```

Seminar:

``` text
display ticket
↓
client-side QR
↓
panitia scan
↓
Worker
↓
record attendance
```

------------------------------------------------------------------------

# 131. FULL DATA FLOW

``` text
                       ORDERONLINE
                           │
                           ▼
                   CLOUDFLARE WORKER
                           │
             ┌─────────────┴─────────────┐
             │                           │
          WEBHOOK                     ACCESS
             │                           │
             ▼                           ▼
       Parse Product               Validate Order
       Normalize Status            Validate Paid
       Calculate Tax                    │
             │                  ┌────────┴────────┐
             │                  ▼                 ▼
             │              Webinar           Seminar
             │              Redirect        QR Check-in
             │                  │                 │
             └──────────────────┼─────────────────┘
                                ▼
                             SUPABASE
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
             ORDERS        ATTENDANCE         CONFIG
                │               │               │
                └───────────────┼───────────────┘
                                ▼
                        CLOUDFLARE PAGES
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
            Dashboard          Order          Presensi
                │                               │
                ▼                               ▼
           Report Tax                        Scan QR
```

------------------------------------------------------------------------

# 132. RESPONSIVE REQUIREMENTS

Desktop-first tetapi tetap usable pada:

``` text
Tablet
HP
```

Breakpoints:

``` css
@media (max-width: 1100px) {}
@media (max-width: 768px) {}
@media (max-width: 480px) {}
```

------------------------------------------------------------------------

# 133. DESKTOP RESPONSIVE

Desktop:

``` text
sidebar fixed width
multi-column layout
floating app shell
```

------------------------------------------------------------------------

# 134. TABLET RESPONSIVE

Tablet:

``` text
sidebar compact
dashboard dapat menjadi satu kolom jika diperlukan
```

------------------------------------------------------------------------

# 135. MOBILE RESPONSIVE

Mobile:

``` text
sidebar → drawer
main padding → 16px
KPI → 1–2 columns
table → horizontal scroll
```

At ≤768px:

``` text
app shell width 100%
min-height 100vh
margin 0
border-radius 0
```

Main content:

``` text
padding: 20px 16px
```

Dashboard:

``` text
1 column
```

Stats:

``` text
2 columns
```

At ≤480px:

``` text
stats grid → 1 column
```

------------------------------------------------------------------------

# 136. ACCESSIBILITY

Minimum:

- text contrast cukup;
- clickable area minimum 40px;
- button tidak hanya dibedakan menggunakan warna;
- form mempunyai label;
- error message dekat input;
- keyboard navigation bekerja;
- visible focus state;
- icon-only button memiliki tooltip / aria-label.

------------------------------------------------------------------------

# 137. ANIMATION

Animation subtle.

Recommended:

``` text
~0.18s transition
```

Untuk:

- background;
- color;
- border;
- box-shadow;
- transform.

Hover button:

``` text
translateY(-1px)
```

Jangan:

- bouncing;
- glowing;
- zoom besar;
- animation berlebihan.

Aplikasi harus terasa stabil.

------------------------------------------------------------------------

# 138. SHADOW

App shell:

``` text
0 20px 50px rgba(65,72,100,.12)
```

Card:

``` text
0 4px 16px rgba(50,55,80,.035)
```

Floating element:

``` text
0 8px 24px rgba(50,55,80,.08)
```

Shadow digunakan seminimal mungkin.

------------------------------------------------------------------------

# 139. VISUAL PRIORITY

Urutan visual:

``` text
1. Page Title
2. KPI / Primary Action
3. Main Data
4. Filter
5. Secondary Information
6. Supporting Text
```

Filter jangan lebih mencolok dibanding data.

------------------------------------------------------------------------

# 140. ONE PRIMARY ACTION

Setiap area hanya mempunyai satu action dominan.

## Konfigurasi Produk

Primary:

``` text
+ Tambah Produk
```

Secondary:

``` text
Edit
```

Danger:

``` text
Delete
```

## Product Name Generator

Primary:

``` text
Generate
```

Secondary:

``` text
Copy
```

## Scan QR

Primary:

``` text
Scanner
```

Secondary:

``` text
Manual Search
```

------------------------------------------------------------------------

# 141. REDUCE CLICKS

Workflow operasional harus:

- search langsung;
- filter cepat;
- status terlihat langsung;
- primary action tersedia;
- tidak membutuhkan terlalu banyak modal;
- detail dibuka menggunakan drawer.

Goal:

``` text
1–3 interaction
```

untuk menemukan data atau menjalankan action utama.

------------------------------------------------------------------------

# 142. KEEP CONTEXT

Jangan pindahkan user ke halaman baru jika tidak diperlukan.

Contoh:

``` text
Klik Order Row
↓
Order Detail Drawer
```

bukan:

``` text
Redirect halaman baru
```

untuk sekadar inspection.

------------------------------------------------------------------------

# 143. INFORMATION DENSITY

Operational app harus:

``` text
clean
+
data efficient
```

Card:

``` text
lebih lega
```

Table:

``` text
lebih rapat
```

Jangan menggunakan whitespace sebesar marketing website.

------------------------------------------------------------------------

# 144. ICON SYSTEM

Gunakan satu icon style/library saja.

Guideline merekomendasikan:

``` text
Lucide Icons
atau
Heroicons
```

Jangan mencampur banyak style icon.

------------------------------------------------------------------------

# 145. IMPLEMENTASI UI FOUNDATION

Urutan implementasi UI mengikuti guideline:

``` text
1. Global color + typography tokens
2. App shell
3. Sidebar
4. Page header
5. Card system
6. Buttons
7. Inputs
8. Badge system
9. KPI cards
10. Filter bar
11. Table
12. Drawer
13. Modal
14. Toast
15. Empty/error/loading states
16. Responsive behavior
17. Micro-interactions
```

Setelah komponen dasar selesai:

``` text
semua halaman wajib menggunakan komponen yang sama
```

agar konsisten.

------------------------------------------------------------------------

# 146. URUTAN BUILD BERDASARKAN DEPENDENCY YANG ADA DI BLUEPRINT

Dokumen sumber tidak memberikan fase coding backend secara eksplisit.

Namun hubungan dependency fungsionalnya adalah:

``` text
Foundation UI
+
Database
+
Authentication
+
Configuration
+
Webhook / Order
+
Dashboard / Reporting
+
Access / Attendance
+
Scanner / Presensi
```

Ini bukan penambahan feature.

Ini hanya penyusunan dependency dari feature yang memang sudah ada.

------------------------------------------------------------------------

# 147. GLOBAL LOADING WORKFLOW

Untuk halaman data:

``` text
User membuka halaman
↓
data sedang dimuat
↓
tampilkan skeleton
↓
data berhasil
↓
render actual content
```

Jika gagal:

``` text
Error State
+
Coba Lagi
```

Jika kosong:

``` text
Empty State
```

------------------------------------------------------------------------

# 148. GLOBAL CRUD WORKFLOW CONFIGURATION

Untuk Product/Pengiklan/Tax dan configuration yang memakai CRUD:

## Create

``` text
Page
↓
+ Tambah
↓
Form
↓
Save
↓
Loading
↓
Success
↓
Toast
↓
Table Updated
```

## Edit

``` text
Table
↓
Edit
↓
Edit Modal
↓
Update
↓
Loading
↓
Success
↓
Toast
↓
Table Updated
```

## Delete

``` text
Table
↓
Delete
↓
Confirmation Modal
↓
Cancel / Delete
```

## Search

``` text
Search
↓
server-side filter/search
↓
table result
```

Semantics penyimpanan Delete yang spesifik tidak ditentukan.

------------------------------------------------------------------------

# 149. MASTER ORDER WORKFLOW

``` text
OrderOnline webhook
↓
Worker menerima data
↓
cek Order ID
↓
parse product
↓
normalize status
↓
calculate tax
↓
Order ID belum ada?
    ├─ Yes → buat row
    └─ No  → update/upsert row
↓
Master Order
↓
tersedia untuk:
Dashboard
Order
Report
Presensi
Access Validation
```

------------------------------------------------------------------------

# 150. MASTER ATTENDANCE WORKFLOW

``` text
Valid Paid Order
↓
attendance interaction
↓
attendance event dicatat
↓
attendance_events
↓
UI aggregate berdasarkan Order ID
↓
hitung Total Activity
↓
ambil 10 timestamp terbaru
↓
hitung Hadir / Belum Hadir
↓
tampilkan Master Presensi
```

------------------------------------------------------------------------

# 151. GLOBAL BUSINESS RULES --- TIDAK BOLEH BERUBAH

Rule berikut adalah hard requirement:

``` text
1 Order ID = 1 Master Order
```

``` text
Order ID baru = 1 Lead
```

``` text
pending = Pending
```

``` text
processing = Paid
```

``` text
complete = Paid
```

``` text
cancelled = Cancelled
```

``` text
Paid = processing OR complete
```

``` text
Paid + 0 attendance = Belum Hadir
```

``` text
Paid + >=1 attendance = Hadir
```

``` text
Pending != Belum Hadir
```

``` text
Attendance hanya valid untuk Order ID valid + Paid
```

``` text
Webinar click berulang = attendance event baru
```

``` text
Raw attendance retention = 30 hari
```

``` text
Master Order tidak ikut dihapus ketika raw attendance melewati retention
```

``` text
Product Code berasal dari configuration
```

``` text
Tax/Fee berasal dari configuration
```

``` text
QR dibuat client-side
```

``` text
OrderOnline access link cukup membawa Order ID
```

``` text
Tidak menggunakan token tambahan pada access link
```

``` text
Semua laporan berasal dari orders + attendance_events
```

------------------------------------------------------------------------

# 152. HAL YANG TIDAK BOLEH DI-HARDCODE

Berdasarkan blueprint:

``` text
Product mapping
Advertiser mapping
Type mapping
Session mapping
Payment tax/fee
```

harus berasal dari configuration.

------------------------------------------------------------------------

# 153. HAL YANG HARUS SERVER-SIDE

Worker digunakan untuk:

``` text
Webhook OrderOnline
Order ID Validation
Paid Validation
Webinar Redirect
Webinar Attendance
Seminar Check-in
Attendance recording
Backend-sensitive operations
```

------------------------------------------------------------------------

# 154. HAL YANG TIDAK PERLU MELALUI WORKER

Dashboard normal:

``` text
Cloudflare Pages
↓
Browser
↓
Supabase
```

dengan permission sesuai.

------------------------------------------------------------------------

# 155. HAL YANG HARUS SERVER-SIDE PADA QUERY DATA BESAR

Meskipun frontend dapat berkomunikasi dengan Supabase, operation berikut
dilakukan di database/server side:

``` text
Filter
Search
Pagination
Large-data Sort
```

Jangan mengambil puluhan ribu row ke browser.

------------------------------------------------------------------------

# 156. DESIGN DO

Wajib:

- satu primary color;
- typography sederhana;
- whitespace konsisten;
- status badge;
- satu icon style;
- readable table;
- fast filter;
- drawer untuk detail;
- skeleton loading;
- toast feedback;
- active filters selalu terlihat;
- empty state;
- error state;
- responsive layout.

------------------------------------------------------------------------

# 157. DESIGN DON'T

Hindari:

- gradient berlebihan;
- shadow gelap;
- border hitam;
- terlalu banyak warna;
- terlalu banyak font size;
- random radius;
- campuran icon style;
- semua button primary;
- semua KPI berwarna;
- terlalu banyak modal;
- table tanpa pagination;
- spinner besar;
- excessive hover animation;
- dashboard terlalu penuh.

------------------------------------------------------------------------

# 158. FINAL DESIGN DIRECTION

``` text
Soft Gray Page
↓
Floating App Shell
↓
Slim Off-White Sidebar
↓
Indigo Active Navigation
↓
Clean White Cards
↓
One Highlight KPI
↓
Compact Data Tables
↓
Soft Status Badges
↓
Minimal Filters
↓
Fast Operational UX
```

Target:

``` text
SaaS admin premium
clean
modern
efisien untuk operasional
```

Khusus untuk:

- pencarian Order;
- monitoring pembayaran;
- presensi event;
- configuration product;
- tax reporting;
- QR scanning.

------------------------------------------------------------------------

# 159. ACCEPTANCE --- LOGIN

Login dianggap sesuai requirement jika:

``` text
ada Username
ada Password
tidak ada public signup
password stored hash
role mendukung minimal Master Admin/Admin/Staff
logout menghapus session
logout redirect ke login
```

------------------------------------------------------------------------

# 160. ACCEPTANCE --- MASTER ORDER

Sesuai jika:

``` text
1 Order ID hanya menghasilkan 1 row
```

dan repeated webhook:

``` text
update/upsert
```

Status mapping harus persis sesuai blueprint.

Master table harus menampilkan seluruh kolom yang ditentukan.

------------------------------------------------------------------------

# 161. ACCEPTANCE --- ORDER SEARCH & FILTER

Sesuai jika:

- structured filters tersedia;
- filter dapat dikombinasikan;
- global search tersedia;
- active filter terlihat;
- filter dapat dilepas;
- Clear All tersedia;
- query dilakukan server-side;
- table menggunakan pagination;
- default 50 row;
- 100 row optional.

------------------------------------------------------------------------

# 162. ACCEPTANCE --- PRODUCT CONFIG

Sesuai jika admin berizin dapat mengelola:

``` text
Produk
Pengiklan
Type
Sesi
```

CRUD UI mengikuti:

``` text
Tambah
Search
Table
Edit
Delete
Status
```

dan configuration digunakan oleh Product Generator/parser.

------------------------------------------------------------------------

# 163. ACCEPTANCE --- PRODUCT GENERATOR

Sesuai jika input:

``` text
Produk
Pengiklan
Event Type
Batch
Sesi
Kota
```

dapat menghasilkan format:

``` text
KM01SO392 - S1 - Solo
```

dan hasil dapat:

``` text
COPY
```

------------------------------------------------------------------------

# 164. ACCEPTANCE --- TAX CONFIG

Sesuai jika admin dapat membuat tax rule dengan:

``` text
Nama
Identifier / Mapping Payment
Type
Value
Active
```

Type hanya:

``` text
Flat
Percentage
```

Calculation harus mengikuti contoh dan formula blueprint.

------------------------------------------------------------------------

# 165. ACCEPTANCE --- TAX REPORT

Sesuai jika menampilkan:

``` text
Jumlah transaksi
Gross
Total Tax
Net
```

dan breakdown dapat dilakukan berdasarkan:

``` text
Payment Method
Produk
Batch
Pengiklan
Tanggal
Kota
Seminar / Webinar
```

------------------------------------------------------------------------

# 166. ACCEPTANCE --- WEBINAR

Sesuai jika:

``` text
Valid Order ID + Paid
↓
attendance timestamp
↓
302 redirect Zoom
```

dan setiap klik berulang:

``` text
attendance event baru
```

Pending/Cancelled/Unknown:

``` text
denied
```

------------------------------------------------------------------------

# 167. ACCEPTANCE --- SEMINAR

Sesuai jika:

``` text
Paid Order
↓
access page
↓
ticket
↓
client-side QR
```

dan scanner:

``` text
QR
↓
Order validation
↓
Paid validation
↓
attendance timestamp
↓
success
```

------------------------------------------------------------------------

# 168. ACCEPTANCE --- PRESENSI

Sesuai jika:

``` text
Seminar + Webinar
```

dapat tampil dalam satu Master Presensi.

Table harus dapat menampilkan:

``` text
10 timestamp terbaru
+
Total Activity keseluruhan
```

Status harus mengikuti:

``` text
Paid + 0 = Belum Hadir
Paid + >=1 = Hadir
```

------------------------------------------------------------------------

# 169. ACCEPTANCE --- ATTENDANCE RETENTION

Sesuai jika:

``` text
raw attendance > 30 hari
```

dihapus otomatis.

Tetapi:

``` text
Master Order tetap ada
```

------------------------------------------------------------------------

# 170. ACCEPTANCE --- UI

Aplikasi dianggap sesuai apabila:

- menggunakan global design tokens;
- mempunyai floating app shell desktop;
- sidebar sesuai struktur;
- typography sesuai;
- table compact;
- filter usable;
- active filter terlihat;
- status badge konsisten;
- modal hanya untuk use case sederhana;
- detail menggunakan drawer;
- loading menggunakan skeleton;
- error state jelas;
- empty state jelas;
- responsive;
- mobile table horizontal scroll;
- scanner usable di mobile;
- komponen visual konsisten di seluruh halaman.

------------------------------------------------------------------------

# 171. AREA YANG BELUM DITENTUKAN BLUEPRINT

Coding agent **tidak boleh mengarang keputusan sendiri** untuk area
berikut tanpa requirement tambahan:

``` text
Algoritma hash password spesifik

Format/session storage implementation

Permission matrix detail Master Admin/Admin/Staff

User-management page

Jenis chart Dashboard

Isi detail Breakdown Dashboard

Kolom sortable secara spesifik

Default sorting

Behavior search debounce

Apakah search ikut terhapus ketika Clear All

Delete configuration:
hard delete / soft delete / deactivate

Edit/Delete Master Order

Behavior product parser jika format invalid

Behavior Tax jika mapping tidak ditemukan

Historical tax behavior setelah config tax diedit/dihapus

Algoritma matching Identifier Payment

Penyimpanan URL Zoom

Repeated seminar scan handling

Detail Manual Search pada scanner

Password policy Ganti Password

Isi app_settings

Retention webhook_logs

API route naming

Library tambahan selain stack yang disebut blueprint

Additional database tables

Additional database fields

Export CSV/XLSX

Notification center

Audio scanner

Audit log

Rate limit

Tax snapshot

Custom reporting baru

Fitur lain yang tidak disebut sumber
```

Jika implementasi mencapai salah satu area tersebut:

``` text
STOP
↓
jangan berasumsi
↓
requirement perlu diputuskan dahulu
```

------------------------------------------------------------------------

# 172. RULE UNTUK VIBE CODING AGENT

## Rule 1

Jangan menambahkan feature yang tidak ada di PRD.

## Rule 2

Jangan mengubah business logic.

## Rule 3

Jangan mengubah struktur sidebar.

## Rule 4

Jangan membuat public signup.

## Rule 5

Jangan membuat Order duplicate.

## Rule 6

Jangan mengubah status mapping.

## Rule 7

Jangan hardcode konfigurasi Product/Advertiser/Type/Session/Tax.

## Rule 8

Jangan menyimpan timestamp attendance sebagai kolom
Timestamp1...Timestamp10 di database.

## Rule 9

Jangan load seluruh database ke browser.

## Rule 10

Jangan menyimpan raw attendance lebih dari 30 hari.

## Rule 11

Jangan menghapus Master Order karena attendance retention.

## Rule 12

Jangan membuat QR di Worker.

## Rule 13

Jangan memberikan akses event kepada Pending atau Cancelled.

## Rule 14

Jangan membuat UI style baru yang tidak mengikuti shared UI system.

## Rule 15

Jangan membuat fitur hanya karena library/framework membuatnya mudah.

## Rule 16

Jika detail tidak tertulis di PRD:

``` text
jangan halusinasi requirement.
```

------------------------------------------------------------------------

# 173. SOURCE OF TRUTH FINAL

Urutan source of truth saat build:

``` text
1. PRD ini
2. Blueprint App — dvflow
3. UI/UX Design Guideline
4. Code implementation
```

Jika code bertentangan dengan business rule:

``` text
CODE YANG DIUBAH
```

bukan requirement.

------------------------------------------------------------------------

# 174. FINAL CORE SYSTEM

``` text
OrderOnline
↓
Webhook
↓
Cloudflare Worker
↓
Parse Product
Normalize Status
Calculate Tax
↓
Supabase PostgreSQL
↓
Orders + Attendance + Config
↓
Cloudflare Pages / React / Tailwind
↓
Scan QR
Dashboard Resume
Order
Presensi Acara
Konfigurasi Produk
Konfigurasi Tax
Report Tax
Product Name Generator
Profil
Logout
```

------------------------------------------------------------------------

# 175. FINAL PRODUCT RULE

Seluruh aplikasi harus mempertahankan prinsip berikut:

``` text
DATA = FOKUS UTAMA
```

``` text
ORDER ID = IDENTITAS TRANSAKSI
```

``` text
ORDERS + ATTENDANCE_EVENTS = SUMBER LAPORAN
```

``` text
CONFIGURATION = SUMBER PRODUCT CODE & TAX
```

``` text
PAID = SYARAT AKSES/PRESENSI
```

``` text
UI = CEPAT, CLEAN, DATA-EFFICIENT
```

``` text
OPERATIONAL WORKFLOW = 1–3 INTERACTION SEBISA MUNGKIN
```

Dan yang paling penting untuk vibe coding:

``` text
JIKA TIDAK ADA DI BLUEPRINT ATAU UI/UX GUIDELINE,
JANGAN DIANGGAP SEBAGAI REQUIREMENT.
```
