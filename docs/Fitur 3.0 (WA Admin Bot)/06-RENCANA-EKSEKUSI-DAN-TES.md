# 06 — Rencana Eksekusi & Tes

## 1. Fase

| Fase | Isi | Status |
|---|---|---|
| F0 | Dokumen Fitur 3.0 + amendemen A66 | ✅ |
| F1 | Migrasi `20261111120000_wa_admin_bot.sql` + pgTAP `37_wa_admin_bot.sql` | ✅ diterapkan bersih di Supabase lokal; pgTAP 950 PASS |
| F2 | Backend `wa-bot/handlers.ts`, `fonnte.ts`, rute, error code, env | ✅ |
| F3 | Cron Worker `apps/wa-cron` + test | ✅ |
| F4 | Halaman web + navigasi + permission + test | ✅ |
| F5 | Deploy produksi + isi token/grup + smoke | ⏳ butuh kredensial & akun nyata |

## 2. Berkas yang ditambah/diubah

### Baru
```text
supabase/migrations/20261111120000_wa_admin_bot.sql
supabase/tests/37_wa_admin_bot.sql
packages/shared/src/domain/wa-reminder.ts
packages/shared/test/wa-reminder.test.ts
packages/api/src/wa-bot/handlers.ts
packages/api/src/wa-bot/fonnte.ts
packages/api/test/wa-bot.test.ts
apps/wa-cron/package.json
apps/wa-cron/tsconfig.json
apps/wa-cron/wrangler.toml
apps/wa-cron/src/index.ts
apps/wa-cron/test/index.test.ts
apps/web/src/pages/wa-bot/{types,WaBotPage,TokenSection,GroupSection,TemplateSection,ScheduleSection,LogSection}.tsx/ts
apps/web/test/wa-bot.test.tsx
.github/workflows/deploy-wa-cron.yml
docs/Fitur 3.0 (WA Admin Bot)/*.md
```

### Diubah
```text
packages/shared/src/index.ts, src/types.ts
packages/api/src/env.ts, src/http/errors.ts, src/routes.ts, test/helpers.ts, test/auth.test.ts
apps/web/src/ui/Field.tsx, src/ui/index.ts
apps/web/src/layout/navigation.ts, src/lib/roles.ts, src/lib/api.ts, src/App.tsx
apps/web/test/navigation.test.ts
package.json (script deploy:wa-cron)
scripts/write-dev-vars.mjs (WA_CRON_SECRET lokal)
docs/AMENDMENTS.md (A66)
```

## 3. Matriks tes

### `packages/shared/test/wa-reminder.test.ts` (7)
- Placeholder sah diterima; asing/rusak ditolak.
- Render mengganti seluruh nilai.
- Normalisasi `08…`, `8…`, `+62…`, `62…`; nomor tak masuk akal ditolak.
- Ringkasan hari (Setiap hari / tiga hari / Minggu).

### `packages/api/test/wa-bot.test.ts` (11)
- 403 tanpa izin pada baca dan tulis.
- Respons overview tidak memuat token; token tersimpan terenkripsi.
- Template: placeholder asing dan nama ganda ditolak.
- Grup: nomor dinormalisasi, pengiklan ganda ditolak.
- Jadwal: jam tidak valid, template tidak ada, hari dinormalkan.
- Kirim tes: header Authorization, form target/message, log tercatat.
- Cron: tanpa/salah secret → 404; tanpa token → `NO_TOKEN`; sukses → `sent`;
  kegagalan Fonnte → `failed` dengan alasan.
- Kirim ulang: id invalid → 404; baris failed → sent + attempts bertambah.
- Daftar log: filter status + pengiklan + tanggal.

### `apps/wa-cron/test/index.test.ts` (3)
- URL/metode/header secret benar.
- Status non-2xx diteruskan tanpa melempar.
- Konfigurasi tidak lengkap ditolak sebelum fetch.

### `apps/web/test/wa-bot.test.tsx` (3)
- Lima bagian utama tampil (token, grup, jadwal, riwayat).
- Placeholder asing ditolak di klien; server tidak dipanggil.
- Modal kirim tes menampilkan pilihan produk.

### `packages/api/test/integration/wa-bot.e2e.test.ts` (2)
- Klaim lewat PostgREST nyata memakai nama argumen RPC yang benar.
- Hanya produk belum lapor yang diklaim; klaim kedua kosong.
- `wa_reminder_mark` mengubah baris `queued` menjadi `sent`.
- `wa_reminder_preview` menghitung leads/paid kemarin (2/1).
- Fixture dibersihkan sendiri; dibuktikan lulus dua kali tanpa reset.

### `supabase/tests/37_wa_admin_bot.sql` (31 assertion)
- `schema_version = 70`.
- Hanya pengiklan aktif + produk belum lapor yang diklaim.
- Grup, produk, dan pesan dirender benar.
- Klaim kedua idempoten; batch diabaikan.
- Jendela 60 menit dan filter hari dihormati.
- Grup nonaktif dilewati; OTS tidak dihitung.
- Retry berhenti di 3 kegagalan; klaim menggantung di-fail-kan.
- Preview mengembalikan leads/paid dan alasan `GROUP_NOT_FOUND`.
- Izin terdaftar; browser tidak punya akses RPC/tabel.

## 4. Perintah verifikasi

```bash
npm run typecheck      # PASS (API, shared, wa-cron, web, worker, functions)
npm test               # PASS: 320 api + 142 shared + 3 wa-cron + 272 web = 737
npm run build          # PASS (web + ticket-qr)
npm run verify:ticket-qr

# Membutuhkan Docker Desktop menyala:
supabase db reset --no-seed
npm run test:db        # termasuk 37_wa_admin_bot.sql

supabase db reset      # dengan seed, untuk integration
npm run test:integration
```

Status terakhir di mesin pengembang (11 November 2026):

```text
typecheck          : PASS
npm test           : PASS (737)
build              : PASS
verify:ticket-qr   : PASS
pgTAP              : PASS — 950 test / 37 berkas (37 WA bot = 31 assertion)
integration        : PASS — 39 test / 5 berkas, lulus dua kali tanpa reset
wrangler dry-run   : PASS
```

## 5. Butir yang belum diverifikasi

1. **Fonnte nyata**: seluruh pengiriman diuji dengan `fetch` tiruan. Kirim tes
   ke satu grup uji setelah token asli dipasang.
2. **Cron Worker di Cloudflare**: belum di-deploy. `wrangler dev --test-scheduled`
   dapat dipakai lokal setelah `WA_CRON_SECRET` disamakan dengan `.dev.vars`.
3. **Produksi**: migrasi, secret, dan Worker belum diterapkan ke akun nyata.
4. **Zona waktu perangkat admin**: UI hanya menampilkan jam WIB apa adanya;
   label “(WIB)” dicantumkan agar tidak disalahartikan.
