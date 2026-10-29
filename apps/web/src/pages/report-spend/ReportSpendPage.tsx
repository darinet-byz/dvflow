import { useState } from 'react'
import { AD_SPEND_INPUT_PERMISSION } from '@dvflow/shared'
import { ApiError } from '../../lib/api'
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
import { AdvertiserFilter, BatchFilter, DateRangeFilters, ProductFilter } from '../shared/FilterControls'
import { useFilterState } from '../shared/useFilterState'

/**
 * Report Spend Iklan (A37).
 *
 * Pengiklan melaporkan biaya iklan per batch untuk satu rentang tanggal. Leads/Paid/Omzet tidak
 * disimpan: RPC `ad_spend_report` menghitungnya live dari order dengan produk + kode pengiklan +
 * batch yang sama, bertanggal order (WIB) di dalam rentang report. Tidak ada order = 0, bukan error.
 *
 * Input hanya untuk akun Advertiser (pengiklannya sendiri); role lain hanya melihat.
 */
type SpendRow = {
  id: string
  date_from: string
  date_to: string
  product_code: string
  product_name: string
  advertiser_code: string
  advertiser_name: string
  batch: string
  /** Spend sebelum PPN. */
  spend: number | string
  tax_percent: number | string
  tax_amount: number | string
  /** Spend + PPN: dasar Profit/Boncos. */
  total_spend: number | string
  leads: number
  paid: number
  /** Tiket Paid report ini = sum(quantity), metrik yang sama dengan tabel sesi (A45). */
  tickets: number
  omzet: number | string
  own: boolean
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
  rows: SpendRow[]
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

/** A46: roll-up per produk + batch + pengiklan, dari report dan order yang sama dengan summary. */
export type ComparisonRow = {
  product_code: string
  product_name: string
  batch: string
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

type FormState = {
  id: string | null
  productCode: string
  batch: string
  dateFrom: string
  dateTo: string
  spend: string
  taxPercent: string
}

const COLUMNS: readonly TableColumn[] = [
  { key: 'date', header: 'Tanggal', minWidth: 150 },
  { key: 'product', header: 'Produk', minWidth: 160 },
  { key: 'advertiser', header: 'Pengiklan', minWidth: 130 },
  { key: 'batch', header: 'Batch', minWidth: 80 },
  { key: 'spend', header: 'Spend', align: 'right', minWidth: 130 },
  { key: 'tax', header: 'PPN', align: 'right', minWidth: 120 },
  { key: 'total_spend', header: 'Total Spend', align: 'right', minWidth: 140 },
  { key: 'leads', header: 'Leads', align: 'right', minWidth: 80 },
  { key: 'paid', header: 'Paid', align: 'right', minWidth: 80 },
  { key: 'tickets', header: 'Total Tiket', align: 'right', minWidth: 110 },
  { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
  { key: 'profit', header: 'Profit / Boncos', align: 'right', minWidth: 140 },
  { key: 'roi', header: '%', align: 'right', minWidth: 80 },
]
const ACTION_COLUMN: TableColumn = { key: 'actions', header: 'Aksi', minWidth: 130 }

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

/** PPN iklan per report, sama dengan pembulatan di RPC `ad_spend_report`. */
export function spendTax(spend: number, taxPercent: number): number {
  return Math.round(spend * taxPercent) / 100
}

function formatPercent(value: number | string): string {
  return `${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`
}

function describeDates(from: string, to: string): string {
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

/** PPN tiap akun iklan biasanya tetap, jadi form baru memakai PPN report terakhir pengiklan ini. */
function emptyForm(lastTaxPercent: string): FormState {
  const range = yesterday()
  return { id: null, productCode: '', batch: '', dateFrom: range.from, dateTo: range.to, spend: '', taxPercent: lastTaxPercent }
}

export function ReportSpendPage() {
  const session = useSession()
  const profile = session.profile
  const toast = useToast()
  // A44: akun Advertiser melihat semua pengiklan di produknya; pengiklan akun hanya menentukan input/edit.
  const ownAdvertiser = profile?.advertiser_code ?? null
  const canInput = ownAdvertiser !== null && !!profile?.permissions?.includes(AD_SPEND_INPUT_PERMISSION)

  // Hanya dipakai sebagai nilai awal (useState); filter bertanggal tidak memicu default "Hari Ini".
  const initialRange = yesterday()
  const state = useFilterState<CommonFilters>({ ...EMPTY_COMMON_FILTERS, dateFrom: initialRange.from, dateTo: initialRange.to })
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
    })
  }, [appliedKey, refresh])

  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [overlap, setOverlap] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<SpendRow | null>(null)
  const [comparisonSort, setComparisonSort] = useState<ComparisonSort>('tickets')

  function openForm(next: FormState): void {
    setForm(next)
    setFormError(null)
    setOverlap(false)
  }

  function closeForm(): void {
    if (saving) return
    setForm(null)
  }

  function changeForm(patch: Partial<FormState>): void {
    setForm((current) => (current === null ? current : { ...current, ...patch }))
    // Data berubah: notif "sudah ada" sebelumnya tidak lagi berlaku untuk isian baru.
    setOverlap(false)
    setFormError(null)
  }

  async function submit(confirmOverlap: boolean): Promise<void> {
    if (form === null || saving) return
    const spend = parseSpendInput(form.spend)
    if (form.productCode === '') { setFormError('Pilih produk terlebih dahulu.'); return }
    if (form.batch.trim() === '') { setFormError('Batch wajib diisi.'); return }
    if (form.dateFrom === '' || form.dateTo === '') { setFormError('Pilih rentang tanggal.'); return }
    if (spend === null) { setFormError('Biaya iklan wajib diisi.'); return }
    const taxPercent = parseTaxPercent(form.taxPercent)
    if (taxPercent === null) { setFormError('PPN iklan wajib diisi dalam persen 0–100 (isi 0 bila tanpa PPN).'); return }

    setSaving(true)
    setFormError(null)
    try {
      await authorizedRequest(form.id === null ? '/api/ad-spend-reports' : `/api/ad-spend-reports/${encodeURIComponent(form.id)}`, {
        method: form.id === null ? 'POST' : 'PATCH',
        body: {
          product_code: form.productCode,
          batch: form.batch.trim(),
          date_from: form.dateFrom,
          date_to: form.dateTo,
          spend,
          tax_percent: taxPercent,
          confirm_overlap: confirmOverlap,
        },
      })
      toast.show(form.id === null ? 'Biaya iklan tersimpan.' : 'Report spend diperbarui.', 'success')
      setForm(null)
      setRefresh((value) => value + 1)
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'AD_SPEND_OVERLAP') {
        setOverlap(true)
      } else {
        setFormError(failure instanceof Error ? failure.message : 'Biaya iklan gagal disimpan.')
      }
    } finally {
      setSaving(false)
    }
  }

  /** "Cek Report": tampilkan report yang sudah ada untuk produk + batch + rentang yang sama. */
  function showExisting(): void {
    if (form === null) return
    state.clearAll()
    state.update('dateFrom', form.dateFrom)
    state.update('dateTo', form.dateTo)
    state.update('productCode', form.productCode)
    state.update('batch', form.batch.trim())
    setForm(null)
  }

  async function confirmDelete(): Promise<void> {
    if (deleting === null || saving) return
    setSaving(true)
    try {
      await authorizedRequest(`/api/ad-spend-reports/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
      toast.show('Report spend dihapus.', 'success')
      setDeleting(null)
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal menghapus report spend.', 'danger')
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
  const rows = data?.rows ?? []
  const columns = canInput ? [...COLUMNS, ACTION_COLUMN] : COLUMNS
  const summary = data?.summary
  const matrix = data?.sessions
  const comparison = data?.comparison
  // Perbandingan hanya bermakna untuk satu produk + batch; filter lain tetap boleh aktif.
  const showComparison = state.applied.productCode !== '' && state.applied.batch.trim() !== ''
  const comparisonProduct = (lists?.products ?? []).find((item) => item.value === state.applied.productCode)?.label ?? state.applied.productCode
  const totalProfit = summary ? spendProfit(summary.omzet, summary.total_spend) : 0
  // Jumlah Tiket = metrik A25; sama dengan baris Total tabel sesi, bukan jumlah Order ID seperti `paid`.
  const totalTickets = matrix?.tickets ?? summary?.paid ?? 0
  const productOptions = (lists?.products ?? []).map((item) => ({ value: item.value, label: item.label }))
  const formSpend = form === null ? null : parseSpendInput(form.spend)
  const formTaxPercent = form === null ? null : parseTaxPercent(form.taxPercent)
  // Baris sudah terurut terbaru dulu; report milik sendiri pertama = PPN terakhir yang dipakai.
  const lastOwn = rows.find((row) => row.own)
  const lastTaxPercent = lastOwn === undefined ? '' : String(Number(lastOwn.tax_percent))

  return (
    <>
      <PageHeader
        title="Report Spend Iklan"
        action={canInput ? <Button variant="primary" onClick={() => openForm(emptyForm(lastTaxPercent))}>+ Input Biaya Iklan</Button> : undefined}
      />

      <div className="filter-bar flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-card p-3.5">
        <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5">
          <DateRangeFilters {...controls} />
          <ProductFilter {...controls} />
          <AdvertiserFilter {...controls} />
          <BatchFilter {...controls} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <FilterChip key={chip.key} label={chip.label} onRemove={() => state.removeFilter(chip.key)} />
          ))}
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
          {/* Fokus utama: Spend dan Profit/Boncos besar di atas, angka pendukung di bawah. */}
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
                    <TableCell>{describeDates(row.date_from, row.date_to)}</TableCell>
                    <TableCell>{row.product_name}</TableCell>
                    <TableCell>{row.advertiser_name}</TableCell>
                    <TableCell>{row.batch}</TableCell>
                    <TableCell align="right">{formatMoney(row.spend)}</TableCell>
                    <TableCell align="right">
                      {formatMoney(row.tax_amount)}
                      <span className="block text-[11px] text-ink-soft">{formatPercent(row.tax_percent)}</span>
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
                    {canInput ? (
                      <TableCell>
                        {row.own ? (
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openForm({
                                id: row.id,
                                productCode: row.product_code,
                                batch: row.batch,
                                dateFrom: row.date_from,
                                dateTo: row.date_to,
                                spend: String(Number(row.spend)),
                                taxPercent: String(Number(row.tax_percent)),
                              })}
                            >
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>
                              Hapus
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })}
            </DataTable>

            {!loading && data !== null && rows.length === 0 ? (
              <p className="border-t border-line px-3 py-8 text-center text-ink-soft">
                Belum ada report spend pada rentang tanggal ini.
              </p>
            ) : null}
          </Card>
        )}
      </div>

      <Modal
        open={form !== null}
        title={form?.id ? 'Edit Biaya Iklan' : 'Input Biaya Iklan'}
        onClose={closeForm}
        footer={overlap ? undefined : (
          <>
            <Button variant="secondary" onClick={closeForm} disabled={saving}>Batal</Button>
            <Button variant="primary" onClick={() => void submit(false)} loading={saving}>Simpan</Button>
          </>
        )}
      >
        {form === null ? null : (
          <div className="flex flex-col gap-3">
            <Combobox
              id="spend-product"
              label="Produk"
              value={form.productCode}
              options={productOptions}
              placeholder="Cari produk…"
              onChange={(value) => changeForm({ productCode: value })}
            />
            <TextInput
              id="spend-batch"
              label="Batch"
              value={form.batch}
              placeholder="mis. 122"
              maxLength={32}
              onChange={(value) => changeForm({ batch: value })}
            />
            <div>
              <p className="mb-1 block text-[12px] font-semibold text-ink-soft">Tanggal</p>
              <DateRangeField
                className="w-full"
                from={form.dateFrom}
                to={form.dateTo}
                onChange={(range) => changeForm({ dateFrom: range.from, dateTo: range.to })}
              />
            </div>
            <TextInput
              id="spend-amount"
              label="Biaya Iklan (Rp)"
              value={form.spend}
              inputMode="numeric"
              placeholder="mis. 6000000"
              onChange={(value) => changeForm({ spend: value })}
            />
            {formSpend === null ? null : <p className="-mt-2 text-[12px] text-ink-soft">{formatMoney(formSpend)} (sebelum PPN)</p>}
            <TextInput
              id="spend-tax"
              label="PPN Iklan (%)"
              value={form.taxPercent}
              inputMode="numeric"
              placeholder="mis. 11 (isi 0 bila tanpa PPN)"
              maxLength={6}
              onChange={(value) => changeForm({ taxPercent: value })}
            />
            {formSpend === null || formTaxPercent === null ? null : (
              <p className="-mt-2 text-[12px] text-ink-soft">
                Pajak {formatMoney(spendTax(formSpend, formTaxPercent))} · Total {formatMoney(formSpend + spendTax(formSpend, formTaxPercent))}
              </p>
            )}

            {formError === null ? null : <p className="text-[12px] text-danger">{formError}</p>}

            {overlap ? (
              <div className="rounded-md border border-warning/40 bg-warning-soft p-3" role="alert">
                <p className="font-semibold text-ink">Tanggal, produk, dan batch sudah ada.</p>
                <p className="mt-0.5 text-[12px] text-ink-soft">
                  Sudah ada report untuk produk dan batch ini pada tanggal yang sama atau bertumpuk.
                </p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={showExisting} disabled={saving}>Cek Report</Button>
                  <Button onClick={() => void submit(true)} loading={saving}>Tambahkan Data Ini</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Report Spend"
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
            Hapus report {deleting.product_name} batch {deleting.batch} ({describeDates(deleting.date_from, deleting.date_to)}),
            spend {formatMoney(deleting.spend)}?
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
              <TableRow key={`${row.advertiser_code}|${row.product_code}|${row.batch}`}>
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

