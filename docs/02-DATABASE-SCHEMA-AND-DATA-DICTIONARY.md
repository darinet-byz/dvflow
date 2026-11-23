# DATABASE SCHEMA & DATA DICTIONARY
## dvflow

Versi: 1.0
Database: Supabase PostgreSQL

## 1. Prinsip
- `orders` adalah Master Order.
- `attendance_events` menyimpan raw attendance row-based.
- config tidak di-hardcode.
- tax historical disimpan sebagai snapshot pada Order.
- soft deactivate untuk configuration.
- direct browser query hanya melalui RLS + valid access JWT.

## 2. users
Purpose: login custom dan profile.

Fields:
- id UUID PK default gen_random_uuid()
- username TEXT NOT NULL
- username_normalized TEXT NOT NULL UNIQUE
- display_name TEXT NOT NULL
- password_hash TEXT NOT NULL
- password_salt TEXT NOT NULL
- password_iterations INTEGER NOT NULL DEFAULT 600000
- role TEXT NOT NULL CHECK role IN ('master_admin','admin','staff')
- avatar_emoji TEXT NULL
- active BOOLEAN NOT NULL DEFAULT TRUE
- advertiser_id UUID NULL FK advertisers(id) ON DELETE RESTRICT  -- A20: wajib tepat bila role = 'advertiser' (CHECK (role = 'advertiser') = (advertiser_id IS NOT NULL))
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

Rule:
- password_hash/salt tidak pernah selectable oleh frontend RLS.

## 3. app_sessions
Purpose: refresh session custom.

Fields:
- id UUID PK default gen_random_uuid()
- user_id UUID NOT NULL FK users(id)
- token_hash TEXT NOT NULL UNIQUE
- expires_at TIMESTAMPTZ NOT NULL
- revoked_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- last_used_at TIMESTAMPTZ NULL

Tidak ada UI menu khusus.

## 4. products
- id UUID PK
- name TEXT NOT NULL
- code TEXT NOT NULL
- code_normalized TEXT NOT NULL UNIQUE
- active BOOLEAN NOT NULL DEFAULT TRUE
- status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','In-Active','On-Hold','Upcoming'))
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

## 5. advertisers
- id UUID PK
- name TEXT NOT NULL
- code TEXT NOT NULL
- code_normalized TEXT NOT NULL UNIQUE
- active BOOLEAN NOT NULL DEFAULT TRUE
- status TEXT NOT NULL DEFAULT 'In-House' CHECK (status IN ('In-House','Freelance','Intern','Resign'))
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

## 5b. product_advertisers (A52/A88, sinkron dengan akses produk)
- product_id UUID FK products
- advertiser_id UUID FK advertisers
- created_at / created_by / updated_by
- PK (product_id, advertiser_id)
- A88: mapping ini **sinkron dua arah** dengan `user_product_access` milik akun Advertiser.
  - Add Team mengganti produk user → mapping pengiklan ikut berubah.
  - Status Produk/Pengiklan mengganti mapping → akses semua akun Advertiser pengiklan itu ikut berubah.
  - Role Advertiser tidak memakai `has_all_product_access`; produk harus eksplisit. Advertiser dengan
    Semua Produk lama dikosongkan saat migrasi 0086.
  - Mapping tetap disimpan untuk pengiklan yang tidak punya akun Advertiser (historis).

## 6. event_types
Purpose: mapping Seminar Offline / Webinar Online.

- id UUID PK
- name TEXT NOT NULL
- code TEXT NOT NULL
- code_normalized TEXT NOT NULL UNIQUE
- kind TEXT NOT NULL CHECK kind IN ('seminar','webinar','hybrid')  -- hybrid: A14 (0030)
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

Seed canonical:
- Seminar Offline / SO / seminar
- Webinar Online / WO / webinar

## 7. sessions_config
Purpose: mapping S1/S2/ST. Nama tabel sengaja tidak `sessions` agar tidak bentrok dengan app_sessions.

- id UUID PK
- name TEXT NOT NULL
- code TEXT NOT NULL
- code_normalized TEXT NOT NULL UNIQUE
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

