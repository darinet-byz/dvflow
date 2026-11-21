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
 * Report Spend Iklan (A37/A88).
 *
 * Card = template (pengiklan + produk + batch + jenis acara). Tombol Tambah Laporan membuat
 * satu laporan harian berisi beberapa baris budget. Card Selesai menjadi resume snapshot dan
 * tetap bisa diaktifkan kembali selama masa draft 3 bulan.
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
  product_code: string
  product_name: string
  advertiser_code: string
  advertiser_name: string
  batch: string
  event_type: string | null
  own: boolean
  can_edit: boolean
}

export type SpendEntry = {
  id: string
  card_id: string
  card_name: string
  date_from: string
  date_to: string
  product_code: string
  product_name: string
  advertiser_code: string
  advertiser_name: string
  batch: string
  event_type: string | null
  spend: number | string
  tax_amount: number | string
  tax_percent: number | string
  total_spend: number | string
  leads: number
  paid: number
  tickets: number
  omzet: number | string
  own: boolean
  can_edit: boolean
  spends: SpendLine[]
}

export type ResumeDay = {
  id: string
  date_from: string
  date_to: string
  spend: number | string
  tax_amount: number | string
}

export type SpendResume = {
  id: string
  card_id: string | null
  name: string
  status: 'draft' | 'final'
  frozen: boolean
  date_from: string
  date_to: string
  retention_until: string
  product_code: string
  product_name: string
  advertiser_code: string
  advertiser_name: string
  batch: string
  event_type: string | null
  spend: number | string
  tax_amount: number | string
  tax_percent: number | string
  total_spend: number | string
  leads: number
  paid: number
  tickets: number
  omzet: number | string
  own: boolean
  can_edit: boolean
  can_activate: boolean
  entries: ResumeDay[]
}

type SpendReport = {
  summary: {
    reports: number
    spend: number | string
    tax_amount: number | string
    total_spend: number | string
    leads: number
    paid: number
    tickets: number
    omzet: number | string
  }
  cards: SpendCard[]
  entries: SpendEntry[]
  resumes: SpendResume[]
  sessions: SessionMatrix
  comparison?: SpendComparison
}

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
type Tab = 'berjalan' | 'selesai'

const EVENT_TYPE_OPTIONS = [
  { value: 'Seminar Offline', label: 'Seminar Offline' },
  { value: 'Webinar Online', label: 'Webinar Online' },
  { value: 'Hybrid', label: 'Hybrid' },
] as const

type CardFormState = {
  name: string
  productCode: string
  batch: string
  eventType: string
}

type SpendDraft = {
  key: string
  id: string | null
  spend: string
  taxPercent: string
}

type EntryFormState = {
  id: string | null
  cardId: string
  cardName: string
  dateFrom: string
  dateTo: string
  spends: SpendDraft[]
}

const ENTRY_COLUMNS: readonly TableColumn[] = [
  { key: 'date', header: 'Tanggal', minWidth: 160 },
  { key: 'card', header: 'Card', minWidth: 190 },
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
  { key: 'actions', header: 'Aksi', minWidth: 150 },
]

const RESUME_COLUMNS: readonly TableColumn[] = [
  { key: 'name', header: 'Nama Card', minWidth: 190 },
  { key: 'period', header: 'Periode', minWidth: 170 },
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
  { key: 'status', header: 'Status', minWidth: 90 },
  { key: 'actions', header: 'Aksi', minWidth: 170 },
]

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

function yesterday() {
  return presetRange('yesterday')
}

export function spendProfit(omzet: number | string, spend: number | string): number {
  return Number(omzet) - Number(spend)
}

export function formatSpendRoi(omzet: number | string, spend: number | string): string {
  const base = Number(spend)
  if (!Number.isFinite(base) || base <= 0) return '-'
  const pct = (spendProfit(omzet, spend) / base) * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export function parseSpendInput(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '')
  if (digits === '') return null
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseTaxPercent(value: string): number | null {
  const cleaned = value.replace('%', '').replace(',', '.').trim()
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return parsed <= 100 ? parsed : null
}

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
  return `entry-draft-${draftCounter}`
}

