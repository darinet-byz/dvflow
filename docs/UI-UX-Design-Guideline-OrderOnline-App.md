# UI/UX DESIGN GUIDELINE
## dvflow

Versi: 1.0  
Style: Modern Soft SaaS Dashboard  
Fokus: Clean, ringan, premium, data-heavy, mudah dipakai tim operasional

---

# 1. TUJUAN DESAIN

UI aplikasi harus terasa:

- Modern
- Clean
- Ringan
- Premium
- Tidak ramai
- Cepat dipahami
- Nyaman dipakai berjam-jam
- Cocok untuk aplikasi operasional dan reporting
- Tetap kuat ketika menampilkan tabel dan data dalam jumlah besar

Desain tidak boleh terasa seperti:
- dashboard template murahan
- terlalu banyak warna
- terlalu banyak shadow
- terlalu banyak border
- terlalu banyak gradient
- terlalu padat
- terlalu dekoratif

Prinsip utama:

> Data harus menjadi fokus utama. UI hanya membantu data terlihat lebih jelas, lebih cepat dibaca, dan lebih mudah digunakan.

---

# 2. KARAKTER VISUAL

Style utama:

**Soft Modern SaaS Dashboard**

Karakter:

- Background abu-abu kebiruan sangat muda
- App container seperti floating canvas besar
- Sidebar off-white
- Card putih
- Rounded corner besar
- Border sangat tipis
- Shadow lembut
- Warna utama indigo / blue-violet
- Warna hijau hanya untuk status positif
- Warna merah hanya untuk warning/error
- Typography sederhana
- Spacing lega
- Icon minimal

Visual hierarchy harus lebih banyak dibuat menggunakan:

1. spacing
2. font weight
3. ukuran teks
4. background
5. warna

Bukan dengan border tebal.

---

# 3. COLOR SYSTEM

Gunakan satu sistem warna global.

```css
:root {
  /* Background */
  --bg-page: #e9edf5;
  --bg-app: #f5f6fb;
  --bg-sidebar: #fafbff;
  --bg-card: #ffffff;
  --bg-soft: #f4f5fa;

  /* Primary */
  --primary: #4f46f5;
  --primary-hover: #4338e8;
  --primary-soft: #eef0ff;

  /* Text */
  --text-primary: #171821;
  --text-secondary: #737786;
  --text-muted: #a5a9b5;

  /* Border */
  --border: #eceef4;

  /* Status */
  --success: #35c96c;
  --success-soft: #e7faee;

  --danger: #ef5b5b;
  --danger-soft: #fff0f0;

  --warning: #f5b94c;
  --warning-soft: #fff7e8;

  /* Shadow */
  --shadow-app:
    0 20px 50px rgba(65,72,100,.12);

  --shadow-card:
    0 4px 16px rgba(50,55,80,.035);
}
```

## Rule warna

Primary hanya dipakai untuk:

- active sidebar
- primary button
- CTA
- selected state
- link penting
- highlight KPI utama
- focus state

Success hanya dipakai untuk:

- Paid
- hadir
- berhasil
- growth positif

Danger hanya dipakai untuk:

- Cancelled
- failed
- error
- penurunan
- check-in ditolak

Warning hanya dipakai untuk:

- Pending
- butuh perhatian
- data belum lengkap

Jangan menggunakan terlalu banyak warna dalam satu layar.

---

# 4. TYPOGRAPHY

Gunakan font sederhana dan familiar.

Recommended:

```css
font-family:
  Inter,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  Roboto,
  Arial,
  sans-serif;
```

## Typography scale

Page Title:
- 22–24px
- 700

Section Title:
- 16–18px
- 650–700

Card Title:
- 14–16px
- 600–650

KPI Number:
- 26–30px
- 700

Body:
- 13–14px
- 400

Label:
- 11–12px
- 500–600

Caption:
- 10–11px
- 400

## Rules

Gunakan maksimal 3 font weight utama:

- 400
- 500 / 600
- 700

Jangan terlalu banyak bold.

Angka KPI boleh memiliki:

```css
letter-spacing: -0.03em;
```

Agar terasa lebih modern.

---

# 5. BORDER RADIUS SYSTEM

Gunakan radius yang konsisten.

```css
:root {
  --radius-xs: 8px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;
}
```

Pemakaian:

- Button: 10px
- Input: 10px
- Sidebar menu: 11px
- Badge: 999px
- Small card: 14px
- Main card: 18px
- App shell: 24px

