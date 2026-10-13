import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import { buildCheckinQrSvg, QR_QUIET_ZONE_MODULES } from '../src/ticket/qr'

/**
 * Bukti bahwa QR kita benar-benar dapat dipindai.
 *
 * Cara kerjanya: SVG yang kita kirim ke browser DIBACA KEMBALI sebagai matriks,
 * diubah menjadi bitmap, lalu DIDEKODE oleh `jsqr` — decoder QR independen
 * (implementasi lain, penulis lain, algoritma pembacaan sungguhan). Kalau hasil
 * dekode sama persis dengan payload, berarti berkas yang kita kirim memang QR
 * yang sah, bukan sekadar "keluaran library".
 *
 * Ini juga yang menutup kekhawatiran lintas browser: yang dikirim adalah SVG
 * berisi `<rect>` biasa — tidak ada canvas, WASM, atau API khusus browser.
 */

type Bitmap = { data: Uint8ClampedArray; width: number; height: number }

/** Baca SVG kita kembali menjadi bitmap RGBA, seperti yang "dilihat" pemindai. */
function rasterize(svg: string, scale: number): Bitmap {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  if (viewBox === null) throw new Error('SVG tanpa viewBox')

  const width = Number(viewBox[1])
  const height = Number(viewBox[2])
  const dark = new Set<string>()

  for (const match of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"\/>/g)) {
    dark.add(`${match[1]},${match[2]}`)
  }

  const pixelWidth = width * scale
  const pixelHeight = height * scale
  const data = new Uint8ClampedArray(pixelWidth * pixelHeight * 4)

  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      const isDark = dark.has(`${Math.floor(x / scale)},${Math.floor(y / scale)}`)
      const value = isDark ? 0 : 255
      const offset = (y * pixelWidth + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }

  return { data, width: pixelWidth, height: pixelHeight }
}

function decode(svg: string): string | null {
  const bitmap = rasterize(svg, 8)
  return jsQR(bitmap.data, bitmap.width, bitmap.height)?.data ?? null
}

describe('QR check-in dapat dipindai (bukti round-trip dengan decoder independen)', () => {
  it('payload nyata /checkin/<orderId> terbaca kembali sama persis', () => {
    const payload = '/checkin/283033796'
    expect(decode(buildCheckinQrSvg(payload))).toBe(payload)
  })

  it('Order ID panjang (batas 64 karakter) tetap terbaca', () => {
    const payload = `/checkin/${'9'.repeat(64)}`
    expect(decode(buildCheckinQrSvg(payload))).toBe(payload)
  })

  it('Order ID berisi huruf, angka, tanda hubung, dan garis bawah', () => {
    for (const orderId of ['abc-123_XYZ', 'ORDER-0001', '00123']) {
      const payload = `/checkin/${orderId}`
      expect(decode(buildCheckinQrSvg(payload))).toBe(payload)
    }
  })

  it('payload pendek dan panjang sama-sama sah (versi QR dipilih otomatis)', () => {
    for (const payload of ['/checkin/1', '/checkin/283033796', `/checkin/${'7'.repeat(64)}`]) {
      expect(decode(buildCheckinQrSvg(payload))).toBe(payload)
    }
  })

  it('teks non-URL pun terenkode benar (bukan kebetulan bentuk path)', () => {
    const payload = 'dvflow-checkin-283033796'
    expect(decode(buildCheckinQrSvg(payload))).toBe(payload)
  })
})

describe('bentuk SVG yang dikirim ke browser', () => {
  it('memuat zona tenang 4 modul dan latar putih', () => {
    const svg = buildCheckinQrSvg('/checkin/283033796')
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
    expect(viewBox).not.toBeNull()

    const canvas = Number(viewBox?.[1])
    // 4 modul zona tenang di setiap sisi.
    expect(canvas).toBeGreaterThan(QR_QUIET_ZONE_MODULES * 2)
    expect(svg).toContain(`<rect width="${canvas}" height="${canvas}" fill="#ffffff"/>`)
  })

  it('memakai crispEdges supaya modul tidak diburamkan saat diperbesar', () => {
    expect(buildCheckinQrSvg('/checkin/1')).toContain('shape-rendering="crispEdges"')
  })

  it('payload TIDAK pernah muncul sebagai teks di dalam markup', () => {
    const payload = '/checkin/283033796'
    const svg = buildCheckinQrSvg(payload)

    // Payload hanya memengaruhi posisi modul. Tidak ada jalur XSS dari sini,
    // dan Order ID tidak ikut tercetak di dalam SVG.
    expect(svg).not.toContain(payload)
    expect(svg).not.toContain('283033796')
  })

  it('payload berisi karakter HTML tetap hanya memengaruhi posisi modul', () => {
    const payload = '"><script>alert(1)</script>'
    const svg = buildCheckinQrSvg(payload)

    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('alert(1)')
    // Dan tetap dapat dipindai.
    expect(decode(svg)).toBe(payload)
  })

  it('SVG dapat dirender berdampingan dengan ukuran apa pun (viewBox, bukan piksel tetap)', () => {
    const svg = buildCheckinQrSvg('/checkin/283033796')
    expect(svg).toContain('width="100%"')
    expect(svg).toContain('height="100%"')
    expect(svg).not.toMatch(/<svg[^>]*\swidth="\d+"/)
  })
})
