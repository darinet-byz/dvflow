import { KNOWN_PAYMENT_IDENTIFIERS, SESSION_CODES } from '@dvflow/shared'
import { Badge } from '../../ui/Badge'
import type { ConfigRow, ConfigSpec } from './ConfigSection'

/**
 * Spesifikasi kelima sumber daya konfigurasi (PRD §57–§61, §74–§77).
 *
 * Dikumpulkan di satu berkas supaya perbedaannya terlihat sekaligus: kode
 * (produk, pengiklan, event type, sesi) memakai `code`, sedangkan fee rule
 * memakai `identifier` + tipe + nilai.
 *
 * Urutan dan nama fieldnya mengikuti sumber: §58/§59 "Nama Produk/Nama + Kode",
 * §60 "Seminar Offline → SO", §61 "Sesi 1 → S1", §75/§77 "Nama | Identifier /
 * Mapping Payment | Type | Value | Active".
 */

function ActiveBadge(row: ConfigRow) {
  return row['active'] === true ? <Badge tone="success">Aktif</Badge> : <Badge tone="neutral">Nonaktif</Badge>
}

function ProductStatusBadge(row: ConfigRow) {
  const status = String(row['status'] ?? '-')
  const tone: 'success' | 'warning' | 'primary' | 'neutral' = status === 'Active' ? 'success'
    : status === 'On-Hold' ? 'warning'
    : status === 'Upcoming' ? 'primary'
    : 'neutral'
  return <Badge tone={tone}>{status}</Badge>
}

function AdvertiserStatusBadge(row: ConfigRow) {
  const status = String(row['status'] ?? '-')
  const tone: 'success' | 'primary' | 'warning' | 'danger' = status === 'In-House' ? 'success'
    : status === 'Freelance' ? 'primary'
    : status === 'Intern' ? 'warning'
    : 'danger'
  return <Badge tone={tone}>{status}</Badge>
}

function CodeCell(row: ConfigRow, key: string) {
  return <span className="font-mono">{String(row[key] ?? '-')}</span>
}

const CODE_FIELDS = [
  { key: 'name', label: 'Nama', maxLength: 200, type: 'text' as const, initial: '', placeholder: 'mis. Kuliner Masteri' },
  {
    key: 'code',
    label: 'Kode',
    type: 'text' as const,
    initial: '',
    placeholder: 'mis. KM',
    help: 'Hanya huruf dan angka, tanpa spasi — pemisah " - " pada nama produk harus tetap tidak ambigu.',
  },
]

const CODE_COLUMNS = [
  { key: 'name', header: 'Nama', minWidth: 200 },
  { key: 'code', header: 'Kode', minWidth: 100 },
  { key: 'active', header: 'Status', minWidth: 100 },
]

const CODE_RENDER = {
  name: (row: ConfigRow) => String(row['name'] ?? '-'),
  code: (row: ConfigRow) => CodeCell(row, 'code'),
  active: (row: ConfigRow) => ActiveBadge(row),
}

export const PRODUCT_SPEC: ConfigSpec = {
  resource: 'products',
  title: 'Produk',
  tableName: 'products',
  readColumns: 'id,name,code,active,status',
  identityKey: 'code',
  statusManaged: true,
  fields: [
    { key: 'name', label: 'Nama', maxLength: 200, type: 'text' as const, initial: '', placeholder: 'mis. Kuliner Masteri' },
    {
      key: 'code',
      label: 'Kode',
      type: 'text' as const,
      initial: '',
      placeholder: 'mis. BOMM',
      maxLength: 4,
      transform: (v: string) => v.toUpperCase(),
      help: 'Tepat 4 huruf kapital (mis. BOMM, KULI).',
    },
  ],
  columns: [...CODE_COLUMNS.filter((column) => column.key !== 'active'), { key: 'status', header: 'Status', minWidth: 120 }],
  render: { ...CODE_RENDER, status: ProductStatusBadge },
}

