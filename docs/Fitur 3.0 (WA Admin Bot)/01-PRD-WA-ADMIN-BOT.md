# 01 — PRD WA Admin Bot

## 1. Latar belakang

Pengiklan wajib mengisi **Report Spend Iklan** setiap hari (biasanya H-1). Saat ini
tidak ada pengingat otomatis: operator harus menagih satu per satu lewat WhatsApp.
Akibatnya laporan telat, biaya iklan tidak terbanding dengan leads/paid, dan
profit per batch baru terlihat jauh setelah keputusan diambil.

Fitur ini mengirim pengingat ke **grup WhatsApp per produk** pada jam yang
ditentukan, hanya untuk pengiklan yang ditugaskan ke produk itu dan belum punya
laporan untuk hari sebelumnya.

## 2. Tujuan

1. Menagih laporan tanpa harus diingat manual.
2. Pesan menyebut **semua pengiklan** di grup lewat nama, dalam satu pesan per grup.
3. Admin dapat mengubah grup, template, dan jam **tanpa deploy ulang**.
4. Tidak ada pesan ganda saat cron berjalan berulang.
5. Seminar dan webinar dicek terpisah: pengiklan yang menjalankan keduanya tetap
   diingatkan untuk jenis acara yang belum dilaporkan.
6. Kegagalan kirim dapat dilihat dan dikirim ulang dari dashboard.

## 3. Aktor & izin

| Aktor | Kemampuan |
|---|---|
| Developer / Owner | Semua (otomatis lewat peran penuh). |
| Manajer / Admin | Melihat dan mengubah konfigurasi, mengirim tes, mengirim ulang. Default pemegang `config.wa_bot` + `action.wa_bot_send`. |
| Pimpro / Member / Staff / Advertiser | Tidak melihat menu. |

Permission ditegakkan di backend dan RPC, bukan hanya dengan menyembunyikan menu.

## 4. Ruang lingkup

### 4.1 Koneksi Fonnte
- Token device disimpan terenkripsi (AES-256-GCM, `INTEGRATION_ENCRYPTION_KEY`).
- Token tidak pernah dikembalikan ke browser; UI hanya melihat status `has_token`.
- Tombol **Kirim Tes** menyediakan **preview** (tidak mengirim) lalu **Kirim ke
  Grup** untuk membuktikan token masih hidup.

### 4.2 Grup per Produk
- Satu produk hanya boleh punya satu grup (`wa_product_groups`).
- Input: produk, ID grup Fonnte (`12xxx@g.us`), status aktif.
- Penerima **otomatis**: pengiklan yang ditugaskan ke produk lewat
  `product_advertisers` dan masih aktif.
- Pengiklan tidak menyimpan nomor HP; semua pengiklan aktif yang ditugaskan ke
  produk otomatis disebut namanya di pesan grup.

### 4.3 Mention pengiklan
- Mention memakai **nama** pengiklan, bukan nomor: `{{mention}}` menjadi
  `@Nama`. Fonnte tidak punya parameter tag WhatsApp, jadi mention ini adalah
  teks sapaan, bukan tag yang memberi notifikasi.
- Satu pesan grup menyebut **semua** pengiklan yang beraktivitas kemarin untuk
  jenis acara itu: `Pagi Mas @A, @B, @C. Jangan lupa report kemarin ya.`

### 4.4 Template pesan
- Nama unik (tanpa membedakan besar/kecil huruf).
- Placeholder yang ditawarkan: `{{mention}}`, `{{advertiser_name}}`,
  `{{advertiser_code}}`, `{{product_name}}`, `{{product_code}}`,
  `{{event_type}}`, `{{date}}`, `{{report_url}}`.
- Warisan yang tetap dirender: `{{store_name}}`, `{{leads}}`, `{{paid}}`.
- Placeholder asing atau kurung kurawal rusak **ditolak saat simpan**.
- Preview dirender dengan data contoh sebelum disimpan.

