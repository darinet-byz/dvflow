# KONTRAK API & SPESIFIKASI KEAMANAN (FITUR 2.0)

> Pembaruan 14 Oktober 2026: aturan hasil implementasi dan matriks akses ada di [audit RBAC dan konfigurasi produk](./08-AUDIT-ROLE-PERMISSION-DAN-KONFIGURASI-PRODUK.md). Jika contoh rancangan lama berbeda, acuan terbaru adalah laporan tersebut dan AMENDMENTS A13.

## dvflow: REST API Endpoints, RBAC Middleware, Session Payload, dan Security Hardening

Dokumen Versi: 2.0  
Target: Cloudflare Workers (`packages/api`) & PostgreSQL RPC

---

## 1. Arsitektur Otorisasi & Session Payload

### A. Format Session & User Profile (`/api/auth/login`, `/api/auth/refresh`, `/api/profile`)
Ketika pengguna login, endpoint sesi mengembalikan objek profil yang diperkaya dengan daftar hak akses (*permissions*) dan batasan produk (*product codes*):

```json
{
  "profile": {
    "user_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "username": "budi_pimpro",
    "display_name": "Budi Santoso",
    "role": "pimpro",
    "role_name": "Pimpro",
    "avatar_emoji": "👔",
    "has_all_product_access": false,
    "allowed_product_codes": ["KULI", "BOMM"],
    "permissions": [
      "operasional.dashboard",
      "operasional.order",
      "operasional.presensi",
      "action.export_data",
      "account.profile"
    ]
  }
}
```

### B. Middleware Otorisasi di Backend Worker
Alih-alih memeriksa nama role secara statis (`if (user.role !== 'master_admin')`), backend menggunakan middleware berbasis permission key:

```ts
// Contoh penegakan di handler
export async function handleRoleConfig(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'config.roles')
  // ... proses aman khusus Master Admin
}
```

---

## 2. Kontrak Endpoint Baru: Manajemen Role & Hak Akses

Semua endpoint role di bawah ini diproteksi oleh izin `config.roles` (khusus Developer & Owner; role legacy master_admin dihapus di A36).

### 1. `GET /api/roles`
Mengambil daftar seluruh role beserta ringkasan statusnya.

- **Header**: `Authorization: Bearer <session_token>`
- **Response 200 OK**:
```json
{
  "roles": [
    {
      "id": "developer",
      "name": "Developer",
      "description": "Akses teknis sistem dan konfigurasi penuh",
      "is_system": true,
      "user_count": 1,
      "permission_count": 19,
      "created_at": "2026-10-13T08:00:00Z"
    },
    {
      "id": "pimpro",
      "name": "Pimpro",
      "description": "Pimpinan proyek produk tertentu",
      "is_system": true,
      "user_count": 3,
      "permission_count": 6,
      "created_at": "2026-10-13T08:00:00Z"
    }
  ]
}
```

---

### 2. `POST /api/roles`
Menambah role baru.

- **Request Body**:
```json
{
  "id": "koordinator_lapangan",
  "name": "Koordinator Lapangan",
  "description": "Koordinator gate dan presensi",
  "permissions": [
    "operasional.scan_qr",
    "operasional.presensi",
    "action.manual_checkin",
    "account.profile"
  ]
}
```
- **Validasi**:
  - `id`: huruf kecil, angka, dan garis bawah (`/^[a-z0-9_]{3,32}$/`), wajib unik.
  - `name`: string 2–64 karakter, tidak boleh kosong.
  - `permissions`: array of valid permission keys.
- **Response 201 Created**:
```json
{
  "id": "koordinator_lapangan",
  "name": "Koordinator Lapangan",
  "description": "Koordinator gate dan presensi",
  "is_system": false,
  "permission_count": 4
}
```

---

### 3. `GET /api/roles/:id`
Mengambil detail satu role beserta seluruh checklist permission-nya.

- **Response 200 OK**:
```json
{
  "id": "pimpro",
  "name": "Pimpro",
  "description": "Pimpinan proyek produk tertentu",
  "is_system": true,
  "permissions": [
    "operasional.dashboard",
    "operasional.order",
    "operasional.presensi",
    "action.export_data",
    "account.profile"
  ]
}
```

---

### 4. `PUT /api/roles/:id/permissions`
Memperbarui checklist hak akses dari suatu role.

- **Request Body**:
```json
{
  "permissions": [
    "operasional.dashboard",
    "operasional.order",
    "operasional.presensi",
    "operasional.generator",
    "action.export_data",
    "account.profile"
  ]
}
```
- **Response 200 OK**:
```json
{
  "success": true,
  "id": "pimpro",
  "permission_count": 6
}
```

---

