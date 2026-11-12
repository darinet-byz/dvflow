# FITUR 3.0 — WA ADMIN BOT (dvflow)

Bot pengingat laporan iklan harian ke grup WhatsApp per produk melalui Fonnte.

## Daftar dokumen

1. **[01-PRD-WA-ADMIN-BOT.md](./01-PRD-WA-ADMIN-BOT.md)** — latar belakang, ruang lingkup, aturan bisnis, kriteria penerimaan.
2. **[02-ARSITEKTUR-CRON-DAN-FONNTE.md](./02-ARSITEKTUR-CRON-DAN-FONNTE.md)** — alur cron Worker → backend → Fonnte, batas platform, idempotensi.
3. **[03-SKEMA-DATABASE-DAN-RPC.md](./03-SKEMA-DATABASE-DAN-RPC.md)** — tabel, index, RPC klaim/tandai/preview, izin, retensi.
4. **[04-KONTRAK-API-DAN-KEAMANAN.md](./04-KONTRAK-API-DAN-KEAMANAN.md)** — endpoint admin dan internal, payload, error, aturan rahasia.
5. **[05-FLOW-DAN-UI-UX.md](./05-FLOW-DAN-UI-UX.md)** — menu, tab halaman, interaksi, keadaan kosong/error.
6. **[06-RENCANA-EKSEKUSI-DAN-TES.md](./06-RENCANA-EKSEKUSI-DAN-TES.md)** — fase, berkas yang berubah, matriks tes, perintah verifikasi.
7. **[07-RUNBOOK-DEPLOY-DAN-OPERASIONAL.md](./07-RUNBOOK-DEPLOY-DAN-OPERASIONAL.md)** — migrasi, secret, deploy Worker, setup Fonnte, smoke test, troubleshooting.

## Keputusan yang dikunci

| # | Keputusan |
|---|---|
| W1 | Grup WhatsApp = **per produk** (1 `products` = 1 grup, `wa_product_groups`). |
| W2 | Pengecekan laporan = **per pengiklan + produk + jenis acara**; batch **diabaikan**. |
| W3 | Pengiriman = **satu pesan per (pengiklan, produk, jenis acara)** yang belum lapor. |
| W4 | Bot **outbound saja**; tidak ada webhook masuk/perintah. |
| W5 | Token Fonnte disimpan **terenkripsi di database** dan dapat diganti dari dashboard. |
| W6 | Menu **Sistem → WA Admin Bot**, satu halaman dengan enam tab. |
| W7 | Pengiriman dilakukan **backend**, bukan cron Worker; Worker hanya pemicu. |
| W8 | Cron Worker terpisah (`apps/wa-cron`) karena Cloudflare Pages tidak punya cron trigger. |
| W9 | Penerima = pengiklan di `product_advertisers`; nomor tag dari `advertisers.wa_phone` (wajib). |
| W10 | Log pengiriman disimpan **3 hari**, lalu dihapus otomatis. |

## Berkas utama

| Lapisan | Berkas |
|---|---|
| Database | `supabase/migrations/20261111120000_wa_admin_bot.sql`, `20261112090000_wa_bot_product_level.sql`, `supabase/tests/37_wa_admin_bot.sql` |
| Aturan murni | `packages/shared/src/domain/wa-reminder.ts` |
| Backend | `packages/api/src/wa-bot/{handlers,fonnte}.ts`, `packages/api/src/routes.ts` |
| Cron | `apps/wa-cron/{wrangler.toml,src/index.ts}` |
| Web | `apps/web/src/pages/wa-bot/*`, `navigation.ts`, `App.tsx`, `lib/roles.ts` |
| Deploy | `.github/workflows/deploy-wa-cron.yml`, `npm run deploy:wa-cron` |

## Status

Implementasi kode selesai dan lolos typecheck, lint, unit test, build, serta
pgTAP. Yang masih perlu dilakukan di lingkungan nyata: terapkan migrasi 71 ke
produksi, isi token Fonnte, nomor WA pengiklan, dan grup per produk, set
`WA_CRON_SECRET`, lalu deploy Worker. Lihat dokumen 07.
