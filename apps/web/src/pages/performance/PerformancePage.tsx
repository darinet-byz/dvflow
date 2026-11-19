import { useEffect, useMemo, useState } from 'react'
import { formatCount, formatDate, formatMoney, formatRate } from '../../lib/format'
import { hasAllProductAccess } from '../../lib/roles'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { supabaseRpc, supabaseSelect } from '../../lib/supabase-rest'
import { useSession } from '../../lib/useSession'
import {
  ADVERTISER_SORT_OPTIONS,
  BATCH_RECENT_LIMIT,
  GRANULARITY_OPTIONS,
  PERIOD_PRESETS,
  PRODUCT_RECENT_BATCHES,
  advertiserLabel,
  costPerTicket,
  deltaClass,
  fetchPerformanceKpi,
  formatDeltaPercent,
  formatPeriodRangeLabel,
  formatRoas,
  isSingleMonthPeriod,
  kpiMeets,
  metricNumber,
  periodPresetRange,
  productLabel,
  resolveGranularity,
  sortAdvertisers,
  type AdvertiserPerformance,
  type AdvertiserSortKey,
  type BatchBreakdown,
  type Granularity,
  type Numeric,
  type PerformanceBreakdown,
  type PerformanceDashboard,
  type PerformanceDetail,
  type PerformanceMetrics,
  type PerformancePeriodRow,
  type PeriodPresetKey,
  type ProductPerformance,
  type TopProduct,
} from '../../lib/performance'
import { PageHeader } from '../../layout/PageHeader'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, CardHeader, KpiCard } from '../../ui/Card'
import { ComparisonChart } from '../../ui/ComparisonChart'
import { Select, SearchInput, TextInput } from '../../ui/Field'
import { SuggestInput } from '../../ui/SuggestInput'
import { describeRecentBatch, useRecentBatches } from '../../lib/recent-batches'
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

