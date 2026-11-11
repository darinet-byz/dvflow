# 01 — PRD WA Admin Bot

## 1. Latar belakang

Pengiklan wajib mengisi **Report Spend Iklan** setiap hari (biasanya H-1). Saat ini
tidak ada pengingat otomatis: operator harus menagih satu per satu lewat WhatsApp.
Akibatnya laporan telat, biaya iklan tidak terbanding dengan leads/paid, dan
profit per batch baru terlihat jauh setelah keputusan diambil.

Fitur ini mengirim pengingat ke **grup WhatsApp pengiklan** pada jam yang
ditentukan, hanya untuk produk yang **belum punya laporan** untuk hari sebelumnya.

## 2. Tujuan

1. Menagih laporan tanpa harus diingat manual.
2. Pesan menyebut data nyata (leads/paid kemarin), bukan kalimat generik.
3. Admin dapat mengubah grup, nomor PIC, template, dan jam **tanpa deploy ulang**.
4. Tidak ada pesan ganda saat cron berjalan berulang.
5. Kegagalan kirim dapat dilihat dan dikirim ulang dari dashboard.

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
- Tombol **Kirim Tes** mengirim satu pesan nyata ke grup terpilih untuk membuktikan
  token masih hidup.

### 4.2 Grup & PIC
- Satu pengiklan hanya boleh punya satu grup.
- Input: pengiklan, ID grup Fonnte (`12xxx@g.us`), nomor PIC (`08xxx`/`628xxx`),
  nama PIC opsional, status aktif.
- Nomor dinormalisasi ke `628xxx`; mention di pesan menjadi `@628xxx`.

### 4.3 Template pesan
- Nama unik (tanpa membedakan besar/kecil huruf).
- Placeholder yang didukung: `{{mention}}`, `{{store_name}}`, `{{product_name}}`,
  `{{leads}}`, `{{paid}}`, `{{report_url}}`.
- Placeholder asing atau kurung kurawal rusak **ditolak saat simpan**.
- Preview dirender dengan data contoh sebelum disimpan.

### 4.4 Jadwal
- Jam eksekusi dibaca sebagai **WIB**.
- Pilihan hari (0 = Minggu … 6 = Sabtu), default setiap hari.
- Satu jadwal memakai satu template.
- Aturan: kirim hanya bila laporan D-1 produk tersebut belum ada
  (`only_if_missing_report`).
- Produk tanpa leads kemarin **tidak** diingatkan (tidak ada yang perlu dilaporkan).

### 4.5 Riwayat pengiriman
- Setiap pesan dicatat: pengiklan, produk, grup, isi, status, percobaan, error,
  waktu klaim/terkirim.
- Filter status, pengiklan, dan rentang tanggal; pagination server-side.
- Baris `failed` dapat dikirim ulang manual.
- Retensi 90 hari.

## 5. Aturan bisnis

1. **Sumber angka**: order `source = 'orderonline'` dengan tanggal order kemarin
   (batas hari WIB, konvensi A24). OTS tidak dihitung karena tidak berasal dari iklan.
2. **Sudah lapor** = ada `ad_spend_reports` untuk pengiklan + produk yang rentang
   tanggalnya mencakup kemarin. Batch tidak diperiksa (W2).
3. **Satu pesan per produk**: jika 3 produk belum lapor, grup menerima 3 pesan.
4. **Idempoten**: kunci unik `(schedule_id, advertiser_id, product_code, reminder_date)`
   untuk status `queued`/`sent`.
5. **Retry**: maksimal 3 percobaan otomatis untuk produk+jadwal+tanggal yang sama.
6. **Gagal-tertutup**: endpoint cron menolak 404 bila `WA_CRON_SECRET` kosong/salah.
7. **Tidak ada pesan ganda** meski Worker berjalan setiap menit.

## 6. Non-goals

- Bot dua arah / perintah masuk.
- Pengingat di luar laporan iklan (mis. tiket acara).
- Pengiriman ke nomor pribadi selain grup.
- Template bersyarat per batch atau per event type.
- Lampiran gambar/PDF.

## 7. Kriteria penerimaan

- [ ] Menambah grup untuk pengiklan kedua berhasil; pengiklan yang sama ditolak.
- [ ] Nomor `0812-3456-7890` tersimpan sebagai `6281234567890`.
- [ ] Template dengan `{{lead}}` ditolak dan pesan galatnya menyebut placeholder itu.
- [ ] Jadwal `09:00` mengirim pada 09:00 WIB, bukan 09:00 UTC.
- [ ] Produk A yang sudah punya report D-1 tidak diingatkan; produk B yang belum
      lapor diingatkan.
- [ ] Menjalankan cron dua kali pada menit yang sama tidak mengirim dua pesan.
- [ ] Token salah membuat log `failed` dengan alasan dari Fonnte, bukan 500.
- [ ] Mengganti token di dashboard langsung dipakai pada run berikutnya.
- [ ] Akun tanpa `config.wa_bot` mendapat 403 pada seluruh endpoint.
