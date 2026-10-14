# DOKUMENTASI LENGKAP FITUR 2.0 (dvflow)

Folder ini berisi dokumen spesifikasi teknis, arsitektur, dan panduan implementasi untuk 6 fitur tambahan pada versi 2.0.

---

## Daftar Dokumen Spesifikasi:

1. **[01-PRD-FITUR-2.0.md](./01-PRD-FITUR-2.0.md)**  
   *Product Requirement Document*: Latar belakang, 6 role baru (*Developer, Owner, Manajer, Admin, Pimpro, Member*), spesifikasi fungsional tiap fitur, dan kriteria penerimaan (*Acceptance Criteria*).

2. **[02-ARSITEKTUR-SCANNER-QR-HARDWARE.md](./02-ARSITEKTUR-SCANNER-QR-HARDWARE.md)**  
   *Hardware Scanner Architecture*: Penjelasan mendalam mengenai mekanisme kamera laptop/webcam USB (Model A) vs Barcode Scanner Gun fisik USB/Bluetooth (Model B - HID Keyboard Wedge), perbandingan kemudahan, dan arsitektur *Dual-Mode*.

3. **[03-SKEMA-DATABASE-DAN-MIGRASI.md](./03-SKEMA-DATABASE-DAN-MIGRASI.md)**  
   *Database Schema & Data Migration*: Skema tabel baru (`app_roles`, `app_permissions`, `app_role_permissions`, `user_product_access`), kamus permission, matriks default 6 role, dan logika SQL scoping produk.

4. **[04-FLOW-DAN-UI-UX-INTERAKSI.md](./04-FLOW-DAN-UI-UX-INTERAKSI.md)**  
   *UI/UX & User Interaction Flow*: Alur navigasi sidebar (*strict menu hiding*), halaman Konfigurasi Role (CRUD & modal checklist), penugasan produk di Add Team, dan interaksi lapangan di Scan QR.

5. **[05-KONTRAK-API-DAN-KEAMANAN.md](./05-KONTRAK-API-DAN-KEAMANAN.md)**  
   *API Contracts & Security Hardening*: Kontrak REST endpoint untuk Role & Permission, penyesuaian payload sesi profil, validasi produk saat check-in, dan proteksi middleware.

6. **[06-RENCANA-PENYESUAIAN-BASE-CODE.md](./06-RENCANA-PENYESUAIAN-BASE-CODE.md)**  
   *Gap Analysis & Phased Migration Plan*: Pemetaan file eksisting yang terdampak, analisis risiko, dan rencana 5 fase eksekusi aman tanpa mengganggu 375 automated tests yang sudah ada.


7. **[07-PLAN-MULTI-WEBHOOK-DAN-ALIAS-PRODUK.md](./07-PLAN-MULTI-WEBHOOK-DAN-ALIAS-PRODUK.md)** — Multi-webhook dan pemetaan alias.

8. **[08-AUDIT-ROLE-PERMISSION-DAN-KONFIGURASI-PRODUK.md](./08-AUDIT-ROLE-PERMISSION-DAN-KONFIGURASI-PRODUK.md)** — Hasil implementasi audit, matriks akses, standar kode, bukti pengujian, serta status migrasi dan pembersihan.

9. **[09-RUNBOOK-MIGRASI-PRODUKSI.md](./09-RUNBOOK-MIGRASI-PRODUKSI.md)** — Langkah menerapkan migrasi 0024–0029 ke produksi dan membersihkan data trial.
