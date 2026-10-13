import { useState } from 'react'
import { EMPTY_COMMON_FILTERS, activeCommonFilters, toFilterArgs, type CommonFilters } from '../../lib/filters'
import { formatCount, formatMoney } from '../../lib/format'
import { supabaseRpc } from '../../lib/supabase-rest'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card, CardHeader, KpiCard } from '../../ui/Card'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { FilterBar, FilterChip } from '../../ui/Filters'
import { Select } from '../../ui/Field'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
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
 * Report Tax (PRD §84–§86, §165, 03 §12).
 *
 * Menu ini khusus finance/reporting: **staff tidak boleh membukanya** (04 §1).
 * Pagarnya ada di dalam RPC `tax_report` (03 §12, A4) — RLS tidak dapat menolak
 * satu halaman saja. Karena itu halaman ini tidak menyembunyikan tombolnya, ia
 * menampilkan penolakan server apa adanya; menyembunyikan menu hanya akan
 * memberi rasa aman yang palsu (CLAUDE.md §9).
 *
 * Tujuh dimensi breakdown diambil persis dari PRD §85 — tidak lebih.
 */
type TaxReportRow = {
  label: string
  transactions: number
  gross_amount: number
  tax_amount: number
  net_amount: number
}

type TaxReport = {
  dimension: string
  summary: { transactions: number; gross_amount: number; tax_amount: number; net_amount: number }
  rows: TaxReportRow[]
}

const DIMENSIONS = [
  { value: 'payment_method', label: 'Payment Method' },
  { value: 'product', label: 'Produk' },
  { value: 'batch', label: 'Batch' },
  { value: 'advertiser', label: 'Pengiklan' },
  { value: 'date', label: 'Tanggal' },
  { value: 'city', label: 'Kota' },
  { value: 'event_type', label: 'Seminar / Webinar' },
]

const COLUMNS: readonly TableColumn[] = [
  { key: 'label', header: 'Kelompok', minWidth: 160 },
  { key: 'transactions', header: 'Transaksi', align: 'right', minWidth: 100 },
  { key: 'gross_amount', header: 'Gross', align: 'right', minWidth: 140 },
  { key: 'tax_amount', header: 'Total Tax', align: 'right', minWidth: 130 },
  { key: 'net_amount', header: 'Net', align: 'right', minWidth: 140 },
]

export function ReportTaxPage() {
  const state = useFilterState(EMPTY_COMMON_FILTERS)
  const { lists } = useConfigLists()
  const [dimension, setDimension] = useState('payment_method')

  const appliedKey = JSON.stringify(state.applied)
  const { data, loading, error, errorCode, reload } = useAsyncData(
    () =>
      supabaseRpc<TaxReport>('tax_report', {
        p_dimension: dimension,
        ...toFilterArgs(state.applied as CommonFilters),
      }),
    [appliedKey, dimension],
  )

  const chips = activeCommonFilters(state.filters)
  const dimensionLabel = DIMENSIONS.find((item) => item.value === dimension)?.label ?? dimension

  // Penolakan akses datang sebagai kode tersendiri dari RPC, bukan sebagai
  // kesalahan server — dicek lewat kode, bukan lewat kalimat pesannya.
  if (errorCode === 'FORBIDDEN_REPORT_TAX') {
    return (
      <>
        <PageHeader title="Report Tax" description="Ringkasan dan breakdown tax/fee transaksi." />
        <Card>
          <ErrorState
            title="Tidak punya akses"
            message={error ?? 'Report Tax hanya untuk Admin dan Admin Master.'}
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Report Tax"
        description="Ringkasan dan breakdown tax/fee dari transaksi yang lolos filter."
      />

      <FilterBar
        filters={
          <>
            <Select
              id="report-dimension"
              ariaLabel="Dimensi breakdown"
              className="w-[190px]"
              value={dimension}
              options={DIMENSIONS}
              onChange={setDimension}
            />
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

      {data === null ? null : (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Jumlah transaksi" value={formatCount(data.summary.transactions)} />
          <KpiCard label="Gross" value={formatMoney(data.summary.gross_amount)} />
          <KpiCard label="Total Tax" value={formatMoney(data.summary.tax_amount)} highlight />
          <KpiCard label="Net" value={formatMoney(data.summary.net_amount)} />
        </div>
      )}

      <div className="mt-4">
        {loading && data === null ? (
          <Card>
            <SkeletonRows rows={8} />
          </Card>
        ) : (
          <Card padding="none">
            <div className="border-b border-line px-4 py-3">
              <CardHeader
                title={`Breakdown per ${dimensionLabel}`}
                description="Ringkasan di atas dihitung dari seluruh baris yang lolos filter, bukan dari jumlah kelompok yang tampil."
              />
            </div>

            <DataTable columns={COLUMNS} exportConfig={{ filename: `report-tax-${dimension}`, loadRows: async () => (await supabaseRpc<TaxReport>('tax_report', { p_dimension: dimension, ...toFilterArgs(state.applied) })).rows.map(row => ({ ...row })) }}>
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell align="right">{formatCount(row.transactions)}</TableCell>
                  <TableCell align="right">{formatMoney(row.gross_amount)}</TableCell>
                  <TableCell align="right">{formatMoney(row.tax_amount)}</TableCell>
                  <TableCell align="right">{formatMoney(row.net_amount)}</TableCell>
                </TableRow>
              ))}
            </DataTable>

            {!loading && data !== null && data.rows.length === 0 ? (
              <p className="border-t border-line px-3 py-8 text-center text-ink-soft">
                Tidak ada transaksi yang cocok dengan filter aktif.
              </p>
            ) : null}
          </Card>
        )}
      </div>
    </>
  )
}
