import QRCode from 'qrcode'

/**
 * QR check-in halaman peserta.
 *
 * Kenapa SVG, bukan canvas atau gambar:
 *   * SVG adalah markup biasa — setiap browser modern merendernya tanpa API
 *     tambahan, tanpa canvas, tanpa WASM, tanpa `toDataURL`;
 *   * satu `<rect>` per modul gelap membuatnya dapat DIPERIKSA: test membaca
 *     kembali markup ini, menyusun ulang matriksnya, lalu MEMBACA QR-nya dengan
 *     decoder independen (`jsqr`). Jadi yang diuji adalah berkas yang benar-benar
 *     dikirim ke browser, bukan sekadar "library-nya seharusnya benar";
 *   * `shapeRendering="crispEdges"` mencegah modul ikut diburamkan saat
 *     diperbesar — QR yang buram adalah penyebab umum gagal pindai.
 *
 * Kontrak yang dijaga: QR dibuat di BROWSER. Worker/backend tidak pernah
 * membuat gambar QR (PRD §94, CLAUDE.md §4).
 */

/** Elemen di halaman tiket tempat QR dipasang. */
export const CHECKIN_QR_ELEMENT_ID = 'checkin-qr'

/** Atribut pada elemen itu yang memuat payload check-in. */
export const CHECKIN_QR_PAYLOAD_ATTRIBUTE = 'data-checkin-payload'

/**
 * Level koreksi galat M (≈15%).
 *
 * QR ini ditampilkan di layar ponsel lalu dipindai ponsel lain, sering dengan
 * pantulan cahaya. M adalah keseimbangan lazim antara ketahanan dan ukuran;
 * level M juga dipakai contoh-contoh standar sehingga hasilnya mudah dibandingkan.
 */
export const QR_ERROR_CORRECTION_LEVEL = 'M' as const

/** Zona tenang minimum yang disyaratkan spec adalah 4 modul. */
export const QR_QUIET_ZONE_MODULES = 4

export type QrSvgOptions = {
  quietZoneModules?: number
}

/**
 * Susun SVG QR dari payload.
 *
 * Fungsi ini murni: tidak menyentuh DOM, tidak butuh canvas. Payload hanya
 * memengaruhi POSISI modul — tidak pernah masuk ke markup sebagai teks — jadi
 * tidak ada jalur XSS dari sini.
 */
export function buildCheckinQrSvg(payload: string, options: QrSvgOptions = {}): string {
  const quietZone = options.quietZoneModules ?? QR_QUIET_ZONE_MODULES
  const qr = QRCode.create(payload, { errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL })

  const moduleCount = qr.modules.size
  const modules = qr.modules.data
  const canvas = moduleCount + quietZone * 2

  const rects: string[] = []
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (modules[row * moduleCount + column] !== 1) continue
      rects.push(`<rect x="${column + quietZone}" y="${row + quietZone}" width="1" height="1"/>`)
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}"`,
    ` width="100%" height="100%" role="img" aria-label="Kode QR check-in"`,
    ` shape-rendering="crispEdges">`,
    `<rect width="${canvas}" height="${canvas}" fill="#ffffff"/>`,
    `<g fill="#000000">`,
    rects.join(''),
    `</g></svg>`,
  ].join('')
}

/**
 * Pasang QR ke halaman tiket.
 *
 * Dipanggil oleh skrip kecil yang dirujuk halaman tiket
 * (`/assets/ticket-qr.js`). Bila elemennya tidak ada atau payloadnya kosong,
 * tidak ada yang dilakukan — halaman tetap berguna tanpa QR, karena Order ID
 * sudah tercetak besar di sana untuk check-in manual.
 */
export function mountCheckinQr(doc: Document = document): boolean {
  const container = doc.getElementById(CHECKIN_QR_ELEMENT_ID)
  if (container === null) return false

  const payload = container.getAttribute(CHECKIN_QR_PAYLOAD_ATTRIBUTE)
  if (payload === null || payload.trim() === '') return false

  container.innerHTML = buildCheckinQrSvg(payload.trim())
  container.setAttribute('data-qr-ready', 'true')
  return true
}
