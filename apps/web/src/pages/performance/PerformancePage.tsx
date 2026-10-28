import { useEffect, useMemo, useState } from 'react'
import { formatCount, formatMoney, formatRate } from '../../lib/format'
import { hasAllProductAccess } from '../../lib/roles'
import { useAsyncData } from '../../lib/useAsyncData'
import { supabaseRpc, supabaseSelect } from '../../lib/supabase-rest'
import { useSession } from '../../lib/useSession'
import {
  ADVERTISER_SORT_OPTIONS,
  GRANULARITY_OPTIONS,
  PERIOD_PRESETS,
  advertiserLabel,
  costPerTicket,
  formatRoas,
  metricNumber,
  periodPresetRange,
  productLabel,
  resolveGranularity,
  sortAdvertisers,
  type AdvertiserPerformance,
  type AdvertiserSortKey,
  type BatchPerformance,
  type Granularity,
  type Numeric,
  type PerformanceDashboard,
  type PerformanceDetail,
  type PerformanceMetrics,
  type PeriodPresetKey,
  type TopProduct,
} from '../../lib/performance'
import { PageHeader } from '../../layout/PageHeader'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, CardHeader, KpiCard } from '../../ui/Card'
import { Select, SearchInput, TextInput } from '../../ui/Field'
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/Feedback'
import { FilterChip } from '../../ui/Filters'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { TrendChart } from '../../ui/TrendChart'
import { DateRangeField } from '../shared/DateRangeField'
import { CONTROL_WIDTH } from '../shared/FilterControls'

/**
 * A46: Performa / Analitik.
 *
 * Level 1 menampilkan SEMUA pengiklan secara individual (kartu/tabel), bukan total gabungan.
 * Klik satu pengiklan -> level 2: track record pengiklan itu, dua grafik kecil (uang & volume),
 * tabel periode dengan delta bulan/tahun, serta top 2 produk dan breakdown batch.
 *
 * Semua angka dihitung RPC `advertiser_performance`; halaman tidak menjumlahkan order sendiri.
 */

type PerformanceFilters = {
  advertiserCode: string
  productCode: string
  batch: string
  dateFrom: string
  dateTo: string
}

const DEFAULT_PERIOD: PeriodPresetKey = 'thisMonth'

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function profitClass(value: Numeric): string {
  const number = metricNumber(value)
  if (number > 0) return 'text-success'
  if (number < 0) return 'text-danger'
  return ''
}

/** Label sumbu/tabel: "01 Okt", "Okt 2026", atau "2026". */
export function formatPeriodLabel(value: string, granularity: Granularity): string {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month) return value
  if (granularity === 'year') return String(year)
  if (granularity === 'month') {
    return new Intl.DateTimeFormat('id-ID', { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1))
  }
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' }).format(new Date(year, month - 1, day ?? 1))
}

