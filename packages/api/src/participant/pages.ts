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
 * `connect-src 'self'` hanya untuk skrip yang sama memeriksa ulang halaman tiket ini
 * (GET tanpa efek samping) agar QR berganti stempel sesudah check-in (A19).
 * Tidak ada `img-src` atau `frame-src`: QR-nya SVG inline buatan skrip di atas.
 */
const TICKET_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"
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
  /** Catatan opsional dari Konfigurasi Tiket (A19: satu-satunya isi aturan tiket). */
  notes?: string | null
  /** Jumlah tiket order (A19, `orders.quantity`). */
  quantity: number
  /** Payload yang nantinya diubah menjadi QR di browser (03 §8, 05 §G03). */
  checkinPath: string
  alreadyCheckedIn?: boolean
  checkedInAt?: string | null
  /** Hybrid: jalur Zoom pada link yang sama (`?via=zoom`); null bila link Zoom belum dikonfigurasi. */
  zoomPath?: string | null
}

export function formatCheckinTime(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null
  try {
    const d = new Date(isoDate)
    if (Number.isNaN(d.getTime())) return null
    return (
      d.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }) + ' WIB'
    )
  } catch {
    return isoDate
  }
}

/**
 * Tiket peserta (A19). Urutan tetap: nama, Order ID (sekali), produk, batch, kota, sesi,
 * catatan, QR, jumlah tiket. Sesudah check-in semua info tetap; hanya QR yang diganti stempel.
 */
export function renderTicketPage(data: TicketData): Response {
  const rows: Array<[string, string | null]> = [
    ['Produk', data.productName],
    ['Batch', data.batch],
    ['Kota', data.city],
    ['Sesi', data.session],
    ['Catatan', data.notes ?? null],
  ]

  const formattedDate = formatCheckinTime(data.checkedInAt)

  const qrOrStamp = data.alreadyCheckedIn
    ? `
      <div class="stamp" role="status">
        <span class="stamp-mark">✓</span>
        <span class="stamp-text">CHECK-IN BERHASIL</span>
        ${formattedDate ? `<span class="stamp-time">${escapeHtml(formattedDate)}</span>` : ''}
      </div>`
    : `
      <div
        id="${CHECKIN_QR_ELEMENT_ID}"
        class="qr"
        data-checkin-payload="${escapeHtml(data.checkinPath)}"
      ></div>
      <p class="hint">Tunjukkan QR ini kepada panitia saat masuk.</p>`

  const scriptTag = data.alreadyCheckedIn ? '' : `
    <script src="${TICKET_QR_SCRIPT_PATH}" defer></script>`

  const body = `
    <header>
      <h1 class="name">${escapeHtml(data.participantName ?? 'Peserta')}</h1>
      <p class="order">Order ID <strong>${escapeHtml(data.orderId)}</strong></p>
    </header>

    <section class="card">
      <dl>
        ${rows
          .filter(([, value]) => value !== null && value !== '')
          .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value as string)}</dd>`)
          .join('\n        ')}
      </dl>
    </section>

    <section class="card checkin" data-checked-in="${data.alreadyCheckedIn ? 'true' : 'false'}">${qrOrStamp}
      <p class="quantity"><strong>${data.quantity}</strong> TIKET</p>
    </section>
