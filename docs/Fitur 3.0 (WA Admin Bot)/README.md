# FITUR 3.0 — WA ADMIN BOT (dvflow)

Bot pengingat laporan iklan harian ke grup WhatsApp advertiser melalui Fonnte.

## Daftar dokumen

1. **[01-PRD-WA-ADMIN-BOT.md](./01-PRD-WA-ADMIN-BOT.md)** — latar belakang, ruang lingkup, aturan bisnis, kriteria penerimaan.
2. **[02-ARSITEKTUR-CRON-DAN-FONNTE.md](./02-ARSITEKTUR-CRON-DAN-FONNTE.md)** — alur cron Worker → backend → Fonnte, batas platform, idempotensi.
3. **[03-SKEMA-DATABASE-DAN-RPC.md](./03-SKEMA-DATABASE-DAN-RPC.md)** — tabel, index, RPC klaim/tandai/preview, izin, retensi.
4. **[04-KONTRAK-API-DAN-KEAMANAN.md](./04-KONTRAK-API-DAN-KEAMANAN.md)** — endpoint admin dan internal, payload, error, aturan rahasia.
5. **[05-FLOW-DAN-UI-UX.md](./05-FLOW-DAN-UI-UX.md)** — menu, lima bagian halaman, interaksi, keadaan kosong/error.
6. **[06-RENCANA-EKSEKUSI-DAN-TES.md](./06-RENCANA-EKSEKUSI-DAN-TES.md)** — fase, berkas yang berubah, matriks tes, perintah verifikasi.
7. **[07-RUNBOOK-DEPLOY-DAN-OPERASIONAL.md](./07-RUNBOOK-DEPLOY-DAN-OPERASIONAL.md)** — migrasi, secret, deploy Worker, setup Fonnte, smoke test, troubleshooting.

## Keputusan yang dikunci (11 November 2026)

| # | Keputusan |
|---|---|
| W1 | Grup WhatsApp = **per pengiklan** (1 `advertisers` = 1 grup). |
| W2 | Pengecekan laporan = **per produk**; batch **diabaikan**. |
| W3 | Pengiriman = **satu pesan per (pengiklan, produk)** yang belum lapor. |
| W4 | Bot **outbound saja**; tidak ada webhook masuk/perintah. |
| W5 | Token Fonnte disimpan **terenkripsi di database** dan dapat diganti dari dashboard. |
| W6 | Menu **Sistem → WA Admin Bot**, satu halaman dengan lima bagian. |
| W7 | Pengiriman dilakukan **backend**, bukan cron Worker; Worker hanya pemicu. |
| W8 | Cron Worker terpisah (`apps/wa-cron`) karena Cloudflare Pages tidak punya cron trigger. |

## Berkas utama

| Lapisan | Berkas |
|---|---|
| Database | `supabase/migrations/20261111120000_wa_admin_bot.sql`, `supabase/tests/37_wa_admin_bot.sql` |
| Aturan murni | `packages/shared/src/domain/wa-reminder.ts` |
| Backend | `packages/api/src/wa-bot/{handlers,fonnte}.ts`, `packages/api/src/routes.ts` |
| Cron | `apps/wa-cron/{wrangler.toml,src/index.ts}` |
| Web | `apps/web/src/pages/wa-bot/*`, `navigation.ts`, `App.tsx`, `lib/roles.ts` |
| Deploy | `.github/workflows/deploy-wa-cron.yml`, `npm run deploy:wa-cron` |

## Status

Implementasi kode selesai dan lolos typecheck, unit test (737), build, pgTAP
(950 test / 37 berkas), serta integration test (39 test / 5 berkas). Yang masih
perlu dilakukan di lingkungan nyata: terapkan migrasi ke produksi, isi token
Fonnte dan ID grup, set `WA_CRON_SECRET`, lalu deploy Worker. Lihat dokumen 07.
