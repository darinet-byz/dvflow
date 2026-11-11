# Rencana Sistem Otomasi Reminder WhatsApp (Dashboard Dinamis)

Dokumen ini berisi spesifikasi teknis dan panduan implementasi untuk bot pengingat pelaporan iklan harian. Sistem ini dirancang agar **100% dinamis**, di mana jadwal pengiriman, template pesan, pengaturan grup WhatsApp, dan penugasan PIC advertiser sepenuhnya dapat dikonfigurasi melalui Dashboard Admin tanpa perlu menyentuh kode (hardcode).

---

## 1. Arsitektur & Teknologi

*   **Backend & Dashboard:** Aplikasi internal Anda (Laravel / Node.js / PHP) bertugas sebagai antarmuka pengaturan (Dashboard) dan penyedia data (API Endpoint).
*   **Database:** Tabel relasional untuk menyimpan konfigurasi grup, PIC, jadwal cron, dan template pesan dinamis.
*   **Orkestrator & Eksekutor:** Cloudflare Workers (Gratis). Bertugas menjalankan Cron Trigger, memanggil API backend, dan mengeksekusi pengiriman pesan.
*   **WhatsApp Gateway:** Fonnte (Menerima payload dari Worker dan meneruskannya ke Grup WhatsApp).

---

## 2. Fitur Dashboard Konfigurasi

Sistem ini membutuhkan antarmuka di Dashboard Admin yang mencakup modul-modul berikut:

### 2.1. Manajemen Advertiser & Grup WA
*   **Tujuan:** Menghubungkan toko/brand di OrderOnline dengan grup WhatsApp dan nomor PIC.
*   **Fitur Input:**
    *   Pilih Toko/Brand (dari data OrderOnline).
    *   Input Nama Advertiser & Nomor WhatsApp (format: `628xxx` untuk tag mention).
    *   Input ID Grup WhatsApp Fonnte (`12xxx@g.us`).
    *   Toggle Status (Aktif/Nonaktifkan bot untuk grup tertentu).

### 2.2. Pengaturan Template Pesan (Dinamis)
*   **Tujuan:** Admin dapat membuat dan mengedit kalimat sapaan, teguran siang, atau eskalasi malam secara bebas.
*   **Fitur Input:**
    *   Nama Template (Contoh: "Template Pagi", "Template Eskalasi").
    *   Teks Editor dengan dukungan **Variabel Placeholder**:
        *   `{{mention}}` : Akan diganti menjadi `@628xxx`.
        *   `{{store_name}}` : Nama toko/brand.
        *   `{{leads}}` : Total leads kemarin.
        *   `{{paid}}` : Total paid kemarin.
        *   `{{report_url}}` : Link dinamis menuju halaman input laporan.

### 2.3. Pengaturan Jadwal Cron (Jam Eksekusi)
*   **Tujuan:** Mengatur pada jam berapa saja Worker harus melakukan pengecekan dan pengiriman pesan, serta template mana yang digunakan pada jam tersebut.
*   **Fitur Input:**
    *   Waktu Eksekusi (Contoh: `09:00`, `12:00`, `20:00`).
    *   Pilihan Template Pesan (Pilih template dari modul 2.2 yang akan digunakan pada jam ini).
    *   Aturan Kondisional: "Kirim jika laporan D-1 belum disubmit".

---

## 3. Skema Database (Dinamis)

Untuk mendukung fleksibilitas di atas, perbarui atau buat tabel berikut di database Anda:

### 3.1. `wa_reminder_groups` (Mapping Grup & PIC)
```sql
CREATE TABLE wa_reminder_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    store_id VARCHAR(50) NOT NULL UNIQUE,
    store_name VARCHAR(100) NOT NULL,
    fonnte_group_id VARCHAR(100) NOT NULL,
    pic_phone VARCHAR(20) NOT NULL COMMENT 'Format 628xxx',
    pic_name VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2. `wa_reminder_templates` (Master Template Pesan)
```sql
CREATE TABLE wa_reminder_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    message_content TEXT NOT NULL COMMENT 'Berisi teks dengan placeholder {{mention}}, dll',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.3. `wa_reminder_schedules` (Master Jadwal & Tipe Pengecekan)
```sql
CREATE TABLE wa_reminder_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    execution_time TIME NOT NULL COMMENT 'Contoh: 09:00:00',
    template_id INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (template_id) REFERENCES wa_reminder_templates(id)
);
```

---

## 4. Alur Kerja Sistem (Flow)

### Tahap 1: Pengaturan oleh Admin (Dashboard)
1.  Admin mendaftarkan toko baru beserta nomor WA PIC dan ID Grup Fonnte di menu **Manajemen Grup WA**.
2.  Admin membuat draf pesan pengingat di menu **Template Pesan** menggunakan placeholder.
3.  Admin mengatur jam operasional di menu **Penjadwalan**. Misalnya: Jam 09.00 menggunakan Template Pagi, jam 12.00 menggunakan Template Siang.