## 8. payment_fee_rules
- id UUID PK
- name TEXT NOT NULL
- identifier TEXT NOT NULL
- identifier_normalized TEXT NOT NULL
- fee_type TEXT NOT NULL CHECK fee_type IN ('flat','percentage')
- fee_value NUMERIC(18,4) NOT NULL CHECK fee_value >= 0  -- e-payment fee (persen untuk percentage / percentage_flat)
- fee_type: flat | percentage | percentage_flat  -- percentage_flat: A16 (0032)
- fee_flat_value NUMERIC(18,4) NOT NULL DEFAULT 0  -- A16: bagian flat untuk percentage_flat
- platform_fee_applies BOOLEAN NOT NULL DEFAULT FALSE  -- A15 (0031)
- epayment_tax_type TEXT NULL CHECK IN ('flat','percentage')  -- A15; berpasangan dengan nilai
- epayment_tax_value NUMERIC(18,4) NULL CHECK >= 0  -- A15; % dihitung dari e-payment fee
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

Constraint:
- partial unique index pada identifier_normalized WHERE active=true.

Percentage disimpan sebagai angka persen, contoh 0.7 berarti 0,7%, bukan 0.007.
Formula: gross * (fee_value / 100).

## 9. orders
Core fields:
- id UUID PK default gen_random_uuid()
- order_id TEXT NOT NULL UNIQUE
- name TEXT NULL
- phone TEXT NULL
- email TEXT NULL

Product raw + normalized:
- product_raw TEXT NULL
- product_parse_status TEXT NOT NULL DEFAULT 'invalid' CHECK IN ('valid','invalid')
- product_code TEXT NULL
- product_name TEXT NULL
- advertiser_code TEXT NULL
- advertiser_name TEXT NULL
- event_type TEXT NULL CHECK event_type IN ('Seminar Offline','Webinar Online','Hybrid') OR event_type IS NULL  -- Hybrid: A14 (0030)
- batch TEXT NULL
- session TEXT NULL
- city TEXT NULL

Status:
- raw_status TEXT NULL
- app_status TEXT NOT NULL CHECK app_status IN ('Pending','Paid','Cancelled','Refund')  -- A58: Refund hanya ditulis RPC manual, bukan mapping provider

Acara efektif (A58):
- event_batch TEXT NULL, event_session TEXT NULL, event_city TEXT NULL  -- override tujuan reschedule
- effective_batch/session/city = generated column `coalesce(event_*, kolom asal)`  -- dibaca Presensi, tiket/QR/Zoom, scanner, dan kartu Data per Sesi di Dashboard (A59)
- batch/session/city tetap nilai ASAL untuk omzet, Report Spend, Performa, dan laporan iklan
- order_reschedules: riwayat append-only (from/to batch-sesi-kota, reason, actor_id, actor_name, created_at)
- order_refunds: satu refund aktif per order (amount, reason, previous_status, refunded_at/by, reverted_at/by, revert_reason)

Payment:
- payment_method TEXT NULL
- payment_provider TEXT NULL
- payment_identifier TEXT NULL
- payment_identifier_normalized TEXT NULL

Source (A29):
- source TEXT NOT NULL DEFAULT 'orderonline' CHECK source IN ('orderonline','ots')  -- 'ots' = peserta bayar di lokasi, Order ID OTS-000001 (sequence ots_order_seq)
- ots_collected_by UUID NULL FK users(id) ON DELETE SET NULL  -- petugas yang mencatat OTS
- attendance_events.source menerima 'seminar_ots'; orderonline_connections.slug tidak boleh 'OTS'

Ticket:
- quantity INTEGER NOT NULL DEFAULT 1 CHECK quantity BETWEEN 1 AND 10000  -- A19: CO Form customer_data.quantity; webhook tanpa quantity mempertahankan nilai

Money:
- gross_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK gross_amount >= 0
- tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK tax_amount >= 0
- net_amount NUMERIC(18,2) NOT NULL DEFAULT 0
- tax_mapping_status TEXT NOT NULL DEFAULT 'unmapped' CHECK IN ('mapped','unmapped')

Tax snapshot:
- fee_rule_id UUID NULL
- fee_rule_name_snapshot TEXT NULL
- fee_type_snapshot TEXT NULL CHECK fee_type_snapshot IN ('flat','percentage') OR fee_type_snapshot IS NULL
- fee_value_snapshot NUMERIC(18,4) NULL
- fee_flat_value_snapshot NUMERIC(18,4) NULL  -- A16 (0032)
- epayment_tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0  -- A15 (0031)
- epayment_tax_type_snapshot TEXT NULL; epayment_tax_value_snapshot NUMERIC(18,4) NULL  -- A15
- platform_fee_amount NUMERIC(18,2) NOT NULL DEFAULT 0  -- A15: hanya order Paid
- platform_fee_percent_snapshot NUMERIC(9,4) NULL  -- A15
- net_amount = gross_amount - tax_amount - epayment_tax_amount - platform_fee_amount  -- A15