/** A80: warna kedisiplinan — hijau >= 80%, kuning >= 50%, merah di bawahnya. */
function disciplineClass(rate: number | null): string {
  if (rate === null) return 'text-ink-soft'
  if (rate >= 0.8) return 'text-success'
  if (rate >= 0.5) return 'text-warning'
  return 'text-danger'
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
  if (metrics.coverage === null || metrics.coverage === undefined) {
    return 'Coverage report tidak dihitung pada tampilan tahunan.'
  }
  const covered = Math.round(metrics.coverage * metrics.tickets)
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
  // A83: detail memakai tahun kalender berjalan dan hanya filter pengiklan/produk.
  const detailMode = effectiveAdvertiserCode.trim() !== ''
  const yearRange = periodPresetRange('thisYear')
  const singleMonth = !detailMode && isSingleMonthPeriod(filters.dateFrom, filters.dateTo)
  const periodMonth = singleMonth ? filters.dateFrom.slice(0, 7) : null
  const [kpiTarget, setKpiTarget] = useState<number | null>(null)
  const [kpiInput, setKpiInput] = useState('')
  const [kpiBusy, setKpiBusy] = useState(false)
  const [kpiMessage, setKpiMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const { batches: recentBatches } = useRecentBatches(filters.productCode, effectiveAdvertiserCode)
  const batchSuggestions = recentBatches.map((batch) => {
    const described = describeRecentBatch(batch)
    return { value: batch.batch, label: described.label, hint: described.hint }
  })

  const loadKey = detailMode
    ? JSON.stringify(['year', effectiveAdvertiserCode, filters.productCode])
    : JSON.stringify([filters, effectiveAdvertiserCode, effectiveGranularity])
  const { data, loading, error, reload } = useAsyncData<PerformanceDashboard | PerformanceDetail>(() => {
    if (detailMode) {
      return supabaseRpc<PerformanceDetail>('advertiser_performance_year', {
        p_advertiser_code: effectiveAdvertiserCode,
        p_product_code: emptyToNull(filters.productCode),
      })
    }
    return supabaseRpc<PerformanceDashboard>('advertiser_performance', {
      p_advertiser_code: null,
      p_product_code: emptyToNull(filters.productCode),
      p_batch: emptyToNull(filters.batch),
      p_date_from: emptyToNull(filters.dateFrom),
      p_date_to: emptyToNull(filters.dateTo),
      p_granularity: effectiveGranularity,
    })
  }, [loadKey])

  const detail = data !== null && 'summary' in data ? data : null
  const dashboard = data !== null && 'advertisers' in data ? data : null

  // A56: breakdown batch/produk sengaja TIDAK memakai tanggal — RPC-nya juga tidak
  // punya parameter tanggal. Hanya pengiklan + filter produk/batch yang diteruskan.
  // `key` disimpan bersama hasil agar data pengiklan lama tidak tampil sesaat
  // ketika pengguna berpindah pengiklan (useAsyncData menahan data sebelumnya).
  const breakdownKey = JSON.stringify([effectiveAdvertiserCode, filters.productCode, detailMode ? '' : filters.batch])
  const {
    data: breakdownState,
    loading: breakdownLoading,
    error: breakdownError,
    reload: reloadBreakdown,
  } = useAsyncData<{ key: string; value: PerformanceBreakdown } | null>(() => {
    const code = effectiveAdvertiserCode.trim()
    if (code === '') return Promise.resolve(null)
    return supabaseRpc<PerformanceBreakdown>('advertiser_breakdown', {
      p_advertiser_code: code,
      p_product_code: emptyToNull(filters.productCode),
      p_batch: detailMode ? null : emptyToNull(filters.batch),
      p_limit: 200,
      // A57: produk = 2 batch terakhir per produk; batch = 5 terakhir (dipakai
      // hanya setelah produk dipilih).
      p_recent_batches_per_product: PRODUCT_RECENT_BATCHES,
      p_batch_limit: BATCH_RECENT_LIMIT,
    }).then((value) => ({ key: breakdownKey, value }))
  }, [breakdownKey])
  const breakdown = breakdownState !== null && breakdownState.key === breakdownKey ? breakdownState.value : null
  // Saat kunci berubah, useAsyncData belum menyalakan `loading` pada render pertama.
  const breakdownPending = breakdown === null && effectiveAdvertiserCode.trim() !== ''

  useEffect(() => {
    if (dashboard !== null) setAdvertiserChoices(dashboard.advertisers)
  }, [dashboard])

  // A83: KPI dibaca lewat RLS (izin operasional.analytics), ditulis lewat backend.
  useEffect(() => {
    if (periodMonth === null) {
      setKpiTarget(null)
      setKpiInput('')
      setKpiMessage(null)
      return
    }
    let active = true
    fetchPerformanceKpi(periodMonth)
      .then((kpi) => {
        if (!active) return
        setKpiTarget(kpi.target_tickets)
        setKpiInput(kpi.target_tickets === null ? '' : String(kpi.target_tickets))
      })
      .catch(() => {
        if (!active) return
        setKpiTarget(null)
        setKpiInput('')
      })
    return () => {
      active = false
    }
  }, [periodMonth])

  async function saveKpi(): Promise<void> {
    if (periodMonth === null || kpiBusy) return
    const value = Number(kpiInput)
    if (!Number.isInteger(value) || value < 1) {
      setKpiMessage({ tone: 'danger', text: 'KPI harus bilangan bulat minimal 1.' })
      return
    }
    setKpiBusy(true)
    setKpiMessage(null)
    try {
      const result = await authorizedRequest<{ target_tickets: number }>('/api/performance/kpi', {
        method: 'PUT',
        body: { month: periodMonth, target_tickets: value },
      })
      setKpiTarget(result.target_tickets)
      setKpiInput(String(result.target_tickets))
      setKpiMessage({ tone: 'success', text: 'KPI disimpan.' })
    } catch (failure) {
      setKpiMessage({ tone: 'danger', text: failure instanceof Error ? failure.message : 'KPI gagal disimpan.' })
    } finally {
      setKpiBusy(false)
    }
  }

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
  const selectedProductLabel = filters.productCode === ''
    ? ''
    : productOptions.find((item) => item.value === filters.productCode)?.label ?? filters.productCode
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
    detailMode || filters.batch.trim() === '' ? null : {
      key: 'batch',
      label: `Batch: ${filters.batch}`,
      onRemove: () => changeFilters({ batch: '' }),
    },
    detailMode ? null : {
      key: 'period',
      label: `Periode: ${periodLabel}`,
      onRemove: () => choosePeriod(DEFAULT_PERIOD),
    },
  ].filter((chip): chip is { key: string; label: string; onRemove: () => void } => chip !== null)

  const controls = (
    <div className="filter-bar flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-card p-3.5">
      <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5">
        <Select
          id="filter-produk-performa"
          ariaLabel="Filter produk"
          className={CONTROL_WIDTH}
          value={filters.productCode}
          placeholder="Semua produk"
          options={productOptions}
          onChange={(value) => changeFilters({ productCode: value })}
        />
        {detailMode ? null : (
          <SuggestInput
            id="filter-batch-performa"
            ariaLabel="Filter batch"
            className={CONTROL_WIDTH}
            value={filters.batch}
            placeholder={filters.productCode === '' ? 'Batch (pilih produk untuk saran)' : 'Batch (mis. 392)'}
            options={batchSuggestions}
            onChange={(value) => changeFilters({ batch: value })}
          />
        )}
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
        {detailMode ? (
          <span className="text-[12px] font-semibold text-ink-soft">Tahun {yearRange.from.slice(0, 4)}</span>
        ) : (
          <>
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
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <FilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
        ))}
        <button
          type="button"
          onClick={detailMode ? () => changeFilters({ productCode: '' }) : clearAll}
          className="ml-auto text-[12px] font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline"
        >
          {detailMode ? 'Clear Produk' : 'Clear All'}
        </button>
      </div>
    </div>
  )

  return (
    <>
      <PageHeader
        title="Performa / Analitik"
        description="Track record tiap pengiklan: tiket, ROAS, kedisiplinan iklan, profit, dan closing rate. Data iklan/online, tanpa OTS."
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
          breakdown={breakdown}
          breakdownLoading={breakdownLoading || breakdownPending}
          breakdownError={breakdownError}
          onReloadBreakdown={reloadBreakdown}
          granularity={detailMode ? 'month' : effectiveGranularity}
          dateFrom={detailMode ? yearRange.from : filters.dateFrom}
          dateTo={detailMode ? yearRange.to : filters.dateTo}
          productSelected={filters.productCode !== ''}
          selectedProductLabel={selectedProductLabel}
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
          kpiTarget={kpiTarget}
          kpiInput={kpiInput}
          kpiMonthLabel={periodMonth === null ? '' : formatPeriodLabel(`${periodMonth}-01`, 'month')}
          kpiBusy={kpiBusy}
          kpiMessage={kpiMessage}
          showKpi={singleMonth}
          onKpiInput={setKpiInput}
          onSaveKpi={() => void saveKpi()}
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
  kpiTarget,
  kpiInput,
  kpiMonthLabel,
  kpiBusy,
  kpiMessage,
  showKpi,
  onKpiInput,
  onSaveKpi,
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
  /** A83: KPI global bulan berjalan; null bila belum diatur. */
  kpiTarget: number | null
  kpiInput: string
  kpiMonthLabel: string
  kpiBusy: boolean
  kpiMessage: { tone: 'success' | 'danger'; text: string } | null
  showKpi: boolean
  onKpiInput: (value: string) => void
  onSaveKpi: () => void
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
        {showKpi ? (
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <div className="w-[230px]">
              <TextInput
                id="kpi-performa"
                type="number"
                inputMode="numeric"
                label={kpiMonthLabel === '' ? 'KPI tiket / pengiklan / bulan' : `KPI ${kpiMonthLabel}`}
                value={kpiInput}
                placeholder="mis. 100"
                disabled={kpiBusy}
                onChange={onKpiInput}
              />
            </div>
            <Button size="sm" variant="primary" loading={kpiBusy} onClick={onSaveKpi}>Simpan</Button>
            {kpiMessage === null ? null : (
              <span className={`text-[11px] font-semibold ${kpiMessage.tone === 'success' ? 'text-success' : 'text-danger'}`}>
                {kpiMessage.text}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-ink-soft">KPI hanya untuk periode satu bulan.</span>
        )}
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
            <AdvertiserCard key={row.advertiser_code ?? advertiserLabel(row)} row={row} kpiTarget={kpiTarget} onOpen={() => onOpen(row)} />
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

function AdvertiserCard({ row, kpiTarget, onOpen }: { row: AdvertiserPerformance; kpiTarget: number | null; onOpen: () => void }) {
  const kpi = kpiMeets(row.tickets, kpiTarget)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full min-w-0 flex-col rounded-lg border border-line bg-card p-4 text-left shadow-card transition-colors hover:border-primary/30 hover:bg-soft/40"
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Pengiklan</span>
          <span className="block truncate text-[14px] font-semibold text-ink">{advertiserLabel(row)}</span>
        </span>
        {kpi === null ? null : (
          <Badge tone={kpi ? 'success' : 'danger'} className="shrink-0">
            {kpi ? 'Memenuhi KPI' : 'Tidak Memenuhi KPI'}
          </Badge>
        )}
      </span>

      <span className="mt-3 block border-t border-line pt-2.5">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Tiket Terjual</span>
        <span className="block text-[24px] font-bold leading-tight text-ink">{formatCount(row.tickets)}</span>
        <span className={`block text-[12px] font-semibold ${deltaClass(row.tickets, row.prev_tickets)}`}>
          {formatDeltaPercent(row.tickets, row.prev_tickets)}
          <span className="ml-1 font-normal text-ink-soft">vs bulan lalu ({formatCount(row.prev_tickets)} tiket)</span>
        </span>
      </span>

      <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <Metric label="ROAS" value={formatRoas(row.roas)} hint="Omzet ÷ Total Spend" />
        <Metric
          label="Kedisiplinan"
          value={formatRate(row.discipline_rate)}
          hint={`${formatCount(row.discipline_batches)} batch dinilai`}
          valueClassName={disciplineClass(row.discipline_rate)}
        />
      </span>

      <span className="mt-3 block border-t border-line pt-2">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Top 2 Event (tiket)</span>
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

      <span className="mt-3 block text-[11px] font-semibold text-primary group-hover:underline">Lihat Detail →</span>
    </button>
  )
}

const ADVERTISER_COLUMNS: readonly TableColumn[] = [
  { key: 'advertiser', header: 'Pengiklan', minWidth: 170 },
  { key: 'spend', header: 'Total Spend', align: 'right', minWidth: 130 },
  { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
  { key: 'profit', header: 'Profit / Boncos', align: 'right', minWidth: 140 },
  { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 120 },
  { key: 'discipline', header: 'Kedisiplinan', align: 'right', minWidth: 120 },
  { key: 'roas', header: 'ROAS', align: 'right', minWidth: 90 },
  { key: 'top', header: 'Top 2 Event', minWidth: 240 },
]

function AdvertiserTable({ rows, onOpen }: { rows: AdvertiserPerformance[]; onOpen: (row: AdvertiserPerformance) => void }) {
  return (
    <Card padding="none">
      <DataTable rowNumbers columns={ADVERTISER_COLUMNS}>
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
            <TableCell align="right">
              {formatCount(row.tickets)}
              <span className={`block text-[10px] ${deltaClass(row.tickets, row.prev_tickets)}`}>
                {formatDeltaPercent(row.tickets, row.prev_tickets)}
              </span>
            </TableCell>
            <TableCell align="right">
              <span className={disciplineClass(row.discipline_rate)}>{formatRate(row.discipline_rate)}</span>
              <span className="block text-[10px] text-ink-soft">{formatCount(row.discipline_batches)} batch</span>
            </TableCell>
            <TableCell align="right">{formatRoas(row.roas)}</TableCell>
            <TableCell>{topProductsText(row.top_products)}</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </Card>
  )
}

/** Jumlah grup maksimal pada grafik perbandingan; tabel tetap memuat sisanya. */
const CHART_TOP = 12

const EMPTY_BREAKDOWN: PerformanceBreakdown = { products: [], batches: [] }

const MONTHLY_COLUMNS: readonly TableColumn[] = [
  { key: 'month', header: 'Bulan', minWidth: 130 },
  { key: 'leads', header: 'Leads', align: 'right', minWidth: 70 },
  { key: 'paid', header: 'Paid', align: 'right', minWidth: 70 },
  { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 80 },
  { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
  { key: 'spend', header: 'Total Spend', align: 'right', minWidth: 130 },
  { key: 'profit', header: 'Profit', align: 'right', minWidth: 130 },
  { key: 'roas', header: 'ROAS', align: 'right', minWidth: 80 },
  { key: 'kpi', header: 'KPI', align: 'right', minWidth: 120 },
]

/** A83: rincian 12 bulan; bulan beku memakai snapshot, 3 bulan terakhir live. */
function PerformanceMonthlyTable({ rows, year }: { rows: PerformancePeriodRow[]; year: number }) {
  return (
    <Card className="mt-3">
      <CardHeader
        title="Rincian Bulanan"
        description={`Tahun ${year}. Bulan berjalan + 2 bulan sebelumnya dihitung live; bulan yang lebih lama memakai snapshot beku.`}
      />
      <DataTable rowNumbers columns={MONTHLY_COLUMNS} maxRows={null}>
        {rows.map((row) => {
          const future = row.is_future === true
          const meets = future ? null : kpiMeets(row.tickets, row.kpi_target)
          return (
            <TableRow key={row.period_start}>
              <TableCell>
                <span className="flex flex-wrap items-center gap-1">
                  <span className="font-semibold text-ink">{formatPeriodLabel(row.period_start, 'month')}</span>
                  {row.is_partial === true ? <Badge tone="warning">Berjalan</Badge> : null}
                  {row.is_frozen === true ? <Badge tone="neutral">Beku</Badge> : null}
                </span>
              </TableCell>
              <TableCell align="right">{future ? '—' : formatCount(row.leads)}</TableCell>
              <TableCell align="right">{future ? '—' : formatCount(row.paid)}</TableCell>
              <TableCell align="right"><span className="font-semibold">{future ? '—' : formatCount(row.tickets)}</span></TableCell>
              <TableCell align="right">{future ? '—' : formatMoney(row.omzet)}</TableCell>
              <TableCell align="right">{future ? '—' : formatMoney(row.total_spend)}</TableCell>
              <TableCell align="right"><span className={future ? 'text-ink-soft' : profitClass(row.profit)}>{future ? '—' : formatMoney(row.profit)}</span></TableCell>
              <TableCell align="right">{future ? '—' : formatRoas(row.roas)}</TableCell>
              <TableCell align="right">
                {meets === null ? (
                  <span className="text-ink-soft">—</span>
                ) : (
                  <Badge tone={meets ? 'success' : 'danger'}>{meets ? 'Memenuhi' : 'Tidak'}</Badge>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </DataTable>
    </Card>
  )
}

function PerformanceDetailView({
  detail,
  breakdown,
  breakdownLoading,
  breakdownError,
  onReloadBreakdown,
  granularity,
  dateFrom,
  dateTo,
  productSelected,
  selectedProductLabel,
  advertiserName,
  onBack,
}: {
  detail: PerformanceDetail
  breakdown: PerformanceBreakdown | null
  breakdownLoading: boolean
  breakdownError: string | null
  onReloadBreakdown: () => void
  granularity: Granularity
  dateFrom: string
  dateTo: string
  /** A57: tanpa produk, kartu Per Batch hanya menampilkan petunjuk. */
  productSelected: boolean
  selectedProductLabel: string
  advertiserName: string
  /** Akun Advertiser tidak punya daftar pengiklan, jadi tombol kembali disembunyikan. */
  onBack?: () => void
}) {
  const summary = detail.summary
  // A83: bulan yang belum berjalan tidak masuk grafik.
  const chartRows = detail.rows.filter((row) => row.is_future !== true)
  const labels = chartRows.map((row) => formatPeriodLabel(row.period_start, granularity))
  // A56 revisi: grafik utama memakai Total Spend (spend + PPN) agar konsisten dengan
  // KPI, grafik per batch/produk, dan tabel breakdown. Nilai per bucket dijumlahkan
  // dari `total_spend`, jadi totalnya sama dengan KPI Total Spend.
  const totalSpendValues = chartRows.map((row) => metricNumber(row.total_spend))
  const ticketValues = chartRows.map((row) => row.tickets)
  const profit = metricNumber(summary.profit)
  const title = advertiserName.trim() === '' ? 'Detail Pengiklan' : advertiserName
  const rangeLabel = formatPeriodRangeLabel(dateFrom, dateTo, granularity)

  return (
    <div className="mt-4">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        {onBack === undefined ? null : <Button variant="ghost" size="sm" onClick={onBack}>← Semua pengiklan</Button>}
        <h2 className="min-w-0 truncate text-[16px] font-semibold text-ink">{title}</h2>
        {detail.year === undefined ? null : <Badge tone="neutral">Tahun {detail.year}</Badge>}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          size="lg"
          label="Total Spend"
          value={formatMoney(summary.total_spend)}
          hint={`Spend ${formatMoney(summary.spend)} + PPN ${formatMoney(summary.tax_amount)}`}
          highlight
        />
        <KpiCard size="lg" label="Total Omzet" value={formatMoney(summary.omzet)} hint="Gross order Paid" />
        <KpiCard
          size="lg"
          label="Total Tiket"
          value={formatCount(summary.tickets)}
          hint={`${formatCount(summary.paid)} order Paid`}
        />
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
          label="Closing Rate"
          value={formatRate(summary.closing_rate)}
          hint={`${formatCount(summary.tickets)} tiket ÷ ${formatCount(summary.leads)} leads`}
        />
        <KpiCard label="ROAS" value={formatRoas(summary.roas)} hint="Omzet ÷ (Spend + PPN)" />
        <KpiCard
          label="Kedisiplinan Iklan"
          value={formatRate(summary.discipline_rate)}
          valueClassName={disciplineClass(summary.discipline_rate)}
          hint={`${formatCount(summary.discipline_score)} / ${formatCount(summary.discipline_batches * 10)} poin · ${formatCount(summary.discipline_batches)} batch`}
        />
      </div>

      <div className="mt-3 rounded-md border border-line bg-soft/40 px-3 py-2 text-[12px] text-ink-soft">
        <span className="font-semibold text-ink">Rincian kedisiplinan:</span>{' '}
        {formatCount(summary.discipline_on_time)} tepat waktu · {formatCount(summary.discipline_late)} terlambat ·{' '}
        {formatCount(summary.discipline_unpublished)} belum tayang · {formatCount(summary.discipline_upcoming)} belum jatuh tempo.
        <span className="block text-[11px]">
          Skor per batch 0–10: tepat waktu 10, telat 1–3 hari 8, 4–7 hari 6, 8–14 hari 4, 15–30 hari 2, lebih dari 30 hari/tidak tayang 0.
        </span>
      </div>

      <p className="mt-2 text-[12px] text-ink-soft">
        Coverage report: {coverageHint(summary)} Cost/Tiket: {costPerTicket(summary) === null ? '-' : formatMoney(costPerTicket(summary) as number)}.
      </p>

      <Card className="mt-4">
        <CardHeader
          title="Total Spend & Tiket Terjual"
          description={
            rangeLabel === ''
              ? 'Total Spend (spend + PPN) di sumbu kiri, tiket Paid di sumbu kanan.'
              : `${rangeLabel} · Total Spend (spend + PPN) di sumbu kiri, tiket Paid di sumbu kanan.`
          }
        />
        {chartRows.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Belum ada data pada rentang ini.</p>
        ) : (
          <TrendChart
            labels={labels}
            series={[
              { key: 'total_spend', label: 'Total Spend', color: '#4f46f5', values: totalSpendValues, axis: 'left', format: formatMoney },
              { key: 'tickets', label: 'Tiket Terjual', color: '#f5b94c', values: ticketValues, axis: 'right', format: formatCount },
            ]}
            formatValue={formatMoney}
            formatAxis={formatAxisMoney}
            formatAxisRight={(value) => formatCount(Math.round(value))}
            ariaLabel="Grafik total spend dan tiket terjual"
            height={260}
            showArea
          />
        )}
      </Card>

      <PerformanceMonthlyTable rows={detail.rows} year={detail.year ?? new Date().getFullYear()} />

      <Card className="mt-3">
        <CardHeader title="Top 3 Event" description="Berdasarkan tiket terjual (order Paid), level produk, pada periode filter." />
        {detail.products.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Belum ada tiket Paid pada periode ini.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {detail.products.slice(0, 3).map((product, index) => (
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

      {breakdownError !== null ? (
        <div className="mt-4">
          <ErrorState message={breakdownError} action={<Button onClick={onReloadBreakdown}>Coba lagi</Button>} />
        </div>
      ) : breakdownLoading && breakdown === null ? (
        <div className="mt-4">
          <Card>
            <SkeletonRows rows={4} />
          </Card>
        </div>
      ) : (
        <>
          <ProductBreakdownCard products={(breakdown ?? EMPTY_BREAKDOWN).products} />
          <BatchBreakdownCard
            batches={(breakdown ?? EMPTY_BREAKDOWN).batches}
            productSelected={productSelected}
            selectedProductLabel={selectedProductLabel}
          />
        </>
      )}
    </div>
  )
}

function chartAxisRight(value: number): string {
  return formatCount(Math.round(value))
}

function ProductBreakdownCard({ products }: { products: ProductPerformance[] }) {
  const totalTickets = products.reduce((sum, product) => sum + product.tickets, 0)
  const chartRows = products.slice(0, CHART_TOP)

  return (
    <Card className="mt-4" padding="none">
      <div className="px-3.5 pb-2 pt-3">
        <h2 className="text-[14px] font-semibold text-ink">Per Produk — 2 Batch Terakhir</h2>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          Total Spend (termasuk PPN), omzet, dan tiket dari {PRODUCT_RECENT_BATCHES} batch terakhir tiap produk;
          filter tanggal tidak dipakai.
          {products.length > CHART_TOP ? ` Grafik menampilkan ${CHART_TOP} produk teratas menurut Spend.` : ''}
        </p>
      </div>
      {products.length === 0 ? (
        <p className="border-t border-line px-3 py-6 text-center text-ink-soft">Belum ada produk dengan tiket atau spend.</p>
      ) : (
        <>
          <div className="px-3.5 pb-3">
            <ComparisonChart
              labels={chartRows.map((product) => productLabel(product))}
              series={[
                { key: 'spend', label: 'Total Spend', color: '#4f46f5', values: chartRows.map((product) => metricNumber(product.total_spend)) },
                { key: 'omzet', label: 'Omzet', color: '#35c96c', values: chartRows.map((product) => metricNumber(product.omzet)) },
                { key: 'tickets', label: 'Tiket', color: '#f5b94c', values: chartRows.map((product) => product.tickets), axis: 'right', format: formatCount },
              ]}
              formatValue={formatMoney}
              formatAxis={formatAxisMoney}
              formatAxisRight={chartAxisRight}
              ariaLabel="Grafik per produk"
            />
          </div>
          <DataTable
            rowNumbers
            columns={[
              { key: 'product', header: 'Produk', minWidth: 170 },
              { key: 'spend', header: 'Total Spend', align: 'right', minWidth: 130 },
              { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 80 },
              { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
              { key: 'profit', header: 'Profit / Boncos', align: 'right', minWidth: 130 },
              { key: 'roas', header: 'ROAS', align: 'right', minWidth: 80 },
              { key: 'share', header: 'Share', align: 'right', minWidth: 80 },
            ]}
            stickyHeader={false}
          >
            {products.map((product) => (
              <TableRow key={product.product_code ?? product.product_name ?? 'tanpa-produk'}>
                <TableCell>{productLabel(product)}</TableCell>
                <TableCell align="right">{formatMoney(product.total_spend)}</TableCell>
                <TableCell align="right">{formatCount(product.tickets)}</TableCell>
                <TableCell align="right">{formatMoney(product.omzet)}</TableCell>
                <TableCell align="right">
                  <span className={profitClass(product.profit)}>{formatMoney(product.profit)}</span>
                </TableCell>
                <TableCell align="right">{formatRoas(product.roas)}</TableCell>
                <TableCell align="right">{formatRate(totalTickets === 0 ? null : product.tickets / totalTickets)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </>
      )}
    </Card>
  )
}

function BatchBreakdownCard({
  batches,
  productSelected,
  selectedProductLabel,
}: {
  batches: BatchBreakdown[]
  productSelected: boolean
  selectedProductLabel: string
}) {
  // A57: tanpa produk, tidak ada dasar yang jelas untuk "5 batch terakhir".
  if (!productSelected) {
    return (
      <Card className="mt-4">
        <CardHeader
          title="Per Batch — 5 Terakhir"
          description="Filter tanggal tidak dipakai; batch diurutkan dari tanggal aktivitas terbaru."
        />
        <p className="text-[13px] text-ink-soft">Pilih produk di filter atas untuk melihat 5 batch terakhir.</p>
      </Card>
    )
  }

  const chartRows = batches.slice(0, BATCH_RECENT_LIMIT)
  const scope = selectedProductLabel.trim() === '' ? 'produk terpilih' : selectedProductLabel

  return (
    <Card className="mt-4" padding="none">
      <div className="px-3.5 pb-2 pt-3">
        <h2 className="text-[14px] font-semibold text-ink">Per Batch — 5 Terakhir</h2>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          {BATCH_RECENT_LIMIT} batch terakhir {scope} berdasarkan tanggal aktivitas terbaru; filter tanggal tidak dipakai.
        </p>
      </div>
      {batches.length === 0 ? (
        <p className="border-t border-line px-3 py-6 text-center text-ink-soft">Belum ada batch dengan tiket atau spend untuk produk ini.</p>
      ) : (
        <>
          <div className="px-3.5 pb-3">
            <ComparisonChart
              labels={chartRows.map((batch) => batch.batch ?? 'Tanpa batch')}
              series={[
                { key: 'spend', label: 'Total Spend', color: '#4f46f5', values: chartRows.map((batch) => metricNumber(batch.total_spend)) },
                { key: 'omzet', label: 'Omzet', color: '#35c96c', values: chartRows.map((batch) => metricNumber(batch.omzet)) },
                { key: 'tickets', label: 'Tiket', color: '#f5b94c', values: chartRows.map((batch) => batch.tickets), axis: 'right', format: formatCount },
              ]}
              formatValue={formatMoney}
              formatAxis={formatAxisMoney}
              formatAxisRight={chartAxisRight}
              ariaLabel="Grafik per batch"
            />
          </div>
          <DataTable
            rowNumbers
            columns={[
              { key: 'batch', header: 'Batch', minWidth: 80 },
              { key: 'activity', header: 'Aktivitas Terakhir', minWidth: 130 },
              { key: 'spend', header: 'Total Spend', align: 'right', minWidth: 130 },
              { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 80 },
              { key: 'omzet', header: 'Omzet', align: 'right', minWidth: 130 },
              { key: 'profit', header: 'Profit / Boncos', align: 'right', minWidth: 130 },
              { key: 'roas', header: 'ROAS', align: 'right', minWidth: 80 },
            ]}
            stickyHeader={false}
          >
            {batches.map((batch) => (
              <TableRow key={`${batch.product_code ?? ''}-${batch.batch ?? 'tanpa-batch'}`}>
                <TableCell>{batch.batch ?? '-'}</TableCell>
                <TableCell>{formatDate(batch.last_activity)}</TableCell>
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
        </>
      )}
    </Card>
  )
}
