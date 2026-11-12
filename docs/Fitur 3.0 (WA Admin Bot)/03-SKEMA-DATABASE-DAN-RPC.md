# 03 — Skema Database & RPC

Migrasi awal: `supabase/migrations/20261111120000_wa_admin_bot.sql`
(`schema_version = 70`).

Perubahan level produk: `supabase/migrations/20261112090000_wa_bot_product_level.sql`
(`schema_version = 71`).

## 1. Tabel

### `wa_bot_settings` (satu baris)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | smallint PK | Selalu `1` (CHECK). |
| `fonnte_token_encrypted` | text | AES-256-GCM, kunci `INTEGRATION_ENCRYPTION_KEY`. |
| `updated_by` | uuid → users | Pelaku perubahan terakhir. |
| `updated_at` | timestamptz | Waktu perubahan. |

### `advertisers.wa_phone`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `wa_phone` | text null | CHECK `^62[0-9]{8,13}$`; wajib di level aplikasi untuk pengiklan aktif. |

Nomor lama dari `wa_reminder_groups.pic_phone` di-backfill saat migrasi.

### `wa_product_groups`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid PK | |
| `product_id` | uuid UNIQUE → products | Satu produk satu grup; hapus produk menghapus mapping. |
| `fonnte_group_id` | text | `12xxx@g.us`, maks. 100 karakter. |
| `is_active` | boolean | Grup nonaktif tidak pernah diklaim. |
| `created_at` / `updated_at` | timestamptz | Trigger `set_updated_at`. |

### `wa_reminder_groups` (legacy)
Tabel lama per pengiklan. Tidak dibaca kode baru dan tidak dihapus agar data
konfigurasi lama tetap ada; sudah diberi komentar database sebagai legacy.
Nomor `pic_phone` di-backfill ke `advertisers.wa_phone` saat migrasi.

### `wa_reminder_templates`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | Unik tanpa membedakan besar/kecil (`lower(name)`). Maks. 50. |
| `message_content` | text | Maks. 4.000 karakter. |
| `is_active` | boolean | Template nonaktif membuat jadwalnya tidak berjalan. |

Placeholder yang ditawarkan: `{{mention}}`, `{{advertiser_name}}`,
`{{advertiser_code}}`, `{{product_name}}`, `{{product_code}}`, `{{event_type}}`,
`{{date}}`, `{{report_url}}`.
`{{mention}}` dirender sebagai `@Nama Pengiklan` (bukan `@nomor`): Fonnte tidak
memiliki parameter tag WhatsApp, sehingga nomor hanya akan tampil sebagai teks.
Warisan yang tetap dirender: `{{store_name}}`, `{{leads}}`, `{{paid}}`.
Divalidasi backend + `packages/shared`.

### `wa_reminder_schedules`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `execution_time` | time | Jam WIB. |
| `template_id` | uuid → templates | `ON DELETE RESTRICT`. |
| `days` | smallint[] | 0 = Minggu; default semua hari; tidak boleh kosong. |
| `only_if_missing_report` | boolean | Default true. |
| `is_active` | boolean | |

### `wa_reminder_logs`
| Kolom | Keterangan |
|---|---|
| `schedule_id` | Null untuk kirim tes; `ON DELETE SET NULL`. |
| `advertiser_id`, `advertiser_name` | Snapshot agar riwayat tetap terbaca. |
| `product_code`, `product_name` | Produk yang diingatkan. |
| `event_type` | `Seminar Offline` / `Webinar Online` / `Hybrid`. |
| `reminder_date` | Tanggal WIB saat pengingat dijalankan. |
| `group_id` | Target Fonnte saat itu. |
| `template_id` | `ON DELETE SET NULL`. |
| `message` | Isi final yang dikirim. |
| `status` | `queued` / `sent` / `failed`. |
| `attempts` | 1–10 (retry otomatis dibatasi 3 di klaim). |
| `fonnte_message_id`, `error` | Diagnosa. |
| `claimed_at`, `sent_at`, `created_at` | Jejak waktu. |

Index:
- `wa_reminder_logs_once_idx` — unique parsial
  `(schedule_id, advertiser_id, product_code, event_type, reminder_date)`.
- `wa_reminder_logs_created_idx`, `wa_reminder_logs_advertiser_idx`.
- `orders_wa_reminder_activity_idx` — expression index untuk pencarian order
  kemarin per pengiklan + produk.