/** Angka sumbu Rupiah yang ringkas: 5 jt, 250 rb, 1,2 M. */
export function formatAxisMoney(value: number): string {
  if (!Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`
  return value.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

function coverageHint(metrics: PerformanceMetrics): string {
  if (metrics.tickets <= 0) return 'Belum ada tiket Paid pada periode ini.'
  const covered = Math.round((metrics.coverage ?? 0) * metrics.tickets)
  return `${formatRate(metrics.coverage)} tiket tercakup report spend (${formatCount(covered)} dari ${formatCount(metrics.tickets)}).`
}

function topProductsText(products: readonly TopProduct[]): string {
  if (products.length === 0) return '-'
  return products.map((product) => `${productLabel(product)} (${formatCount(product.tickets)} tiket)`).join(' · ')
}

function currentPeriodKey(filters: PerformanceFilters): PeriodPresetKey {
  const match = PERIOD_PRESETS.find((preset) => {
    if (preset.key === 'custom') return false
    const range = periodPresetRange(preset.key)
    return range.from === filters.dateFrom && range.to === filters.dateTo
  })
  return match?.key ?? 'custom'
}

type CodeRow = { code: string; name: string }
type PerformanceLists = {
  products: Array<{ value: string; label: string }>
  advertisers: Array<{ value: string; label: string }>
}

/**
 * Hanya produk + pengiklan. Sengaja tidak memakai `useConfigLists` yang juga membaca
 * fee rule/event type/sesi: role yang hanya punya `operasional.analytics` tidak perlu
 * izin konfigurasi lain.
 */
function usePerformanceLists(includeAdvertisers: boolean): { lists: PerformanceLists | null; error: string | null } {
  const { data, error } = useAsyncData(async () => {
    const [products, advertisers] = await Promise.all([
      supabaseSelect<CodeRow>('products', { active: 'is.true' }, 'code,name'),
      // Akun berproduk terbatas memakai pilihan dari hasil RPC, bukan seluruh tabel pengiklan.
      includeAdvertisers
        ? supabaseSelect<CodeRow>('advertisers', { active: 'is.true' }, 'code,name')
        : Promise.resolve([] as CodeRow[]),
    ])
    const toOptions = (rows: CodeRow[]) =>
      rows
        .map((row) => ({ value: row.code, label: `${row.code} - ${row.name}` }))
        .sort((left, right) => left.value.localeCompare(right.value, 'id'))
    return { products: toOptions(products), advertisers: toOptions(advertisers) }
  }, [includeAdvertisers])
  return { lists: data, error }
}

export function PerformancePage() {
  const initial = periodPresetRange(DEFAULT_PERIOD)
  const session = useSession()
  const profile = session.profile
  // A48: halaman Performa hanya menampilkan pengiklan akun; halaman lain tetap mengikuti A44.
  const ownAdvertiser = (profile?.advertiser_code ?? '').trim()
  const ownScope = ownAdvertiser !== ''
  const fullAccess = hasAllProductAccess(profile)
  const [filters, setFilters] = useState<PerformanceFilters>({
    advertiserCode: '',
    productCode: '',
    batch: '',
    dateFrom: initial.from,
    dateTo: initial.to,
  })
  const [granularityMode, setGranularityMode] = useState<'auto' | Granularity>('auto')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [sortKey, setSortKey] = useState<AdvertiserSortKey>('omzet')
  const [search, setSearch] = useState('')
  const [customPeriod, setCustomPeriod] = useState(false)
  // Pilihan pengiklan untuk akun berproduk terbatas (Pimpro): hanya yang muncul di hasil RPC.
  const [advertiserChoices, setAdvertiserChoices] = useState<AdvertiserPerformance[]>([])

  const { lists } = usePerformanceLists(fullAccess)
  const effectiveGranularity = resolveGranularity(granularityMode, filters.dateFrom, filters.dateTo)
  const periodKey = customPeriod ? 'custom' : currentPeriodKey(filters)
  const effectiveAdvertiserCode = ownScope ? ownAdvertiser : filters.advertiserCode

  const appliedKey = JSON.stringify([filters, effectiveAdvertiserCode, effectiveGranularity])
  const { data, loading, error, reload } = useAsyncData<PerformanceDashboard | PerformanceDetail>(() => {
    return supabaseRpc<PerformanceDashboard | PerformanceDetail>('advertiser_performance', {
      p_advertiser_code: emptyToNull(effectiveAdvertiserCode),
      p_product_code: emptyToNull(filters.productCode),
      p_batch: emptyToNull(filters.batch),
      p_date_from: emptyToNull(filters.dateFrom),
      p_date_to: emptyToNull(filters.dateTo),
      p_granularity: effectiveGranularity,
    })
  }, [appliedKey])

  const detail = data !== null && 'summary' in data ? data : null
  const dashboard = data !== null && 'advertisers' in data ? data : null

  useEffect(() => {
    if (dashboard !== null) setAdvertiserChoices(dashboard.advertisers)
  }, [dashboard])

  const advertiserOptions = ownScope
    ? [{
        value: ownAdvertiser,
        label: `${ownAdvertiser} - ${profile?.advertiser_name ?? ownAdvertiser}`,
      }]
    : fullAccess
      ? (lists?.advertisers ?? []).map((item) => ({ value: item.value, label: item.label }))
      : advertiserChoices
          .filter((row): row is AdvertiserPerformance & { advertiser_code: string } => row.advertiser_code !== null)
          .map((row) => ({
            value: row.advertiser_code,
            // Sama dengan label dropdown konfigurasi: "01 - Zul".
            label: row.advertiser_name === null
              ? row.advertiser_code
              : `${row.advertiser_code} - ${row.advertiser_name}`,
          }))
          .sort((left, right) => left.value.localeCompare(right.value, 'id'))
  const productOptions = (lists?.products ?? []).map((item) => ({ value: item.value, label: item.label }))
  const periodLabel = PERIOD_PRESETS.find((preset) => preset.key === periodKey)?.label ?? 'Kustom'

  const filteredAdvertisers = useMemo(() => {
    if (dashboard === null) return []
    const needle = search.trim().toLowerCase()
    const rows = needle === ''
      ? dashboard.advertisers
      : dashboard.advertisers.filter((row) =>
          `${row.advertiser_name ?? ''} ${row.advertiser_code ?? ''}`.toLowerCase().includes(needle),
        )
    return sortAdvertisers(rows, sortKey)
  }, [dashboard, search, sortKey])

  function changeFilters(patch: Partial<PerformanceFilters>): void {
    setFilters((current) => ({ ...current, ...patch }))
  }

  function choosePeriod(key: PeriodPresetKey): void {
    if (key === 'custom') {
      setCustomPeriod(true)
      return
    }
    setCustomPeriod(false)
    const range = periodPresetRange(key)
    changeFilters({ dateFrom: range.from, dateTo: range.to })
  }

  function chooseDateRange(range: { from: string; to: string }): void {
    if (range.from === '' || range.to === '') {
      choosePeriod(DEFAULT_PERIOD)
      return
    }
    setCustomPeriod(true)
    changeFilters({ dateFrom: range.from, dateTo: range.to })
  }

  function clearAll(): void {
    const range = periodPresetRange(DEFAULT_PERIOD)
    setFilters({ advertiserCode: '', productCode: '', batch: '', dateFrom: range.from, dateTo: range.to })
    setGranularityMode('auto')
    setCustomPeriod(false)
    setSearch('')
  }

  function openAdvertiser(row: AdvertiserPerformance): void {
    if (ownScope || row.advertiser_code === null) return
    changeFilters({ advertiserCode: row.advertiser_code })
    setSearch('')
  }

  const chips = [
    ownScope || filters.advertiserCode === '' ? null : {
      key: 'advertiser',
      label: `Pengiklan: ${advertiserOptions.find((item) => item.value === filters.advertiserCode)?.label ?? filters.advertiserCode}`,
      onRemove: () => changeFilters({ advertiserCode: '' }),
    },
    filters.productCode === '' ? null : {
      key: 'product',
      label: `Produk: ${productOptions.find((item) => item.value === filters.productCode)?.label ?? filters.productCode}`,
      onRemove: () => changeFilters({ productCode: '' }),
    },
    filters.batch.trim() === '' ? null : {
      key: 'batch',
      label: `Batch: ${filters.batch}`,
      onRemove: () => changeFilters({ batch: '' }),
    },
    {
      key: 'period',
      label: `Periode: ${periodLabel}`,
      onRemove: () => choosePeriod(DEFAULT_PERIOD),
    },
  ].filter((chip): chip is { key: string; label: string; onRemove: () => void } => chip !== null)

  const controls = (
    <div className="filter-bar flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-card p-3.5">
      <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5">
        {ownScope ? null : (
          <Select
            id="filter-pengiklan-performa"
            ariaLabel="Filter pengiklan"
            className={CONTROL_WIDTH}
            value={filters.advertiserCode}
            placeholder="Semua pengiklan"
            options={advertiserOptions}
            onChange={(value) => changeFilters({ advertiserCode: value })}
          />
        )}
        <Select
          id="filter-produk-performa"
          ariaLabel="Filter produk"
          className={CONTROL_WIDTH}
          value={filters.productCode}
          placeholder="Semua produk"
          options={productOptions}
          onChange={(value) => changeFilters({ productCode: value })}
        />
        <TextInput
          id="filter-batch-performa"
          ariaLabel="Filter batch"
          className={CONTROL_WIDTH}
          value={filters.batch}
          placeholder="Batch (mis. 392)"
          onChange={(value) => changeFilters({ batch: value })}
        />
        <Select
          id="filter-periode-performa"
          ariaLabel="Filter periode"
          className={CONTROL_WIDTH}
          value={periodKey === 'custom' ? 'custom' : periodKey}
          options={PERIOD_PRESETS.map((preset) => ({ value: preset.key, label: preset.label }))}
          onChange={(value) => choosePeriod(value as PeriodPresetKey)}
        />
        {periodKey === 'custom' ? (
          <DateRangeField
            className={CONTROL_WIDTH}
            from={filters.dateFrom}
            to={filters.dateTo}
            onChange={chooseDateRange}
          />
        ) : null}
        {effectiveAdvertiserCode === '' ? null : (
          <Select
            id="filter-granularitas-performa"
            ariaLabel="Granularitas grafik"
            className={CONTROL_WIDTH}
            value={granularityMode}
            options={GRANULARITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(value) => setGranularityMode(value as 'auto' | Granularity)}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <FilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
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
  )

  return (
    <>
      <PageHeader
        title="Performa / Analitik"
        description="Track record tiap pengiklan: spend, omzet, profit, closing rate, tiket, dan ROAS."
      />

      {controls}

      {error === null ? null : (
        <div className="mt-4">
          <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
        </div>
      )}

      {loading && data === null ? (
        <div className="mt-4">
          <Card>
            <SkeletonRows rows={8} />
          </Card>
        </div>
      ) : detail !== null ? (
        <PerformanceDetailView
          detail={detail}
          granularity={effectiveGranularity}
          advertiserName={advertiserOptions.find((item) => item.value === effectiveAdvertiserCode)?.label ?? effectiveAdvertiserCode}
          onBack={ownScope ? undefined : () => changeFilters({ advertiserCode: '' })}
        />
      ) : (
        <PerformanceDashboardView
          advertisers={filteredAdvertisers}
          total={dashboard?.advertisers.length ?? 0}
          view={view}
          sortKey={sortKey}
          search={search}
          onSearch={setSearch}
          onSort={setSortKey}
          onView={setView}
          onOpen={openAdvertiser}
        />
      )}
    </>
  )
}

function PerformanceDashboardView({
  advertisers,
  total,
  view,
  sortKey,
  search,
  onSearch,
  onSort,
  onView,
  onOpen,
}: {
  advertisers: AdvertiserPerformance[]
  total: number
  view: 'cards' | 'table'
  sortKey: AdvertiserSortKey
  search: string
  onSearch: (value: string) => void
  onSort: (value: AdvertiserSortKey) => void
  onView: (value: 'cards' | 'table') => void
  onOpen: (row: AdvertiserPerformance) => void
}) {
  return (
    <div className="mt-4">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Semua Pengiklan</h2>
          <p className="text-[12px] text-ink-soft">
            {advertisers.length === total ? `${formatCount(total)} pengiklan` : `${formatCount(advertisers.length)} dari ${formatCount(total)} pengiklan`}
          </p>
        </div>
        <SearchInput id="cari-pengiklan-performa" value={search} onChange={onSearch} placeholder="Cari pengiklan…" />
        <div className="flex items-center gap-2">
          <Select
            id="urut-pengiklan-performa"
            ariaLabel="Urutkan pengiklan"
            className="w-[170px]"
            value={sortKey}
            options={ADVERTISER_SORT_OPTIONS.map((option) => ({ value: option.value, label: `Urut: ${option.label}` }))}
            onChange={(value) => onSort(value as AdvertiserSortKey)}
          />
          <div className="inline-flex rounded-sm border border-line bg-card p-0.5" role="group" aria-label="Tampilan daftar pengiklan">
            <button
              type="button"
              aria-pressed={view === 'cards'}
              onClick={() => onView('cards')}
              className={`rounded-xs px-3 py-1.5 text-[12px] font-semibold ${view === 'cards' ? 'bg-primary text-white' : 'text-ink-soft hover:text-ink'}`}
            >
              Kartu
            </button>
            <button
              type="button"
              aria-pressed={view === 'table'}
              onClick={() => onView('table')}
              className={`rounded-xs px-3 py-1.5 text-[12px] font-semibold ${view === 'table' ? 'bg-primary text-white' : 'text-ink-soft hover:text-ink'}`}
            >
              Tabel
            </button>
          </div>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          title="Belum ada data pengiklan"
          description="Tidak ada order atau report spend pada periode dan filter ini."
        />
      ) : advertisers.length === 0 ? (
        <EmptyState title="Pengiklan tidak ditemukan" description="Coba kata kunci lain." />
      ) : view === 'cards' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {advertisers.map((row) => (
            <AdvertiserCard key={row.advertiser_code ?? advertiserLabel(row)} row={row} onOpen={() => onOpen(row)} />
          ))}
        </div>
      ) : (
        <AdvertiserTable rows={advertisers} onOpen={onOpen} />
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string
  value: string
  hint?: string
  valueClassName?: string
}) {
  return (
    <span className="block min-w-0">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <span className={`block truncate text-[13px] font-semibold ${valueClassName ?? 'text-ink'}`}>{value}</span>
      {hint === undefined ? null : <span className="block truncate text-[10px] text-ink-soft">{hint}</span>}
    </span>
  )
}

function AdvertiserCard({ row, onOpen }: { row: AdvertiserPerformance; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full min-w-0 flex-col rounded-lg border border-line bg-card p-4 text-left shadow-card transition-colors hover:border-primary/30 hover:bg-soft/40"
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-ink">{advertiserLabel(row)}</span>
          <span className="block text-[11px] text-ink-soft">Total Spend {formatMoney(row.total_spend)}</span>
        </span>
        <Badge tone="primary">ROAS {formatRoas(row.roas)}</Badge>
      </span>

      <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <Metric label="Omzet" value={formatMoney(row.omzet)} />
        <Metric label="Profit / Boncos" value={formatMoney(row.profit)} valueClassName={profitClass(row.profit)} />
        <Metric label="Tiket Terjual" value={formatCount(row.tickets)} hint={`${formatCount(row.paid)} order Paid`} />
        <Metric
          label="Closing Rate"
          value={formatRate(row.closing_rate)}
          hint={`${formatCount(row.tickets)} tiket / ${formatCount(row.leads)} leads`}
        />
      </span>

      <span className="mt-3 block border-t border-line pt-2">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Top 2 Produk (tiket)</span>
        {row.top_products.length === 0 ? (
          <span className="mt-1 block text-[12px] text-ink-soft">Belum ada tiket Paid.</span>
        ) : (
          row.top_products.map((product, index) => (
            <span key={`${product.product_code ?? product.product_name ?? index}`} className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[12px]">
              <span className="truncate text-ink">{index + 1}. {productLabel(product)}</span>
              <span className="shrink-0 font-semibold text-ink">{formatCount(product.tickets)} tiket</span>
            </span>
          ))
        )}
      </span>

      <span className="mt-3 block text-[11px] font-semibold text-primary group-hover:underline">Lihat detail →</span>
    </button>
  )
}

const ADVERTISER_COLUMNS: readonly TableColumn[] = [
  { key: 'advertiser', header: 'Pengiklan', minWidth: 170 },
  { key: 'spend', header: 'Total Spend', align: 'right', minWidth: 130 },
  { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
  { key: 'profit', header: 'Profit / Boncos', align: 'right', minWidth: 140 },
  { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 90 },
  { key: 'closing', header: 'Closing Rate', align: 'right', minWidth: 120 },
  { key: 'roas', header: 'ROAS', align: 'right', minWidth: 90 },
  { key: 'top', header: 'Top 2 Produk', minWidth: 240 },
]

function AdvertiserTable({ rows, onOpen }: { rows: AdvertiserPerformance[]; onOpen: (row: AdvertiserPerformance) => void }) {
  return (
    <Card padding="none">
      <DataTable columns={ADVERTISER_COLUMNS}>
        {rows.map((row) => (
          <TableRow key={row.advertiser_code ?? advertiserLabel(row)}>
            <TableCell>
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="text-left font-semibold text-primary hover:underline"
              >
                {advertiserLabel(row)}
              </button>
            </TableCell>
            <TableCell align="right">{formatMoney(row.total_spend)}</TableCell>
            <TableCell align="right">{formatMoney(row.omzet)}</TableCell>
            <TableCell align="right">
              <span className={profitClass(row.profit)}>{formatMoney(row.profit)}</span>
            </TableCell>
            <TableCell align="right">{formatCount(row.tickets)}</TableCell>
            <TableCell align="right">
              {formatRate(row.closing_rate)}
              <span className="block text-[10px] text-ink-soft">{formatCount(row.tickets)} / {formatCount(row.leads)}</span>
            </TableCell>
            <TableCell align="right">{formatRoas(row.roas)}</TableCell>
            <TableCell>{topProductsText(row.top_products)}</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </Card>
  )
}

function PerformanceDetailView({
  detail,
  granularity,
  advertiserName,
  onBack,
}: {
  detail: PerformanceDetail
  granularity: Granularity
  advertiserName: string
  /** Akun Advertiser tidak punya daftar pengiklan, jadi tombol kembali disembunyikan. */
  onBack?: () => void
}) {
  const summary = detail.summary
  const labels = detail.rows.map((row) => formatPeriodLabel(row.period_start, granularity))
  const spendValues = detail.rows.map((row) => metricNumber(row.spend))
  const omzetValues = detail.rows.map((row) => metricNumber(row.omzet))
  const profitValues = detail.rows.map((row) => metricNumber(row.profit))
  const profit = metricNumber(summary.profit)
  const title = advertiserName.trim() === '' ? 'Detail Pengiklan' : advertiserName

  return (
    <div className="mt-4">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        {onBack === undefined ? null : <Button variant="ghost" size="sm" onClick={onBack}>← Semua pengiklan</Button>}
        <h2 className="min-w-0 truncate text-[16px] font-semibold text-ink">{title}</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          size="lg"
          label="Total Spend"
          value={formatMoney(summary.total_spend)}
          hint={`Spend ${formatMoney(summary.spend)} + PPN ${formatMoney(summary.tax_amount)}`}
          highlight
        />
        <KpiCard size="lg" label="Omzet" value={formatMoney(summary.omzet)} hint="Gross order Paid" />
        <KpiCard
          size="lg"
          label={profit < 0 ? 'Boncos' : 'Profit'}
          value={formatMoney(summary.profit)}
          valueClassName={profit < 0 ? 'text-danger' : profit > 0 ? 'text-success' : ''}
          hint="Omzet − Total Spend"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          label="Tiket Terjual"
          value={formatCount(summary.tickets)}
          hint={`${formatCount(summary.paid)} order Paid`}
        />
        <KpiCard
          label="Closing Rate"
          value={formatRate(summary.closing_rate)}
          hint={`${formatCount(summary.tickets)} tiket ÷ ${formatCount(summary.leads)} leads`}
        />
        <KpiCard label="ROAS" value={formatRoas(summary.roas)} hint="Omzet ÷ (Spend + PPN)" />
      </div>

      <p className="mt-2 text-[12px] text-ink-soft">
        Coverage report: {coverageHint(summary)} Cost/Tiket: {costPerTicket(summary) === null ? '-' : formatMoney(costPerTicket(summary) as number)}.
      </p>

      <Card className="mt-3">
        <CardHeader title="Top 2 Produk" description="Berdasarkan tiket terjual (order Paid), level produk." />
        {detail.top_products.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Belum ada tiket Paid pada periode ini.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {detail.top_products.map((product, index) => (
              <div key={`${product.product_code ?? product.product_name ?? index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-line bg-soft/50 p-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{index + 1}. {productLabel(product)}</p>
                  <p className="text-[11px] text-ink-soft">{formatMoney(product.omzet)} omzet</p>
                </div>
                <p className="shrink-0 text-right text-[13px] font-bold text-ink">{formatCount(product.tickets)} tiket</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Spend x Waktu" description="Spend sebelum PPN pada periode yang dipilih." />
          {detail.rows.length === 0 ? <p className="text-[13px] text-ink-soft">Belum ada data.</p> : (
            <TrendChart
              labels={labels}
              series={[{ key: 'spend', label: 'Spend', color: '#4f46f5', values: spendValues }]}
              formatValue={formatMoney}
              formatAxis={formatAxisMoney}
              ariaLabel="Grafik garis spend"
              soft
            />
          )}
        </Card>
        <Card>
          <CardHeader title="Omzet x Waktu" description="Gross order Paid pada periode yang dipilih." />
          {detail.rows.length === 0 ? <p className="text-[13px] text-ink-soft">Belum ada data.</p> : (
            <TrendChart
              labels={labels}
              series={[{ key: 'omzet', label: 'Omzet', color: '#35c96c', values: omzetValues }]}
              formatValue={formatMoney}
              formatAxis={formatAxisMoney}
              ariaLabel="Grafik garis omzet"
              soft
            />
          )}
        </Card>
        <Card>
          <CardHeader title="Profit x Waktu" description="Omzet − Total Spend; nilai negatif berarti boncos." />
          {detail.rows.length === 0 ? <p className="text-[13px] text-ink-soft">Belum ada data.</p> : (
            <TrendChart
              labels={labels}
              series={[{ key: 'profit', label: 'Profit', color: '#f5b94c', values: profitValues }]}
              formatValue={formatMoney}
              formatAxis={formatAxisMoney}
              ariaLabel="Grafik garis profit"
              soft
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ProductTable products={detail.products} />
        <BatchTable batches={detail.batches} />
      </div>
    </div>
  )
}

function ProductTable({ products }: { products: TopProduct[] }) {
  const totalTickets = products.reduce((sum, product) => sum + product.tickets, 0)
  return (
    <Card padding="none">
      <div className="px-3.5 pb-2 pt-3">
        <h2 className="text-[14px] font-semibold text-ink">Breakdown Produk</h2>
        <p className="mt-0.5 text-[12px] text-ink-soft">Semua produk dengan tiket Paid pada periode ini.</p>
      </div>
      {products.length === 0 ? (
        <p className="border-t border-line px-3 py-6 text-center text-ink-soft">Belum ada tiket Paid.</p>
      ) : (
        <DataTable
          columns={[
            { key: 'product', header: 'Produk', minWidth: 180 },
            { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 80 },
            { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
            { key: 'share', header: 'Share', align: 'right', minWidth: 80 },
          ]}
          stickyHeader={false}
        >
          {products.map((product) => (
            <TableRow key={product.product_code ?? product.product_name ?? 'tanpa-produk'}>
              <TableCell>{productLabel(product)}</TableCell>
              <TableCell align="right">{formatCount(product.tickets)}</TableCell>
              <TableCell align="right">{formatMoney(product.omzet)}</TableCell>
              <TableCell align="right">{formatRate(totalTickets === 0 ? null : product.tickets / totalTickets)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      )}
    </Card>
  )
}

function BatchTable({ batches }: { batches: BatchPerformance[] }) {
  return (
    <Card padding="none">
      <div className="px-3.5 pb-2 pt-3">
        <h2 className="text-[14px] font-semibold text-ink">Breakdown Batch</h2>
        <p className="mt-0.5 text-[12px] text-ink-soft">Kontribusi batch terhadap tiket, omzet, dan spend.</p>
      </div>
      {batches.length === 0 ? (
        <p className="border-t border-line px-3 py-6 text-center text-ink-soft">Belum ada tiket Paid.</p>
      ) : (
        <DataTable
          columns={[
            { key: 'batch', header: 'Batch', minWidth: 80 },
            { key: 'spend', header: 'Total Spend', align: 'right', minWidth: 130 },
            { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 80 },
            { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
            { key: 'profit', header: 'Profit / Boncos', align: 'right', minWidth: 130 },
            { key: 'roas', header: 'ROAS', align: 'right', minWidth: 80 },
          ]}
          stickyHeader={false}
        >
          {batches.map((batch) => (
            <TableRow key={batch.batch ?? 'tanpa-batch'}>
              <TableCell>{batch.batch ?? '-'}</TableCell>
              <TableCell align="right">{formatMoney(batch.total_spend)}</TableCell>
              <TableCell align="right">{formatCount(batch.tickets)}</TableCell>
              <TableCell align="right">{formatMoney(batch.omzet)}</TableCell>
              <TableCell align="right">
                <span className={profitClass(batch.profit)}>{formatMoney(batch.profit)}</span>
              </TableCell>
              <TableCell align="right">{formatRoas(batch.roas)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      )}
    </Card>
  )
}
