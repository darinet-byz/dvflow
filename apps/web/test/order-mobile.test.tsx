// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FieldAppContext } from '../src/lib/field-app'
import type { OrderRow } from '../src/lib/queries'

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({ status: 'authenticated', profile: { user_id: '1', role: 'pimpro', permissions: ['operasional.order'], has_all_product_access: true } }),
}))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/queries')>()),
  fetchOrdersPage: vi.fn(),
  fetchConfigLists: vi.fn(async () => ({ products: [], advertisers: [], eventTypes: [], eventTypeNames: [], sessions: [], paymentMethods: [] })),
}))
vi.mock('../src/lib/follow-up', () => ({
  fetchFollowUpSummaries: vi.fn(),
  fetchFollowUpContext: vi.fn(),
  markFollowUpSlot: vi.fn(),
  fetchFollowUpTemplates: vi.fn(),
  saveFollowUpTemplates: vi.fn(),
}))

const { OrderPage } = await import('../src/pages/order/OrderPage')
const { fetchOrdersPage } = await import('../src/lib/queries')
const { fetchFollowUpSummaries, fetchFollowUpContext, markFollowUpSlot } = await import('../src/lib/follow-up')

const ORDER = {
  id: 'o1',
  order_id: 'MTIX-283818331',
  name: 'Budi Santoso',
  phone: '0812-3456-7890',
  email: null,
  product_raw: 'MTIX01WS60 - S1 - Tegal',
  product_parse_status: 'valid',
  product_code: 'MTIX',
  product_name: 'Master Tiktok Indonesia',
  advertiser_code: '01',
  advertiser_name: 'Zul',
  event_type: 'Hybrid',
  batch: '60',
  session: 'S1',
  city: 'Tegal',
  app_status: 'Paid',
  raw_status: 'paid',
  payment_method: null,
  payment_provider: null,
  payment_identifier: null,
  gross_amount: 100000,
  tax_amount: 0,
  net_amount: 100000,
  tax_mapping_status: 'unmapped',
  fee_rule_name_snapshot: null,
  fee_type_snapshot: null,
  fee_value_snapshot: null,
  source_created_at: null,
  source_updated_at: null,
  created_at: '2026-11-14T03:00:00.000Z',
  paid_at: null,
  updated_at: '2026-11-14T03:00:00.000Z',
} as OrderRow

function renderOrder() {
  return render(
    <MemoryRouter>
      <FieldAppContext.Provider value={true}>
        <OrderPage />
      </FieldAppContext.Provider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(fetchOrdersPage).mockResolvedValue({
    rows: [ORDER],
    total: 1,
    summary: { total: 1, paid: 1, pending: 0 },
  })
  vi.mocked(fetchFollowUpSummaries).mockResolvedValue({
    orders: [{ order_id: ORDER.order_id, slots: [1], used: [1], quantity: 1 }],
  })
  vi.mocked(fetchFollowUpContext).mockResolvedValue({
    order: {
      order_id: ORDER.order_id,
      name: ORDER.name,
      phone: ORDER.phone,
      phone_wa: '6281234567890',
      product_code: 'MTIX',
      product_name: 'Master Tiktok Indonesia',
      advertiser_name: 'Zul',
      event_type: 'Hybrid',
      batch: '60',
      session: 'S1',
      city: 'Tegal',
      is_ots: false,
    },
    event_type: { code: 'WS', name: 'Workshop' },
    templates: [{ slot: 1, body: 'Halo {nama}, ini {produk}. {link}' }],
    marks: [{ slot: 1, used_at: '2026-11-14T04:00:00.000Z', used_by_name: 'Admin Satu' }],
    template_updated: null,
  })
  vi.mocked(markFollowUpSlot).mockResolvedValue({
    order_id: ORDER.order_id,
    slot: 2,
    used_at: '2026-11-14T05:00:00.000Z',
    used_by_name: 'Pimpro Satu',
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Order di HP (A77)', () => {
  it('menampilkan kartu ringkas: No, Nama, Jumlah Tiket, Status, produk, sesi, kota', async () => {
    renderOrder()

    expect(await screen.findByText('Budi Santoso')).toBeDefined()
    expect(await screen.findByText('1 tiket')).toBeDefined()
    expect(screen.getByText('Paid')).toBeDefined()
    expect(screen.getByText('Master Tiktok Indonesia')).toBeDefined()
    expect(screen.getByText('Sesi 1')).toBeDefined()
    expect(screen.getByText('Tegal')).toBeDefined()
    // Order ID & No HP tidak lagi di kartu; detailnya ada di drawer.
    expect(screen.queryByText('MTIX-283818331')).toBeNull()
    expect(screen.queryByText('0812-3456-7890')).toBeNull()
  })

  it('menampilkan F1-F4 dan mewarnai slot yang sudah dipakai', async () => {
    renderOrder()

    const f1 = await screen.findByRole('button', { name: 'Follow up F1 MTIX-283818331' })
    await waitFor(() => expect(f1.className).toContain('bg-success-soft'))
    const f2 = screen.getByRole('button', { name: 'Follow up F2 MTIX-283818331' })
    await waitFor(() => expect(f2.className).toContain('border-dashed'))
    expect(screen.getByRole('button', { name: 'Follow up F3 MTIX-283818331' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Follow up F4 MTIX-283818331' })).toBeDefined()
  })

  it('bubble yang punya template membuka preview, yang kosong langsung ke WhatsApp kosong', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    renderOrder()

    fireEvent.click(await screen.findByRole('button', { name: 'Follow up F1 MTIX-283818331' }))
    expect(await screen.findByText(/Halo Budi Santoso, ini Master Tiktok Indonesia/)).toBeDefined()

    fireEvent.click(screen.getAllByRole('button', { name: 'Tutup' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Follow up F2 MTIX-283818331' }))

    await waitFor(() => expect(vi.mocked(markFollowUpSlot)).toHaveBeenCalledWith('MTIX-283818331', 2))
    expect(String(open.mock.calls[0]?.[0] ?? '')).toBe('https://api.whatsapp.com/send?phone=6281234567890')
  })
})
