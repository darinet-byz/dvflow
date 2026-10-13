/**
 * Halaman peserta (03 §8, §15; PRD §89, §93).
 *
 * Halaman ini SENGAJA minimal dan berdiri sendiri — bukan bagian dari design
 * system dashboard admin (STATE.md K3: "halaman tiket ringan terpisah"). Yang
 * membukanya adalah peserta di lapangan, sering dari ponsel dan kadang dengan
 * koneksi buruk, jadi tidak ada aset eksternal, tidak ada framework, dan tidak
 * ada permintaan jaringan tambahan.
 *
 * Keamanan yang dijaga:
 *   * seluruh data peserta di-escape (04 §9) — nama/kota berasal dari webhook,
 *     yaitu input paling tidak terpercaya di sistem ini (L07);
 *   * `Content-Security-Policy` ketat tanpa `script-src` sama sekali (04 §9);
 *   * halaman hanya memuat data minimum: nama, Order ID, dan data acara.
 *     Email dan nomor WA tidak pernah ditampilkan (04 §12);
 *   * tidak ada aksi admin di rute peserta (04 §12).
 */

/**
 * CSP halaman peserta.
 *
 * Dua bentuk, dan bedanya disengaja:
 *   * halaman tiket memuat SATU skrip same-origin (`script-src 'self'`) untuk
 *     menggambar QR di browser. Tanpa `'unsafe-inline'` dan tanpa `'unsafe-eval'`;
 *   * halaman error tidak memuat skrip sama sekali.
 *
 * Tidak ada `img-src`, `connect-src`, atau `frame-src`: halaman ini tidak perlu
 * memuat atau menghubungi apa pun. QR-nya SVG inline buatan skrip di atas.
 */
const TICKET_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'"
const ERROR_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

/**
 * Path skrip QR, relatif terhadap origin yang sama.
 *
 * Dipaku bersama `apps/web/vite.config.ts`, yang membangun entry `ticket-qr`
 * menjadi berkas ini. Bila salah satu berubah, yang lain harus ikut.
 */
export const TICKET_QR_SCRIPT_PATH = '/assets/ticket-qr.js'

/** Elemen tempat skrip QR memasang SVG-nya (`apps/web/src/ticket/qr.ts`). */
export const CHECKIN_QR_ELEMENT_ID = 'checkin-qr'

export type TicketData = {
  orderId: string
  participantName: string | null
  eventType: string
  productName: string | null
  advertiserName: string | null
  batch: string | null
  session: string | null
  city: string | null
  venue?: string | null
  schedule?: string | null
  notes?: string | null
  /** Payload yang nantinya diubah menjadi QR di browser (03 §8, 05 §G03). */
  checkinPath: string
}

