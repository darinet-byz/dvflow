import { EMPTY_COMMON_FILTERS } from '../../lib/filters'
import { formatCount, formatMoney, formatRate } from '../../lib/format'
import { fetchDashboardSummary } from '../../lib/queries'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card, CardHeader, KpiCard } from '../../ui/Card'
import { ErrorState, Skeleton } from '../../ui/Feedback'
import { FilterBar, FilterChip } from '../../ui/Filters'
import { activeCommonFilters } from '../../lib/filters'
import { useFilterState } from '../shared/useFilterState'
import {
  AdvertiserFilter,
  BatchFilter,
  CityFilter,
  DateRangeFilters,
  EventTypeFilter,
  ProductFilter,
  SessionFilter,
} from '../shared/FilterControls'

/**
 * Dashboard Resume (PRD §40–§43, 01 §16).
 *
 * Yang dijaga:
 *   * seluruh KPI memakai SATU set filter yang sama (PRD §41) — dijamin dengan
 *     mengirim satu objek filter ke satu RPC;
 *   * **tidak ada chart** dan tidak ada breakdown card tambahan (01 §16);
 *   * hanya satu KPI yang diberi visual primary (guideline §43): `Paid`, karena
 *     itu angka yang paling menentukan tindakan operasional.
 *
 * Rasio ditampilkan "-" ketika penyebutnya nol, bukan "0%" (STATE.md K4).
 */
export function DashboardPage() {
  const state = useFilterState(EMPTY_COMMON_FILTERS)
  const { lists } = useConfigLists()

  const appliedKey = JSON.stringify(state.applied)
  const { data, loading, error, reload } = useAsyncData(
    () => fetchDashboardSummary(state.applied),
    [appliedKey],
  )

  const chips = activeCommonFilters(state.filters)

  return (
    <>
      <PageHeader title="Dashboard Resume" description="Ringkasan kondisi operasional." />

      <FilterBar
        filters={
          <>
            <DateRangeFilters filters={state.filters} lists={lists} update={state.update} />
            <ProductFilter filters={state.filters} lists={lists} update={state.update} />
            <AdvertiserFilter filters={state.filters} lists={lists} update={state.update} />
            <EventTypeFilter filters={state.filters} lists={lists} update={state.update} />
            <BatchFilter filters={state.filters} lists={lists} update={state.update} />
            <SessionFilter filters={state.filters} lists={lists} update={state.update} />
            <CityFilter filters={state.filters} lists={lists} update={state.update} />
          </>
        }
        activeFilters={chips.map((chip) => (
          <FilterChip key={chip.key} label={chip.label} onRemove={() => state.removeFilter(chip.key)} />
        ))}
        onClearAll={state.clearAll}
      />

      {error === null ? null : (
        <div className="mt-4">
          <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
        </div>
      )}

      {error !== null ? null : loading || data === null ? (
        <DashboardSkeleton />
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader title="Order" description="Leads dan status pembayaran mengikuti filter aktif." />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Leads" value={formatCount(data.leads)} />
              <KpiCard label="Paid" value={formatCount(data.paid)} highlight />
              <KpiCard label="Pending" value={formatCount(data.pending)} />
              <KpiCard
                label="Conversion Rate"
                value={formatRate(data.conversion_rate)}
                hint={data.leads === 0 ? 'Belum ada lead' : 'Paid ÷ Leads'}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Finansial" description="Nilai transaksi dari order Paid yang lolos filter." />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <KpiCard label="Gross" value={formatMoney(data.gross_amount)} />
              <KpiCard label="E-payment Fee" value={formatMoney(data.tax_amount)} />
              <KpiCard label="E-payment Fee Tax" value={formatMoney(data.epayment_tax_amount ?? 0)} />
              <KpiCard label="Platform Fee" value={formatMoney(data.platform_fee_amount ?? 0)} />
              <KpiCard label="Net" value={formatMoney(data.net_amount)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Kehadiran" description="Dihitung dari presensi webinar dan seminar." />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <KpiCard label="Sudah Hadir" value={formatCount(data.sudah_hadir)} />
              <KpiCard label="Belum Hadir" value={formatCount(data.belum_hadir)} />
              <KpiCard
                label="Attendance Rate"
                value={formatRate(data.attendance_rate)}
                hint={data.paid === 0 ? 'Belum ada order Paid' : 'Hadir ÷ Paid'}
              />
            </div>
          </Card>
        </div>
      )}
    </>
  )
}

/** Skeleton berbentuk KPI (guideline §13: skeleton untuk memuat data halaman). */
function DashboardSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-4" aria-busy="true">
      {[0, 1, 2].map((group) => (
        <Card key={group}>
          <Skeleton height={18} className="mb-3 max-w-[220px]" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((tile) => (
              <Skeleton key={tile} height={64} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