Timestamps:
- source_created_at TIMESTAMPTZ NULL
- source_updated_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- paid_at TIMESTAMPTZ NULL
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

Rules:
- first insert created_at = local receive timestamp jika source_created_at tidak tersedia;
- paid_at diisi saat order pertama kali menjadi Paid; jangan dihapus bila repeated Paid webhook;
- if explicit source timestamp tersedia, simpan juga, jangan menimpa app receive timestamps secara ambigu.

## 10. attendance_events
- id UUID PK default gen_random_uuid()
- order_id TEXT NOT NULL
- attendance_type TEXT NOT NULL CHECK IN ('webinar','seminar')
- source TEXT NOT NULL CHECK IN ('webinar_redirect','seminar_qr','seminar_manual','seminar_ots')
- scanner_user_id UUID NULL FK users(id)
- clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
- ticket_no INTEGER NOT NULL DEFAULT 1 CHECK (1..10000) — A61

FK recommendation:
- order_id references orders(order_id) ON DELETE RESTRICT.

Seminar uniqueness (A61):
- partial unique index `UNIQUE(order_id, ticket_no) WHERE attendance_type='seminar'`.
- satu baris = satu tiket hadir; rombongan boleh datang bertahap.

Webinar:
- tidak unique; setiap redirect valid membuat row dengan `ticket_no = 1`.
- satu klik link membuat presensi order; KPI menghitung seluruh tiket order hadir.

Retention:
- delete attendance_events WHERE clicked_at < now() - interval '30 days'.

## 11. app_settings
Generic internal setting yang memang sudah disebut blueprint.

Fields:
- key TEXT PK
- value_text TEXT NULL
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_by UUID NULL FK users(id)

Key MVP yang diizinkan:
- `webinar_destination::<product_raw>`
- `seminar_ticket::<scope>` (A12)
- `fee_setting::platform_fee_percent` — PLATFORM FEE global dalam persen (A15, 0031)

Jangan menambah key lain tanpa requirement.

## 12. webhook_logs (optional but recommended for troubleshooting)
- id UUID PK
- provider TEXT NOT NULL DEFAULT 'orderonline'
- request_id TEXT NULL
- order_id TEXT NULL
- outcome TEXT NOT NULL
- error_code TEXT NULL
- payload_sanitized JSONB NULL
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()

Retention 7 hari.
Jangan simpan credential/secret header.

## 12a. ad_spend_cards + entries + reports + resumes (A37/A87/A88, 0048/0085/0087/0088)
Sejak A88 ada tiga level:

```text
ad_spend_cards (template)
  └── ad_spend_report_entries (laporan harian)
        └── ad_spend_reports (baris budget + PPN)
```

**`ad_spend_cards`**
- id UUID PK; advertiser_id/product_id FK RESTRICT; batch TEXT NOT NULL (A33); event_type TEXT NULL (A63)
- name TEXT NOT NULL (1–120); status TEXT (`berjalan`/`selesai`); finished_at TIMESTAMPTZ
- date_from/date_to DATE NULL: rekap rentang tampilan
- UNIQUE (advertiser_id, product_id, batch, event_type) `NULLS NOT DISTINCT` (satu card per scope, termasuk draft)
- RLS: baca `operasional.report_spend` + scope produk (A44); tulis hanya lewat Worker (service_role)
- Izin `action.manage_spend` (manajer/owner/developer)

**`ad_spend_report_entries`**
- id UUID PK; card_id FK CASCADE; date_from/date_to; created_by/updated_by/timestamps
- CONSTRAINT EXCLUDE (card_id =, daterange(date_from,date_to,'[]') &&): laporan harian tidak boleh bertumpuk
  dalam satu card. Beberapa akun dengan tanggal sama digabung dalam satu entry.
- Trigger `ad_spend_reports_set_entry` mengisi `entry_id` untuk jalur lama/tes.

**`ad_spend_reports` (baris budget, dipertahankan)**
- id UUID PK; card_id FK CASCADE; entry_id FK CASCADE; advertiser_id/product_id/batch/event_type/date_from/date_to/
  spend/tax_percent
