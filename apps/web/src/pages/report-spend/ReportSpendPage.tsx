import { useEffect, useState } from 'react'
import { AD_SPEND_INPUT_PERMISSION } from '@dvflow/shared'
import { presetRange } from '../../lib/date-range'
import { activeCommonFilters, EMPTY_COMMON_FILTERS, toFilterArgs, type CommonFilters } from '../../lib/filters'
import { formatCount, formatDate, formatMoney, formatText } from '../../lib/format'
import { authorizedRequest } from '../../lib/session'
import { supabaseRpc } from '../../lib/supabase-rest'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { useSession } from '../../lib/useSession'
import { PageHeader } from '../../layout/PageHeader'
import { Badge, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, KpiCard } from '../../ui/Card'
import { Combobox } from '../../ui/Combobox'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Select, TextInput } from '../../ui/Field'
import { FilterChip } from '../../ui/Filters'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, TableTotalRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import { DateRangeField } from '../shared/DateRangeField'
import { AdvertiserFilter, BatchFilter, DateRangeFilters, EventTypeFilter, ProductFilter } from '../shared/FilterControls'
import { useFilterState } from '../shared/useFilterState'

/**
 * Report Spend Iklan (A37/A87).
 *
 * Satu card = satu pengiklan + produk + batch + jenis acara. Card berisi banyak baris
 * budget; tiap baris punya tanggal, spend, dan PPN sendiri. Leads/Paid/Omzet/Tiket TIDAK
 * disimpan: RPC `ad_spend_report` menghitungnya live dari order dengan produk + pengiklan +
 * batch + jenis acara yang sama. Order dihitung sekali per card, bukan sekali per baris.
 */
export type SpendLine = {
  id: string
  date_from: string
  date_to: string
  spend: number | string
  tax_percent: number | string
  tax_amount: number | string
}

export type SpendCard = {
  id: string
  name: string
  status: 'berjalan' | 'selesai'
  date_from: string | null
  date_to: string | null
  product_code: string
  product_name: string
  advertiser_code: string
  advertiser_name: string
  batch: string
  event_type: string | null
  /** Spend sebelum PPN, jumlah semua baris. */
  spend: number | string
  tax_percent: number | string
  tax_amount: number | string
  /** Spend + PPN: dasar Profit/Boncos. */
  total_spend: number | string
  leads: number
  paid: number
  tickets: number
  omzet: number | string
  own: boolean
  can_edit: boolean
  spends: SpendLine[]
}

type SpendReport = {
  summary: {
    reports: number
    spend: number | string
    tax_amount: number | string
    total_spend: number | string
    leads: number
    paid: number
    omzet: number | string
  }
  cards: SpendCard[]
  rows: SpendCard[]
  sessions: SessionMatrix
  comparison?: SpendComparison
}

/** Tiket Paid per sesi × pengiklan (A43), dari order yang sama dengan card. */
export type SessionMatrixRow = {
  session: string | null
  city: string | null
  event_type: string | null
  tickets: number
  advertisers: { advertiser_code: string | null; tickets: number }[]
}

type SessionMatrix = {
  tickets: number
  advertisers: { advertiser_code: string | null; advertiser_name: string | null; tickets: number }[]
  rows: SessionMatrixRow[]
}

/** A46: roll-up per produk + batch + jenis acara + pengiklan. */
export type ComparisonRow = {
  product_code: string
  product_name: string
  batch: string
  event_type?: string | null
  advertiser_code: string
  advertiser_name: string
  spend: number | string
  tax_amount: number | string
  total_spend: number | string
  leads: number
  paid: number
  tickets: number
  omzet: number | string
}

export type SpendComparison = {
  totals: {
    spend: number | string
    tax_amount: number | string
    total_spend: number | string
    leads: number
    paid: number
    tickets: number
    omzet: number | string
  }
  rows: ComparisonRow[]
}

type ComparisonSort = 'tickets' | 'omzet' | 'profit' | 'roi' | 'spend'

const EVENT_TYPE_OPTIONS = [
  { value: 'Seminar Offline', label: 'Seminar Offline' },
  { value: 'Webinar Online', label: 'Webinar Online' },
  { value: 'Hybrid', label: 'Hybrid' },
] as const

type SpendDraft = {
  /** ID stabil untuk React; tidak dikirim ke server. */
  key: string
  /** ID baris di database; null untuk baris baru. */
  id: string | null
  dateFrom: string
  dateTo: string
  spend: string
  taxPercent: string
}

type CardFormState = {
  id: string | null
  name: string
  productCode: string
  batch: string
  eventType: string
  status: 'berjalan' | 'selesai'
  spends: SpendDraft[]
  canEdit: boolean
}

