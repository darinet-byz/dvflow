# IMPLEMENTATION DECISIONS
## dvflow

Versi: 1.0
Tujuan: menutup area yang sebelumnya ditandai "belum ditentukan" agar coding agent tidak menebak.

## 1. Authentication
Aplikasi tetap memakai login sederhana:
- username
- password
- tanpa public signup
- tanpa UI Supabase Auth

Implementasi teknis:
- verifikasi username/password dilakukan oleh Cloudflare Worker;
- password disimpan sebagai salted PBKDF2-SHA256 hash menggunakan Web Crypto;
- minimum 600.000 iterations;
- salt random minimal 16 bytes per user;
- hash tidak pernah dikirim ke browser.

Alasan pilihan PBKDF2: tersedia native melalui Web Crypto di Cloudflare Workers sehingga tidak membutuhkan library crypto/wasm tambahan yang rawan berbeda perilaku antar runtime.

## 2. Session model
Gunakan dua lapis credential:
1. App refresh session: random opaque token, disimpan sebagai hash di database dan dikirim sebagai Secure + HttpOnly + SameSite=Lax cookie.
2. Short-lived Supabase-compatible access JWT: umur 30 menit, diberikan ke frontend untuk query Browser -> Supabase dengan RLS.

Access JWT:
- disimpan hanya di memory aplikasi; boleh dipulihkan melalui endpoint session refresh;
- jangan disimpan di localStorage;
- claim Postgres `role` = `authenticated`;
- claim custom `app_role` = `master_admin | admin | staff`;
- claim `app_user_id` = users.id;
- claim `sub` = users.id;
- JWT ditandatangani di Worker menggunakan private signing key yang juga di-trust oleh Supabase.

Jika implementasi custom JWT Supabase belum dikonfigurasi di project, jangan membuka RLS atau memakai service key di frontend sebagai shortcut.

## 3. Session lifecycle
- idle/refresh session lifetime: 7 hari.
- access JWT lifetime: 30 menit.
- logout menghapus/menonaktifkan refresh session server-side dan menghapus cookie.
- password change menonaktifkan seluruh session user tersebut.
- disabled user tidak dapat refresh session.

## 4. Password policy
Untuk MVP:
- minimal 8 karakter;
- current password wajib untuk ganti password;
- new password dan confirmation wajib sama;
- username case-insensitive dan unique;
- password comparison tetap case-sensitive.

Tidak perlu complexity rule huruf besar/angka/simbol.

## 5. RBAC final
Master Admin:
- seluruh read operation;
- scanner/check-in;
- Product Name Generator;
- CRUD Product/Advertiser/Event Type/Session;
- CRUD Tax;
- Report Tax;
- ubah profil sendiri;
- membuat user melalui protected admin API / developer tooling, tanpa menambah menu sidebar.

Admin:
- seluruh read operation;
- scanner/check-in;
- Product Name Generator;
- CRUD Product/Advertiser/Event Type/Session;
- CRUD Tax;
- Report Tax;
- ubah profil sendiri;
- tidak dapat membuat Master Admin.

Staff:
- Dashboard read;
- Order read/search/filter;
- Presensi read/search/filter;
- scanner/check-in;
- Product Name Generator;
- ubah profil sendiri;
- tidak dapat CRUD konfigurasi Product/Tax;
- tidak dapat akses write admin endpoints.

## 6. Sorting final
Order:
- default `created_at DESC`;
- sortable: order_id, name, app_status, gross_amount, tax_amount, net_amount, created_at, paid_at, updated_at.

Presensi:
- default latest attendance activity DESC;
- jika belum hadir, fallback ke order created_at DESC;
- sortable: order_id, name, total_activity, latest_activity, product_name, batch, session, city.

Report Tax:
- default group value ascending untuk label dan transaction count descending untuk summary table bila applicable.

## 7. Search behavior
- debounce 300 ms;
- minimal 2 karakter, kecuali numeric Order ID boleh 1 karakter;
- Enter tetap menjalankan search langsung;
- Clear All menghapus structured filters tetapi TIDAK menghapus global search text;
- search text dihapus hanya lewat clear pada input search.

## 8. Delete configuration semantics
Semua configuration memakai soft deactivate.

`Delete` pada UI berarti:
- confirmation;
- set `active=false`;
- row tidak muncul di selector/generator normal;
- historical order tetap utuh;
- row tetap dapat dipakai untuk memahami historical normalized data.

Tidak ada hard delete dari UI MVP.

## 9. Product parser invalid
Jika `product_raw` tidak sesuai format atau kode tidak ditemukan:
- webhook tetap diterima;
- Order ID tetap disimpan/upsert;
- `product_raw` selalu dipertahankan;
- normalized field yang tidak dapat dipastikan menjadi NULL;
- `product_parse_status = invalid`;
- row tetap dapat dicari melalui Order ID/nama/WA/product_raw;
- akses seminar/webinar ditolak jika event_type tidak dapat ditentukan;
- tidak membuat mapping baru otomatis.

Jika parsing valid: `product_parse_status = valid`.

## 10. Product parser rules
Canonical pattern:
`[PRODUCT_CODE][ADVERTISER_CODE][TYPE_CODE][BATCH] - [SESSION_CODE] - [CITY]`