- PPN = round(spend × tax_percent / 100, 2) per baris; entry/card = jumlah baris.
- Trigger `ad_spend_reports_set_card` mengisi card; card baru dari jalur lama berstatus Berjalan.
- Trigger `ad_spend_reports_block_finished` menolak perubahan baris pada card Selesai (harus Aktifkan dulu).

**`ad_spend_resumes` (snapshot)**
- id UUID PK; card_id UUID NULL FK ON DELETE SET NULL; advertiser_id NULL; advertiser_code/name, product_code/name,
  batch, event_type, name, date_from/date_to, spend, tax_amount, total_spend, leads, paid, tickets, omzet,
  finished_at, frozen_at, timestamps.
- Dibuat/dihitung ulang oleh `refresh_ad_spend_resume` saat card Selesai.
- `purge_ad_spend_drafts()` (cron harian 02.00 WIB) menghapus card + entry + baris budget yang `finished_at` lebih
  dari **3 bulan**, membekukan resume (`frozen_at`, `card_id = null`). Resume tetap ada setelah card hilang.
- Aktifkan (`activate_ad_spend_card`) hanya untuk resume draft: menghapus resume sementara, card kembali Berjalan,
  lalu laporan harian bisa diedit/ditambah. Selesai lagi membuat resume baru dengan timer baru.

**Migrasi 0087/0088.** Baris budget lama dikelompokkan menjadi entry per card menurut rentang yang bertumpuk/bersambung;
card Selesai lama dibuatkan resume snapshot. Transisi satu kali membuat card untuk 2 batch terakhir per produk + jenis
acara hanya untuk advertiser yang memegang produk (setelah sync A88) **dan** punya report/lead di batch itu.

**A46 — `comparison`.** `ad_spend_report` mengembalikan `cards[]` (template aktif), `entries[]` (Laporan Berjalan),
`resumes[]` (Laporan Selesai), `summary` (semua data), `sessions`, dan `comparison` (laporan harian aktif). Angka order
memakai `distinct order_id`; entry tidak bertumpuk sehingga order dihitung sekali per card.

**A92 — arsip Laporan Selesai.** `resumes[]` tidak difilter `p_date_from`/`p_date_to` (arsip); filter produk,
pengiklan, batch, dan jenis acara tetap berlaku. Resume membawa `finished_at` (kapan card ditandai Selesai) dan
`retention_until`; kolom Periode tetap `date_from..date_to`. `summary`/KPI tetap mengikuti filter tanggal.

### 12b. RPC dashboard_session_summary (A59, 0064)
Data per Sesi di Dashboard (dipindahkan dari Resume Batch): tiket Paid (`sum(quantity)`, order `app_status = Paid`,
`product_parse_status = valid`) per (sesi, kota, jenis acara) untuk satu produk + batch (`normalize_batch`), dengan
rincian per pengiklan (+ OTS). Tidak ada tabel baru.

```text
dashboard_session_summary(
  p_product_code, p_batch, p_event_type,
  p_search, p_date_from, p_date_to,
  p_advertiser_code, p_session, p_city
)
```

Produk + batch wajib. Seluruh parameter lain mengikuti filter Dashboard yang sama (tanggal WIB, pencarian,
pengiklan, jenis acara, sesi, kota). Batch/sesi/kota memakai acara efektif reschedule (A58); refund tidak dihitung.
Izin `operasional.dashboard`; scope produk + pengiklan lewat `actor_can_order`. Wrapper lama
`batch_session_summary(text,text,text)` dipertahankan untuk tab yang masih terbuka dan memakai izin yang sama.
Izin `operasional.resume_batch` dihapus.

### 12c. RPC advertiser_performance (A46, 0056)
Track record iklan per pengiklan. Tidak ada tabel baru.

```text
advertiser_performance(
  p_advertiser_code text, p_product_code text, p_batch text,
  p_date_from date, p_date_to date, p_granularity text  -- day | month | year
)
```

- Tanpa `p_advertiser_code` (mode dashboard): `advertisers[]`, satu baris per pengiklan yang punya order/report
  pada periode. Tiap baris: `spend`, `tax_amount`, `total_spend`, `leads`, `paid`, `tickets`, `omzet`, `profit`,
  `closing_rate` (tiket/leads), `roas` (omzet/(spend+PPN)), `coverage` (tiket tercakup report / total tiket),
  dan `top_products[]` (maks. 2, urut tiket Paid).