export const ADVERTISER_SPEC: ConfigSpec = {
  resource: 'advertisers',
  title: 'Pengiklan',
  tableName: 'advertisers',
  readColumns: 'id,name,code,active,status',
  identityKey: 'code',
  statusManaged: true,
  fields: [
    { key: 'name', label: 'Nama', maxLength: 200, type: 'text' as const, initial: '', placeholder: 'mis. Zul' },
    {
      key: 'code',
      label: 'Kode',
      type: 'text' as const,
      initial: '',
      placeholder: 'mis. 01',
      maxLength: 2,
      transform: (v: string) => v.replace(/\D/g, ''),
      help: 'Tepat 2 digit angka numerik (mis. 01, 02, 99).',
    },
  ],
  columns: [...CODE_COLUMNS.filter((column) => column.key !== 'active'), { key: 'status', header: 'Status', minWidth: 120 }],
  render: { ...CODE_RENDER, status: AdvertiserStatusBadge },
}

const KIND_LABELS = {
  seminar: 'Offline — tiket QR + check-in di lokasi',
  webinar: 'Online — diarahkan ke link Zoom',
  hybrid: 'Hybrid — tiket QR di lokasi + link Zoom',
} as const

export const EVENT_TYPE_SPEC: ConfigSpec = {
  resource: 'event-types',
  title: 'Type',
  tableName: 'event_types',
  readColumns: 'id,name,code,kind,active',
  identityKey: 'code',
  fields: [
    { key: 'name', label: 'Nama', maxLength: 200, type: 'text' as const, initial: '', placeholder: 'mis. Seminar Offline' },
    {
      key: 'code',
      label: 'Kode',
      type: 'text' as const,
      initial: '',
      placeholder: 'mis. SO',
      maxLength: 2,
      transform: (v: string) => v.toUpperCase(),
      help: 'Tepat 2 huruf kapital (mis. SO, WO).',
    },
    {
      key: 'kind',
      label: 'Cara Hadir',
      type: 'select',
      initial: 'seminar',
      // Nilai tersimpan tetap seminar/webinar (02 §event_types); hanya label yang netral,
      // karena tipe seperti Workshop juga memakai salah satu dari dua alur ini.
      options: [
        { value: 'seminar', label: KIND_LABELS.seminar },
        { value: 'webinar', label: KIND_LABELS.webinar },
        { value: 'hybrid', label: KIND_LABELS.hybrid },
      ],
      help: 'Menentukan alur peserta Paid: tiket QR + check-in di lokasi, link Zoom, atau keduanya (Hybrid) dengan satu Order ID.',
    },
  ],
  columns: [...CODE_COLUMNS, { key: 'kind', header: 'Cara Hadir', minWidth: 160 }],
  render: {
    ...CODE_RENDER,
    kind: (row: ConfigRow) => KIND_LABELS[String(row['kind']) as keyof typeof KIND_LABELS] ?? String(row['kind'] ?? '-'),
  },
}

export const SESSION_SPEC: ConfigSpec = {
  resource: 'sessions',
  title: 'Sesi',
  tableName: 'sessions_config',
  readColumns: 'id,name,code,active',
  identityKey: 'code',
  fields: [CODE_FIELDS[0]!, { key: 'code', label: 'Kode sesi', type: 'select', initial: 'ST', options: SESSION_CODES.map((code) => ({ value: code, label: code })) }],
  columns: CODE_COLUMNS,
  render: CODE_RENDER,
}

