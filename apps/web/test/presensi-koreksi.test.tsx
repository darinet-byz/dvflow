// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PresensiRow } from '../src/lib/queries'
import { ToastProvider } from '../src/ui/Toast'

/**
 * A62: tombol koreksi manual di drawer Presensi.
 *
 * Yang diuji adalah kontrak UI-nya: tombol muncul sesuai status, dialog memakai
 * jumlah tiket yang benar, dan endpoint yang dipanggil membawa jumlah tersebut.
 * Aturan bisnisnya sendiri diuji di pgTAP/API.
 */

const authorizedRequest = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('../src/lib/session', () => ({ authorizedRequest }))
vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: 'user-1',
      username: 'dev',
      display_name: 'Dev',
      avatar_emoji: null,
      role: 'admin',
      permissions: ['operasional.presensi', 'action.manual_checkin'],
    },
  }),
}))

const { PresensiDetailDrawer } = await import('../src/pages/presensi/PresensiDetailDrawer')

function row(overrides: Partial<PresensiRow> = {}): PresensiRow {
  return {
    order_id: '283033796',
    name: 'Ahmad',
    phone: '+628111',
    product_code: 'KM',
    product_name: 'Kuliner Masteri',
    advertiser_code: '01',
    advertiser_name: 'Zul',
    event_type: 'Seminar Offline',
    batch: '392',
    session: 'S1',
    city: 'Solo',
    product_parse_status: 'valid',
    app_status: 'Paid',
    gross_amount: 200000,
    quantity: 2,
    checked_in_tickets: 1,
    attendance_data_expired: false,
    attendance_status: 'Hadir Sebagian',
    scanner_names: ['Operator Satu'],
    total_activity: 1,
    latest_activity: '2026-10-13T09:00:00.000Z',
    timestamps: ['2026-10-13T09:00:00.000Z'],
    created_at: '2026-10-13T08:00:00.000Z',
    paid_at: '2026-10-13T08:05:00.000Z',
    updated_at: '2026-10-13T08:05:00.000Z',
    ...overrides,
  }
}

function renderDrawer(value: PresensiRow, onChanged = vi.fn()) {
  render(
    <ToastProvider>
      <PresensiDetailDrawer row={value} onClose={() => {}} onChanged={onChanged} />
    </ToastProvider>,
  )
  return onChanged
}

afterEach(() => {
  cleanup()
  authorizedRequest.mockClear()
})

describe('A62: koreksi presensi di drawer', () => {
  it('menampilkan operator dan dua tombol koreksi untuk presensi sebagian', () => {
    renderDrawer(row())
    expect(screen.getByText('Operator Satu')).toBeDefined()
    expect(screen.getByTestId('presensi-correction')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Tandai Hadir' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Batalkan Check-in' })).toBeDefined()
  })

  it('tandai hadir mengirim sisa tiket ke endpoint mark-present', async () => {
    const onChanged = renderDrawer(row())

    fireEvent.click(screen.getByRole('button', { name: 'Tandai Hadir' }))
    expect(screen.getByLabelText(/Jumlah tiket yang ditandai hadir/)).toBeDefined()

    const buttons = screen.getAllByRole('button', { name: 'Tandai Hadir' })
    fireEvent.click(buttons[buttons.length - 1]!)

    await waitFor(() =>
      expect(authorizedRequest).toHaveBeenCalledWith('/api/presensi/283033796/mark-present', {
        method: 'POST',
        body: { tickets: 1 },
      }),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('batalkan check-in mengirim seluruh tiket yang hadir ke endpoint reset', async () => {
    const onChanged = renderDrawer(row({ quantity: 3, checked_in_tickets: 2, attendance_status: 'Hadir Sebagian' }))

    fireEvent.click(screen.getByRole('button', { name: 'Batalkan Check-in' }))
    expect(screen.getByLabelText(/Jumlah tiket yang dikembalikan/)).toBeDefined()

    const buttons = screen.getAllByRole('button', { name: 'Batalkan Check-in' })
    fireEvent.click(buttons[buttons.length - 1]!)

    await waitFor(() =>
      expect(authorizedRequest).toHaveBeenCalledWith('/api/presensi/283033796/reset', {
        method: 'POST',
        body: { tickets: 2 },
      }),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('webinar tidak menampilkan tombol koreksi', () => {
    renderDrawer(row({ event_type: 'Webinar Online', attendance_status: 'Hadir', checked_in_tickets: 2 }))
    expect(screen.queryByTestId('presensi-correction')).toBeNull()
  })
})
