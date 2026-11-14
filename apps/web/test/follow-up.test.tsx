// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { authorizedRequest } from '../src/lib/session'
import { supabaseSelect } from '../src/lib/supabase-rest'
import { FollowUpModal } from '../src/pages/order/FollowUpModal'
import { FollowUpTemplatePage } from '../src/pages/follow-up/FollowUpTemplatePage'
import type { OrderRow } from '../src/lib/queries'

vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn() }))
vi.mock('../src/lib/supabase-rest', () => ({ supabaseSelect: vi.fn(), supabaseRpc: vi.fn() }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

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

const CONTEXT = {
  order: {
    order_id: 'MTIX-283818331',
    name: 'Budi Santoso',
    phone: '0812-3456-7890',
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
  templates: [
    { slot: 1, body: 'Halo {nama}, ini {jenis} {produk}. Link: {link}' },
    { slot: 2, body: 'Reminder batch {batch} sesi {sesi}.' },
  ],
  marks: [],
  template_updated: { at: '2026-11-14T03:00:00.000Z', by: 'Admin Satu' },
}

function mockContext(context = CONTEXT): void {
  vi.mocked(authorizedRequest).mockImplementation(async (path, options) => {
    if (typeof path === 'string' && path.endsWith('/follow-up') && options?.method === 'POST') {
      return { order_id: 'MTIX-283818331', slot: (options.body as { slot: number }).slot, used_at: '2026-11-14T05:00:00.000Z', used_by_name: 'Admin Satu' }
    }
    if (typeof path === 'string' && path.endsWith('/follow-up')) return context
    return {}
  })
}

describe('Follow Up Manual (A76)', () => {
  it('menampilkan bubble, preview, dan membuka api.whatsapp.com saat Kirim', async () => {
    mockContext()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    render(<FollowUpModal order={ORDER} onClose={() => {}} />)

    expect(await screen.findByText('Master Tiktok Indonesia')).toBeDefined()
    expect(screen.getByText(/Workshop/)).toBeDefined()
    expect(screen.getByText('6281234567890')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'F1' }))
    const preview = screen.getByText(/Halo Budi Santoso, ini Workshop Master Tiktok Indonesia/)
    expect(preview).toBeDefined()
    expect(preview.textContent).toContain('/access/MTIX/283818331')

    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    const openedUrl = String(open.mock.calls[0]?.[0] ?? '')
    expect(openedUrl.startsWith('https://api.whatsapp.com/send?phone=6281234567890&text=')).toBe(true)
    expect(openedUrl.includes('wa.me')).toBe(false)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'F1' }).className).toContain('bg-success-soft')
    })
  })

  it('order OTS tidak mengisi link tiket', async () => {
    mockContext({
      ...CONTEXT,
      order: { ...CONTEXT.order, order_id: 'OTS-000009', is_ots: true, event_type: 'Seminar Offline' },
      event_type: { code: 'SO', name: 'Seminar Offline' },
      templates: [{ slot: 1, body: 'Halo {nama}. Link: {link}' }],
    })
    render(<FollowUpModal order={{ ...ORDER, order_id: 'OTS-000009' }} onClose={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: 'F1' }))
    const preview = screen.getByText(/Halo Budi Santoso\. Link:/)
    expect(preview.textContent).not.toContain('/access/')
  })

  it('menampilkan arahan bila template belum diatur', async () => {
    mockContext({ ...CONTEXT, templates: [] })
    render(<FollowUpModal order={ORDER} onClose={() => {}} />)

    expect(await screen.findByText(/Belum ada template untuk produk ini/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Atur di Template Follow Up' })).toBeDefined()
  })
})

describe('Template Follow Up (A76)', () => {
  it('memuat template per produk + jenis acara dan menyimpannya', async () => {
    vi.mocked(supabaseSelect).mockResolvedValue([{ code: 'MTIX', name: 'Master Tiktok Indonesia', active: true }])
    vi.mocked(authorizedRequest).mockImplementation(async (path, options) => {
      if (path === '/api/follow-up-templates' && options?.method === 'PUT') return { saved: true }
      if (typeof path === 'string' && path.startsWith('/api/follow-up-templates')) {
        return {
          product: { code: 'MTIX', name: 'Master Tiktok Indonesia' },
          event_types: [
            { id: 'et-so', code: 'SO', name: 'Seminar Offline', kind: 'seminar', active: true },
            { id: 'et-ws', code: 'WS', name: 'Workshop', kind: 'hybrid', active: true },
          ],
          templates: [
            { event_type_id: 'et-ws', slot: 1, body: 'Halo {nama}', updated_at: '2026-11-14T03:00:00.000Z' },
          ],
        }
      }
      return {}
    })

    render(<FollowUpTemplatePage />)

    expect(await screen.findByLabelText('F1')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Jenis Acara'), { target: { value: 'WS' } })
    await waitFor(() => expect((screen.getByLabelText('F1') as HTMLTextAreaElement).value).toBe('Halo {nama}'))

    fireEvent.change(screen.getByLabelText('F2'), { target: { value: 'Reminder {batch}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Template' }))

    await waitFor(() => {
      expect(vi.mocked(authorizedRequest)).toHaveBeenCalledWith('/api/follow-up-templates', expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ productCode: 'MTIX', eventTypeCode: 'WS' }),
      }))
    })
  })
})