/** Rp / % dengan format Indonesia untuk kolom fee. */
function formatFee(type: unknown, value: unknown, flat?: unknown): string {
  if (type === null || type === undefined || value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (type === 'percentage_flat') return `${n.toLocaleString('id-ID')}% + Rp${Number(flat ?? 0).toLocaleString('id-ID')}`
  return type === 'percentage' ? `${n.toLocaleString('id-ID')}%` : `Rp${n.toLocaleString('id-ID')}`
}

/** Persen dan flat (field form) -> kolom API. Kosong dibaca 0; nilai tidak valid diteruskan agar server menolaknya. */
export function feeColumnsFromParts(percentRaw: unknown, flatRaw: unknown): Record<string, unknown> {
  const read = (value: unknown) => (value === '' || value === undefined || value === null ? 0 : value)
  const percent = read(percentRaw)
  const flat = read(flatRaw)
  if (typeof percent !== 'number' || typeof flat !== 'number') return { fee_type: 'flat', fee_value: percent, fee_flat_value: flat }
  if (percent > 0 && flat > 0) return { fee_type: 'percentage_flat', fee_value: percent, fee_flat_value: flat }
  if (percent > 0) return { fee_type: 'percentage', fee_value: percent, fee_flat_value: 0 }
  return { fee_type: 'flat', fee_value: flat, fee_flat_value: 0 }
}

const FEE_TYPE_OPTIONS = [
  { value: 'flat', label: 'Flat (Rp)' },
  { value: 'percentage', label: 'Persentase (%)' },
] as const

export const FEE_RULE_SPEC: ConfigSpec = {
  resource: 'payment-fee-rules',
  title: 'Metode Pembayaran',
  tableName: 'payment_fee_rules',
  readColumns: 'id,name,identifier,fee_type,fee_value,fee_flat_value,platform_fee_applies,epayment_tax_type,epayment_tax_value,active',
  identityKey: 'identifier',
  order: KNOWN_PAYMENT_IDENTIFIERS.map((item) => item.code),
  activeToggle: true,
  fromRow: (row) => {
    const type = row['fee_type']
    const value = String(row['fee_value'] ?? 0)
    if (type === 'percentage') return { fee_percent: value, fee_flat: '0' }
    if (type === 'percentage_flat') return { fee_percent: value, fee_flat: String(row['fee_flat_value'] ?? 0) }
    return { fee_percent: '0', fee_flat: value }
  },
  toBody: ({ fee_percent, fee_flat, ...rest }) => ({ ...rest, ...feeColumnsFromParts(fee_percent, fee_flat) }),
  fields: [
    { key: 'name', label: 'Nama', maxLength: 200, type: 'text', initial: '', placeholder: 'mis. VA BCA' },
    {
      key: 'identifier',
      label: 'Kode Metode Bayar (OrderOnline)',
      type: 'select',
      initial: 'bank_transfer',
      // Kode persis yang dikirim webhook: payment.method (bank_transfer) atau payment.channels (e-payment).
      options: KNOWN_PAYMENT_IDENTIFIERS.map((item) => ({ value: item.code, label: `${item.code} — ${item.label}` })),
    },
    {
      key: 'platform_fee_applies',
      label: 'Kena Platform Fee',
      type: 'checkbox',
      initial: 'false',
      help: 'Centang untuk e-payment (VA, QRIS, e-wallet). Bank transfer jangan dicentang.',
    },
    // Dua field dengan arti tetap (A16): tidak ada lagi satu "Nilai" yang artinya berubah menurut tipe.
    {
      key: 'fee_percent',
      label: 'E-payment Fee — Persen (%)',
      type: 'number',
      initial: '0',
      placeholder: 'mis. 0.7',
      help: 'Persen dari nominal order. 0.7 berarti 0,7%. Isi 0 bila tidak ada.',
    },
    {
      key: 'fee_flat',
      label: 'E-payment Fee — Flat (Rp)',
      type: 'number',
      initial: '0',
      placeholder: 'mis. 4000',
      help: 'Rupiah per order. Bisa digabung dengan persen. Isi 0 bila tidak ada.',
    },
    {
      key: 'epayment_tax_type',
      label: 'E-payment Fee Tax — Tipe',
      type: 'select',
      initial: '',
      options: [{ value: '', label: 'Tidak ada' }, ...FEE_TYPE_OPTIONS],
    },
    {
      key: 'epayment_tax_value',
      label: 'E-payment Fee Tax — Nilai',
      type: 'number',
      initial: '',
      placeholder: 'mis. 1',
      help: 'Persentase dihitung dari E-payment Fee (mis. PPN 1% untuk VA). Kosongkan bila tipe "Tidak ada".',
    },
  ],
  columns: [
    { key: 'name', header: 'Nama', minWidth: 160 },
    { key: 'identifier', header: 'Identifier', minWidth: 150 },
    { key: 'fee', header: 'E-payment Fee', align: 'right', minWidth: 120 },
    { key: 'epayment_tax', header: 'E-payment Fee Tax', align: 'right', minWidth: 130 },
    { key: 'platform_fee_applies', header: 'Platform Fee', minWidth: 110 },
  ],
  render: {
    name: (row) => String(row['name'] ?? '-'),
    identifier: (row) => CodeCell(row, 'identifier'),
    fee: (row) => formatFee(row['fee_type'], row['fee_value'], row['fee_flat_value']),
    epayment_tax: (row) => formatFee(row['epayment_tax_type'], row['epayment_tax_value']),
    platform_fee_applies: (row) => (row['platform_fee_applies'] === true ? 'Ya' : 'Tidak'),
    active: (row) => ActiveBadge(row),
  },
}
