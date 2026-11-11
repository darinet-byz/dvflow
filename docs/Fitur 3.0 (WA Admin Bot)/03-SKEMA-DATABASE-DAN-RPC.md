# 03 — Skema Database & RPC

Migrasi: `supabase/migrations/20261111120000_wa_admin_bot.sql`
(`schema_version = 70`).

## 1. Tabel

### `wa_bot_settings` (satu baris)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | smallint PK | Selalu `1` (CHECK). |
| `fonnte_token_encrypted` | text | AES-256-GCM, kunci `INTEGRATION_ENCRYPTION_KEY`. |
| `updated_by` | uuid → users | Pelaku perubahan terakhir. |
| `updated_at` | timestamptz | Waktu perubahan. |

### `wa_reminder_groups`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid PK | |
| `advertiser_id` | uuid UNIQUE → advertisers | Satu pengiklan satu grup; hapus pengiklan menghapus mapping. |
| `fonnte_group_id` | text | `12xxx@g.us`, maks. 100 karakter. |
| `pic_phone` | text | CHECK `^62[0-9]{8,13}$` (selalu dinormalisasi backend). |
| `pic_name` | text null | Maks. 50 karakter. |
| `is_active` | boolean | Grup nonaktif tidak pernah diklaim. |
| `created_at` / `updated_at` | timestamptz | Trigger `set_updated_at`. |

### `wa_reminder_templates`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | Unik tanpa membedakan besar/kecil (`lower(name)`). Maks. 50. |
| `message_content` | text | Maks. 4.000 karakter. |
| `is_active` | boolean | Template nonaktif membuat jadwalnya tidak berjalan. |

Placeholder yang sah: `{{mention}}`, `{{store_name}}`, `{{product_name}}`,
`{{leads}}`, `{{paid}}`, `{{report_url}}`. Divalidasi backend + `packages/shared`.

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
| `reminder_date` | Tanggal WIB saat pengingat dijalankan. |
| `group_id` | Target Fonnte saat itu. |
| `template_id` | `ON DELETE SET NULL`. |
| `message` | Isi final yang dikirim. |
| `status` | `queued` / `sent` / `failed`. |
| `attempts` | 1–10 (retry otomatis dibatasi 3 di klaim). |
| `fonnte_message_id`, `error` | Diagnosa. |
| `claimed_at`, `sent_at`, `created_at` | Jejak waktu. |

Index:
- `wa_reminder_logs_once_idx` — unique parsial, penjaga pesan ganda.
- `wa_reminder_logs_created_idx`, `wa_reminder_logs_advertiser_idx`.
- `wa_reminder_schedules_time_idx` (aktif).
- `wa_reminder_templates_name_key` — unique `lower(name)`.

## 2. RPC

Semua RPC `SECURITY DEFINER`, `EXECUTE` hanya untuk `service_role`.

### `wa_reminder_claim(p_now timestamptz, p_base_url text, p_limit integer)`
Mengembalikan array JSON task siap kirim:
`{ log_id, group_id, message, advertiser_id, advertiser_name, product_code, product_name }`.

Langkah:
1. Tandai klaim `queued` lebih dari 10 menit sebagai `failed` (`CLAIM_TIMEOUT`).
2. Pilih jadwal aktif yang:
   - template-nya aktif,
   - hari cocok (`days @> dow`),
   - `now` berada di `[jam, jam+60 menit)` WIB.
3. Hitung order kemarin per pengiklan + produk:
   `source = 'orderonline'`, batas hari WIB, `leads`/`paid`.
4. Buang produk yang tidak punya leads.
5. Buang produk yang sudah punya `ad_spend_reports` mencakup kemarin
   (kecuali `only_if_missing_report = false`). Batch diabaikan.
6. Buang produk yang sudah 3× `failed` pada tanggal itu.
7. Render template (enam placeholder).
8. Insert `queued` dengan `on conflict do nothing`, batasi `p_limit`.

### `wa_reminder_mark(p_id uuid, p_status text, p_fonnte_message_id text, p_error text)`
Mengubah baris `queued` menjadi `sent`/`failed`. Baris yang sudah bukan `queued`
tidak berubah (`updated: false`) — mencegah penandaan ganda.

### `wa_reminder_preview(p_now, p_advertiser_code, p_product_code, p_template_id, p_base_url)`
Menghasilkan pesan final + angka kemarin untuk **Kirim Tes**. Mengembalikan
`{found:false, reason}` bila template/pengiklan/produk/grup tidak ada.

## 3. Izin

| Key | Modul | Default |
|---|---|---|
| `config.wa_bot` | konfigurasi | Manajer, Admin |
| `action.wa_bot_send` | aksi | Manajer, Admin |

Developer/Owner otomatis memiliki seluruh izin lewat `actor_has_permission`.

## 4. RLS & grant

- Kelima tabel: `ENABLE ROW LEVEL SECURITY`.
- `REVOKE ALL` dari `public, anon, authenticated`.
- `GRANT ALL` hanya ke `service_role`.
- Tidak ada policy SELECT: browser tidak dapat membaca token, nomor PIC, atau
  isi pesan. Semua akses lewat backend.

## 5. Retensi

Job `pg_cron` `dvflow_wa_reminder_logs_retention` berjalan `43 3 * * *` dan
menghapus log lebih tua dari 90 hari. Bila `pg_cron` tidak tersedia, migrasi tetap
berhasil dengan warning; penghapusan menjadi tanggung jawab operator.

## 6. Dampak ke objek lain

Migrasi ini **tidak mengubah** tabel `orders`, `ad_spend_reports`, atau RPC lama.
Pembacaan order hanya SELECT, sehingga snapshot tax dan aturan retensi tidak
tersentuh.
