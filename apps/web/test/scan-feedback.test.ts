import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/lib/api'
import {
  SAME_QR_COOLDOWN_MS,
  fromCheckinError,
  fromCheckinSuccess,
  fromScannerTestQr,
  fromUnknownQr,
  isScannerTestQr,
  SCANNER_TEST_QR_PAYLOAD,
  shouldProcessQr,
  type CheckinResponse,
} from '../src/pages/scanner/scan-feedback'

/**
 * Apa yang dibaca panitia di lapangan (PRD §96, §98, §101).
 *
 * Pesan dan warnanya diuji di sini karena inilah satu-satunya umpan balik yang
 * diterima operator: kalau "sudah check-in" terlihat sama dengan "ditolak",
 * panitia akan menahan peserta yang sebenarnya sudah tercatat.
 */

const BASE: CheckinResponse = {
  state: 'CHECKIN_SUCCESS',
  order_id: '283033796',
  name: 'Ahmad',
  event_type: 'Seminar Offline',
  session: 'S1',
  clicked_at: '2026-10-13T09:00:00.000Z',
  attendance_id: 'att-1',
  scanner: { user_id: 'user-1', display_name: 'Operator Satu' },
}

describe('hasil check-in', () => {
  it('berhasil -> hijau, dengan nama dan waktu dari server', () => {
    const outcome = fromCheckinSuccess(BASE)

    expect(outcome.tone).toBe('success')
    expect(outcome.title).toBe('Check-in berhasil')
    expect(outcome.name).toBe('Ahmad')
    expect(outcome.orderId).toBe('283033796')
    expect(outcome.clickedAt).toBe('2026-10-13T09:00:00.000Z')
    expect(outcome.alert).toBe(false)
  })

  it('A19: jumlah tiket dari server ditampilkan', () => {
    expect(fromCheckinSuccess({ ...BASE, quantity: 4 }).quantity).toBe(4)
    expect(fromUnknownQr('x').quantity).toBeNull()
  })

  it('A61: check-in sebagian menampilkan tiket baru diverifikasi dan sisanya', () => {
    const outcome = fromCheckinSuccess({
      ...BASE,
      quantity: 4,
      tickets_confirmed: 2,
      checked_in_tickets: 2,
      remaining_tickets: 2,
    })

    expect(outcome.tone).toBe('success')
    expect(outcome.ticketsConfirmed).toBe(2)
    expect(outcome.checkedInTickets).toBe(2)
    expect(outcome.remainingTickets).toBe(2)
    expect(outcome.detail).toContain('sisa 2 tiket')
  })

  it('A61: tiket terakhir -> detail menyebut semua tiket sudah hadir', () => {
    const outcome = fromCheckinSuccess({
      ...BASE,
      quantity: 4,
      tickets_confirmed: 2,
      checked_in_tickets: 4,
      remaining_tickets: 0,
    })

    expect(outcome.detail).toContain('semua 4 tiket sudah hadir')
    expect(outcome.remainingTickets).toBe(0)
  })

  it('sudah check-in -> kuning, BUKAN merah: bukan kegagalan', () => {
    const outcome = fromCheckinSuccess({ ...BASE, state: 'ALREADY_CHECKED_IN' })

    expect(outcome.tone).toBe('warning')
    expect(outcome.title).toBe('Sudah check-in')
    expect(outcome.alert).toBe(false)
    expect(outcome.quantity).toBe(1)
    // Timestamp yang ditampilkan adalah check-in PERTAMA (01 §13).
    expect(outcome.clickedAt).toBe('2026-10-13T09:00:00.000Z')
  })
})

describe('penolakan check-in', () => {
  it('setiap kode punya judul singkat yang terbaca dari jauh', () => {
    const cases: Array<[string, string]> = [
      ['ORDER_NOT_FOUND', 'Order tidak ditemukan'],
      ['ORDER_NOT_PAID', 'Check-in ditolak'],
      ['NOT_SEMINAR_ORDER', 'Bukan seminar'],
      ['SESSION_INVALID', 'Sesi berakhir'],
    ]

    for (const [code, title] of cases) {
      const outcome = fromCheckinError(new ApiError(code as 'ORDER_NOT_FOUND', 'pesan dari server', 400))
      expect(outcome.tone).toBe('danger')
      expect(outcome.title).toBe(title)
      expect(outcome.detail).toBe('pesan dari server')
      expect(outcome.alert).toBe(true)
    }
  })

  it('galat tak terduga tetap ditolak dengan pesan yang jelas', () => {
    const outcome = fromCheckinError(new Error('boom'))

    expect(outcome.tone).toBe('danger')
    expect(outcome.title).toBe('Gagal')
    expect(outcome.detail).toBe('Check-in tidak dapat diproses.')
  })

  it('QR yang bukan tiket peserta ditolak, isinya ditampilkan terpotong', () => {
    const outcome = fromUnknownQr('https://contoh.example/promo-panjang-sekali-yang-tidak-berakhir')

    expect(outcome.tone).toBe('danger')
    expect(outcome.title).toBe('QR tidak dikenali')
    expect(outcome.detail.length).toBeLessThan(120)
  })
})

describe('jeda QR yang sama (teknis, bukan aturan produk)', () => {
  it('QR pertama selalu diproses', () => {
    expect(shouldProcessQr(null, '283033796', 1000)).toBe(true)
  })

  it('QR yang sama tidak diproses berulang di dalam jeda', () => {
    const previous = { orderId: '283033796', at: 1000 }

    expect(shouldProcessQr(previous, '283033796', 1500)).toBe(false)
    expect(shouldProcessQr(previous, '283033796', 1000 + SAME_QR_COOLDOWN_MS - 1)).toBe(false)
  })

  it('setelah jeda, QR yang sama boleh diproses lagi', () => {
    const previous = { orderId: '283033796', at: 1000 }
    expect(shouldProcessQr(previous, '283033796', 1000 + SAME_QR_COOLDOWN_MS)).toBe(true)
  })

  it('QR peserta LAIN langsung diproses — antrean tidak boleh tersendat', () => {
    const previous = { orderId: '283033796', at: 1000 }
    expect(shouldProcessQr(previous, '111111', 1010)).toBe(true)
  })
})

describe('QR tes scanner (A23)', () => {
  it('dikenali (spasi/huruf kecil toleran), bukan tiket', () => {
    expect(isScannerTestQr(SCANNER_TEST_QR_PAYLOAD)).toBe(true)
    expect(isScannerTestQr(' dvflow-tes-scanner \n')).toBe(true)
    expect(isScannerTestQr('/checkin/283033796')).toBe(false)
  })

  it('hasilnya hijau, tanpa Order ID & tanpa jumlah tiket', () => {
    const outcome = fromScannerTestQr()
    expect(outcome).toMatchObject({ tone: 'success', title: 'QR tes terbaca', orderId: null, clickedAt: null, quantity: null, alert: false })
  })
})

