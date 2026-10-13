-- ============================================================================
-- seed.sql — data DEVELOPMENT (hanya berjalan di `supabase db reset` lokal)
-- ============================================================================
--
-- Berkas ini TIDAK ikut ke produksi: `supabase db push` hanya menjalankan
-- migrations/, sedangkan seed.sql hanya dipakai ingest lokal. Karena itu contoh
-- produk/pengiklan di bawah aman berada di sini dan DILARANG dipindahkan ke
-- migrations/ (06 §5: "Do not seed fake business products/advertisers into
-- production migration").
--
-- Yang TIDAK ada di sini dengan sengaja:
--   * user apa pun, termasuk Master Admin. 06 §6 melarang mengirim password
--     default; Master Admin pertama dibuat lewat `scripts/create-master-admin.mjs`.
--   * attendance_events / orders contoh. Data order dibuat oleh test atau
--     webhook, bukan oleh seed.
--
-- event_types (SO/WO) dan sessions_config (S1/S2/ST) tidak diulang di sini:
-- keduanya seed canonical yang sudah ada di migrasi 0006/0007.

-- Produk & pengiklan contoh (pola kode dari PRD §67: KM / Kuliner Masteri).
insert into public.products (name, code)
values
  ('Kuliner Masteri', 'KM'),
  ('Bisnis Masteri', 'BM')
on conflict (code_normalized) do nothing;

insert into public.advertisers (name, code)
values
  ('Zul', '01'),
  ('Rahman', '02')
on conflict (code_normalized) do nothing;

-- Fee rule contoh yang sekaligus mencerminkan angka acceptance test:
--   E01 flat 4000;
--   E02 percentage 0.7 (= 0,7%).
--
-- Identifier di sini SENGAJA memakai nilai yang benar-benar dikirim provider
-- (`payment.method` apa adanya: `bank_transfer`, `qris`), bukan label yang lebih
-- rapi seperti "Bank Transfer". Alasannya 06 §15: yang didaftarkan adalah
-- "exact canonical payment identifier" — identifier yang benar-benar diterima
-- aplikasi. Menuliskan label lain di sini hanya akan menghasilkan tax `unmapped`
-- yang membingungkan saat pengembangan.
insert into public.payment_fee_rules (name, identifier, fee_type, fee_value)
values
  ('Admin Bank Transfer', 'bank_transfer', 'flat', 4000),
  ('Fee QRIS 0.7%', 'qris', 'percentage', 0.7)
on conflict do nothing;

-- Catatan: `on conflict do nothing` pada payment_fee_rules tidak memakai target
-- kolom karena unique-nya adalah partial index (`where active`).