### Tahap 2: Eksekusi Otomatis (Cloudflare Worker & Backend API)
1.  **Cloudflare Worker** di-setting untuk berjalan sangat sering (misal: setiap jam atau setiap 15 menit menggunakan Cron `0 * * * *` atau `*/15 * * * *`).
2.  Saat Worker berjalan, ia akan memanggil **API Endpoint Backend** (`GET /api/internal/check-reminder-schedule`).
3.  **Backend (Aplikasi Anda) melakukan evaluasi:**
    *   Apakah jam saat ini cocok dengan jam di tabel `wa_reminder_schedules`?
    *   Jika **TIDAK**, backend merespons: "Tidak ada jadwal". Worker berhenti.
    *   Jika **YA**, backend melanjutkan pengecekan.
4.  **Backend Mengecek Data OrderOnline & Laporan:**
    *   Cari toko yang kemarin ada `leads` atau `paid` > 0.
    *   Kecualikan toko yang sudah mengisi laporan di tabel `ad_reports`.
5.  **Backend Merakit Pesan (Replace Placeholder):**
    *   Backend mengambil template yang berelasi dengan jadwal saat itu.
    *   Backend mengganti variabel placeholder (`{{mention}}`, `{{leads}}`, dll) dengan data riil dari masing-masing toko.
6.  **Backend Mengembalikan JSON ke Worker:**
    *   Format respon berisi daftar tugas siap kirim: `[ { "target_group": "123@g.us", "message": "Teks final..." }, ... ]`
7.  **Cloudflare Worker Mengirim ke Fonnte:**
    *   Worker melakukan *looping* membaca array JSON tersebut.
    *   Worker mengirim HTTP POST ke API Fonnte untuk masing-masing grup dengan jeda delay.

---

## 5. Implementasi API Backend (Jantung Sistem)

Karena Worker tidak boleh di-hardcode, logika berat dipindah ke API Backend. Worker hanya berfungsi sebagai *trigger* dan pengirim.

**Contoh Logic Endpoint `GET /api/internal/check-reminder-schedule` (Pseudocode):**

```php
// 1. Cek apakah jam saat ini ada di tabel penjadwalan
$currentHour = date('H:00:00'); // Bulatkan ke jam
$schedule = DB::table('wa_reminder_schedules')
                ->where('execution_time', $currentHour)
                ->where('is_active', true)
                ->first();

if (!$schedule) {
    return response()->json([]); // Kosong, Worker tidak perlu jalan
}

// 2. Ambil Template
$template = DB::table('wa_reminder_templates')->find($schedule->template_id);

// 3. Tarik Toko yang belum lapor (Kueri SQL seperti di penjelasan sebelumnya)
$pendingStores = $this->getStoresWithPendingReportsYesterday();

$readyToSend = [];

// 4. Rakit Pesan
foreach ($pendingStores as $store) {
    $message = str_replace(
        ['{{mention}}', '{{store_name}}', '{{leads}}', '{{paid}}', '{{report_url}}'],
        ['@'.$store->pic_phone, $store->store_name, $store->total_leads, $store->total_paid, 'https://appkamu.com/report?id='.$store->store_id],
        $template->message_content
    );

    $readyToSend[] = [
        'group_id' => $store->fonnte_group_id,
        'message' => $message
    ];
}

return response()->json($readyToSend);
```

---

## 6. Kode Cloudflare Worker (Sangat Ringkas & Universal)

Kode Worker ini tidak mengandung hardcode jam, template, atau logika pengecekan. Ia murni membaca perintah dari Backend Anda.

**`wrangler.toml`**
Atur cron agar berjalan setiap jam pada menit ke-0 (misal: 00:00, 01:00, 02:00, dst). Backend yang akan menolak jika bukan jam pengiriman.
```toml
name = "dynamic-wa-reminder"
main = "src/index.js"
compatibility_date = "2024-01-01"

[triggers]
crons = ["0 * * * *"] # Jalan tiap jam

[vars]
BACKEND_API = "https://appkamu.com/api/internal/check-reminder-schedule"
```

**`src/index.js`**
```javascript
export default {
  async scheduled(event, env, ctx) {
    // 1. Tanya Backend: "Ada pesan yang perlu dikirim jam ini?"
    const res = await fetch(env.BACKEND_API, {
      headers: { "Authorization": `Bearer ${env.SECRET_TOKEN}` }
    });
    const tasks = await res.json();

    if (!tasks || tasks.length === 0) return; // Tidak ada tugas

    // 2. Eksekusi pengiriman ke Fonnte
    for (const task of tasks) {
      await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          "Authorization": env.FONNTE_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          target: task.group_id,
          message: task.message,
          countryCode: "62"
        })
      });

      await new Promise(r => setTimeout(r, 2000)); // Jeda 2 detik
    }
  }
};
```

---

## 7. Rangkuman Keuntungan Pendekatan Dinamis

1.  **Tanpa Deploy Ulang:** Jika ingin mengubah kata-kata, menambah grup target, atau mengganti jadwal pengiriman dari jam 09:00 menjadi 09:30, Anda hanya perlu merubahnya di Dashboard. Cloudflare Worker tidak perlu di-deploy atau diedit ulang.
2.  **Pemeliharaan Terpusat:** Logika deteksi laporan, penggabungan placeholder teks, dan manajemen jadwal dikelola di bahasa pemrograman Backend Anda (PHP/Node.js) yang jauh lebih familiar untuk di-maintain.
3.  **Skalabilitas:** Sistem ini siap menangani puluhan hingga ratusan advertiser karena logika pembagian *(batching)* dapat diatur secara fleksibel di sisi Backend.