Jangan membuat setiap komponen punya radius berbeda secara random.

---

# 6. SPACING SYSTEM

Gunakan kelipatan 4px.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-7: 32px;
--space-8: 40px;
```

Recommended:

- Main app padding: 28–30px
- Card padding: 18–20px
- Gap antar card: 16–18px
- Gap antar section: 24–32px
- Sidebar padding: 16px
- Gap icon ke text: 10–12px

---

# 7. APP SHELL

Desktop app tampil seperti floating canvas.

```css
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg-page);
}

.app-shell {
  width: calc(100% - 64px);
  max-width: 1440px;

  min-height: calc(100vh - 64px);

  margin: 32px auto;

  display: flex;

  background: var(--bg-app);

  border-radius: var(--radius-xl);

  overflow: hidden;

  box-shadow: var(--shadow-app);
}
```

Tujuan:

Membuat aplikasi terasa seperti satu produk SaaS yang utuh, bukan halaman admin biasa.

---

# 8. SIDEBAR

Recommended width:

```css
.sidebar {
  width: 230px;
  min-width: 230px;

  padding: 24px 16px;

  background: var(--bg-sidebar);

  border-right: 1px solid var(--border);

  display: flex;
  flex-direction: column;
}
```

## Struktur sidebar

### OPERASIONAL

- Scan QR
- Dashboard Resume
- Order
- Presensi Acara

### KONFIGURASI

- Konfigurasi Produk
- Konfigurasi Tax
- Report Tax
- Product Name Generator

### ACCOUNT

- Profil
- Logout

Section title:

```css
.sidebar-section-title {
  margin: 24px 12px 8px;

  font-size: 10px;
  font-weight: 600;

  letter-spacing: .08em;
  text-transform: uppercase;

  color: #a3a7b5;
}
```

---

# 9. SIDEBAR MENU

Normal state:

```css
.sidebar-item {
  height: 44px;

  display: flex;
  align-items: center;

  gap: 12px;

  padding: 0 14px;

  margin-bottom: 4px;

  border-radius: 11px;

  font-size: 14px;
  font-weight: 500;

  color: #656a79;

  cursor: pointer;

  transition:
    background .18s ease,
    color .18s ease,
    transform .18s ease;
}
```

Hover:

```css
.sidebar-item:hover {
  background: #f0f1f7;
  color: #22242d;
}
```

Active:

```css
.sidebar-item.active {
  background:
    linear-gradient(
      135deg,
      #564cff,
      #424bf4
    );

  color: #ffffff;

  box-shadow:
    0 5px 14px rgba(79,70,245,.22);
}
```

Active menu harus terlihat jelas tanpa perlu border tebal.

---

# 10. MAIN CONTENT

```css
.main-content {
  flex: 1;
  min-width: 0;

  padding: 28px 30px 32px;
}
```

Jangan memenuhi semua area dengan card.

Sisakan negative space.

Negative space adalah bagian penting dari desain.

---

# 11. PAGE HEADER

Struktur:

```text
Page Title                         Search   Notification   Profile
Subtitle / description
```

CSS:

```css
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;

  margin-bottom: 22px;
}

.page-title {
  margin: 0;

  font-size: 24px;
  font-weight: 700;

  line-height: 1.25;
}