### 4.5 Jadwal
- Jam eksekusi dibaca sebagai **WIB**.
- Pilihan hari (0 = Minggu … 6 = Sabtu), default setiap hari.
- Satu jadwal memakai satu template; jadwal berlaku untuk semua produk.
- Aturan: kirim hanya bila laporan D-1 untuk **pengiklan + produk + jenis acara**
  tersebut belum ada (`only_if_missing_report`).
- Produk tanpa order kemarin **tidak** diingatkan.

### 4.6 Riwayat pengiriman
- Setiap pesan dicatat: pengiklan, produk, jenis acara, grup, isi, status,
  percobaan, error, waktu klaim/terkirim.
- Filter status, produk, pengiklan, jenis acara, dan rentang tanggal; pagination
  server-side.
- Baris `failed` dapat dikirim ulang manual.
- Retensi **3 hari**; setelah itu dihapus otomatis.

## 5. Aturan bisnis

1. **Sumber angka**: order `source = 'orderonline'` dengan tanggal order kemarin
   (batas hari WIB, konvensi A24). OTS tidak dihitung karena tidak berasal dari iklan.
2. **Sudah lapor** = ada `ad_spend_reports` untuk pengiklan + produk + jenis acara
   yang rentang tanggalnya mencakup kemarin. Batch tidak diperiksa (W2).
3. **Satu pesan per (produk, jenis acara)** yang punya pengiklan belum lapor.
   Setiap jadwal memilih audiens: **semua** pengiklan yang beraktivitas kemarin,
   atau **hanya yang belum lapor**. Contoh: pagi menyebut semua, siang/sore hanya
   yang belum lapor.
4. **Idempoten**: kunci unik `(schedule_id, product_code, event_type,
   reminder_date)` untuk status `queued`/`sent`. Baris grup ditandai
   `advertiser_id is null`.
5. **Retry**: maksimal 3 percobaan otomatis untuk produk+jenis acara+jadwal+tanggal
   yang sama.
6. **Gagal-tertutup**: endpoint cron menolak 404 bila `WA_CRON_SECRET` kosong/salah.
7. **Tidak ada pesan ganda** meski Worker berjalan setiap menit.
8. **Tanpa nomor**: pengiklan tidak lagi menyimpan nomor HP; mention memakai nama.

## 6. Non-goals

- Bot dua arah / perintah masuk.
- Pengingat di luar laporan iklan (mis. tiket acara).
- Pengiriman ke nomor pribadi selain grup.
- Template bersyarat per batch.
- Lampiran gambar/PDF.
- Penyimpanan riwayat jangka panjang (WhatsApp sudah menyimpan chat).

## 7. Kriteria penerimaan

- [ ] Menambah grup untuk produk kedua berhasil; produk yang sama ditolak.
- [ ] Pengiklan yang ditugaskan ke produk otomatis muncul sebagai penerima.
- [ ] Nomor `0812-3456-7890` tersimpan sebagai `6281234567890`.
- [ ] Produk tidak bisa diaktifkan bila pengiklan penerimanya belum punya nomor.
- [ ] Template dengan `{{lead}}` ditolak dan pesan galatnya menyebut placeholder itu.
- [ ] Jadwal `09:00` mengirim pada 09:00 WIB, bukan 09:00 UTC.
- [ ] Report seminar tidak menutupi reminder webinar untuk pengiklan yang sama.
- [ ] Produk A yang sudah punya report D-1 tidak diingatkan; produk B yang belum
      lapor diingatkan.
- [ ] Menjalankan cron dua kali pada menit yang sama tidak mengirim dua pesan.
- [ ] Token salah membuat log `failed` dengan alasan dari Fonnte, bukan 500.
- [ ] Mengganti token di dashboard langsung dipakai pada run berikutnya.
- [ ] Kirim tes bisa preview tanpa mengirim, lalu mengirim setelah dikonfirmasi.
- [ ] Log lebih tua dari 3 hari terhapus otomatis.
- [ ] Akun tanpa `config.wa_bot` mendapat 403 pada seluruh endpoint.