- Dengan `p_advertiser_code` (mode detail): `summary`, `rows[]` per bucket (`period_start`, `period_end`,
  `is_partial`, metrik, `prev`, `yoy`), `products[]`, `batches[]`, `top_products[]`.
- **Spend diprorata harian.** Report 28 Agu–3 Sep dibagi 7 hari; porsi 1–3 Sep masuk September. Ini berbeda dari
  `ad_spend_report` yang menampilkan nilai report penuh bila beririsan dengan filter.
- Tiket/omzet hanya order `Paid`; leads semua status. Order OTS (tanpa pengiklan) tidak masuk.
- Granularitas `day|month|year`; bucket pertama/terakhir yang tidak penuh diberi `is_partial = true` dan
  `prev`/`yoy` null.
- Izin `operasional.analytics`; scope produk lewat `actor_can_product` (A44).
- **Tidak ada index baru di 0056** karena `orders` adalah tabel produksi aktif. Bila perlu, index khusus dibuat
  terpisah dengan `CREATE INDEX CONCURRENTLY`.

## 13. Minimum indexes
orders:
- unique(order_id)
- index(product_code)
- index(advertiser_code)
- index(event_type)
- index(batch)
- index(session)
- index(city)
- index(app_status)
- index(created_at DESC)
- index(paid_at DESC)
- index(payment_identifier_normalized)

attendance_events:
- index(order_id)
- index(clicked_at DESC)
- partial unique seminar index.

Config:
- unique normalized code fields.

## 14. RLS matrix summary
Browser-facing SELECT:
- authenticated app users may SELECT orders, attendance_events, active config needed for UI, tax report sources, and own user profile fields.

Browser-facing WRITE:
- config writes allowed only master_admin/admin by RLS OR through protected Worker endpoint; choose one consistent implementation.
- attendance INSERT from browser forbidden; check-in must go through Worker.
- orders INSERT/UPDATE from browser forbidden; only Worker/service backend.
- users credential fields forbidden from browser.

Recommended implementation:
- read direct Browser -> Supabase;
- sensitive write through Worker;
- config CRUD may also go through Worker to simplify RBAC and validation.

## 15. SQL migration ordering
1. extensions if needed
2. users
3. app_sessions
4. products
5. advertisers
6. event_types
7. sessions_config
8. payment_fee_rules
9. orders
9a. order_reschedules (A58)
9b. order_refunds (A58)
10. attendance_events
11. app_settings
12. webhook_logs optional
13. indexes
14. RLS policies
15. seed canonical event/session config
16. cron retention jobs

## 16. Prohibited schema shortcuts
- no Timestamp1...Timestamp10 columns;
- no separate leads table;
- no separate paid table;
- no separate report source table;
- no duplicated Order per webhook;
- no plaintext password;
- no `role` free-text values outside allowed enum/check;
- no hard-delete config from UI.


## A64 - Sumber pendaftaran

Gunakan orders.source yang sudah ada: orderonline/ots. Tidak ada backfill atau tabel OTS baru. Filter p_source diterapkan sebelum agregasi/pagination. Paid transaction = count Order ID Paid; tiket terjual = sum quantity Paid; hadir dan rasio mengikuti aturan presensi/retensi pada sumber yang sama. Semua = penjumlahan metrik aditif Online + OTS; rasio dihitung ulang. Fungsi internal service-role ots_registrations_page dan ots_duplicate_candidates memvalidasi izin aktor dan cakupan produk; tidak tersedia bagi anon/authenticated. Helper ots_phone_key hanya untuk normalisasi pencarian, bukan unique constraint.

## A79 - Chat internal dan kalender event

Fitur Advertiser Notes lama dihapus total: tabel `advertiser_notes`, RPC `advertiser_notes_page`/`save_advertiser_note`/`archive_advertiser_note`, dan izin `operasional.advertiser_notes`/`action.manage_advertiser_notes`.

### chat_threads
Satu baris = satu percakapan **1:1**. Pasangan user disimpan terurut supaya satu pasangan hanya punya satu thread.

- id UUID PK
- user_a / user_b UUID NOT NULL FK users(id) ON DELETE CASCADE
- created_at / last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE (user_a, user_b); CHECK (user_a < user_b)