function newDraft(): SpendDraft {
  return { key: draftKey(), id: null, spend: '', taxPercent: '' }
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

function formFromEntry(entry: SpendEntry): EntryFormState {
  return {
    id: entry.id,
    cardId: entry.card_id,
    cardName: entry.card_name,
    dateFrom: entry.date_from,
    dateTo: entry.date_to,
    spends: entry.spends.length > 0
      ? entry.spends.map((line) => ({
          key: draftKey(),
          id: line.id,
          spend: String(Number(line.spend)),
          taxPercent: String(Number(line.tax_percent)),
        }))
      : [newDraft()],
  }
}

function taxLabel(row: { spends?: SpendLine[]; tax_percent: number | string }): string {
  if (row.spends !== undefined && row.spends.length > 1) return `${row.spends.length} budget`
  return formatPercent(row.tax_percent)
}

export function ReportSpendPage() {
  const session = useSession()
  const profile = session.profile
  const toast = useToast()
  const ownAdvertiser = profile?.advertiser_code ?? null
  const permissions = profile?.permissions ?? []
  const canInput = ownAdvertiser !== null && permissions.includes(AD_SPEND_INPUT_PERMISSION)

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

  const [tab, setTab] = useState<Tab>('berjalan')
  const [showMore, setShowMore] = useState(false)
  const [cardForm, setCardForm] = useState<CardFormState | null>(null)
  const [entryForm, setEntryForm] = useState<EntryFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [finishingId, setFinishingId] = useState<string | null>(null)
  const [deletingCard, setDeletingCard] = useState<SpendCard | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<SpendEntry | null>(null)
  const [detailResume, setDetailResume] = useState<SpendResume | null>(null)
  const [activating, setActivating] = useState<SpendResume | null>(null)
  const [comparisonSort, setComparisonSort] = useState<ComparisonSort>('tickets')

  function openCreateCard(): void {
    setCardForm({
      name: '',
      productCode: state.applied.productCode,
      batch: state.applied.batch.trim(),
      eventType: state.applied.eventType,
    })
    setFormError(null)
  }

  function openEntry(card: SpendCard): void {
    const range = yesterday()
    setEntryForm({
      id: null,
      cardId: card.id,
      cardName: card.name,
      dateFrom: range.from,
      dateTo: range.to,
      spends: [newDraft()],
    })
    setFormError(null)
  }

  function closeOverlays(): void {
    if (saving) return
    setCardForm(null)
    setEntryForm(null)
    setFormError(null)
  }

  function changeEntry(patch: Partial<EntryFormState>): void {
    setEntryForm((current) => (current === null ? current : { ...current, ...patch }))
    setFormError(null)
  }

  function changeSpend(key: string, patch: Partial<SpendDraft>): void {
    setEntryForm((current) => current === null
      ? current
      : { ...current, spends: current.spends.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)) })
    setFormError(null)
  }

  function addSpend(): void {
    setEntryForm((current) => current === null ? current : { ...current, spends: [...current.spends, newDraft()] })
    setFormError(null)
  }

  function removeSpend(key: string): void {
    setEntryForm((current) => current === null ? current : { ...current, spends: current.spends.filter((draft) => draft.key !== key) })
    setFormError(null)
  }

  async function submitCard(): Promise<void> {
    if (cardForm === null || saving) return
    if (cardForm.productCode === '') { setFormError('Pilih produk terlebih dahulu.'); return }
    if (cardForm.batch.trim() === '') { setFormError('Batch wajib diisi.'); return }
    if (cardForm.eventType === '') { setFormError('Pilih jenis acara: Seminar Offline, Webinar Online, atau Hybrid.'); return }
    setSaving(true)
    setFormError(null)
    try {
      const result = await authorizedRequest<{ action: string; status?: string }>('/api/ad-spend-cards', {
        method: 'POST',
        body: {
          name: cardForm.name.trim(),
          product_code: cardForm.productCode,
          batch: cardForm.batch.trim(),
          event_type: cardForm.eventType,
        },
      })
      if (result.action === 'existing') {
        toast.show('Card untuk batch ini sudah ada. Buka card tersebut untuk menambah laporan.', 'success')
        setTab(result.status === 'selesai' ? 'selesai' : 'berjalan')
      } else {
        toast.show('Card Report dibuat.', 'success')
      }
      setCardForm(null)
      setRefresh((value) => value + 1)
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Card Report gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  async function submitEntry(): Promise<void> {
    if (entryForm === null || saving) return
    if (entryForm.dateFrom === '' || entryForm.dateTo === '') { setFormError('Pilih tanggal laporan.'); return }
    if (entryForm.dateTo < entryForm.dateFrom) { setFormError('Tanggal akhir tidak boleh sebelum tanggal awal.'); return }
    if (entryForm.spends.length === 0) { setFormError('Isi minimal satu baris budget.'); return }
    let spends: Array<{ id: string | null; spend: number; tax_percent: number }>
    try {
      spends = entryForm.spends.map((draft, index) => {
        const line = draftTax(draft)
        if (line === null) throw new Error(`Baris budget ${index + 1}: budget dan PPN wajib diisi dengan benar.`)
        return { id: draft.id, spend: line.spend, tax_percent: line.taxPercent }
      })
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Isian baris budget tidak valid.')
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      const path = entryForm.id === null
        ? `/api/ad-spend-cards/${encodeURIComponent(entryForm.cardId)}/reports`
        : `/api/ad-spend-cards/${encodeURIComponent(entryForm.cardId)}/reports/${encodeURIComponent(entryForm.id)}`
      await authorizedRequest(path, {
        method: entryForm.id === null ? 'POST' : 'PATCH',
        body: { date_from: entryForm.dateFrom, date_to: entryForm.dateTo, spends },
      })
      toast.show(entryForm.id === null ? 'Laporan ditambahkan.' : 'Laporan diperbarui.', 'success')
      setEntryForm(null)
      setRefresh((value) => value + 1)
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Laporan gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  async function finishCard(card: SpendCard): Promise<void> {
    if (saving) return
    setSaving(true)
    setFinishingId(card.id)
    try {
      await authorizedRequest(`/api/ad-spend-cards/${encodeURIComponent(card.id)}/finish`, { method: 'POST' })
      toast.show('Card ditandai Selesai. Resume dibuat.', 'success')
      setTab('selesai')
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal menandai Selesai.', 'danger')
    } finally {
      setSaving(false)
      setFinishingId(null)
    }
  }

  async function deleteCard(): Promise<void> {
    if (deletingCard === null || saving) return
    setSaving(true)
    try {
      await authorizedRequest(`/api/ad-spend-cards/${encodeURIComponent(deletingCard.id)}`, { method: 'DELETE' })
      toast.show('Card Report dihapus.', 'success')
      setDeletingCard(null)
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal menghapus Card Report.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEntry(): Promise<void> {
    if (deletingEntry === null || saving) return
    setSaving(true)
    try {
      await authorizedRequest(
        `/api/ad-spend-cards/${encodeURIComponent(deletingEntry.card_id)}/reports/${encodeURIComponent(deletingEntry.id)}`,
        { method: 'DELETE' },
      )
      toast.show('Laporan dihapus.', 'success')
      setDeletingEntry(null)
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal menghapus laporan.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function activateResume(): Promise<void> {
    if (activating === null || saving) return
    setSaving(true)
    try {
      await authorizedRequest(`/api/ad-spend-cards/${encodeURIComponent(activating.card_id ?? '')}/activate`, { method: 'POST' })
      toast.show('Card diaktifkan lagi. Tambah/edit laporan sekarang.', 'success')
      setActivating(null)
      setDetailResume(null)
      setTab('berjalan')
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal mengaktifkan card.', 'danger')
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
  const entries = data?.entries ?? []
  const resumes = data?.resumes ?? []
  const summary = data?.summary
  const matrix = data?.sessions
  const comparison = data?.comparison
  const showComparison = tab === 'berjalan' && state.applied.productCode !== '' && state.applied.batch.trim() !== ''
  const comparisonProduct = (lists?.products ?? []).find((item) => item.value === state.applied.productCode)?.label ?? state.applied.productCode
  const totalProfit = summary ? spendProfit(summary.omzet, summary.total_spend) : 0
  const productOptions = (lists?.products ?? []).map((item) => ({ value: item.value, label: item.label }))

  useEffect(() => {
    const openFromQuery = () => {
      if (!canInput) return
      const params = new URLSearchParams(window.location.search)
      if (params.get('new') !== '1') return
      if (state.applied.productCode === '' || state.applied.batch.trim() === '') return
      openCreateCard()
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
        description="Card untuk input laporan harian; hasilnya masuk ke Laporan Berjalan dan bisa di-resume."
        action={canInput ? <Button variant="primary" onClick={openCreateCard}>+ Buat Card Report</Button> : undefined}
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
            <KpiCard label="Jumlah Tiket" value={formatCount(summary.tickets)} hint="Total tiket dari order Paid" />
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
            <h2 className="text-[14px] font-semibold text-ink">Card Report</h2>
            <p className="mt-0.5 text-[12px] text-ink-soft">Card template. Klik Tambah Laporan untuk input laporan harian.</p>
          </div>
        </div>
        {cards.length === 0 ? (
          <Card>
            <p className="py-4 text-center text-ink-soft">
              {canInput ? 'Belum ada Card Report. Buat card untuk mulai mencatat laporan.' : 'Belum ada Card Report aktif.'}
            </p>
          </Card>
        ) : (
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <Card key={card.id} className="flex min-w-0 flex-col gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-[14px] font-semibold text-ink">{card.name}</h3>
                      <p className="mt-0.5 break-words text-[12px] text-ink-soft">
                        {card.product_name} · Batch {card.batch}{card.event_type === null ? '' : ` · ${card.event_type}`}
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink-soft">{card.advertiser_name}</p>
                    </div>
                    <Badge tone="warning">Berjalan</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="primary" onClick={() => openEntry(card)}>Tambah Laporan</Button>
                  {card.can_edit ? (
                    <>
                      <Button size="sm" variant="secondary" loading={finishingId === card.id} disabled={saving && finishingId !== card.id} onClick={() => void finishCard(card)}>
                        Selesai
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeletingCard(card)}>Hapus</Button>
                    </>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-line bg-card p-1">
          <button
            type="button"
            onClick={() => setTab('berjalan')}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${tab === 'berjalan' ? 'bg-primary-soft text-primary' : 'text-ink-soft hover:bg-soft hover:text-ink'}`}
          >
            Laporan Berjalan
          </button>
          <button
            type="button"
            onClick={() => setTab('selesai')}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${tab === 'selesai' ? 'bg-primary-soft text-primary' : 'text-ink-soft hover:bg-soft hover:text-ink'}`}
          >
            Laporan Selesai
          </button>
        </div>

        <div className="mt-3">
          {loading && data === null ? (
            <Card><SkeletonRows rows={8} /></Card>
          ) : tab === 'berjalan' ? (
            <Card padding="none">
              <DataTable rowNumbers columns={ENTRY_COLUMNS}>
                {entries.map((entry) => {
                  const profit = spendProfit(entry.omzet, entry.total_spend)
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>{describeDates(entry.date_from, entry.date_to)}</TableCell>
                      <TableCell><span className="font-medium text-ink">{entry.card_name}</span></TableCell>
                      <TableCell>{entry.product_name}</TableCell>
                      <TableCell>{entry.advertiser_name}</TableCell>
                      <TableCell>{entry.batch}</TableCell>
                      <TableCell>
                        {entry.event_type === null ? '-' : <Badge tone={eventTypeTone(entry.event_type)}>{entry.event_type}</Badge>}
                      </TableCell>
                      <TableCell align="right">{formatMoney(entry.spend)}</TableCell>
                      <TableCell align="right">
                        {formatMoney(entry.tax_amount)}
                        <span className="block text-[11px] text-ink-soft">{taxLabel(entry)}</span>
                      </TableCell>
                      <TableCell align="right">{formatMoney(entry.total_spend)}</TableCell>
                      <TableCell align="right">{formatCount(entry.leads)}</TableCell>
                      <TableCell align="right">{formatCount(entry.paid)}</TableCell>
                      <TableCell align="right">{formatCount(entry.tickets)}</TableCell>
                      <TableCell align="right">{formatMoney(entry.omzet)}</TableCell>
                      <TableCell align="right"><span className={profitClass(profit)}>{formatMoney(profit)}</span></TableCell>
                      <TableCell align="right"><span className={profitClass(profit)}>{formatSpendRoi(entry.omzet, entry.total_spend)}</span></TableCell>
                      <TableCell>
                        {entry.can_edit ? (
                          <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => setEntryForm(formFromEntry(entry))}>Edit</Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeletingEntry(entry)}>Hapus</Button>
                          </div>
                        ) : <span className="text-[12px] text-ink-muted">-</span>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </DataTable>
              {!loading && data !== null && entries.length === 0 ? (
                <p className="border-t border-line px-3 py-8 text-center text-ink-soft">
                  Belum ada laporan harian pada rentang tanggal ini.
                </p>
              ) : null}
            </Card>
          ) : (
            <Card padding="none">
              <DataTable rowNumbers columns={RESUME_COLUMNS}>
                {resumes.map((resume) => {
                  const profit = spendProfit(resume.omzet, resume.total_spend)
                  return (
                    <TableRow key={resume.id}>
                      <TableCell><span className="font-medium text-ink">{resume.name}</span></TableCell>
                      <TableCell>{describeDates(resume.date_from, resume.date_to)}</TableCell>
                      <TableCell>{resume.product_name}</TableCell>
                      <TableCell>{resume.advertiser_name}</TableCell>
                      <TableCell>{resume.batch}</TableCell>
                      <TableCell>
                        {resume.event_type === null ? '-' : <Badge tone={eventTypeTone(resume.event_type)}>{resume.event_type}</Badge>}
                      </TableCell>
                      <TableCell align="right">{formatMoney(resume.spend)}</TableCell>
                      <TableCell align="right">
                        {formatMoney(resume.tax_amount)}
                        <span className="block text-[11px] text-ink-soft">{formatPercent(resume.tax_percent)}</span>
                      </TableCell>
                      <TableCell align="right">{formatMoney(resume.total_spend)}</TableCell>
                      <TableCell align="right">{formatCount(resume.leads)}</TableCell>
                      <TableCell align="right">{formatCount(resume.paid)}</TableCell>
                      <TableCell align="right">{formatCount(resume.tickets)}</TableCell>
                      <TableCell align="right">{formatMoney(resume.omzet)}</TableCell>
                      <TableCell align="right"><span className={profitClass(profit)}>{formatMoney(profit)}</span></TableCell>
                      <TableCell align="right"><span className={profitClass(profit)}>{formatSpendRoi(resume.omzet, resume.total_spend)}</span></TableCell>
                      <TableCell>
                        <Badge tone={resume.status === 'draft' ? 'warning' : 'success'}>
                          {resume.status === 'draft' ? 'Draft' : 'Final'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setDetailResume(resume)}>Detail</Button>
                          {resume.can_activate ? (
                            <Button size="sm" variant="ghost" onClick={() => setActivating(resume)}>Aktifkan</Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </DataTable>
              {!loading && data !== null && resumes.length === 0 ? (
                <p className="border-t border-line px-3 py-8 text-center text-ink-soft">
                  Belum ada laporan selesai pada rentang tanggal ini.
                </p>
              ) : null}
            </Card>
          )}
        </div>
      </div>

      {tab === 'berjalan' && matrix !== undefined ? (
        <div className="mt-4">
          <Card padding="none">
            <div className="px-3.5 pb-2 pt-3">
              <h2 className="text-[14px] font-semibold text-ink">Tiket Paid per Sesi</h2>
              <p className="mt-0.5 text-[12px] text-ink-soft">Jumlah tiket (quantity) per sesi dari laporan harian aktif.</p>
            </div>
            {matrix.rows.length === 0 ? (
              <p className="border-t border-line px-3 py-6 text-center text-ink-soft">Belum ada tiket Paid pada laporan berjalan.</p>
            ) : (
              <DataTable rowNumbers columns={matrixColumns(matrix)} stickyHeader={false}>
                {matrix.rows.map((row) => (
                  <TableRow key={`${row.session ?? ''}|${row.city ?? ''}|${row.event_type ?? ''}`}>
                    <TableCell>{formatText(row.city)}</TableCell>
                    <TableCell>{row.session ?? 'Tanpa sesi'}</TableCell>
                    <TableCell>{row.event_type === null ? '-' : <Badge tone={eventTypeTone(row.event_type)}>{row.event_type}</Badge>}</TableCell>
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
                    <TableCell key={item.advertiser_code ?? ''} align="right">{formatCount(item.tickets)}</TableCell>
                  ))}
                  <TableCell align="right">{formatCount(matrix.tickets)}</TableCell>
                </TableTotalRow>
              </DataTable>
            )}
          </Card>
        </div>
      ) : null}

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

      <Modal
        open={cardForm !== null}
        title="Buat Card Report"
        onClose={closeOverlays}
        footer={(
          <>
            <Button variant="secondary" onClick={closeOverlays} disabled={saving}>Batal</Button>
            <Button variant="primary" onClick={() => void submitCard()} loading={saving}>Simpan</Button>
          </>
        )}
      >
        {cardForm === null ? null : (
          <div className="flex flex-col gap-3">
            <TextInput
              id="card-name"
              label="Nama Card"
              value={cardForm.name}
              placeholder="otomatis dari produk · batch · jenis acara"
              maxLength={120}
              onChange={(value) => setCardForm({ ...cardForm, name: value })}
            />
            <Combobox
              id="card-product"
              label="Produk"
              value={cardForm.productCode}
              options={productOptions}
              placeholder="Cari produk…"
              onChange={(value) => setCardForm({ ...cardForm, productCode: value })}
            />
            <TextInput
              id="card-batch"
              label="Batch"
              value={cardForm.batch}
              placeholder="mis. 122"
              maxLength={32}
              onChange={(value) => setCardForm({ ...cardForm, batch: value })}
            />
            <Select
              id="card-event-type"
              label="Jenis Acara"
              value={cardForm.eventType}
              placeholder="Pilih Seminar / Webinar / Hybrid"
              options={EVENT_TYPE_OPTIONS}
              onChange={(value) => setCardForm({ ...cardForm, eventType: value })}
            />
            {formError === null ? null : <p className="text-[12px] text-danger">{formError}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={entryForm !== null}
        title={entryForm?.id === null ? 'Tambah Laporan' : 'Edit Laporan'}
        onClose={closeOverlays}
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={closeOverlays} disabled={saving}>Batal</Button>
            <Button variant="primary" onClick={() => void submitEntry()} loading={saving}>Simpan</Button>
          </>
        )}
      >
        {entryForm === null ? null : (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-line bg-soft px-3 py-2.5">
              <p className="font-semibold text-ink">{entryForm.cardName}</p>
              <p className="mt-0.5 text-[12px] text-ink-soft">Satu laporan boleh berisi beberapa baris budget/akun.</p>
            </div>
            <DateRangeField
              id="entry-date"
              ariaLabel="Tanggal laporan"
              from={entryForm.dateFrom}
              to={entryForm.dateTo}
              onChange={(range) => changeEntry({ dateFrom: range.from, dateTo: range.to })}
            />
            <div className="flex min-w-0 items-end justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-semibold text-ink">Biaya Iklan</h3>
                <p className="text-[12px] text-ink-soft">Tiap baris punya budget dan PPN sendiri.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={addSpend} disabled={entryForm.spends.length >= 20}>+ Tambah Budget</Button>
            </div>
            <div className="flex flex-col gap-2.5">
              {entryForm.spends.map((draft, index) => {
                const line = draftTax(draft)
                return (
                  <div key={draft.key} className="rounded-md border border-line p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-ink">Budget {index + 1}</p>
                      {entryForm.spends.length > 1 ? (
                        <button type="button" onClick={() => removeSpend(draft.key)} className="text-[12px] font-semibold text-danger hover:underline">
                          Hapus baris
                        </button>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <TextInput
                        id={`entry-spend-${draft.key}`}
                        label="Budget (Rp)"
                        value={draft.spend}
                        inputMode="numeric"
                        placeholder="mis. 6000000"
                        onChange={(value) => changeSpend(draft.key, { spend: value })}
                      />
                      <TextInput
                        id={`entry-tax-${draft.key}`}
                        label="PPN (%)"
                        value={draft.taxPercent}
                        inputMode="numeric"
                        placeholder="mis. 11"
                        maxLength={6}
                        onChange={(value) => changeSpend(draft.key, { taxPercent: value })}
                      />
                    </div>
                    {line === null ? (
                      <p className="mt-2 text-[12px] text-ink-soft">Isi budget dan PPN untuk melihat pajak baris ini.</p>
                    ) : (
                      <p className="mt-2 text-[12px] text-ink-soft">PPN {formatMoney(line.tax)} · Total {formatMoney(line.total)}</p>
                    )}
                  </div>
                )
              })}
            </div>
            {(() => {
              const totals = formTotals(entryForm.spends)
              return (
                <div className="rounded-md bg-primary-soft px-3 py-2.5 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-primary">Total {entryForm.spends.length} baris</span>
                    <span className="font-semibold text-primary">{formatMoney(totals.total)}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-soft">Spend {formatMoney(totals.spend)} + PPN {formatMoney(totals.tax)}</p>
                </div>
              )
            })()}
            {formError === null ? null : <p className="text-[12px] text-danger">{formError}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={deletingCard !== null}
        title="Hapus Card Report"
        onClose={() => (saving ? undefined : setDeletingCard(null))}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setDeletingCard(null)} disabled={saving}>Batal</Button>
            <Button variant="danger" onClick={() => void deleteCard()} loading={saving}>Hapus</Button>
          </>
        )}
      >
        {deletingCard === null ? null : (
          <p>Hapus card <strong>{deletingCard.name}</strong> ({deletingCard.product_name}, batch {deletingCard.batch}) beserta semua laporan hariannya?</p>
        )}
      </Modal>

      <Modal
        open={deletingEntry !== null}
        title="Hapus Laporan"
        onClose={() => (saving ? undefined : setDeletingEntry(null))}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setDeletingEntry(null)} disabled={saving}>Batal</Button>
            <Button variant="danger" onClick={() => void deleteEntry()} loading={saving}>Hapus</Button>
          </>
        )}
      >
        {deletingEntry === null ? null : (
          <p>Hapus laporan <strong>{deletingEntry.card_name}</strong> tanggal {describeDates(deletingEntry.date_from, deletingEntry.date_to)}?</p>
        )}
      </Modal>

      <Modal
        open={detailResume !== null}
        title={detailResume?.name ?? 'Detail Laporan Selesai'}
        onClose={() => (saving ? undefined : setDetailResume(null))}
        size="lg"
        footer={detailResume === null ? undefined : (
          <>
            <Button variant="secondary" onClick={() => setDetailResume(null)} disabled={saving}>Tutup</Button>
            {detailResume.can_activate ? (
              <Button variant="primary" onClick={() => { setActivating(detailResume); setDetailResume(null) }} disabled={saving}>
                Aktifkan
              </Button>
            ) : null}
          </>
        )}
      >
        {detailResume === null ? null : (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-line bg-soft px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{detailResume.name}</p>
                  <p className="mt-0.5 text-[12px] text-ink-soft">
                    {detailResume.product_name} · Batch {detailResume.batch}{detailResume.event_type === null ? '' : ` · ${detailResume.event_type}`}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-soft">{detailResume.advertiser_name}</p>
                </div>
                <Badge tone={detailResume.status === 'draft' ? 'warning' : 'success'}>
                  {detailResume.status === 'draft' ? 'Draft' : 'Final'}
                </Badge>
              </div>
              <p className="mt-2 text-[12px] text-ink-soft">
                Periode {describeDates(detailResume.date_from, detailResume.date_to)}
                {detailResume.status === 'draft'
                  ? ` · Data harian tersedia sampai ${formatDate(detailResume.retention_until)}`
                  : ' · Data harian sudah dihapus; hanya resume yang tersimpan.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
              <div className="rounded-md bg-soft p-2.5"><p className="text-ink-soft">Spend</p><p className="font-semibold text-ink">{formatMoney(detailResume.spend)}</p></div>
              <div className="rounded-md bg-soft p-2.5"><p className="text-ink-soft">PPN</p><p className="font-semibold text-ink">{formatMoney(detailResume.tax_amount)}</p></div>
              <div className="rounded-md bg-soft p-2.5"><p className="text-ink-soft">Total Spend</p><p className="font-semibold text-ink">{formatMoney(detailResume.total_spend)}</p></div>
              <div className="rounded-md bg-soft p-2.5"><p className="text-ink-soft">Tiket</p><p className="font-semibold text-ink">{formatCount(detailResume.tickets)}</p></div>
              <div className="rounded-md bg-soft p-2.5"><p className="text-ink-soft">Leads</p><p className="font-semibold text-ink">{formatCount(detailResume.leads)}</p></div>
              <div className="rounded-md bg-soft p-2.5"><p className="text-ink-soft">Paid</p><p className="font-semibold text-ink">{formatCount(detailResume.paid)}</p></div>
              <div className="rounded-md bg-soft p-2.5"><p className="text-ink-soft">Omzet</p><p className="font-semibold text-ink">{formatMoney(detailResume.omzet)}</p></div>
              <div className="rounded-md bg-soft p-2.5"><p className="text-ink-soft">Profit</p><p className={`font-semibold ${profitTone(spendProfit(detailResume.omzet, detailResume.total_spend)) || 'text-ink'}`}>{formatMoney(spendProfit(detailResume.omzet, detailResume.total_spend))}</p></div>
            </div>
            {detailResume.status === 'draft' ? (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">Laporan Harian</h3>
                {detailResume.entries.length === 0 ? (
                  <p className="text-[12px] text-ink-soft">Belum ada laporan harian.</p>
                ) : (
                  <DataTable
                    rowNumbers
                    stickyHeader={false}
                    columns={[
                      { key: 'date', header: 'Tanggal', minWidth: 180 },
                      { key: 'spend', header: 'Spend', align: 'right', minWidth: 130 },
                      { key: 'tax', header: 'PPN', align: 'right', minWidth: 130 },
                      { key: 'total', header: 'Total', align: 'right', minWidth: 130 },
                    ]}
                  >
                    {detailResume.entries.map((day) => (
                      <TableRow key={day.id}>
                        <TableCell>{describeDates(day.date_from, day.date_to)}</TableCell>
                        <TableCell align="right">{formatMoney(day.spend)}</TableCell>
                        <TableCell align="right">{formatMoney(day.tax_amount)}</TableCell>
                        <TableCell align="right">{formatMoney(Number(day.spend) + Number(day.tax_amount))}</TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={activating !== null}
        title="Aktifkan Card"
        onClose={() => (saving ? undefined : setActivating(null))}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setActivating(null)} disabled={saving}>Batal</Button>
            <Button variant="primary" onClick={() => void activateResume()} loading={saving}>Aktifkan</Button>
          </>
        )}
      >
        {activating === null ? null : (
          <p>
            Aktifkan <strong>{activating.name}</strong>? Resume ini akan dihapus sementara dan card kembali ke
            Laporan Berjalan. Setelah ditandai Selesai lagi, masa draft 3 bulan dihitung dari tanggal baru.
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
            {productLabel} · Batch {batch} · laporan harian aktif.
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
          Belum ada laporan harian untuk produk dan batch ini pada rentang tanggal yang dipilih.
        </p>
      ) : (
        <DataTable rowNumbers columns={COMPARISON_COLUMNS} stickyHeader={false}>
          {sorted.map((row) => {
            const profit = spendProfit(row.omzet, row.total_spend)
            const cost = row.tickets > 0 ? Number(row.total_spend) / row.tickets : null
            const share = totalTickets > 0 ? (row.tickets / totalTickets) * 100 : 0
            return (
              <TableRow key={`${row.advertiser_code}|${row.product_code}|${row.batch}|${row.event_type ?? ''}`}>
                <TableCell><span className="font-medium text-ink">{row.advertiser_name}</span></TableCell>
                <TableCell align="right">
                  {formatMoney(row.spend)}
                  <span className="block text-[10px] text-ink-soft">PPN {formatMoney(row.tax_amount)}</span>
                </TableCell>
                <TableCell align="right">{formatMoney(row.total_spend)}</TableCell>
                <TableCell align="right">{formatCount(row.leads)}</TableCell>
                <TableCell align="right">{formatCount(row.paid)}</TableCell>
                <TableCell align="right">{formatCount(row.tickets)}</TableCell>
                <TableCell align="right">{formatMoney(row.omzet)}</TableCell>
                <TableCell align="right"><span className={profitClass(profit)}>{formatMoney(profit)}</span></TableCell>
                <TableCell align="right"><span className={profitClass(profit)}>{formatSpendRoi(row.omzet, row.total_spend)}</span></TableCell>
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
            <TableCell align="right"><span className={profitClass(totalProfit)}>{totals === undefined ? '-' : formatMoney(totalProfit)}</span></TableCell>
            <TableCell align="right"><span className={profitClass(totalProfit)}>{totals === undefined ? '-' : formatSpendRoi(totals.omzet, totals.total_spend)}</span></TableCell>
            <TableCell align="right">{totalCost === null ? '-' : formatMoney(totalCost)}</TableCell>
            <TableCell align="right">{formatPercent(100)}</TableCell>
          </TableTotalRow>
        </DataTable>
      )}
    </Card>
  )
}
