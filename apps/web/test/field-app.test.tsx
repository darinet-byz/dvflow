// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { canUseFieldApp, FieldAppContext } from '../src/lib/field-app'

/** A30: Tampilan Apps Lapangan — hanya Pimpro/Staff/Member berizin, hanya di HP. */
const session = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }))
vi.mock('../src/lib/useSession', () => ({ useSession: () => ({ status: 'authenticated', profile: session.profile }) }))
vi.mock('../src/lib/session', () => ({ authorizedRequest: vi.fn(async () => ({})) }))
vi.mock('../src/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/queries')>()),
  fetchConfigLists: vi.fn(async () => ({ products: [], advertisers: [], eventTypes: [], eventTypeNames: [], sessions: [], paymentMethods: [] })),
  fetchPresensiSummary: vi.fn(async () => ({ paid: 1, sudah_hadir: 1, belum_hadir: 0, attendance_rate: 1 })),
  fetchPresensiPage: vi.fn(async () => ({ total: 1, page: 1, page_size: 50, rows: [{
    order_id: 'OTS-000001', name: 'Siti Aminah', phone: null, product_code: 'KULI', product_name: 'Kuliner Masteri', advertiser_code: null, advertiser_name: null,
    event_type: 'Seminar Offline', batch: '392', session: 'S1', city: 'Solo', product_parse_status: 'valid', app_status: 'Paid', attendance_status: 'Hadir',
    total_activity: 1, latest_activity: '2026-10-17T02:00:00Z', timestamps: ['2026-10-17T02:00:00Z'], created_at: '2026-10-17T02:00:00Z', paid_at: null, updated_at: '2026-10-17T02:00:00Z',
  }] })),
}))

// jsdom tanpa matchMedia/localStorage: tiruan yang bisa diatur per tes.
let phone = true
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: phone, addEventListener: () => {}, removeEventListener: () => {} }) })
const memory = new Map<string, string>()
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k), clear: () => memory.clear(),
} })

const FIELD_PERMS = ['ui.field_app', 'operasional.presensi', 'operasional.scan_qr', 'action.ots', 'action.manual_checkin', 'account.profile']
const profile = (role: string, permissions: string[]) => ({ user_id: '1', username: 'u', display_name: 'Petugas', avatar_emoji: null, role, permissions })

const { AppShell } = await import('../src/layout/AppShell')
const { PresensiPage } = await import('../src/pages/presensi/PresensiPage')

function renderShell(path = '/scan-qr') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<p>isi halaman</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { phone = true; memory.clear() })
afterEach(cleanup)

describe('canUseFieldApp', () => {
  it('hanya pimpro/member yang izinnya dicentang', () => {
    expect(canUseFieldApp(profile('member', ['ui.field_app']))).toBe(true)
    expect(canUseFieldApp(profile('pimpro', ['ui.field_app']))).toBe(true)
    expect(canUseFieldApp(profile('member', ['operasional.scan_qr']))).toBe(false)
    expect(canUseFieldApp(profile('admin', ['ui.field_app']))).toBe(false)
    // Master otomatis punya semua izin, tetapi tetap tampilan web.
    expect(canUseFieldApp(profile('developer', ['ui.field_app']))).toBe(false)
  })
})

describe('AppShell memilih kerangka', () => {
  it('staff berizin di HP -> tab bawah Presensi · OTS · Scan · Cari · Akun, Scan di tengah', () => {
    session.profile = profile('member', FIELD_PERMS)
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Navigasi lapangan' })
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Presensi', 'OTS', 'Scan', 'Cari', 'Akun'])
    expect(screen.queryByRole('button', { name: 'Buka menu' })).toBeNull()
  })

  it('tab tanpa izin tidak tampil', () => {
    session.profile = profile('member', ['ui.field_app', 'operasional.scan_qr', 'operasional.presensi'])
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Navigasi lapangan' })
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Presensi', 'Scan', 'Akun'])
  })

  it('halaman di luar tab (mis. Dashboard) diarahkan ke Scan', () => {
    session.profile = profile('member', FIELD_PERMS)
    renderShell('/')
    expect(screen.getByText('Scan Tiket')).toBeDefined()
  })

  it.each([
    ['admin di HP', () => { session.profile = profile('admin', FIELD_PERMS) }],
    ['staff di desktop', () => { session.profile = profile('member', FIELD_PERMS); phone = false }],
    ['staff tanpa izin', () => { session.profile = profile('member', ['operasional.scan_qr']) }],
  ])('%s -> tampilan web biasa', (_name, arrange) => {
    arrange()
    renderShell()
    expect(screen.queryByTestId('field-app-shell')).toBeNull()
  })

  it('"tampilan web lengkap" disimpan per perangkat dan bisa kembali', () => {
    session.profile = profile('member', FIELD_PERMS)
    memory.set('dvflow.preferWebLayout', '1')
    renderShell()
    expect(screen.queryByTestId('field-app-shell')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tampilan aplikasi' }))
    expect(screen.getByTestId('field-app-shell')).toBeDefined()
  })
})

describe('Presensi di mode lapangan', () => {
  it('kartu, bukan tabel; filter dilipat', async () => {
    session.profile = profile('member', FIELD_PERMS)
    render(
      <MemoryRouter>
        <FieldAppContext.Provider value={true}>
          <PresensiPage />
        </FieldAppContext.Provider>
      </MemoryRouter>,
    )
    const cards = await screen.findByTestId('presensi-cards')
    expect(within(cards).getByText('Siti Aminah')).toBeDefined()
    expect(within(cards).getByText(/OTS-000001 · OTS/)).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByTestId('standard-filter-bar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    expect(screen.getByTestId('standard-filter-bar')).toBeDefined()
  })
})