.page-subtitle {
  margin-top: 5px;

  font-size: 12px;

  color: #8b8f9c;
}
```

---

# 12. ICON BUTTON

Untuk:

- search
- notification
- quick action

```css
.icon-button {
  width: 40px;
  height: 40px;

  display: grid;
  place-items: center;

  background: #ffffff;

  border: 1px solid #eef0f4;
  border-radius: 50%;

  cursor: pointer;

  box-shadow:
    0 2px 8px rgba(40,45,70,.03);
}
```

Hover:

```css
.icon-button:hover {
  background: #f6f7fb;
}
```

---

# 13. CARD SYSTEM

Default card:

```css
.card {
  background: var(--bg-card);

  border: 1px solid var(--border);

  border-radius: var(--radius-lg);

  padding: 20px;

  box-shadow: var(--shadow-card);
}
```

Rules:

- jangan gunakan shadow tebal
- jangan gunakan border gelap
- jangan pakai gradient di semua card
- gunakan background putih untuk mayoritas card

---

# 14. KPI CARD

Dipakai untuk:

- Leads
- Paid
- Pending
- Conversion Rate
- Gross
- Tax
- Net
- Hadir
- Belum Hadir
- Attendance Rate

```css
.stat-card {
  min-height: 130px;

  padding: 18px;

  background: #ffffff;

  border: 1px solid var(--border);

  border-radius: var(--radius-lg);

  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
```

Label:

```css
.stat-label {
  font-size: 12px;
  font-weight: 500;

  color: #686d7c;
}
```

Value:

```css
.stat-value {
  margin-top: 8px;

  font-size: 28px;
  font-weight: 700;

  letter-spacing: -.03em;

  color: #171821;
}
```

Description:

```css
.stat-description {
  font-size: 11px;

  color: #9da1ae;
}
```

---

# 15. PRIMARY KPI CARD

Hanya satu atau maksimal dua KPI penting yang boleh diberikan highlight besar.

Contoh:

- Total Paid
- Net Revenue

```css
.stat-card.primary {
  color: #ffffff;

  border: none;

  background:
    linear-gradient(
      145deg,
      #5147f8,
      #4355f6
    );

  box-shadow:
    0 12px 28px rgba(79,70,245,.25);
}
```

Jangan membuat semua KPI memiliki background warna.

Kalau semua penting, tidak ada yang benar-benar penting.

---

# 16. ICON BOX

```css
.icon-box {
  width: 38px;
  height: 38px;

  display: grid;
  place-items: center;

  border-radius: 11px;

  background: #f3f4f8;

  color: #333642;
}
```

Primary:

```css
.stat-card.primary .icon-box {
  background: rgba(255,255,255,.92);
  color: var(--primary);
}
```

Icon disarankan menggunakan satu library saja:

- Lucide Icons
atau
- Heroicons

Jangan mencampur banyak icon style.

---

# 17. BADGE SYSTEM

Generic:

```css
.badge {
  display: inline-flex;
  align-items: center;

  padding: 4px 7px;

  border-radius: 999px;

  font-size: 10px;
  font-weight: 600;

  white-space: nowrap;
}
```

Success:

```css
.badge.success {
  background: var(--success-soft);
  color: #28a95b;
}
```

Danger:

```css
.badge.danger {
  background: var(--danger-soft);
  color: var(--danger);
}
```

Warning:

```css
.badge.warning {
  background: var(--warning-soft);
  color: #c78a21;
}
```

---

# 18. STATUS BADGE RULE

Recommended:

Paid:
- green

Pending:
- yellow

Cancelled:
- red

Hadir:
- green

Belum Hadir:
- gray atau orange soft

Seminar:
- purple soft

Webinar:
- blue soft

Jangan membuat badge dengan warna neon atau saturasi terlalu tinggi.

---

# 19. DASHBOARD GRID

Default:

```css
.dashboard-grid {
  display: grid;

  grid-template-columns:
    minmax(0, 2fr)
    minmax(300px, .9fr);

  gap: 18px;
}
```

Untuk KPI:

```css
.stats-grid {
  display: grid;

  grid-template-columns:
    repeat(2, minmax(0, 1fr));

  gap: 16px;
}
```

Tujuan:

Area kiri:
- KPI
- chart
- trend
- data utama

Area kanan:
- breakdown
- statistics
- quick summary
- distribution
- recent activity

---

# 20. TABLE DESIGN

Master Order dan Master Presensi adalah area paling penting.

Wrapper:

```css
.table-card {
  background: #ffffff;

  border-radius: 18px;

  border: 1px solid var(--border);

  overflow: hidden;
}
```

Table:

```css
.data-table {
  width: 100%;

  border-collapse: collapse;

  font-size: 13px;
}
```

Header:

```css
.data-table thead {
  background: #f8f9fc;
}

.data-table th {
  padding: 14px 16px;

  text-align: left;

  font-size: 11px;
  font-weight: 600;

  color: #858a98;

  text-transform: uppercase;

  letter-spacing: .035em;

  border-bottom: 1px solid var(--border);
}
```

Body:

```css
.data-table td {
  padding: 15px 16px;

  color: #343741;

  border-bottom: 1px solid #f0f1f5;
}
```

Hover:

```css
.data-table tbody tr:hover {
  background: #fafbfe;
}
```

---

# 21. TABLE UX RULE

Untuk tabel besar:

- Sticky header
- Horizontal scroll jika perlu
- Pagination
- Jangan load seluruh database sekaligus
- Default 50 rows/page
- Optional 100 rows/page
- Filter server-side
- Search server-side
- Sort server-side jika data besar

Recommended sticky header:

```css
.data-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
}
```

Kolom penting dapat dibuat sticky kiri:

- Order ID
- Nama

---

# 22. FILTER BAR

Filter menjadi salah satu komponen utama aplikasi.

Structure:

```text
Search...

