import { SESSION_CODES } from '@dvflow/shared'
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
  description: 'Kode produk/event yang dikenali parser. Standar: tepat 4 huruf kapital (mis. BOMM, KULI).',
  tableName: 'products',
  readColumns: 'id,name,code,active',
  identityKey: 'code',
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
  columns: CODE_COLUMNS,
  render: CODE_RENDER,
}

export const ADVERTISER_SPEC: ConfigSpec = {
  resource: 'advertisers',
  title: 'Pengiklan',
  description: 'Kode pengiklan yang dikenali parser. Standar: tepat 2 digit angka (mis. 01, 02).',
  tableName: 'advertisers',
  readColumns: 'id,name,code,active',
  identityKey: 'code',
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
  columns: CODE_COLUMNS,
  render: CODE_RENDER,
}

export const EVENT_TYPE_SPEC: ConfigSpec = {
  resource: 'event-types',
  title: 'Type',
  description: 'Jenis acara. `kind` inilah yang menentukan Seminar Offline / Webinar Online pada order (PRD §60).',
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
      label: 'Kind',
      type: 'select',
      initial: 'seminar',
      options: [
        { value: 'seminar', label: 'seminar → Seminar Offline' },
        { value: 'webinar', label: 'webinar → Webinar Online' },
      ],
      help: 'Menentukan status acara pada order. Mengganti nama baris ini tidak mengubah order yang sudah ada.',
    },
  ],
  columns: [...CODE_COLUMNS, { key: 'kind', header: 'Kind', minWidth: 100 }],
  render: { ...CODE_RENDER, kind: (row: ConfigRow) => String(row['kind'] ?? '-') },
}

export const SESSION_SPEC: ConfigSpec = {
  resource: 'sessions',
  title: 'Sesi',
  description: '9 Sesi paten (ST, S1 - S8) yang dikenali parser (PRD §61).',
  tableName: 'sessions_config',
  readColumns: 'id,name,code,active',
  identityKey: 'code',
  fields: [CODE_FIELDS[0]!, { key: 'code', label: 'Kode sesi', type: 'select', initial: 'ST', options: SESSION_CODES.map((code) => ({ value: code, label: code })) }],
  columns: CODE_COLUMNS,
  render: CODE_RENDER,
}

export const FEE_RULE_SPEC: ConfigSpec = {
  resource: 'payment-fee-rules',
  title: 'Fee Rule',
  description:
    'Aturan tax/fee per identifier pembayaran. Identifier diisi persis seperti yang diterima dari webhook (PRD §75–§77).',
  tableName: 'payment_fee_rules',
  readColumns: 'id,name,identifier,fee_type,fee_value,active',
  identityKey: 'identifier',
  fields: [
    { key: 'name', label: 'Nama', maxLength: 200, type: 'text', initial: '', placeholder: 'mis. Admin Bank Transfer' },
    {
      key: 'identifier',
      label: 'Identifier / Mapping Payment',
      type: 'text',
      initial: '',
      placeholder: 'mis. bank_transfer',
      help: 'Harus sama persis dengan identifier yang dikirim webhook (hanya besar/kecil huruf dan spasi tepi yang diabaikan).',
    },
    {
      key: 'fee_type',
      label: 'Type',
      type: 'select',
      initial: 'flat',
      options: [
        { value: 'flat', label: 'Flat' },
        { value: 'percentage', label: 'Percentage' },
      ],
    },
    {
      key: 'fee_value',
      label: 'Value',
      type: 'number',
      initial: '',
      placeholder: 'mis. 4000 atau 0.7',
      help: 'Untuk percentage, isi angka persen: 0.7 berarti 0,7%.',
    },
  ],
  columns: [
    { key: 'name', header: 'Nama', minWidth: 180 },
    { key: 'identifier', header: 'Identifier', minWidth: 170 },
    { key: 'fee_type', header: 'Type', minWidth: 110 },
    { key: 'fee_value', header: 'Value', align: 'right', minWidth: 100 },
    { key: 'active', header: 'Status', minWidth: 100 },
  ],
  render: {
    name: (row) => String(row['name'] ?? '-'),
    identifier: (row) => CodeCell(row, 'identifier'),
    fee_type: (row) => String(row['fee_type'] ?? '-'),
    fee_value: (row) => String(row['fee_value'] ?? '-'),
    active: (row) => ActiveBadge(row),
  },
}
