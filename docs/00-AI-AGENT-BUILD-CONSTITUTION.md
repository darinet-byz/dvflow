# AI AGENT BUILD CONSTITUTION
## dvflow

Versi: 1.0
Status: Wajib dipatuhi seluruh coding agent

## 1. Tujuan dokumen
Dokumen ini adalah pagar implementasi agar AI coding agent tidak menambah scope, mengubah business rule, atau mengambil keputusan produk secara diam-diam.

Urutan source of truth:
1. PRD.txt
2. Blueprint App / Webhook OrderOnline Meta CAPI.txt
3. UI-UX-Design-Guideline-OrderOnline-App.md
4. Dokumen engineering contract di folder ini
5. Code

Jika code bertentangan dengan dokumen di atas, code yang diubah.

## 2. Prinsip non-negotiable
- Jangan menambah menu baru.
- Jangan membuat public signup.
- Jangan mengubah struktur sidebar.
- Jangan mengubah mapping status: pending = Pending, processing/complete = Paid, cancelled = Cancelled.
- Jangan membuat duplicate Master Order. Satu Order ID = satu row.
- Jangan hardcode Product, Advertiser, Event Type, Session, atau Tax rule ke source code.
- Jangan menyimpan attendance sebagai timestamp_1 ... timestamp_10 di database.
- Jangan load seluruh database ke browser.
- Jangan menyimpan raw attendance lebih dari 30 hari.
- Jangan menghapus Master Order karena retention attendance.
- Jangan membuat QR di Worker.
- Jangan memberi akses event kepada Pending, Cancelled, atau Order ID tidak dikenal.
- Jangan menaruh Supabase secret/service key, JWT private key, password hash secret, atau webhook secret di frontend.
- Jangan mengubah UI design system global tanpa requirement baru.

## 3. Scope sidebar final
OPERASIONAL
- Scan QR
- Dashboard Resume
- Order
- Presensi Acara

KONFIGURASI
- Konfigurasi Produk
- Konfigurasi Tax
- Report Tax
- Product Name Generator

ACCOUNT
- Profil
- Logout

Tidak ada menu User Management, Notification Center, Export, Audit Log, atau menu lain pada MVP.

## 4. Rule ketika requirement tidak ada
Coding agent dilarang mengarang behavior baru.

Jika menemukan gap:
1. cek PRD;
2. cek blueprint;
3. cek UI/UX guideline;
4. cek dokumen engineering contract;
5. jika tetap tidak ada, tandai `BLOCKED_BY_REQUIREMENT` dan jangan diam-diam membuat fitur.

Pengecualian: keputusan engineering yang sudah dikunci di dokumen `01-IMPLEMENTATION-DECISIONS.md` harus langsung dipakai dan tidak dianggap gap.

## 5. Rule perubahan schema
- Migration wajib versioned.
- Jangan edit migration lama yang sudah pernah diterapkan ke environment bersama.
- Penambahan kolom internal diperbolehkan hanya jika tercantum pada Data Dictionary.
- Jangan membuat tabel tambahan tanpa tercantum di Data Dictionary.

## 6. Rule perubahan API
- Route Worker harus mengikuti `03-WORKER-API-CONTRACT.md`.
- Response code dan error code tidak boleh diubah sesuka agent.
- Semua endpoint sensitif harus memverifikasi session/role sesuai kontrak.

## 7. Rule UI
Gunakan shared components untuk:
- Button
- Input
- Select
- Badge
- Card
- KPI Card
- Filter Bar
- Filter Chip
- Table
- Drawer
- Modal
- Toast
- Skeleton
- Empty State
- Error State

Jangan membuat visual style per halaman yang berbeda sendiri.

## 8. Rule query data
- Pagination server-side.
- Default 50 row/page.
- Optional 100 row/page.
- Filter server-side.
- Search server-side.
- Sort server-side.
- Search debounce 300 ms.
- Query hanya field yang diperlukan halaman.

## 9. Rule testing sebelum task dianggap selesai
Sebuah fitur tidak dianggap selesai hanya karena UI tampil.
Agent harus memverifikasi minimal:
- happy path;
- unauthorized path;
- empty state;
- error state;
- duplicate/retry path bila relevan;
- mobile behavior bila relevan;
- tidak ada secret di browser bundle.

Gunakan test cases pada `05-EDGE-CASES-AND-ACCEPTANCE-TESTS.md`.

## 10. Definition of Done
Task hanya boleh dinyatakan DONE jika:
- sesuai source of truth;
- tidak menambah scope;
- migration/schema sesuai contract;
- route/API sesuai contract;
- UI mengikuti guideline;
- test relevan lulus;
- lint/typecheck/build lulus;
- tidak ada credential/secrets di repository atau frontend;
- tidak ada TODO yang memengaruhi business-critical flow kecuali dependency eksternal yang jelas ditandai.