- `wa_reminder_schedules_time_idx` (aktif).
- `wa_reminder_templates_name_key` — unique `lower(name)`.

## 2. RPC

Semua RPC `SECURITY DEFINER`, `EXECUTE` hanya untuk `service_role`.

### `wa_reminder_claim(p_now timestamptz, p_base_url text, p_limit integer)`
Mengembalikan array JSON task siap kirim:
`{ log_id, group_id, message, advertiser_id, advertiser_name, product_code, product_name, event_type }`.

Langkah:
1. Purge log lebih tua dari 3 hari (`wa_reminder_purge`).
2. Tandai klaim `queued` lebih dari 10 menit sebagai `failed` (`CLAIM_TIMEOUT`).
3. Pilih jadwal aktif yang template-nya aktif, hari cocok (`days @> dow`), dan
   `now` berada di `[jam, jam+60 menit)` WIB.
4. Ambil produk dengan grup aktif, lalu pengiklan yang ditugaskan ke produk itu
   (`product_advertisers`) dan punya `wa_phone`.
5. Hitung order kemarin per pengiklan + produk + **jenis acara**:
   `source = 'orderonline'`, batas hari WIB, `leads`/`paid`.
6. Buang grup yang tidak punya order kemarin.
7. Buang yang sudah punya `ad_spend_reports` untuk **jenis acara yang sama**
   (kecuali `only_if_missing_report = false`). Batch diabaikan.
8. Buang yang sudah 3× `failed` pada tanggal itu untuk kunci yang sama.
9. Render template lewat `wa_render_reminder`.
10. Insert `queued` dengan `on conflict do nothing`, batasi `p_limit`.

### `wa_reminder_mark(p_id uuid, p_status text, p_fonnte_message_id text, p_error text)`
Mengubah baris `queued` menjadi `sent`/`failed`. Baris yang sudah bukan `queued`
tidak berubah (`updated: false`) — mencegah penandaan ganda.

### `wa_reminder_preview(p_now, p_advertiser_code, p_product_code, p_template_id, p_event_type, p_base_url)`
Menghasilkan pesan final + angka kemarin untuk **Kirim Tes**. Bila `p_event_type`
kosong, dipakai jenis acara order terbaru kemarin. Mengembalikan
`{found:false, reason}` bila template/pengiklan/produk/grup tidak ada, pengiklan
tidak ditugaskan, nomor kosong, atau tidak ada order untuk jenis acara itu.

### `wa_reminder_purge(p_now timestamptz, p_keep_days integer)`
Menghapus log lebih tua dari `p_keep_days` (default 3). Dipanggil klaim dan
tersedia untuk operator.

### `wa_render_reminder(...)`
Fungsi murni pengganti placeholder, dipakai klaim & preview agar isi pesan
tidak pernah berbeda antara dua jalur. `{{mention}}` memakai
`p_advertiser_name`; argumen `p_mention` dipertahankan hanya demi signature.

## 3. Izin

| Key | Modul | Default |
|---|---|---|
| `config.wa_bot` | konfigurasi | Manajer, Admin |
| `action.wa_bot_send` | aksi | Manajer, Admin |

Developer/Owner otomatis memiliki seluruh izin lewat `actor_has_permission`.

## 4. RLS & grant

- Semua tabel `wa_*`: `ENABLE ROW LEVEL SECURITY`.
- `REVOKE ALL` dari `public, anon, authenticated`.
- `GRANT ALL` hanya ke `service_role`.
- Tidak ada policy SELECT: browser tidak dapat membaca token, nomor, atau isi
  pesan. Semua akses lewat backend.

## 5. Retensi

Job `pg_cron` `dvflow_wa_reminder_logs_retention` berjalan `43 3 * * *` dan
menghapus log lebih tua dari **3 hari**. `wa_reminder_claim` juga memanggil
`wa_reminder_purge` agar retensi tetap berlaku bila `pg_cron` tidak tersedia.
Saat migrasi, baris lama langsung dibersihkan.

## 6. Dampak ke objek lain

Migrasi ini **tidak mengubah** tabel `orders` atau RPC lama. `ad_spend_reports`
hanya dibaca (SELECT). Snapshot tax dan aturan retensi tidak tersentuh.