${data.zoomPath ? `
    <a class="btn-zoom" href="${escapeHtml(data.zoomPath)}" rel="noopener">JOIN SECARA ONLINE (ZOOM)</a>` : ''}

    <footer>Simpan halaman ini sampai acara selesai.</footer>${scriptTag}
  `

  return htmlResponse(200, 'Tiket Peserta', body, TICKET_CSP)
}

const WEBINAR_PENDING_MESSAGE =
  'Halo, Link Zoom akan bisa diakses mendekati jadwal pelaksanaan webinar. Jadi tenang saja yaa 😊'

/**
 * Maskot DVFLOW dari halaman login (`apps/web/src/ui/LoginMascot.tsx`), tanpa logo
 * Meta Ads dan partikel di sekitarnya. Murni SVG + animasi CSS: lolos `ERROR_CSP`
 * karena tidak memuat skrip maupun gambar eksternal.
 */
const MASCOT_SVG = `<svg class="mascot" viewBox="26 10 128 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="mascotBody" x1="40" y1="40" x2="130" y2="140" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#EEF2F9"/>
    </linearGradient>
    <linearGradient id="mascotAccent" x1="50" y1="30" x2="110" y2="100" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6366F1"/><stop offset="100%" stop-color="#4F46F5"/>
    </linearGradient>
    <filter id="mascotShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#1e293b" flood-opacity="0.1"/>
    </filter>
  </defs>
  <ellipse cx="85" cy="122" rx="38" ry="5" fill="#cbd5e1" opacity="0.35"/>
  <g class="m-float">
    <path d="M58 48 C50 30, 60 18, 72 32 Z" fill="url(#mascotAccent)" stroke="#4338CA" stroke-width="2" stroke-linejoin="round"/>
    <path d="M62 44 C56 32, 63 25, 70 34 Z" fill="#F472B6" opacity="0.8"/>
    <path d="M112 48 C120 30, 110 18, 98 32 Z" fill="url(#mascotAccent)" stroke="#4338CA" stroke-width="2" stroke-linejoin="round"/>
    <path d="M108 44 C114 32, 107 25, 100 34 Z" fill="#F472B6" opacity="0.8"/>
    <line x1="85" y1="35" x2="85" y2="22" stroke="#4F46F5" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="85" cy="19" r="4.5" fill="#38BDF8" class="m-sparkle"/>
    <circle cx="85" cy="19" r="2.5" fill="#FFFFFF"/>
    <rect x="48" y="36" width="74" height="70" rx="30" fill="url(#mascotBody)" stroke="#CBD5E1" stroke-width="2.5" filter="url(#mascotShadow)"/>
    <rect x="63" y="76" width="44" height="23" rx="10" fill="#F1F5F9" stroke="#E2E8F0" stroke-width="1.5"/>
    <path d="M85 83 C82 80, 77 82, 78 86 C79 89, 85 92, 85 92 C85 92, 91 89, 92 86 C93 82, 88 80, 85 83 Z" fill="#4F46F5"/>
    <ellipse cx="61" cy="65" rx="5" ry="3" fill="#FDA4AF" opacity="0.85"/>
    <ellipse cx="109" cy="65" rx="5" ry="3" fill="#FDA4AF" opacity="0.85"/>
    <g class="m-blink">
      <ellipse cx="71" cy="58" rx="5" ry="6.5" fill="#1E293B"/>
      <circle cx="69" cy="56" r="2" fill="#FFFFFF"/><circle cx="73" cy="61" r="0.8" fill="#FFFFFF"/>
      <ellipse cx="99" cy="58" rx="5" ry="6.5" fill="#1E293B"/>
      <circle cx="97" cy="56" r="2" fill="#FFFFFF"/><circle cx="101" cy="61" r="0.8" fill="#FFFFFF"/>
    </g>
    <path d="M80 66 Q85 71 90 66" stroke="#1E293B" stroke-width="2" stroke-linecap="round" fill="none"/>
    <g class="m-wave">
      <path d="M48 80 C36 78, 30 68, 36 60 C40 56, 46 64, 49 72 Z" fill="url(#mascotBody)" stroke="#CBD5E1" stroke-width="2"/>
    </g>
    <path d="M120 78 C132 75, 142 66, 146 54 C148 50, 140 48, 134 56 C128 62, 122 70, 118 75 Z" fill="url(#mascotBody)" stroke="#CBD5E1" stroke-width="2"/>
    <rect x="62" y="103" width="16" height="8" rx="4" fill="#E2E8F0"/>
    <rect x="92" y="103" width="16" height="8" rx="4" fill="#E2E8F0"/>
  </g>
