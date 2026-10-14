# SKEMA DATABASE & STRATEGI MIGRASI (FITUR 2.0)

> Pembaruan 14 Oktober 2026: aturan hasil implementasi dan matriks akses ada di [audit RBAC dan konfigurasi produk](./08-AUDIT-ROLE-PERMISSION-DAN-KONFIGURASI-PRODUK.md). Jika contoh rancangan lama berbeda, acuan terbaru adalah laporan tersebut dan AMENDMENTS A13.

## dvflow: Relasi Dynamic RBAC, Checklist Permission, dan Scoped Product Access

Dokumen Versi: 2.0  
Fokus: Skema PostgreSQL, Data Integrity, Indeks, dan Backward Compatibility

---

## 1. Analisis Skema Database Eksisting (Baseline Versi 1.0)

Pada versi 1.0:
- Tabel `public.users` memiliki batasan kaku:
  ```sql
  constraint users_role_check check (role in ('master_admin', 'admin', 'staff'))
  ```
- Otorisasi di level SQL (`app_role()`) membaca string role dari JWT/sesi.
- Tidak ada pembatasan produk per user — semua user yang berhak melihat data order/presensi dapat melihat seluruh produk di tabel `public.orders`.

Tantangan Migrasi:
1. Kita **TIDAK BOLEH** merusak data user yang sudah aktif (`himel`, `hizul`, `divimultimedia`, dll).
2. Transaksi order dan presensi yang sudah berjalan tidak boleh terganggu.
3. Migrasi harus bersifat idempoten (*safe rollback & zero-downtime*).

---

## 2. Desain Tabel Baru Fitur 2.0

### A. Tabel `public.app_roles` (Daftar Role Dinamis)
Menyimpan daftar role, baik role standar bawaan sistem maupun role baru yang ditambahkan oleh Master Admin.

```sql
create table public.app_roles (
  id text primary key,                   -- slug unik huruf kecil: 'developer', 'owner', 'manajer', 'admin', 'pimpro', 'member', atau kustom 'koordinator'
  name text not null,                  -- label tampilan: 'Developer', 'Owner', 'Manajer', 'Admin', 'Pimpro', 'Member'
  description text,                    -- deskripsi fungsi role
  is_system boolean not null default false, -- true jika role bawaan (tidak boleh dihapus)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### B. Tabel `public.app_permissions` (Kamus Hak Akses Fitur)
Daftar seluruh kapabilitas fitur dalam aplikasi yang dapat dicentang pada konfigurasi role.

```sql
create table public.app_permissions (
  key text primary key,                -- kode unik: 'operasional.scan_qr', 'config.produk', dll
  name text not null,                 -- label manusiawi: 'Akses Scan QR', 'Konfigurasi Produk'
  module text not null,               -- kategori: 'operasional', 'konfigurasi', 'team', 'aksi'
  description text,
  sort_order integer not null default 0
);
```

### C. Tabel `public.app_role_permissions` (Relasi Many-to-Many Role vs Permission)
Menyimpan checklist hak akses yang dimiliki oleh tiap role.

```sql
create table public.app_role_permissions (
  role_id text not null references public.app_roles (id) on delete cascade,
  permission_key text not null references public.app_permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

create index app_role_permissions_role_idx on public.app_role_permissions (role_id);
```

### D. Tabel `public.user_product_access` (Pembatasan Akses Produk per User)
Menentukan produk apa saja yang boleh diakses oleh user tertentu (terutama Pimpro dan Member).

```sql
create table public.user_product_access (
  user_id uuid not null references public.users (id) on delete cascade,
  product_code text not null references public.products (code) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_code)
);

create index user_product_access_user_idx on public.user_product_access (user_id);
```

### E. Penyesuaian pada Tabel `public.users`
Menambahkan penanda cakupan produk dan mereferensikan role ke tabel `app_roles`:

```sql
-- 1. Tambah flag cakupan produk
alter table public.users
  add column if not exists has_all_product_access boolean not null default true;

-- 2. Hapus check constraint role lama yang kaku
alter table public.users
  drop constraint if exists users_role_check;

-- 3. Hubungkan kolom role dengan foreign key ke app_roles
alter table public.users
  add constraint users_role_fkey foreign key (role) references public.app_roles (id) on update cascade on delete restrict;