export function renderTicketPage(data: TicketData): Response {
  const rows: Array<[string, string | null]> = [
    ['Produk', data.productName],
    ['Pengiklan', data.advertiserName],
    ['Batch', data.batch],
    ['Sesi', data.session],
    ['Kota', data.city],
    ['Lokasi', data.venue ?? null],
    ['Jadwal', data.schedule ?? null],
    ['Catatan', data.notes ?? null],
  ]

  const body = `
    <header>
      <p class="eyebrow">Tiket Peserta</p>
      <h1>${escapeHtml(data.participantName ?? 'Peserta')}</h1>
      <p class="order">Order ID <strong>${escapeHtml(data.orderId)}</strong></p>
    </header>

    <section class="card">
      <p class="event">${escapeHtml(data.eventType)}</p>
      <dl>
        ${rows
          .filter(([, value]) => value !== null && value !== '')
          .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value as string)}</dd>`)
          .join('\n        ')}
      </dl>
    </section>

    <section class="card checkin">
      <p class="event">Check-in panitia</p>
      <div
        id="${CHECKIN_QR_ELEMENT_ID}"
        class="qr"
        data-checkin-payload="${escapeHtml(data.checkinPath)}"
      ></div>
      <p class="hint">
        Tunjukkan kode QR di atas kepada panitia. Bila kamera panitia bermasalah,
        sebutkan Order ID di bawah — panitia dapat mencarinya secara manual.
      </p>
      <p class="payload">${escapeHtml(data.orderId)}</p>
    </section>

    <footer>Simpan halaman ini sampai acara selesai.</footer>
    <script src="${TICKET_QR_SCRIPT_PATH}" defer></script>
  `

  return htmlResponse(200, 'Tiket Peserta', body, TICKET_CSP)
}

/** Kode error halaman peserta (03 §15). */
export type ParticipantErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_PAID'
  | 'INVALID_EVENT_PRODUCT'
  | 'WEBINAR_DESTINATION_NOT_CONFIGURED'
  | 'GENERIC_ACCESS_ERROR'

const ERROR_PAGES: Record<ParticipantErrorCode, { status: number; title: string; message: string }> = {
  ORDER_NOT_FOUND: {
    status: 404,
    title: 'Tiket tidak ditemukan',
    message: 'Order ID ini tidak terdaftar. Periksa kembali tautan dari OrderOnline.',
  },
  ORDER_NOT_PAID: {
    status: 403,
    title: 'Pembayaran belum selesai',
    message: 'Akses acara hanya terbuka untuk order yang sudah lunas.',
  },
  INVALID_EVENT_PRODUCT: {
    status: 403,
    title: 'Data acara tidak dikenali',
    message: 'Produk pada order ini tidak dapat dipetakan ke acara mana pun. Hubungi panitia.',
  },
  WEBINAR_DESTINATION_NOT_CONFIGURED: {
    status: 503,
    title: 'Tautan acara belum siap',
    message: 'Tautan acara ini belum dikonfigurasi. Hubungi panitia.',
  },
  GENERIC_ACCESS_ERROR: {
    status: 500,
    title: 'Terjadi kesalahan',
    message: 'Permintaan Anda tidak dapat diproses saat ini. Coba beberapa saat lagi.',
  },
}

/**
 * Halaman error peserta.
 *
 * Hanya memuat Order ID yang memang sudah dipegang peserta; tidak ada stack
 * trace, nama tabel, atau ID internal lain (03 §15).
 */
export function renderErrorPage(code: ParticipantErrorCode, orderId: string | null = null): Response {
  const page = ERROR_PAGES[code]
  const body = `
    <header>
      <p class="eyebrow">Tiket Peserta</p>
      <h1>${escapeHtml(page.title)}</h1>
    </header>
    <section class="card">
      <p>${escapeHtml(page.message)}</p>
      ${orderId === null ? '' : `<p class="order">Order ID <strong>${escapeHtml(orderId)}</strong></p>`}
    </section>
    <footer>Jika menurut Anda ini keliru, hubungi panitia acara.</footer>
  `

  return htmlResponse(page.status, page.title, body, ERROR_CSP)
}

function htmlResponse(status: number, title: string, body: string, contentSecurityPolicy: string): Response {
  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 24px 16px 40px; max-width: 480px;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 14px; line-height: 1.5; color: #171821; background: #f7f8fc;
  }
  .eyebrow { margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #737786; }
  h1 { margin: 4px 0 8px; font-size: 22px; font-weight: 700; }
  .order { margin: 0; color: #737786; }
  .order strong { color: #171821; font-size: 15px; }
  .card { margin-top: 16px; padding: 16px; background: #fff; border: 1px solid #eceef4; border-radius: 18px; }
  .event { margin: 0 0 10px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #4f46f5; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
  dt { color: #737786; }
  dd { margin: 0; font-weight: 600; }
  .hint { margin: 12px 0 12px; color: #737786; }
  .qr { width: 100%; max-width: 260px; aspect-ratio: 1 / 1; margin: 0 auto; background: #fff; }
  .qr svg { display: block; width: 100%; height: 100%; }
  .payload { margin: 0; font-size: 30px; font-weight: 700; letter-spacing: .06em; text-align: center; }
  footer { margin-top: 20px; font-size: 12px; color: #737786; text-align: center; }
</style>
</head>
<body>
${body}
</body>
</html>`

  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': contentSecurityPolicy,
      // Halaman peserta tidak boleh di-cache: status order bisa berubah.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  })
}

/**
 * Escape HTML (04 §9).
 *
 * Nama peserta, kota, dan nama produk berasal dari webhook — input tak
 * terpercaya. React otomatis meng-escape, tetapi halaman ini dirender sebagai
 * HTML, jadi escaping-nya harus eksplisit (L07).
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