[Produk ▼]
[Batch ▼]
[Kota ▼]
[Pengiklan ▼]
[Status ▼]
[Tanggal ▼]

Active Filters:
Kuliner Masteri ×
Batch 392 ×
Solo ×
Paid ×

Clear All
```

Wrapper:

```css
.filter-bar {
  display: flex;

  gap: 10px;

  flex-wrap: wrap;

  padding: 14px;

  margin-bottom: 16px;

  background: #ffffff;

  border: 1px solid var(--border);

  border-radius: 16px;
}
```

---

# 23. INPUT

```css
.input {
  height: 40px;

  padding: 0 13px;

  background: #f6f7fa;

  border: 1px solid transparent;

  border-radius: 10px;

  font-size: 13px;

  color: var(--text-primary);

  outline: none;
}
```

Focus:

```css
.input:focus {
  background: #ffffff;

  border-color: #b9b5ff;

  box-shadow:
    0 0 0 3px rgba(79,70,245,.08);
}
```

Placeholder:

```css
.input::placeholder {
  color: #adb1bd;
}
```

---

# 24. SELECT / DROPDOWN

```css
.select {
  height: 40px;

  padding: 0 34px 0 12px;

  background: #f6f7fa;

  border: 1px solid transparent;
  border-radius: 10px;

  font-size: 13px;

  color: #555966;
}
```

Mini dropdown:

```css
.select-mini {
  height: 34px;

  padding: 0 10px;

  background: #f7f8fb;

  border: none;
  border-radius: 9px;

  font-size: 11px;

  color: #656977;
}
```

---

# 25. FILTER CHIP

```css
.filter-chip {
  display: inline-flex;
  align-items: center;

  gap: 6px;

  height: 30px;

  padding: 0 10px;

  border-radius: 999px;

  background: var(--primary-soft);

  color: #5049d9;

  font-size: 11px;
  font-weight: 500;
}
```

Active filter harus selalu terlihat.

---

# 26. BUTTON SYSTEM

Primary:

```css
.btn-primary {
  height: 40px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  gap: 8px;

  padding: 0 16px;

  border: none;
  border-radius: 10px;

  background: var(--primary);

  color: white;

  font-size: 13px;
  font-weight: 600;

  cursor: pointer;
}
```

Hover:

```css
.btn-primary:hover {
  background: var(--primary-hover);
}
```

Secondary:

```css
.btn-secondary {
  height: 40px;

  padding: 0 16px;

  border: 1px solid var(--border);
  border-radius: 10px;

  background: #ffffff;

  color: #555966;

  font-size: 13px;
  font-weight: 500;
}
```

Danger button jangan selalu merah penuh.

Gunakan merah penuh hanya untuk action berbahaya seperti delete permanen.

---

# 27. CARD HEADER

```css
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  margin-bottom: 18px;
}

.card-title {
  font-size: 15px;
  font-weight: 650;

  color: #22242d;
}
```

Optional description:

```css
.card-description {
  margin-top: 4px;

  font-size: 11px;

  color: var(--text-muted);
}
```

---

# 28. EMPTY STATE

Empty state jangan menampilkan area kosong besar.

Structure:

```text
[Icon]

Belum ada data

Data akan muncul setelah order masuk.

[Optional Action]
```

Style:

- icon muted
- title 14px / 600
- description 12px
- max width 300px
- center aligned

---

# 29. LOADING STATE

Gunakan skeleton.

Jangan menggunakan spinner besar di seluruh dashboard.

Skeleton:

- KPI skeleton
- table row skeleton
- chart skeleton

Gunakan spinner hanya untuk action kecil seperti:

- Save
- Update
- Generate
- Check-in

---

# 30. ERROR STATE

Error harus jelas.

Contoh:

```text
Gagal memuat data

Tidak dapat mengambil data order.
Silakan coba lagi.