</svg>`

const MASCOT_STYLE = `
  .mascot { display: block; width: 128px; height: 120px; margin: 8px auto 4px; }
  .mascot .m-float { animation: m-float 4.5s ease-in-out infinite; }
  .mascot .m-blink { transform-box: fill-box; transform-origin: center; animation: m-blink 4s ease-in-out infinite; }
  .mascot .m-wave { transform-box: fill-box; transform-origin: 100% 85%; animation: m-wave 2.8s ease-in-out infinite; }
  .mascot .m-sparkle { transform-box: fill-box; transform-origin: center; animation: m-sparkle 2.2s ease-in-out infinite; }
  @keyframes m-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
  @keyframes m-blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } }
  @keyframes m-wave { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-14deg); } 75% { transform: rotate(14deg); } }
  @keyframes m-sparkle { 0%, 100% { opacity: .2; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.2); } }
  @media (prefers-reduced-motion: reduce) { .mascot * { animation: none !important; } }
  .pending { text-align: center; }
  .pending .card p { margin: 0; font-size: 15px; }
`

/**
 * Webinar Paid yang link Zoom-nya belum dikonfigurasi (kode `WEBINAR_DESTINATION_NOT_CONFIGURED`).
 *
 * Peserta sudah lolos cek order + Paid + produk valid, jadi halaman ini menenangkan,
 * bukan menyalahkan: nama + Order ID menunjukkan tiketnya sah. Status tetap 503 dan
 * pemanggil tidak mencatat presensi (01 §15).
 */
export function renderWebinarPendingPage(data: { orderId: string; participantName: string | null }): Response {
  const body = `
    <div class="pending">
      ${MASCOT_SVG}
      <h1 class="name">${escapeHtml(data.participantName ?? 'Peserta')}</h1>
      <p class="order">Order ID <strong>${escapeHtml(data.orderId)}</strong></p>
      <section class="card">
        <p>${escapeHtml(WEBINAR_PENDING_MESSAGE)}</p>
      </section>
    </div>
  `

  return htmlResponse(503, 'Link Zoom belum dibuka', body, ERROR_CSP, MASCOT_STYLE)
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
    title: 'Link Zoom belum dibuka',
    message: WEBINAR_PENDING_MESSAGE,
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

function htmlResponse(
  status: number,
  title: string,
  body: string,
  contentSecurityPolicy: string,
  extraStyle = '',
): Response {
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
  .name { margin: 0 0 6px; font-size: 28px; line-height: 1.2; word-break: break-word; }
  .checkin { text-align: center; }
  .checkin .hint { margin: 12px 0 0; }
  .stamp {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
    width: 100%; max-width: 260px; aspect-ratio: 1 / 1; margin: 0 auto;
    border: 4px solid #35c96c; border-radius: 18px; background: #e6f7ec; color: #0e8345;
    transform: rotate(-4deg);
  }
  .stamp-mark { font-size: 44px; font-weight: 700; line-height: 1; }
  .stamp-text { font-size: 22px; font-weight: 800; letter-spacing: .04em; }
  .stamp-time { font-size: 13px; font-weight: 600; color: #171821; }
  .quantity { margin: 16px 0 0; font-size: 18px; font-weight: 700; letter-spacing: .06em; color: #4f46f5; }
  .quantity strong { font-size: 40px; margin-right: 4px; }
  .btn-zoom { display: block; margin-top: 16px; padding: 16px 20px; border-radius: 10px; background: #4f46f5; color: #fff; font-size: 16px; font-weight: 800; letter-spacing: .02em; text-align: center; text-decoration: none; }
  .btn-zoom:hover { background: #4338e8; }
  footer { margin-top: 20px; font-size: 12px; color: #737786; text-align: center; }${extraStyle}
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
