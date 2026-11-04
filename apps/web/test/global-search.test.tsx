// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({
    status: 'authenticated',
    profile: {
      user_id: 'u1',
      username: 'tiket',
      display_name: 'Tiket',
      role: 'member',
      avatar_emoji: null,
      permissions: ['config.tiket'],
    },
  }),
}))

const { GlobalSearchDialog } = await import('../src/layout/GlobalSearch')

afterEach(cleanup)

function open(): void {
  act(() => window.dispatchEvent(new Event('dvflow:open-global-search')))
}

describe('Pencarian menu global', () => {
  it('mencari fitur berdasarkan nama/kata kunci dan menghormati izin role', () => {
    render(
      <MemoryRouter>
        <GlobalSearchDialog />
      </MemoryRouter>,
    )

    open()
    const input = screen.getByLabelText('Cari menu atau fitur')
    fireEvent.change(input, { target: { value: 'tiket' } })

    expect(screen.getByText('Konfigurasi Barcode / Tiket')).toBeTruthy()
    // Role ini hanya boleh membuka config.tiket; menu lain tidak muncul.
    expect(screen.queryByText('Order')).toBeNull()
    expect(screen.queryByText('Dashboard')).toBeNull()
  })
})