[Coba Lagi]
```

Jangan hanya menampilkan:

```text
Error 500
```

---

# 31. TOAST / NOTIFICATION

Untuk action seperti:

- konfigurasi tersimpan
- kode produk copied
- check-in berhasil
- password berhasil diubah

Gunakan toast.

Posisi:

- top right
atau
- bottom right

Duration:
3–5 detik.

Success:
green icon + neutral white card.

Jangan membuat seluruh toast hijau.

---

# 32. MODAL

Modal digunakan hanya untuk:

- confirmation
- edit sederhana
- delete confirmation
- detail cepat

Jangan gunakan modal untuk form panjang.

Form panjang lebih baik menggunakan:

- page
atau
- side panel / drawer

---

# 33. DRAWER

Recommended untuk:

- detail order
- detail attendance
- quick edit
- inspection data

Drawer:

```text
Desktop width:
420–520px
```

Keuntungan:
user tidak kehilangan context tabel.

---

# 34. DASHBOARD RESUME UX

Recommended hierarchy:

```text
Dashboard Resume

[Date] [Product] [Advertiser] [Event Type] [Batch] [City]

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

Satu card primary dapat digunakan untuk:

- Paid
atau
- Net

Tergantung fokus operasional.

---

# 35. ORDER PAGE UX

Structure:

```text
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

Filter sekunder bisa dimasukkan ke tombol:

```text
More Filters
```

Jika ruang terlalu padat.

---

# 36. PRESENSI PAGE UX

Structure:

```text
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

Timestamp dapat menggunakan horizontal scrolling.

---

# 37. SCAN QR UX

Menu Scan QR berbeda dengan dashboard biasa.

Prioritas:

- cepat
- besar
- mudah dilihat
- minim distraction

Layout:

```text
SCAN PRESENSI

[ Camera Scanner ]

Status scanner

Hasil terakhir:

✅ Ahmad
Order #123456
Check-in berhasil
20:14:03
```

Success menggunakan area hijau soft.

Failed menggunakan merah soft.

Jangan membuat operator harus klik banyak tombol.

---

# 38. PRODUCT NAME GENERATOR UX

Layout recommended:

```text
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

Recommended style:

- background primary-soft
- monospace optional
- font 16–18px
- copy button jelas

---

# 39. KONFIGURASI PAGE UX

Untuk konfigurasi:

- Konfigurasi Produk
- Pengiklan
- Tax

Gunakan pattern:

```text
Page Header                 [+ Tambah]

Search

Table