### chat_messages
- id UUID PK
- thread_id UUID NOT NULL FK chat_threads(id) ON DELETE CASCADE
- sender_id UUID NOT NULL FK users(id) ON DELETE CASCADE
- body TEXT NOT NULL CHECK (tidak kosong, maks 2000)
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- read_at TIMESTAMPTZ NULL

RLS aktif; kedua tabel hanya dapat dibaca/ditulis `service_role`. RPC: `chat_recipients(p_actor)`, `chat_threads_page(p_actor)`, `chat_messages_page(p_actor, p_thread_id)` (menandai `read_at`), dan `send_chat_message(p_actor, p_role_id, p_recipient_id, p_all, p_body)`. Kirim ke "Semua [Role]" di-fan-out menjadi satu baris `chat_messages` per penerima di thread 1:1 masing-masing.

### event_calendar
- id UUID PK
- product_code TEXT NOT NULL FK products(code) ON UPDATE CASCADE ON DELETE RESTRICT
- category TEXT NOT NULL CHECK in ('Seminar','Webinar','Workshop')
- event_date DATE NOT NULL
- start_time TIME NOT NULL (WIB, tanpa zona waktu)
- location TEXT NOT NULL CHECK (tidak kosong, maks 200)
- created_by / updated_by UUID NULL FK users(id) ON DELETE SET NULL
- created_at / updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

RLS aktif; baca dan tulis lewat Worker. Izin `operasional.event_calendar` (lihat) dan `action.manage_event_calendar` (kelola).

### ad_calendar (A80)
Satu baris = satu deadline tayang untuk satu **batch** per pengiklan. Deadline berlaku untuk seluruh jadwal di batch itu; event hanya konteks/prefill.

- id UUID PK
- event_id UUID NULL FK event_calendar(id) ON DELETE SET NULL
- advertiser_id UUID NOT NULL FK advertisers(id) ON DELETE RESTRICT
- product_code TEXT NOT NULL FK products(code) ON UPDATE CASCADE ON DELETE RESTRICT
- batch TEXT NOT NULL CHECK (sudah `normalize_batch`, tidak kosong, maks 32)
- deadline_date DATE NOT NULL
- created_by / updated_by UUID NULL FK users(id) ON DELETE SET NULL
- created_at / updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE (advertiser_id, product_code, batch)

RLS aktif; tabel hanya untuk `service_role`. Tanggal tayang **tidak disimpan**: `ad_calendar_publish_date(advertiser_id, product_id, batch)` mengambil order/lead pertama (selain OTS); bila tidak ada lead sama sekali, memakai `date_from` report spend pertama.

`ad_calendar_page(p_actor, p_from, p_to)` (RPC service-only; `p_actor` dikirim backend) mengembalikan baris deadline + `publish_date`, `publish_source` (`order`/`report`), `days_late`, `score`, `status` (`on_time`/`late`/`unpublished`/`upcoming`), plus opsi produk/pengiklan/event.

`ad_calendar_scores(...)` menghitung skor per batch: tepat waktu 10; telat 1–3 hari 8; 4–7 hari 6; 8–14 hari 4; 15–30 hari 2; >30 hari atau deadline lewat tanpa data 0. Batch belum jatuh tempo dan belum tayang berstatus `upcoming` dan tidak masuk penyebut. `advertiser_performance` menambahkan `prev_tickets` (bulan kalender penuh sebelumnya) serta `discipline_rate`, `discipline_score`, `discipline_batches`, `discipline_on_time`, `discipline_late`, `discipline_unpublished`, `discipline_upcoming`.

Izin: `action.manage_ad_calendar` (default Manajer + Admin).

### RPC recent_batches
`recent_batches(p_product_code text, p_advertiser_code text default null, p_limit integer default 3)` mengembalikan `{batches:[{batch,product_code,product_name,advertiser_code,advertiser_name,last_activity,orders,tickets}]}`. Maksimal 3 batch berbeda dari order Online, urut aktivitas order terakhir, dalam scope `actor_can_product`. Ini hanya saran; filter batch tetap teks bebas.

### RPC ots_finance_report
`ots_finance_report(p_actor uuid, p_filters jsonb)` mengembalikan `summary`, `batches[]`, dan `sessions[]` untuk order `source='ots'`, `app_status='Paid'`, dalam scope aktor. Filter: from/to (WIB), product_code, batch, session, city, method. `checked_in_tickets` dibatasi quantity. Tidak ada tabel baru.
