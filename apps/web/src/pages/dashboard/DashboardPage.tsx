import { Link } from 'react-router-dom'
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
  const state = useFilterState({ ...EMPTY_COMMON_FILTERS, source: 'orderonline' }, { storageKey: 'dashboard' })
  const { lists } = useConfigLists()

  const sourceLabel = state.applied.source === 'ots' ? 'OTS' : state.applied.source === 'orderonline' ? 'Online' : 'Semua sumber'
  const comparisonKey = JSON.stringify({ ...state.applied, source: '' })
  const comparison = useAsyncData(() => Promise.all([
    fetchDashboardSummary({ ...state.applied, source: 'orderonline' }),
    fetchDashboardSummary({ ...state.applied, source: 'ots' }),
  ]), [comparisonKey])

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

      <p className="mt-3 text-[13px] text-ink-soft">Menampilkan {sourceLabel}. Online adalah pendaftaran OrderOnline; atribusi iklan mengikuti filter pengiklan.</p>
      {state.applied.source === 'ots' ? <p className="mt-2 text-[13px] text-ink-soft">OTS dicatat setelah lunas dan langsung check-in. Rasio OTS bukan indikator performa iklan.</p> : null}
      {state.applied.advertiserCode ? <p className="mt-2 text-[13px] text-ink-soft">OTS tidak memiliki pengiklan, sehingga tidak masuk hasil filter pengiklan ini.</p> : null}
      <Card className="mt-4">
        <CardHeader title="Ringkasan per Sumber" description="Mengikuti seluruh filter di atas kecuali Sumber Pendaftaran. Omzet dan tiket hanya dari transaksi Paid." />
        {comparison.error ? <ErrorState message={comparison.error} action={<Button onClick={comparison.reload}>Coba lagi</Button>} /> : comparison.loading || !comparison.data ? <Skeleton height={90} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]"><thead><tr>{['Sumber', 'Transaksi Paid', 'Tiket Terjual', 'Omzet Gross', 'Tiket Hadir'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
              <tbody>{comparison.data.map((item, index) => <tr className="border-t border-line" key={index}>
                <td className="p-2"><Link className="font-semibold text-primary underline" to={`/order?${new URLSearchParams({ ...state.applied, appStatus: 'Paid', source: index === 0 ? 'orderonline' : 'ots' })}`}>{index === 0 ? 'Online' : 'OTS'}</Link></td>
                <td className="p-2">{formatCount(item.paid)}</td><td className="p-2">{formatCount(item.paid_tickets ?? 0)}</td><td className="p-2">{formatMoney(item.gross_amount)}</td><td className="p-2">{formatCount(item.sudah_hadir)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>

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
            <CardHeader title={`Finansial - ${sourceLabel}`} />
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
            <CardHeader title={`Order - ${sourceLabel}`} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <KpiCard label="Leads" value={formatCount(data.leads)} hint="Jumlah Order ID" />
              <KpiCard label="Paid" value={formatCount(data.paid)} highlight hint="Order ID processing/complete; Refund tidak dihitung" />
              <KpiCard label="Jumlah Tiket" value={formatCount(data.paid_tickets ?? data.paid)} hint="Total tiket dari order Paid" />
              <KpiCard label="Pending" value={formatCount(data.pending)} />
              <KpiCard
                label="Conversion Rate"
                value={data.conversion_rate == null ? '\u2014' : formatRate(data.conversion_rate)}
                hint={data.leads === 0 ? 'Belum ada lead' : 'Paid ÷ Leads'}
              />
            </div>
          </Card>

          <SessionSummaryCard filters={state.applied} />

          <Card>
            <CardHeader title={`Kehadiran - ${sourceLabel}`} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <KpiCard label="Sudah Hadir (tiket)" value={formatCount(data.sudah_hadir)} />
              <KpiCard label="Belum Hadir (tiket)" value={formatCount(data.belum_hadir)} />
              <KpiCard
                label="Attendance Rate"
                value={data.attendance_rate == null ? '\u2014' : formatRate(data.attendance_rate)}
                hint={(data.paid_tickets ?? data.paid) === 0 ? 'Belum ada tiket Paid' : 'Tiket hadir ÷ tiket Paid'}
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