Edit action
Delete action
Status
```

Jangan membuat seluruh konfigurasi berada dalam satu form panjang.

Gunakan CRUD sederhana.

---

# 40. PROFILE UX

Profil harus sederhana.

Isi:

- Nama
- Username
- Avatar Emoji
- Ganti Password

Avatar berupa emoji dalam circle.

Example:

```text
😎 🚀 🐼 🦊 🐯 👨‍💻 🤖
```

Selected emoji:

- primary-soft background
- primary border
- subtle shadow

---

# 41. RESPONSIVE BEHAVIOR

Walaupun aplikasi fokus desktop, tetap harus usable pada tablet dan HP.

Breakpoint:

```css
@media (max-width: 1100px) {}
@media (max-width: 768px) {}
@media (max-width: 480px) {}
```

Desktop:
- sidebar fixed width
- multi-column

Tablet:
- sidebar compact
- dashboard grid menjadi 1 column jika perlu

Mobile:
- sidebar berubah drawer
- main padding 16px
- KPI 1–2 columns
- table horizontal scroll

---

# 42. MOBILE RULE

Mobile:

```css
@media (max-width: 768px) {

  .app-shell {
    width: 100%;
    min-height: 100vh;

    margin: 0;

    border-radius: 0;
  }

  .main-content {
    padding: 20px 16px;
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns:
      repeat(2, minmax(0,1fr));
  }
}
```

Jika screen sangat kecil:

```css
@media (max-width: 480px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
```

---

# 43. ACCESSIBILITY

Minimum:

- contrast teks cukup
- clickable area minimum 40px
- button tidak hanya dibedakan berdasarkan warna
- form punya label
- error message dekat input
- keyboard navigation tetap bekerja
- visible focus state
- icon-only button wajib memiliki tooltip / aria-label

---

# 44. ANIMATION

Animation harus subtle.

Recommended:

```css
transition:
  background .18s ease,
  color .18s ease,
  border-color .18s ease,
  box-shadow .18s ease,
  transform .18s ease;
```

Hover button:

```css
transform: translateY(-1px);
```

Jangan gunakan:

- bouncing
- glowing
- zoom besar
- animation berlebihan

Aplikasi operasional harus terasa stabil.

---

# 45. SHADOW RULE

App shell:

```css
0 20px 50px rgba(65,72,100,.12)
```

Card:

```css
0 4px 16px rgba(50,55,80,.035)
```

Floating element:

```css
0 8px 24px rgba(50,55,80,.08)
```

Gunakan shadow seminimal mungkin.

---

# 46. VISUAL PRIORITY

Urutan visual:

1. Page Title
2. KPI / Primary Action
3. Main data
4. Filter
5. Secondary information
6. Supporting text

Jangan membuat filter lebih mencolok dibanding data.

---

# 47. UX PRINCIPLE: ONE PRIMARY ACTION

Dalam satu area, hanya boleh ada satu aksi yang benar-benar dominan.

Contoh:

Konfigurasi Produk:

Primary:
+ Tambah Produk

Secondary:
Edit

Danger:
Delete

Product Generator:

Primary:
Generate

Secondary:
Copy

Scan QR:

Primary:
Scanner

Secondary:
Manual Search

---

# 48. UX PRINCIPLE: REDUCE CLICKS

Untuk workflow operasional:

- search langsung
- filter cepat
- status langsung terlihat
- primary action selalu tersedia
- tidak perlu membuka banyak modal
- detail bisa dibuka via drawer

Goal:

User menemukan data atau melakukan action utama dalam 1–3 interaksi.

---

# 49. UX PRINCIPLE: KEEP CONTEXT

Jangan memindahkan user ke halaman lain jika tidak perlu.

Contoh:

Klik row order:

gunakan detail drawer.

Jangan langsung redirect ke halaman baru jika hanya ingin melihat detail.

---

# 50. UX PRINCIPLE: INFORMATION DENSITY

Aplikasi adalah operational tool.

Jadi jangan terlalu banyak whitespace seperti marketing website.

Target:

- clean
- tetapi tetap data efficient

Card boleh lega.

Table harus lebih rapat.

---

# 51. MASTER CSS FOUNDATION

```css
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

  --radius-xs: 8px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;

  --shadow-app:
    0 20px 50px rgba(65,72,100,.12);

  --shadow-card:
    0 4px 16px rgba(50,55,80,.035);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;

  min-height: 100vh;

  background: var(--bg-page);

  color: var(--text-primary);

  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Arial,
    sans-serif;
}

button,
input,
select,
textarea {
  font: inherit;
}
```

---

# 52. DO

Lakukan:

- gunakan satu primary color
- gunakan typography sederhana
- gunakan whitespace dengan konsisten
- gunakan status badge
- gunakan icon style yang sama
- buat table mudah dibaca
- buat filter cepat digunakan
- gunakan drawer untuk detail
- gunakan skeleton loading
- gunakan toast untuk feedback
- selalu tampilkan active filters
- buat empty/error state
- gunakan responsive layout

---

# 53. DON'T

Hindari:

- gradient berlebihan
- shadow gelap
- border hitam
- terlalu banyak warna
- terlalu banyak font size
- radius random
- icon berbeda-beda style
- semua button berwarna primary
- semua KPI berwarna
- terlalu banyak modal
- tabel tanpa pagination
- loading spinner besar
- hover animation berlebihan
- dashboard terlalu penuh

---

# 54. DESIGN KEYWORDS

Jika diberikan kepada AI UI / coding agent, gunakan keyword berikut:

```text
Modern SaaS Dashboard
Soft UI
Clean Admin Panel
Premium Operational Dashboard
Light Gray Background
White Rounded Cards
Indigo Accent
Minimal Border
Soft Shadow
High Data Readability
Compact Table
Clean Typography
Generous Spacing
Lucide Icons
Responsive Admin Interface
```

---

# 55. FINAL DESIGN DIRECTION

Final visual direction:

```text
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

Target akhir:

> Aplikasi harus terasa seperti SaaS admin premium yang clean dan modern, tetapi tetap efisien untuk aktivitas operasional sehari-hari, pencarian order, monitoring pembayaran, presensi acara, konfigurasi produk, tax reporting, dan scanning QR.

---

# 56. PRIORITAS IMPLEMENTASI

Urutan implementasi UI disarankan:

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

Setelah seluruh komponen dasar dibuat, semua halaman wajib menggunakan komponen yang sama agar UI tetap konsisten.
