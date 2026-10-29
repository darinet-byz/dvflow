import { EMPTY_COMMON_FILTERS } from '../../lib/filters'
import { formatCount, formatMoney, formatRate } from '../../lib/format'
import { fetchDashboardSummary } from '../../lib/queries'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card, CardHeader, KpiCard } from '../../ui/Card'
import { ErrorState, Skeleton } from '../../ui/Feedback'
import { useFilterState } from '../shared/useFilterState'
import { StandardFilterBar } from '../shared/StandardFilterBar'
import { SessionSummaryCard } from './SessionSummaryCard'

/**
 * Dashboard (PRD §40–§43, 01 §16; A59).
 *
 * Yang dijaga:
 *   * seluruh KPI memakai SATU set filter yang sama (PRD §41) — dijamin dengan
 *     mengirim satu objek filter ke satu RPC;
 *   * **tidak ada chart**; kartu Data per Sesi adalah ringkasan operasional yang
 *     dipindahkan dari Resume Batch (A59);
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


  return (
    <>
      <PageHeader title="Dashboard" />

      <StandardFilterBar
        filters={state.filters}
        lists={lists}
        update={state.update}
        removeFilter={state.removeFilter}
        clearAll={state.clearAll}
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
            <CardHeader title="Finansial" />
            {/* Grid 6 kolom: baris 1 Gross & Net (masing-masing 3), baris 2 tiga potongan (masing-masing 2) -> tepi rata. */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <KpiCard size="lg" className="md:col-span-3" label="Gross" value={formatMoney(data.gross_amount)} />
              <KpiCard size="lg" className="md:col-span-3" label="Net" value={formatMoney(data.net_amount)} highlight />
              <KpiCard className="md:col-span-2" label="Platform Fee" value={formatMoney(data.platform_fee_amount ?? 0)} />
              <KpiCard className="md:col-span-2" label="E-payment Fee" value={formatMoney(data.tax_amount)} />
              <KpiCard className="md:col-span-2" label="E-payment Fee Tax" value={formatMoney(data.epayment_tax_amount ?? 0)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Order" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <KpiCard label="Leads" value={formatCount(data.leads)} hint="Jumlah Order ID" />
              <KpiCard label="Paid" value={formatCount(data.paid)} highlight hint="Order ID processing/complete; Refund tidak dihitung" />
              <KpiCard label="Jumlah Tiket" value={formatCount(data.paid_tickets ?? data.paid)} hint="Total tiket dari order Paid" />
              <KpiCard label="Pending" value={formatCount(data.pending)} />
              <KpiCard
                label="Conversion Rate"
                value={formatRate(data.conversion_rate)}
                hint={data.leads === 0 ? 'Belum ada lead' : 'Paid ÷ Leads'}
              />
            </div>
          </Card>

          <SessionSummaryCard filters={state.applied} />

          <Card>
            <CardHeader title="Kehadiran" />
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
      {[0, 1, 2, 3].map((group) => (
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
