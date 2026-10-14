# Dokumen Rencana Teknis: Multi-Webhook (10+ Toko) & Sistem Alias Produk Transisi + Menu Order Unmapped

Dokumen ini memuat spesifikasi arsitektur dan cetak biru teknis lengkap untuk penanganan multi-webhook toko OrderOnline, sistem alias produk di masa transisi, serta menu batch remapping "Order Unmapped".

---

## 1. Spesifikasi Webhook Multi-Toko & Anti-Tabrakan Order ID

### A. Form Input Koneksi Webhook (`apps/web/src/pages/config/IntegrationsPage.tsx`)
Hanya memuat 3 kolom input ringkas:
1. **Nama Toko**: Nama label toko/acara (misal: `"Seminar Kuliner Solo"`).
2. **Kode Toko**: Kode pengenal maksimal **4 karakter alfanumerik kapital** (misal: `SOLO`, `BDG`, `TK1`).
   - Validasi: `^[A-Z0-9]{1,4}$`.
3. **Personal Access Token**: Token API dari OrderOnline.

### B. Output Tunggal Hasil Simpan Webhook
Hanya menampilkan 1 format Webhook dan 1 format Redirect Peserta yang seirama:
1. **URL Webhook**:
   `https://api.dvflow.id/api/webhooks/orderonline/{connectionId}/{webhookSecret}`
2. **URL Redirect Peserta (Halaman Terima Kasih OrderOnline)**:
   `https://app.dvflow.id/access/{kodeToko}/{order_id}`

### C. Rute Backend & Resolusi Peserta
- **Rute Seirama**: `GET /access/:kodeToko/:orderId`
- Di database, `orders.order_id` disimpan unik sebagai `${kodeToko}-${rawOrderId}` (misal: `SOLO-2819381`).
- `orders.raw_order_id` menyimpan nomor asli OrderOnline `"2819381"`.
- Jika 10 toko memiliki nomor order kembar `#2819381`, semuanya tersimpan aman tanpa saling tolak atau timpa (*100% collision-free*).
- Scanner QR gate seminar membaca string `SOLO-2819381` $\rightarrow$ check-in via `POST /checkin/SOLO-2819381` instan dan akurat.

---

## 2. Sistem Alias Produk (Masa Transisi)

### A. Konsep Pemetaan
```
[ Nama Alias di OrderOnline ]  ==>  [ Nama Konfigurasi Resmi DVFLOW ]
Contoh:
"Workshop Kuliner Solo VIP"    ==>  "KM01SO392 - S1 - Solo"
"Seminar Bisnis Bandung Promo" ==>  "BM01SO001 - ST - Bandung"
```

### B. Alur Ingestion Webhook Otomatis (Pre-Parser Hook)
1. Webhook menerima payload dari OrderOnline toko manapun.
2. Sistem mencocokkan `productRaw` ke tabel `product_aliases`.
3. Jika **cocok**:
   - Elemen event di-parse dari target resmi (`KM01SO392 - S1 - Solo`).
   - Order langsung berstatus **VALID**, QR tiket langsung aktif, dan omzet langsung terhitung.
   - Nama asli `"Workshop Kuliner Solo VIP"` tetap tersimpan di `product_raw` untuk jejak audit.
4. Jika **belum terdaftar**:
   - Order tetap tersimpan aman di database dengan `product_parse_status = 'invalid'`.
   - Order otomatis masuk ke menu **Order Unmapped**.

---

## 3. Menu Baru: "Order Unmapped" (Batch Remapping)

- **Letak Menu**: Kelompok **OPERASIONAL** $\rightarrow$ rute `/order-unmapped`.
- **Fitur Utama**:
  1. Kotak pencarian teks nama produk mentah / alias.
  2. Tabel daftar order invalid dengan checkbox per baris dan **Checklist All**.
  3. Tombol aksi massal: `[ 🔗 Petakan Terpilih (N) ]`.
  4. Modal Batch Remap:
     - Dropdown penyusun konfigurasi resmi DVFLOW (Produk, Pengiklan, Tipe Event, Sesi, Batch, Kota) atau template alias.
     - Checkbox: `☑ Simpan sebagai Alias baru secara permanen` (tercentang default).
  5. Eksekusi instan: Semua order terpilih langsung valid dan alias baru tersimpan permanen.

---

## 4. Skema Database & Migrasi (`supabase/migrations/0025_product_aliases_and_multi_connection.sql`)

1. **`orderonline_connections`**:
   - Tambah kolom `slug varchar(4) unique not null check (slug ~ '^[A-Z0-9]{1,4}$')`.
2. **`orders`**:
   - Tambah kolom `raw_order_id text` dan `connection_id uuid references orderonline_connections(id)`.
   - Tambah index: `idx_orders_raw_order_id` dan `idx_orders_connection_id`.
3. **`orderonline_order_sources`**:
   - Primary key diganti menjadi `(order_id, connection_id)`.
4. **`product_aliases`**:
   - Tabel baru penampung kamus alias produk.
5. **RPC `batch_remap_orders`**:
   - Atomic update untuk daftar order yang dipetakan massal.
6. **Seed RBAC Permissions**:
   - `operasional.order_unmapped` dan `config.alias_produk` untuk Developer, Owner, Master Admin, Manajer, Admin.

---

## 5. Rencana Eksekusi Berkas

1. **Migrasi Database**: `supabase/migrations/0025_product_aliases_and_multi_connection.sql`
2. **Shared Types**: `packages/shared/src/types.ts`
3. **Backend API**:
   - `packages/api/src/integrations/handlers.ts`
   - `packages/api/src/participant/handlers.ts`
   - `packages/api/src/webhooks/handlers.ts`
   - `packages/api/src/aliases/handlers.ts` [NEW]
   - `packages/api/src/routes.ts`
4. **Frontend Web App**:
   - `apps/web/src/pages/config/IntegrationsPage.tsx`
   - `apps/web/src/pages/order/OrderUnmappedPage.tsx` [NEW]
   - `apps/web/src/pages/config/KonfigurasiProdukPage.tsx`
   - `apps/web/src/layout/navigation.ts`, `apps/web/src/lib/roles.ts`, `apps/web/src/App.tsx`
5. **Pengujian & Verifikasi**:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`