Parsing:
- trim whitespace di sekitar segment;
- separator utama harus ` - ` setelah trim;
- code lookup case-insensitive tetapi disimpan sesuai code canonical configuration;
- city disimpan sebagai display string hasil trim;
- batch wajib string non-empty dan tidak diubah menjadi integer agar leading zero tidak hilang;
- parser tidak boleh fuzzy guess.

## 11. Tax matching final
Webhook adapter harus menghasilkan `payment_identifier` canonical.

Normalisasi identifier:
- trim;
- lowercase;
- collapse multiple whitespace menjadi satu;
- tidak fuzzy matching.

Tax rule match:
- exact match `payment_fee_rules.identifier_normalized = orders.payment_identifier_normalized`;
- hanya rule `active=true` yang dipakai untuk order baru/update yang membutuhkan perhitungan tax;
- identifier harus unique di antara rule aktif.

Jika tidak ada mapping:
- tax_amount = 0;
- net_amount = gross_amount;
- `tax_mapping_status = unmapped`;
- jangan memilih rule terdekat.

Jika match:
- `tax_mapping_status = mapped`.

## 12. Historical tax behavior
Tax adalah snapshot transaksi.

Saat tax dihitung, Orders menyimpan:
- tax_amount;
- net_amount;
- fee_rule_id;
- fee_rule_name_snapshot;
- fee_type_snapshot;
- fee_value_snapshot.

Edit/deactivate Tax config:
- tidak mengubah order historis;
- hanya berlaku pada webhook/order calculation berikutnya.

Repeated webhook untuk Order ID yang sama:
- tax hanya dihitung ulang jika field payment/gross yang menjadi input calculation berubah ATAU order sebelumnya berstatus `unmapped` dan sekarang rule valid tersedia;
- tidak melakukan mass retroactive recalculation.

## 13. Repeated seminar scan
Seminar berbeda dengan webinar.

Rule seminar:
- satu Order ID hanya membutuhkan satu successful seminar check-in;
- repeated scan tidak membuat attendance row baru;
- response = `ALREADY_CHECKED_IN` dan tampilkan timestamp check-in pertama;
- duplicate protection dilakukan server-side, bukan hanya UI.

Rule webinar tetap sesuai PRD:
- setiap successful click/redirect menciptakan attendance event baru.

## 14. Scanner Manual Search
Secondary action Manual Search dipakai jika kamera/QR bermasalah.

Search field tunggal dapat mencari:
- Order ID;
- nama;
- no WA.

Hasil hanya menampilkan kandidat seminar.
Operator memilih satu row lalu menekan `Check-in`.
Server menjalankan validation yang sama persis dengan QR:
- Order ada;
- app_status Paid;
- event_type Seminar Offline;
- belum check-in.

Manual Search tidak boleh bypass rule Paid.

## 15. Webinar destination / Zoom URL
Tidak membuat Event Management UI baru.

Destination disimpan di `app_settings` dengan key exact berdasarkan `product_raw`:
`webinar_destination::<product_raw>`

Value = HTTPS destination URL.

Worker lookup menggunakan exact product_raw.
Jika mapping tidak ada:
- jangan record attendance;
- jangan redirect ke URL random;
- tampilkan access error `WEBINAR_DESTINATION_NOT_CONFIGURED`.

Konfigurasi app_settings untuk MVP dilakukan developer/Master Admin melalui database/admin tooling, bukan menu sidebar baru.

## 16. Dashboard chart / breakdown
Karena tidak ada metric chart yang ditentukan, MVP final:
- jangan membuat chart;
- jangan membuat breakdown card tambahan.

Dashboard hanya menampilkan KPI yang sudah ditentukan plus filters.
Ini lebih aman daripada agent memilih chart sendiri.

## 17. Notification center
Tidak dibuat.
Toast feedback bukan notification center.

## 18. Edit/Delete Master Order
Tidak tersedia pada MVP.
Drawer Order bersifat read-only.

## 19. Webhook log retention
Jika webhook_logs dipakai:
- retention 7 hari;
- hanya metadata + sanitized payload/error context yang diperlukan troubleshooting;
- jangan menyimpan secret/header credential;
- cron menghapus >7 hari.

## 20. Webhook security
Gunakan endpoint secret yang tidak dapat ditebak:
`/api/webhooks/orderonline/:webhookSecret`

`webhookSecret` berasal dari Worker secret environment variable.
Request dengan secret salah: 404, bukan 401, agar endpoint tidak mudah ditebak.

Jika di kemudian hari OrderOnline menyediakan signature resmi dan contoh payload yang sudah diverifikasi, signature validation boleh menggantikan/menambah secret path melalui update requirement.

## 21. Webhook retry/idempotency
- Order upsert idempotent berdasarkan unique `order_id`.
- attendance webinar bukan idempotent per click karena repeated click memang dicatat.
- seminar check-in idempotent berdasarkan `order_id + attendance_type=seminar`.
- Worker wajib aman bila webhook yang sama dikirim ulang.

## 22. External webhook payload mapping: BLOCKER DATA
Dokumen sumber belum memberikan contoh payload OrderOnline nyata.
Karena itu coding agent DILARANG menebak nama JSON key eksternal.

Sebelum webhook adapter dinyatakan production-ready, wajib tersedia minimal:
- 1 payload pending;
- 1 payload processing/paid;
- 1 payload complete jika berbeda;
- 1 payload cancelled;
- minimal 2 payment method berbeda.

Adapter harus memetakan payload eksternal ke canonical object pada API Contract.
Bagian lain aplikasi hanya membaca canonical object, bukan raw provider key.