const COLUMNS: readonly TableColumn[] = [
  { key: 'name', header: 'Nama Card', minWidth: 190 },
  { key: 'date', header: 'Data Terlapor', minWidth: 170 },
  { key: 'product', header: 'Produk', minWidth: 160 },
  { key: 'advertiser', header: 'Pengiklan', minWidth: 130 },
  { key: 'batch', header: 'Batch', minWidth: 80 },
  { key: 'event_type', header: 'Jenis', minWidth: 130 },
  { key: 'spend', header: 'Spend', align: 'right', minWidth: 130 },
  { key: 'tax', header: 'PPN', align: 'right', minWidth: 130 },
  { key: 'total_spend', header: 'Total Spend', align: 'right', minWidth: 140 },
  { key: 'leads', header: 'Leads', align: 'right', minWidth: 80 },
  { key: 'paid', header: 'Paid', align: 'right', minWidth: 80 },
  { key: 'tickets', header: 'Total Tiket', align: 'right', minWidth: 110 },
  { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
  { key: 'profit', header: 'Profit / Boncos', align: 'right', minWidth: 140 },
  { key: 'roi', header: '%', align: 'right', minWidth: 80 },
]
const ACTION_COLUMN: TableColumn = { key: 'actions', header: 'Aksi', minWidth: 150 }

const COMPARISON_COLUMNS: readonly TableColumn[] = [
  { key: 'advertiser', header: 'Pengiklan', minWidth: 160 },
  { key: 'spend', header: 'Spend', align: 'right', minWidth: 140 },
  { key: 'total_spend', header: 'Total Spend', align: 'right', minWidth: 140 },
  { key: 'leads', header: 'Leads', align: 'right', minWidth: 80 },
  { key: 'paid', header: 'Paid', align: 'right', minWidth: 80 },
  { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 90 },
  { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
  { key: 'profit', header: 'Profit / Boncos', align: 'right', minWidth: 140 },
  { key: 'roi', header: '%', align: 'right', minWidth: 80 },
  { key: 'cost_ticket', header: 'Cost/Tiket', align: 'right', minWidth: 110 },
  { key: 'share', header: 'Share Tiket', align: 'right', minWidth: 100 },
]

/** Tiket pengiklan di satu sesi; pengiklan tanpa order Paid di sesi itu = 0. */
export function sessionMatrixCell(row: SessionMatrixRow, advertiserCode: string | null): number {
  return row.advertisers.find((item) => item.advertiser_code === advertiserCode)?.tickets ?? 0
}

function matrixColumns(matrix: SessionMatrix): TableColumn[] {
  return [
    { key: 'city', header: 'Kota', minWidth: 130 },
    { key: 'session', header: 'Sesi', minWidth: 80 },
    { key: 'event_type', header: 'Jenis', minWidth: 130 },
    ...matrix.advertisers.map((item): TableColumn => ({
      key: `adv-${item.advertiser_code ?? ''}`,
      header: item.advertiser_name ? `${item.advertiser_name} (${item.advertiser_code ?? '-'})` : (item.advertiser_code ?? 'Tanpa pengiklan'),
      align: 'right',
      minWidth: 110,
    })),
    { key: 'tickets', header: 'Total', align: 'right', minWidth: 90 },
  ]
}

/** Report spend umumnya untuk H-1 (keputusan pengguna A37). */
function yesterday() {
  return presetRange('yesterday')
}

/** Profit/Boncos = Omzet − Total Spend (spend + PPN). */
export function spendProfit(omzet: number | string, spend: number | string): number {
  return Number(omzet) - Number(spend)
}

/** Persentase Profit/Boncos terhadap Total Spend; spend 0 tidak punya persentase ("-"). */
export function formatSpendRoi(omzet: number | string, spend: number | string): string {
  const base = Number(spend)
  if (!Number.isFinite(base) || base <= 0) return '-'
  const pct = (spendProfit(omzet, spend) / base) * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

/** "6.000.000" / "6000000" / "Rp 6.000.000" → 6000000. Kosong atau bukan angka → null. */
export function parseSpendInput(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '')
  if (digits === '') return null
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : null
}

/** "11" / "11,5" / "11%" → 11 / 11.5. Kosong, bukan angka, atau di luar 0–100 → null. */
export function parseTaxPercent(value: string): number | null {
  const cleaned = value.replace('%', '').replace(',', '.').trim()
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return parsed <= 100 ? parsed : null
}

/** PPN iklan per baris budget, sama dengan pembulatan di RPC `ad_spend_report`. */
export function spendTax(spend: number, taxPercent: number): number {
  return Math.round(spend * taxPercent) / 100
}

function formatPercent(value: number | string): string {
  return `${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`
}

function describeDates(from: string | null, to: string | null): string {
  if (from === null || to === null || from === '' || to === '') return '-'
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`
}

function profitTone(value: number): string {
  if (value > 0) return 'text-success'
  if (value < 0) return 'text-danger'
  return ''
}

function profitClass(value: number): string {
  const tone = profitTone(value)
  return tone === '' ? '' : `font-semibold ${tone}`
}

let draftCounter = 0
function draftKey(): string {
  draftCounter += 1
  return `spend-draft-${draftCounter}`
}

function newDraft(from?: string, to?: string): SpendDraft {
  const range = from !== undefined && to !== undefined ? { from, to } : yesterday()
  return { key: draftKey(), id: null, dateFrom: range.from, dateTo: range.to, spend: '', taxPercent: '' }
}

function draftFromLine(line: SpendLine): SpendDraft {
  return {
    key: draftKey(),
    id: line.id,
    dateFrom: line.date_from,
    dateTo: line.date_to,
    spend: String(Number(line.spend)),
    taxPercent: String(Number(line.tax_percent)),
  }
}

function draftTax(draft: SpendDraft): { spend: number; taxPercent: number; tax: number; total: number } | null {
  const spend = parseSpendInput(draft.spend)
  const taxPercent = parseTaxPercent(draft.taxPercent)
  if (spend === null || taxPercent === null) return null
  const tax = spendTax(spend, taxPercent)
  return { spend, taxPercent, tax, total: spend + tax }
}

function formTotals(spends: SpendDraft[]): { spend: number; tax: number; total: number } {
  return spends.reduce(
    (total, draft) => {
      const line = draftTax(draft)
      if (line === null) return total
      return { spend: total.spend + line.spend, tax: total.tax + line.tax, total: total.total + line.total }
    },
    { spend: 0, tax: 0, total: 0 },
  )
}

function cardDateLabel(card: SpendCard): string {
  return describeDates(card.date_from, card.date_to)
}

function cardLineCount(card: SpendCard): number {
  return card.spends.length
}

function cardTaxLabel(card: SpendCard): string {
  if (card.spends.length === 1) return formatPercent(card.spends[0]?.tax_percent ?? 0)
  return `${card.spends.length} budget`
}

function formFromCard(card: SpendCard): CardFormState {
  return {
    id: card.id,
    name: card.name,
    productCode: card.product_code,
    batch: card.batch,
    eventType: card.event_type ?? '',
    status: card.status,
    spends: card.spends.length > 0
      ? card.spends.map(draftFromLine)
      // Template dari order: baris pertama mengikuti rentang order card, bukan tanggal acak.
      : [card.date_from !== null && card.date_to !== null ? newDraft(card.date_from, card.date_to) : newDraft()],
    canEdit: card.can_edit,
  }
}

export function ReportSpendPage() {
  const session = useSession()
  const profile = session.profile
  const toast = useToast()
  const ownAdvertiser = profile?.advertiser_code ?? null
  const permissions = profile?.permissions ?? []
  const canInput = ownAdvertiser !== null && permissions.includes(AD_SPEND_INPUT_PERMISSION)

  // Hanya dipakai sebagai nilai awal (useState); filter bertanggal tidak memicu default "Hari Ini".
  const initialRange = yesterday()
  const state = useFilterState<CommonFilters>(
    { ...EMPTY_COMMON_FILTERS, dateFrom: initialRange.from, dateTo: initialRange.to },
    { storageKey: 'report-spend' },
  )
  const { lists } = useConfigLists()
  const [refresh, setRefresh] = useState(0)

  const appliedKey = JSON.stringify(state.applied)
  const { data, loading, error, reload } = useAsyncData(() => {
    const args = toFilterArgs(state.applied)
    return supabaseRpc<SpendReport>('ad_spend_report', {
      p_date_from: args['p_date_from'],
      p_date_to: args['p_date_to'],
      p_product_code: args['p_product_code'],
      p_advertiser_code: args['p_advertiser_code'],
      p_batch: args['p_batch'],
      p_event_type: args['p_event_type'],
    })
  }, [appliedKey, refresh])

  const [showMore, setShowMore] = useState(false)
  const [form, setForm] = useState<CardFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<SpendCard | null>(null)
  const [comparisonSort, setComparisonSort] = useState<ComparisonSort>('tickets')

  function openCreate(): void {
    setForm({
      id: null,
      name: '',
      productCode: state.applied.productCode,
      batch: state.applied.batch.trim(),
      eventType: state.applied.eventType,
      status: 'berjalan',
      spends: [newDraft()],
      canEdit: true,
    })
    setFormError(null)
  }

  function openCard(card: SpendCard): void {
    setForm(formFromCard(card))
    setFormError(null)
  }

  function closeForm(): void {
    if (saving) return
    setForm(null)
    setFormError(null)
  }

  function changeForm(patch: Partial<CardFormState>): void {
    setForm((current) => (current === null ? current : { ...current, ...patch }))
    setFormError(null)
  }

  /** Setiap baris punya state sendiri; perubahan satu baris tidak menyentuh PPN baris lain. */
  function changeSpend(key: string, patch: Partial<SpendDraft>): void {
    setForm((current) => current === null
      ? current
      : { ...current, spends: current.spends.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)) })
    setFormError(null)
  }

  function addSpend(): void {
    setForm((current) => {
      if (current === null) return current
      const last = current.spends[current.spends.length - 1]
      // Tanggal boleh diwarisi untuk kenyamanan, tetapi PPN dan budget selalu kosong:
      // tidak ada satu nilai PPN yang diam-diam dipakai ulang untuk baris baru.
      const draft = last === undefined
        ? newDraft()
        : newDraft(last.dateFrom, last.dateTo)
      return { ...current, spends: [...current.spends, draft] }
    })
    setFormError(null)
  }

  function removeSpend(key: string): void {
    setForm((current) => current === null ? current : { ...current, spends: current.spends.filter((draft) => draft.key !== key) })
    setFormError(null)
  }

  async function submit(nextStatus?: 'berjalan' | 'selesai'): Promise<void> {
    if (form === null || saving) return
    if (!form.canEdit && form.id !== null) return
    if (form.spends.length === 0) {
      setFormError('Isi minimal satu baris budget.')
      return
    }
    if (form.id === null) {
      if (form.productCode === '') { setFormError('Pilih produk terlebih dahulu.'); return }
      if (form.batch.trim() === '') { setFormError('Batch wajib diisi.'); return }
      if (form.eventType === '') { setFormError('Pilih jenis acara: Seminar Offline, Webinar Online, atau Hybrid.'); return }
    }

    let spends: Array<{ id: string | null; date_from: string; date_to: string; spend: number; tax_percent: number }>
    try {
      spends = form.spends.map((draft, index) => {
        const line = draftTax(draft)
        const label = `Baris budget ${index + 1}`
        if (draft.dateFrom === '' || draft.dateTo === '') throw new Error(`${label}: pilih tanggal.`)
        if (draft.dateTo < draft.dateFrom) throw new Error(`${label}: tanggal akhir tidak boleh sebelum tanggal awal.`)
        if (line === null) throw new Error(`${label}: budget dan PPN wajib diisi dengan benar.`)
        return {
          id: draft.id,
          date_from: draft.dateFrom,
          date_to: draft.dateTo,
          spend: line.spend,
          tax_percent: line.taxPercent,
        }
      })
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Isian baris budget tidak valid.')
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      const status = nextStatus ?? form.status
      if (form.id === null) {
        const result = await authorizedRequest<{ action: string; id: string }>('/api/ad-spend-cards', {
          method: 'POST',
          body: {
            name: form.name.trim(),
            product_code: form.productCode,
            batch: form.batch.trim(),
            event_type: form.eventType,
            spends,
          },
        })
        if (result.action === 'existing') {
          toast.show('Card untuk batch ini sudah ada. Buka card tersebut untuk menambah budget.', 'success')
        } else {
          toast.show('Card Report dibuat.', 'success')
        }
      } else {
        await authorizedRequest(`/api/ad-spend-cards/${encodeURIComponent(form.id)}`, {
          method: 'PATCH',
          body: { name: form.name.trim(), status, spends },
        })
        toast.show(status === 'selesai' ? 'Card ditandai Selesai.' : status === 'berjalan' ? 'Card dibuka lagi.' : 'Card Report diperbarui.', 'success')
      }
      setForm(null)
      setRefresh((value) => value + 1)
    } catch (failure) {
      if (failure instanceof Error) setFormError(failure.message)
      else setFormError('Card Report gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  async function finishCard(card: SpendCard): Promise<void> {
    if (saving || !card.can_edit) return
    const spends = card.spends.map((line) => ({
      id: line.id,
      date_from: line.date_from,
      date_to: line.date_to,
      spend: Number(line.spend),
      tax_percent: Number(line.tax_percent),
    }))
    if (spends.length === 0) {
      toast.show('Isi minimal satu baris budget sebelum menandai Selesai.', 'danger')
      return
    }
    setSaving(true)
    try {
      await authorizedRequest(`/api/ad-spend-cards/${encodeURIComponent(card.id)}`, {
        method: 'PATCH',
        body: { name: card.name, status: 'selesai', spends },
      })
      toast.show('Card ditandai Selesai.', 'success')
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal menandai Selesai.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleting === null || saving) return
    setSaving(true)
    try {
      await authorizedRequest(`/api/ad-spend-cards/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
      toast.show('Card Report dihapus.', 'success')
      setDeleting(null)
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal menghapus Card Report.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  function clearAll(): void {
    state.clearAll()
    const range = yesterday()
    state.update('dateFrom', range.from)
    state.update('dateTo', range.to)
  }

  const controls = { filters: state.filters, lists, update: state.update }
  const chips = activeCommonFilters(state.filters)
  const cards = data?.cards ?? []
  const rows = data?.rows ?? []
  const columns = [...COLUMNS, ACTION_COLUMN]
  const summary = data?.summary
  const matrix = data?.sessions
  const comparison = data?.comparison
  const showComparison = state.applied.productCode !== '' && state.applied.batch.trim() !== ''
  const comparisonProduct = (lists?.products ?? []).find((item) => item.value === state.applied.productCode)?.label ?? state.applied.productCode
  const totalProfit = summary ? spendProfit(summary.omzet, summary.total_spend) : 0
  const totalTickets = matrix?.tickets ?? summary?.paid ?? 0
  const productOptions = (lists?.products ?? []).map((item) => ({ value: item.value, label: item.label }))
  const editingCard = form?.id === null || form?.id === undefined
    ? null
    : [...cards, ...rows].find((card) => card.id === form.id) ?? null

  // Tautan "Input Report Spend" dari panel Advertiser Notes membawa `new=1`.
  useEffect(() => {
    const openFromQuery = () => {
      if (!canInput) return
      const params = new URLSearchParams(window.location.search)
      if (params.get('new') !== '1') return
      if (state.applied.productCode === '' || state.applied.batch.trim() === '') return
      openCreate()
      const url = new URL(window.location.href)
      url.searchParams.delete('new')
      window.history.replaceState({}, '', url)
    }
    openFromQuery()
    window.addEventListener('dvflow:filter-from-url', openFromQuery)
    return () => window.removeEventListener('dvflow:filter-from-url', openFromQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canInput, state.applied.productCode, state.applied.batch, state.applied.eventType])

  return (
    <>
      <PageHeader
        title="Report Spend Iklan"
        description="Biaya iklan per batch dan tiket dari OrderOnline. OTS tidak termasuk di laporan ini."
        action={canInput ? <Button variant="primary" onClick={openCreate}>+ Buat Card Report</Button> : undefined}
      />

      <div className="filter-bar flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-card p-3.5">
        <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5">
          <DateRangeFilters {...controls} />
          <ProductFilter {...controls} />
          <BatchFilter {...controls} />
          <AdvertiserFilter {...controls} />
        </div>
        {showMore ? (
          <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5">
            <EventTypeFilter {...controls} />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <FilterChip key={chip.key} label={chip.label} onRemove={() => state.removeFilter(chip.key)} />
          ))}
          <button
            type="button"
            onClick={() => setShowMore((value) => !value)}
            aria-expanded={showMore}
            className="rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-ink-soft hover:border-primary/40 hover:text-ink"
          >
            {showMore ? 'Sembunyikan Filter' : 'Filter Lain'}
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto text-[12px] font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline"
          >
            Clear All
          </button>
        </div>
      </div>

      {error === null ? null : (
        <div className="mt-4">
          <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
        </div>
      )}

      {summary === undefined ? null : (
        <div className="mt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <KpiCard
              size="lg"
              label="Total Spend"
              value={formatMoney(summary.total_spend)}
              hint={`Spend ${formatMoney(summary.spend)} + PPN ${formatMoney(summary.tax_amount)}`}
              highlight
            />
            <KpiCard
              size="lg"
              label={totalProfit < 0 ? 'Boncos' : 'Profit'}
              value={formatMoney(totalProfit)}
              valueClassName={profitTone(totalProfit)}
              hint="Omzet − Total Spend"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Leads" value={formatCount(summary.leads)} />
            <KpiCard label="Jumlah Tiket" value={formatCount(totalTickets)} hint="Total tiket dari order Paid" />
            <KpiCard label="Total Omzet" value={formatMoney(summary.omzet)} hint="Gross order Paid" />
            <KpiCard
              label="% Profit / Boncos"
              value={formatSpendRoi(summary.omzet, summary.total_spend)}
              valueClassName={profitTone(totalProfit)}
              hint="Terhadap total spend"
            />
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-2 flex min-w-0 flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">Report Berjalan</h2>
            <p className="mt-0.5 text-[12px] text-ink-soft">Card aktif. Klik card untuk menambah atau mengubah baris budget.</p>
          </div>
        </div>
        {cards.length === 0 ? (
          <Card>
            <p className="py-4 text-center text-ink-soft">
              {canInput ? 'Belum ada Card Report berjalan. Buat card untuk mulai mencatat budget.' : 'Belum ada Card Report berjalan.'}
            </p>
          </Card>
        ) : (
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const profit = spendProfit(card.omzet, card.total_spend)
              return (
                <Card key={card.id} className="flex min-w-0 flex-col gap-3">
                  <button type="button" onClick={() => openCard(card)} className="min-w-0 text-left">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="break-words text-[14px] font-semibold text-ink">{card.name}</h3>
                        <p className="mt-0.5 break-words text-[12px] text-ink-soft">
                          {card.product_name} · Batch {card.batch}{card.event_type === null ? '' : ` · ${card.event_type}`}
                        </p>
                      </div>
                      <Badge tone="warning">Berjalan</Badge>
                    </div>
                    <p className="mt-2 text-[12px] text-ink-soft">
                      Data terlapor {cardDateLabel(card)} · {cardLineCount(card)} baris budget
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                      <div className="rounded-md bg-soft px-2.5 py-2">
                        <p className="text-ink-soft">Total Spend</p>
                        <p className="font-semibold text-ink">{formatMoney(card.total_spend)}</p>
                      </div>
                      <div className="rounded-md bg-soft px-2.5 py-2">
                        <p className="text-ink-soft">{profit < 0 ? 'Boncos' : 'Profit'}</p>
                        <p className={`font-semibold ${profitTone(profit) || 'text-ink'}`}>{formatMoney(profit)}</p>
                      </div>
                      <div className="rounded-md bg-soft px-2.5 py-2">
                        <p className="text-ink-soft">Leads / Paid</p>
                        <p className="font-semibold text-ink">{formatCount(card.leads)} / {formatCount(card.paid)}</p>
                      </div>
                      <div className="rounded-md bg-soft px-2.5 py-2">
                        <p className="text-ink-soft">Omzet</p>
                        <p className="font-semibold text-ink">{formatMoney(card.omzet)}</p>
                      </div>
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => openCard(card)}>
                      {card.can_edit ? 'Tambah Budget' : 'Detail'}
                    </Button>
                    {card.can_edit ? (
                      <Button size="sm" variant="ghost" loading={saving} onClick={() => void finishCard(card)}>
                        Selesai
                      </Button>
                    ) : null}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {matrix === undefined ? null : (
        <div className="mt-4">
          <Card padding="none">
            <div className="px-3.5 pb-2 pt-3">
              <h2 className="text-[14px] font-semibold text-ink">Tiket Paid per Sesi</h2>
              <p className="mt-0.5 text-[12px] text-ink-soft">Jumlah tiket (quantity) per sesi, bukan jumlah Order ID.</p>
            </div>
            {matrix.rows.length === 0 ? (
              <p className="border-t border-line px-3 py-6 text-center text-ink-soft">Belum ada tiket Paid pada report ini.</p>
            ) : (
              <DataTable rowNumbers columns={matrixColumns(matrix)} stickyHeader={false}>
                {matrix.rows.map((row) => (
                  <TableRow key={`${row.session ?? ''}|${row.city ?? ''}|${row.event_type ?? ''}`}>
                    <TableCell>{formatText(row.city)}</TableCell>
                    <TableCell>{row.session ?? 'Tanpa sesi'}</TableCell>
                    <TableCell>
                      {row.event_type === null ? '-' : <Badge tone={eventTypeTone(row.event_type)}>{row.event_type}</Badge>}
                    </TableCell>
                    {matrix.advertisers.map((item) => (
                      <TableCell key={item.advertiser_code ?? ''} align="right">
                        {formatCount(sessionMatrixCell(row, item.advertiser_code))}
                      </TableCell>
                    ))}
                    <TableCell align="right" className="font-semibold">{formatCount(row.tickets)}</TableCell>
                  </TableRow>
                ))}
                <TableTotalRow>
                  <TableCell>Total</TableCell>
                  <TableCell>{''}</TableCell>
                  <TableCell>{''}</TableCell>
                  {matrix.advertisers.map((item) => (
                    <TableCell key={item.advertiser_code ?? ''} align="right">
                      {formatCount(item.tickets)}
                    </TableCell>
                  ))}
                  <TableCell align="right">{formatCount(matrix.tickets)}</TableCell>
                </TableTotalRow>
              </DataTable>
            )}
          </Card>
        </div>
      )}

      {showComparison ? (
        <div className="mt-4">
          <AdvertiserComparison
            comparison={comparison}
            productLabel={comparisonProduct}
            batch={state.applied.batch.trim()}
            sort={comparisonSort}
            onSort={setComparisonSort}
          />
        </div>
      ) : null}

      <div className="mt-4">
        {loading && data === null ? (
          <Card>
            <SkeletonRows rows={8} />
          </Card>
        ) : (
          <Card padding="none">
            <DataTable rowNumbers columns={columns}>
              {rows.map((row) => {
                const profit = spendProfit(row.omzet, row.total_spend)
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="font-medium text-ink">{row.name}</span>
                    </TableCell>
                    <TableCell>{cardDateLabel(row)}</TableCell>
                    <TableCell>{row.product_name}</TableCell>
                    <TableCell>{row.advertiser_name}</TableCell>
                    <TableCell>{row.batch}</TableCell>
                    <TableCell>
                      {row.event_type === null ? '-' : <Badge tone={eventTypeTone(row.event_type)}>{row.event_type}</Badge>}
                    </TableCell>
                    <TableCell align="right">{formatMoney(row.spend)}</TableCell>
                    <TableCell align="right">
                      {formatMoney(row.tax_amount)}
                      <span className="block text-[11px] text-ink-soft">{cardTaxLabel(row)}</span>
                    </TableCell>
                    <TableCell align="right">{formatMoney(row.total_spend)}</TableCell>
                    <TableCell align="right">{formatCount(row.leads)}</TableCell>
                    <TableCell align="right">{formatCount(row.paid)}</TableCell>
                    <TableCell align="right">{formatCount(row.tickets)}</TableCell>
                    <TableCell align="right">{formatMoney(row.omzet)}</TableCell>
                    <TableCell align="right">
                      <span className={profitClass(profit)}>{formatMoney(profit)}</span>
                    </TableCell>
                    <TableCell align="right">
                      <span className={profitClass(profit)}>{formatSpendRoi(row.omzet, row.total_spend)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => openCard(row)}>
                          {row.can_edit ? 'Detail / Edit' : 'Detail'}
                        </Button>
                        {row.can_edit ? (
                          <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>Hapus</Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </DataTable>

            {!loading && data !== null && rows.length === 0 ? (
              <p className="border-t border-line px-3 py-8 text-center text-ink-soft">
                Belum ada Card Report Selesai pada rentang tanggal ini.
              </p>
            ) : null}
          </Card>
        )}
      </div>

      <Modal
        open={form !== null}
        title={form?.id === null ? 'Buat Card Report' : 'Card Report'}
        onClose={closeForm}
        size="lg"
        footer={form === null ? undefined : form.canEdit ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {form.id !== null ? (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    if (editingCard !== null) {
                      setDeleting(editingCard)
                      setForm(null)
                    }
                  }}
                >
                  Hapus
                </Button>
              ) : null}
              {form.id !== null ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => void submit(form.status === 'selesai' ? 'berjalan' : 'selesai')}
                >
                  {form.status === 'selesai' ? 'Buka Lagi' : 'Tandai Selesai'}
                </Button>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeForm} disabled={saving}>Batal</Button>
              <Button variant="primary" onClick={() => void submit()} loading={saving}>Simpan</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={closeForm}>Tutup</Button>
        )}
      >
        {form === null ? null : (
          <div className="flex flex-col gap-3">
            {form.id === null ? (
              <>
                <TextInput
                  id="card-name"
                  label="Nama Card"
                  value={form.name}
                  placeholder="otomatis dari produk · batch · jenis acara"
                  maxLength={120}
                  onChange={(value) => changeForm({ name: value })}
                />
                <Combobox
                  id="card-product"
                  label="Produk"
                  value={form.productCode}
                  options={productOptions}
                  placeholder="Cari produk…"
                  onChange={(value) => changeForm({ productCode: value })}
                />
                <TextInput
                  id="card-batch"
                  label="Batch"
                  value={form.batch}
                  placeholder="mis. 122"
                  maxLength={32}
                  onChange={(value) => changeForm({ batch: value })}
                />
                <Select
                  id="card-event-type"
                  label="Jenis Acara"
                  value={form.eventType}
                  placeholder="Pilih Seminar / Webinar / Hybrid"
                  options={EVENT_TYPE_OPTIONS}
                  onChange={(value) => changeForm({ eventType: value })}
                />
              </>
            ) : (
              <div className="rounded-md border border-line bg-soft px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{form.name}</p>
                    <p className="mt-0.5 break-words text-[12px] text-ink-soft">
                      {form.productCode} · Batch {form.batch}{form.eventType === '' ? '' : ` · ${form.eventType}`}
                    </p>
                  </div>
                  <Badge tone={form.status === 'selesai' ? 'success' : 'warning'}>
                    {form.status === 'selesai' ? 'Selesai' : 'Berjalan'}
                  </Badge>
                </div>
                {form.canEdit ? (
                  <div className="mt-2">
                    <TextInput
                      id="card-name-edit"
                      label="Nama Card"
                      value={form.name}
                      maxLength={120}
                      onChange={(value) => changeForm({ name: value })}
                    />
                  </div>
                ) : null}
              </div>
            )}

            <div className="flex min-w-0 items-end justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-semibold text-ink">Biaya Iklan</h3>
                <p className="text-[12px] text-ink-soft">Tiap baris punya budget dan PPN sendiri.</p>
              </div>
              {form.canEdit ? (
                <Button size="sm" variant="secondary" onClick={addSpend} disabled={form.spends.length >= 20}>
                  + Tambah Budget
                </Button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2.5">
              {form.spends.map((draft, index) => {
                const line = draftTax(draft)
                return (
                  <div key={draft.key} className="rounded-md border border-line p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-ink">Budget {index + 1}</p>
                      {form.canEdit && form.spends.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeSpend(draft.key)}
                          className="text-[12px] font-semibold text-danger hover:underline"
                        >
                          Hapus baris
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2.5">
                      <DateRangeField
                        id={`card-spend-date-${draft.key}`}
                        ariaLabel={`Tanggal budget ${index + 1}`}
                        from={draft.dateFrom}
                        to={draft.dateTo}
                        disabled={!form.canEdit}
                        onChange={(range) => changeSpend(draft.key, { dateFrom: range.from, dateTo: range.to })}
                      />
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <TextInput
                          id={`card-spend-amount-${draft.key}`}
                          label="Budget (Rp)"
                          value={draft.spend}
                          inputMode="numeric"
                          placeholder="mis. 6000000"
                          disabled={!form.canEdit}
                          onChange={(value) => changeSpend(draft.key, { spend: value })}
                        />
                        <TextInput
                          id={`card-spend-tax-${draft.key}`}
                          label="PPN (%)"
                          value={draft.taxPercent}
                          inputMode="numeric"
                          placeholder="mis. 11"
                          maxLength={6}
                          disabled={!form.canEdit}
                          onChange={(value) => changeSpend(draft.key, { taxPercent: value })}
                        />
                      </div>
                      {line === null ? (
                        <p className="text-[12px] text-ink-soft">Isi budget dan PPN untuk melihat pajak baris ini.</p>
                      ) : (
                        <p className="text-[12px] text-ink-soft">
                          PPN {formatMoney(line.tax)} · Total {formatMoney(line.total)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {(() => {
              const totals = formTotals(form.spends)
              return (
                <div className="rounded-md bg-primary-soft px-3 py-2.5 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-primary">Total {form.spends.length} baris</span>
                    <span className="font-semibold text-primary">{formatMoney(totals.total)}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-soft">
                    Spend {formatMoney(totals.spend)} + PPN {formatMoney(totals.tax)}
                  </p>
                </div>
              )
            })()}

            {formError === null ? null : <p className="text-[12px] text-danger">{formError}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Card Report"
        onClose={() => (saving ? undefined : setDeleting(null))}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={saving}>Batal</Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={saving}>Hapus</Button>
          </>
        )}
      >
        {deleting === null ? null : (
          <p>
            Hapus card <strong>{deleting.name}</strong> ({deleting.product_name}, batch {deleting.batch},
            {' '}{cardDateLabel(deleting)}) beserta {cardLineCount(deleting)} baris budget?
          </p>
        )}
      </Modal>
    </>
  )
}

const COMPARISON_SORT_OPTIONS: ReadonlyArray<{ value: ComparisonSort; label: string }> = [
  { value: 'tickets', label: 'Urut: Tiket' },
  { value: 'omzet', label: 'Urut: Omzet' },
  { value: 'profit', label: 'Urut: Profit' },
  { value: 'roi', label: 'Urut: ROI' },
  { value: 'spend', label: 'Urut: Spend' },
]

function comparisonValue(row: ComparisonRow, sort: ComparisonSort): number {
  if (sort === 'tickets') return row.tickets
  if (sort === 'omzet') return Number(row.omzet)
  if (sort === 'profit') return spendProfit(row.omzet, row.total_spend)
  if (sort === 'spend') return Number(row.spend)
  const base = Number(row.total_spend)
  return base > 0 ? spendProfit(row.omzet, row.total_spend) / base : Number.NEGATIVE_INFINITY
}

/**
 * A46: perbandingan performa antar pengiklan untuk satu produk + batch.
 *
 * Angka memakai report/order yang sama dengan KPI di atas, jadi total baris selalu
 * cocok dengan summary. Read-only; edit/hapus tetap di tabel report.
 */
export function AdvertiserComparison({
  comparison,
  productLabel,
  batch,
  sort,
  onSort,
}: {
  comparison: SpendComparison | undefined
  productLabel: string
  batch: string
  sort: ComparisonSort
  onSort: (value: ComparisonSort) => void
}) {
  const rows = comparison?.rows ?? []
  const totals = comparison?.totals
  const sorted = [...rows].sort((left, right) => {
    const diff = comparisonValue(right, sort) - comparisonValue(left, sort)
    if (diff !== 0) return diff
    return left.advertiser_name.localeCompare(right.advertiser_name, 'id')
  })
  const totalTickets = totals?.tickets ?? rows.reduce((sum, row) => sum + row.tickets, 0)
  const totalProfit = totals === undefined ? 0 : spendProfit(totals.omzet, totals.total_spend)
  const totalCost = totals === undefined || totals.tickets <= 0 ? null : Number(totals.total_spend) / totals.tickets

  return (
    <Card padding="none">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-3.5 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-ink">Perbandingan Pengiklan</h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            {productLabel} · Batch {batch} · metrik sama dengan kartu di atas.
          </p>
        </div>
        <Select
          id="comparison-sort"
          ariaLabel="Urutkan perbandingan pengiklan"
          className="w-[170px]"
          value={sort}
          options={COMPARISON_SORT_OPTIONS}
          onChange={(value) => onSort(value as ComparisonSort)}
        />
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-line px-3 py-6 text-center text-ink-soft">
          Belum ada report spend untuk produk dan batch ini pada rentang tanggal yang dipilih.
        </p>
      ) : (
        <DataTable rowNumbers columns={COMPARISON_COLUMNS} stickyHeader={false}>
          {sorted.map((row) => {
            const profit = spendProfit(row.omzet, row.total_spend)
            const cost = row.tickets > 0 ? Number(row.total_spend) / row.tickets : null
            const share = totalTickets > 0 ? (row.tickets / totalTickets) * 100 : 0
            return (
              <TableRow key={`${row.advertiser_code}|${row.product_code}|${row.batch}|${row.event_type ?? ''}`}>
                <TableCell>
                  <span className="font-medium text-ink">{row.advertiser_name}</span>
                </TableCell>
                <TableCell align="right">
                  {formatMoney(row.spend)}
                  <span className="block text-[10px] text-ink-soft">PPN {formatMoney(row.tax_amount)}</span>
                </TableCell>
                <TableCell align="right">{formatMoney(row.total_spend)}</TableCell>
                <TableCell align="right">{formatCount(row.leads)}</TableCell>
                <TableCell align="right">{formatCount(row.paid)}</TableCell>
                <TableCell align="right">{formatCount(row.tickets)}</TableCell>
                <TableCell align="right">{formatMoney(row.omzet)}</TableCell>
                <TableCell align="right">
                  <span className={profitClass(profit)}>{formatMoney(profit)}</span>
                </TableCell>
                <TableCell align="right">
                  <span className={profitClass(profit)}>{formatSpendRoi(row.omzet, row.total_spend)}</span>
                </TableCell>
                <TableCell align="right">{cost === null ? '-' : formatMoney(cost)}</TableCell>
                <TableCell align="right">{formatPercent(share)}</TableCell>
              </TableRow>
            )
          })}
          <TableTotalRow>
            <TableCell>Total</TableCell>
            <TableCell align="right">{totals === undefined ? '-' : formatMoney(totals.spend)}</TableCell>
            <TableCell align="right">{totals === undefined ? '-' : formatMoney(totals.total_spend)}</TableCell>
            <TableCell align="right">{totals === undefined ? '-' : formatCount(totals.leads)}</TableCell>
            <TableCell align="right">{totals === undefined ? '-' : formatCount(totals.paid)}</TableCell>
            <TableCell align="right">{formatCount(totalTickets)}</TableCell>
            <TableCell align="right">{totals === undefined ? '-' : formatMoney(totals.omzet)}</TableCell>
            <TableCell align="right">
              <span className={profitClass(totalProfit)}>{totals === undefined ? '-' : formatMoney(totalProfit)}</span>
            </TableCell>
            <TableCell align="right">
              <span className={profitClass(totalProfit)}>
                {totals === undefined ? '-' : formatSpendRoi(totals.omzet, totals.total_spend)}
              </span>
            </TableCell>
            <TableCell align="right">{totalCost === null ? '-' : formatMoney(totalCost)}</TableCell>
            <TableCell align="right">{formatPercent(100)}</TableCell>
          </TableTotalRow>
        </DataTable>
      )}
    </Card>
  )
}