### 5. `DELETE /api/roles/:id`
Menghapus role kustom.

- **Response 200 OK**: `{ "success": true, "deleted_id": "koordinator_lapangan" }`
- **Error Response 400 Bad Request**:
  - `SYSTEM_ROLE_CANNOT_BE_DELETED`: Jika mencoba menghapus role bawaan sistem (`is_system = true`).
  - `ROLE_IN_USE`: Jika masih ada user yang terikat pada role tersebut:  
    `"Role masih digunakan oleh 2 pengguna. Pindahkan pengguna ke role lain sebelum menghapus."`

---

### 6. `GET /api/permissions`
Mengambil kamus seluruh hak akses yang tersedia di sistem untuk dirender sebagai kotak centang di UI frontend.

- **Response 200 OK**:
```json
{
  "modules": [
    {
      "module": "operasional",
      "module_name": "Operasional",
      "permissions": [
        { "key": "operasional.scan_qr", "name": "Scan QR Tiket", "description": "Memindai QR tiket peserta di gate" },
        { "key": "operasional.dashboard", "name": "Dashboard Resume", "description": "Melihat omzet, KPI leads, dan kehadiran" },
        { "key": "operasional.order", "name": "Data Order", "description": "Melihat dan mencari transaksi order" },
        { "key": "operasional.presensi", "name": "Presensi Acara", "description": "Melihat riwayat log kehadiran peserta T1-T10" },
        { "key": "operasional.generator", "name": "Product Name Generator", "description": "Membuat nama produk iklan terstandar" }
      ]
    },
    {
      "module": "config",
      "module_name": "Konfigurasi",
      "permissions": [
        { "key": "config.produk", "name": "Konfigurasi Produk", "description": "Mengelola data produk, sesi, dan pengiklan" },
        { "key": "config.tax", "name": "Konfigurasi Tax & Fee", "description": "Mengelola aturan potongan fee pembayaran" },
        { "key": "config.report_tax", "name": "Report Tax", "description": "Membuka laporan pajak dan potongan" },
        { "key": "config.zoom", "name": "Konfigurasi Link Zoom", "description": "Mengatur tautan redirect Zoom webinar" },
        { "key": "config.tiket", "name": "Konfigurasi Tiket Seminar", "description": "Mengatur jadwal, venue, dan tiket QR" },
        { "key": "config.integrasi", "name": "API & Webhook", "description": "Mengelola webhook dan koneksi OrderOnline" },
        { "key": "config.roles", "name": "Konfigurasi Role & Permission", "description": "Mengatur peran pengguna dan hak akses" }
      ]
    }
  ]
}
```

---

## 3. Penyesuaian Endpoint Manajemen Tim (`/api/users`)

### A. `POST /api/users` (Tambah Anggota Tim)
Diperkaya untuk menerima parameter pembatasan produk:

- **Request Body**:
```json
{
  "username": "budi_pimpro",
  "display_name": "Budi Santoso",
  "initial_password": "PasswordKuat123!",
  "role": "pimpro",
  "has_all_product_access": false,
  "product_codes": ["KM", "MT"]
}
```
- **Aturan Validasi**:
  - Jika `has_all_product_access = false`, array `product_codes` tidak boleh kosong, dan seluruh kode produk harus terdaftar di tabel `products`.

---

### B. `PUT /api/users/:id` (Edit Anggota Tim)
Mendukung pembaruan role dan pembatasan produk:

- **Request Body**:
```json
{
  "display_name": "Budi Santoso, S.Kom",
  "role": "pimpro",
  "has_all_product_access": false,
  "product_codes": ["KM"]
}
```

---

## 4. Keamanan di Level Lapangan: Validasi Produk saat Scan QR

Ketika operator (Pimpro / Member) memindai QR code tiket melalui `POST /checkin/:orderId`:
1. Server mengekstrak Order ID dan membaca `product_code` dari order tersebut di database.
2. Server memeriksa apakah operator yang sedang login memiliki otoritas atas produk tersebut:
   - Jika operator memiliki `has_all_product_access = true`: Check-in dilanjutkan.
   - Jika operator dibatasi produk, sistem memeriksa apakah `order.product_code` ada di daftar `user_product_access` milik operator:
     - Jika **ADA**: Check-in berhasil.
     - Jika **TIDAK ADA**: Server menolak dengan error `403 FORBIDDEN_PRODUCT_ACCESS`:  
       *"Akses ditolak: Anda tidak memiliki wewenang untuk memeriksa tiket produk ini (Produk: Kuliner Masteri)."*
3. Langkah ini menjamin bahwa panitia acara produk A tidak bisa secara sengaja/tidak sengaja men-checkin tiket peserta dari produk B.

