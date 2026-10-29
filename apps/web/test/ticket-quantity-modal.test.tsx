// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TicketQuantityModal, type PendingTickets } from '../src/pages/scanner/ScanQrPage'

/**
 * A61: dialog jumlah tiket untuk order multi-tiket.
 *
 * Yang dijaga: default adalah sisa tiket, operator bisa memilih lebih sedikit,
 * dan mode Scanner Stick memberi peringatan bahwa keyboard diabaikan.
 */
const PROMPT: PendingTickets = {
  orderId: '283033796',
  source: 'qr',
  name: 'Ahmad',
  session: 'S1',
  quantity: 4,
  checkedIn: 0,
  remaining: 4,
}

afterEach(() => cleanup())

describe('TicketQuantityModal', () => {
  it('default = sisa tiket, lalu konfirmasi jumlah pilihan', () => {
    const onConfirm = vi.fn()

    render(<TicketQuantityModal prompt={PROMPT} busy={false} onConfirm={onConfirm} onCancel={() => {}} />)

    expect(screen.getByText(/Order ini/)).toBeDefined()
    expect(screen.getByTestId('ticket-quantity-modal')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi 2 tiket' }))

    expect(onConfirm).toHaveBeenCalledWith(2)
  })

  it('tidak menampilkan apa pun tanpa prompt', () => {
    const { container } = render(
      <TicketQuantityModal prompt={null} busy={false} onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(container.textContent).toBe('')
  })

  it('mode Scanner Stick memberi peringatan keyboard diabaikan', () => {
    render(
      <TicketQuantityModal
        prompt={PROMPT}
        busy={false}
        scannerStick
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByText(/Ketikan alat berikutnya diabaikan/)).toBeDefined()
  })
})