```

---

## 3. Kamus Master Hak Akses (*Permission Master Seed*)

Tabel `app_permissions` diisi dengan entri terstruktur:

| Modul | Permission Key | Nama Fitur | Keterangan |
|---|---|---|---|
| **Operasional** | `operasional.scan_qr` | Scan QR Tiket | Halaman pemindai QR & validasi hadir |
| **Operasional** | `operasional.dashboard` | Dashboard Resume | Melihat kartu KPI omzet & kehadiran |
| **Operasional** | `operasional.order` | Data Order | Tabel order masuk dari webhook |
| **Operasional** | `operasional.presensi` | Presensi Acara | Tabel daftar kehadiran peserta (T1–T10) |
| **Operasional** | `operasional.generator` | Name Generator | Pembuat format nama produk iklan |
| **Konfigurasi** | `config.produk` | Konfigurasi Produk | CRUD Produk, Pengiklan, Sesi, Kota |
| **Konfigurasi** | `config.tax` | Konfigurasi Tax | CRUD Biaya admin & pajak payment |
| **Konfigurasi** | `config.report_tax` | Report Tax | Laporan rekapitulasi pajak & fee |
| **Konfigurasi** | `config.zoom` | Konfigurasi Zoom | Pengaturan mapping link Zoom webinar |
| **Konfigurasi** | `config.tiket` | Konfigurasi Tiket | Pengaturan lokasi, jadwal & tiket QR |
| **Konfigurasi** | `config.integrasi` | API & Webhook | Manajemen token OrderOnline & webhook |
| **Konfigurasi** | `config.roles` | Konfigurasi Role | **Khusus Master Admin**: CRUD Role & Izin |
| **Account** | `team.manage` | Manajemen Tim | Melihat, menambah, mengedit akun tim |
| **Account** | `account.profile` | Profil & Password | Mengubah nama display & password sendiri |
| **Aksi Khusus** | `action.export_data` | Export CSV/Excel | Mengunduh rekapan data order & presensi |
| **Aksi Khusus** | `action.manual_checkin`| Manual Check-in | Melakukan presensi manual tanpa kamera |
| **Aksi Khusus** | `action.delete_master` | Hapus Data Master | Tombol delete pada tabel konfigurasi |

---

## 4. Matriks Default 6 Role Standar

Saat migrasi dijalankan, sistem otomatis memasang checklist default:

| Permission Key | Developer | Owner | Manajer | Admin | Pimpro | Member |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `operasional.scan_qr` | [x] | [x] | [x] | [x] | [x] | [x] |
| `operasional.dashboard` | [x] | [x] | [x] | [x] | [x] | [ ] |
| `operasional.order` | [x] | [x] | [x] | [x] | [x] | [ ] |
| `operasional.presensi` | [x] | [x] | [x] | [x] | [x] | [x] |
| `operasional.generator` | [x] | [x] | [x] | [x] | [x] | [ ] |
| `config.produk` | [x] | [x] | [x] | [ ] | [ ] | [ ] |
| `config.tax` | [x] | [x] | [ ] | [ ] | [ ] | [ ] |
| `config.report_tax` | [x] | [x] | [ ] | [ ] | [ ] | [ ] |
| `config.zoom` | [x] | [x] | [x] | [x] | [ ] | [ ] |
| `config.tiket` | [x] | [x] | [x] | [x] | [ ] | [ ] |
| `config.integrasi` | [x] | [x] | [ ] | [ ] | [ ] | [ ] |
| `config.roles` | **[x]** | **[x]** | [ ] | [ ] | [ ] | [ ] |
| `team.manage` | [x] | [x] | [ ] | [ ] | [ ] | [ ] |
| `account.profile` | [x] | [x] | [x] | [x] | [x] | [x] |
| `action.export_data` | [x] | [x] | [x] | [x] | [x] | [ ] |
| `action.manual_checkin`| [x] | [x] | [x] | [x] | [x] | [x] |
| `action.delete_master` | [x] | [x] | [ ] | [ ] | [ ] | [ ] |
| *Default Akses Produk* | *All* | *All* | *All* | *All* | **Scoped** | **Scoped** |

> **Catatan Fleksibilitas**: Matriks di atas adalah **nilai awal**. Melalui menu baru **Konfigurasi Role**, Developer atau Owner dapat mencentang atau menghilangkan izin kapan saja sesuai kebutuhan tim.

---

## 5. Logika SQL Scoping Produk (Enforcement di Level Database)

Untuk memastikan Pimpro dan Member tidak bisa melihat data di luar produknya, fungsi pembacaan data (`orders` query, `presensi_page`, `dashboard_summary`) disesuaikan dengan logika SQL berikut:

```sql
-- Helper Function: Mengecek apakah user dibatasi produk tertentu
create or replace function public.app_user_is_scoped(p_user_id uuid)
returns boolean
language sql stable
as $$
  select not coalesce((select has_all_product_access from public.users where id = p_user_id), true);
$$;

-- Helper Function: Mengambil daftar kode produk yang diizinkan untuk user
create or replace function public.app_user_product_codes(p_user_id uuid)
returns setof text
language sql stable
as $$
  select product_code from public.user_product_access where user_id = p_user_id;
$$;
```

Di dalam query SQL order dan presensi, ditambahkan klausul penyaring otomatis:
```sql
where (
  -- Jika user memiliki akses semua produk: loloskan semua
  not public.app_user_is_scoped(v_actor_user_id)
  -- Jika dibatasi produk: hanya ambil order yang product_code-nya ada di daftar izin
  or o.product_code in (select public.app_user_product_codes(v_actor_user_id))
)
```

Dengan arsitektur ini:
- Keamanan data bersifat **absolut** di tingkat database.
- Performa tetap sangat cepat karena query memanfaatkan indeks `orders_product_code_idx` dan `user_product_access_user_idx`.

