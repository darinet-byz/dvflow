import { useMemo, useState } from 'react'
import { formatCount, formatMoney } from '../../lib/format'
import { presetRange } from '../../lib/date-range'
import { fetchOtsReferenceData, type OtsReferenceData } from '../../lib/queries'
import { describeRecentBatch, useRecentBatches } from '../../lib/recent-batches'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData, useDebouncedValue } from '../../lib/useAsyncData'
import { Button } from '../../ui/Button'
import { Card, CardHeader, KpiCard } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Drawer } from '../../ui/Overlay'
import { SuggestInput } from '../../ui/SuggestInput'
import { DataTable, TableCell, TableRow, TableTotalRow, type TableColumn } from '../../ui/Table'
import { DateRangeField } from '../shared/DateRangeField'
import { OTS_METHOD_OPTIONS } from '../scanner/OtsDrawer'

type FilterState = {
  productCode: string
  batch: string
  session: string
  city: string
  method: string
  from: string
  to: string
}

export type OtsBatchRow = {
  product_code: string | null
  product_name: string | null
  batch: string | null
  transactions: number
  tickets: number
  gross_amount: number | string
  tunai: number | string
  transfer: number | string
  qris: number | string
  checked_in_tickets: number
}

export type OtsSessionRow = OtsBatchRow & {
  session: string | null
  city: string | null
}

type OtsFinanceReport = {
  summary: {
    transactions: number
    tickets: number
    gross_amount: number | string
    avg_ticket: number | string | null
    tunai: number | string
    transfer: number | string
    qris: number | string
    checked_in_tickets: number
  }
  batches: OtsBatchRow[]
  sessions: OtsSessionRow[]
}

const BATCH_COLUMNS: readonly TableColumn[] = [
  { key: 'product', header: 'Produk', minWidth: 180 },
  { key: 'batch', header: 'Batch', minWidth: 80 },
  { key: 'transactions', header: 'Transaksi', align: 'right', minWidth: 90 },
  { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 80 },
  { key: 'gross', header: 'Omzet', align: 'right', minWidth: 130 },
  { key: 'tunai', header: 'Tunai', align: 'right', minWidth: 120 },
  { key: 'transfer', header: 'Transfer', align: 'right', minWidth: 120 },
  { key: 'qris', header: 'QRIS', align: 'right', minWidth: 110 },
  { key: 'attendance', header: 'Hadir', align: 'right', minWidth: 90 },
  { key: 'actions', header: 'Aksi', minWidth: 100 },
]

const SESSION_COLUMNS: readonly TableColumn[] = [
  { key: 'session', header: 'Sesi', minWidth: 90 },
  { key: 'city', header: 'Kota', minWidth: 140 },
  { key: 'transactions', header: 'Transaksi', align: 'right', minWidth: 90 },
  { key: 'tickets', header: 'Tiket', align: 'right', minWidth: 80 },
  { key: 'gross', header: 'Omzet', align: 'right', minWidth: 130 },
  { key: 'attendance', header: 'Hadir', align: 'right', minWidth: 90 },
]

function initialFilters(): FilterState {
  const range = presetRange('last30')
  return { productCode: '', batch: '', session: '', city: '', method: '', from: range.from, to: range.to }
}

export function OtsReportPanel() {
  const [filters, setFilters] = useState<FilterState>(initialFilters)
  const [selected, setSelected] = useState<OtsBatchRow | null>(null)
  const references = useAsyncData<OtsReferenceData>(fetchOtsReferenceData, [])
  const { batches: recentBatches } = useRecentBatches(filters.productCode, '')
  const city = useDebouncedValue(filters.city)

  const appliedKey = JSON.stringify({ ...filters, city })
  const { data, loading, error, reload } = useAsyncData<OtsFinanceReport>(() => {
    const params = new URLSearchParams()
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.productCode) params.set('product_code', filters.productCode)
    if (filters.batch.trim()) params.set('batch', filters.batch.trim())
    if (filters.session) params.set('session', filters.session)
    if (city.trim()) params.set('city', city.trim())
    if (filters.method) params.set('method', filters.method)
    return authorizedRequest<OtsFinanceReport>(`/api/ots/report?${params.toString()}`)
  }, [appliedKey])

  const products = references.data?.products ?? []
  const sessions = references.data?.sessions ?? []
  const batchOptions = recentBatches.map((item) => {
    const described = describeRecentBatch(item)
    return { value: item.batch, label: described.label, hint: described.hint }
  })
  const report = data
  const summary = report?.summary
  const batchRows = report?.batches ?? []
  const selectedSessions = useMemo(() => {
    if (selected === null) return []
    return (report?.sessions ?? []).filter(
      (row) => row.product_code === selected.product_code && row.batch === selected.batch,
    )
  }, [report, selected])

  function update(patch: Partial<FilterState>): void {
    setFilters((current) => ({ ...current, ...patch }))
  }

  return (
    <>
      <div className="filter-bar flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-card p-3.5">
        <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5">
          <DateRangeField
            className="w-[190px]"
            from={filters.from}
            to={filters.to}
            onChange={(range) => update({ from: range.from, to: range.to })}
          />
          <Select
            id="ots-report-product"
            ariaLabel="Filter produk laporan OTS"
            className="w-[190px]"
            value={filters.productCode}
            placeholder="Semua Produk"
            options={products.map((product) => ({ value: product.code, label: `${product.code} — ${product.name}` }))}            onChange={(value) => update({ productCode: value })}
          />
          <SuggestInput
            id="ots-report-batch"
            ariaLabel="Filter batch laporan OTS"
            className="w-[190px]"
            value={filters.batch}
            placeholder={filters.productCode === '' ? 'Batch (pilih produk untuk saran)' : 'Batch'}
            options={batchOptions}
            onChange={(value) => update({ batch: value })}
          />
          <Select
            id="ots-report-method"
            ariaLabel="Filter metode bayar OTS"
            className="w-[190px]"
            value={filters.method}
            placeholder="Semua Metode"
            options={OTS_METHOD_OPTIONS}
            onChange={(value) => update({ method: value })}
          />
        </div>
        <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5">
          <Select
            id="ots-report-session"
            ariaLabel="Filter sesi laporan OTS"
            className="w-[190px]"
            value={filters.session}
            placeholder="Semua Sesi"
            options={sessions.map((session) => ({ value: session.code, label: session.name }))}
            onChange={(value) => update({ session: value })}
          />
          <TextInput
            id="ots-report-city"
            ariaLabel="Filter kota laporan OTS"
            className="w-[190px]"
            value={filters.city}
            placeholder="Semua Kota"
            onChange={(value) => update({ city: value })}
          />
          <Button variant="secondary" onClick={() => setFilters(initialFilters())}>Clear All</Button>
        </div>
      </div>

      {error === null ? null : (
        <div className="mt-4">
          <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
        </div>
      )}

      {summary === undefined ? null : (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Transaksi" value={formatCount(summary.transactions)} />
          <KpiCard label="Tiket" value={formatCount(summary.tickets)} />
          <KpiCard label="Omzet OTS" value={formatMoney(summary.gross_amount)} highlight />
          <KpiCard label="Rata-rata / Tiket" value={summary.avg_ticket === null ? '-' : formatMoney(summary.avg_ticket)} />
          <KpiCard label="Tunai" value={formatMoney(summary.tunai)} />
          <KpiCard label="Transfer" value={formatMoney(summary.transfer)} />
          <KpiCard label="QRIS" value={formatMoney(summary.qris)} />
          <KpiCard label="Tiket Hadir" value={formatCount(summary.checked_in_tickets)} hint={`dari ${formatCount(summary.tickets)} tiket`} />
        </div>
      )}
      {summary === undefined ? null : (
        <p className="mt-2 text-[11px] text-ink-soft">Tiket hadir dihitung dari data presensi yang masih tersedia (retensi 30 hari).</p>
      )}

      <div className="mt-4">
        {loading && report === null ? (
          <Card><SkeletonRows rows={7} /></Card>
        ) : (
          <Card padding="none">
            <div className="px-3.5 pb-2 pt-3">
              <CardHeader title="Rekap per Batch" description="Klik baris untuk melihat rincian sesi dan kota." />
            </div>
            <DataTable
              columns={BATCH_COLUMNS}
              exportConfig={{
                filename: 'laporan-ots-batch',
                columns: BATCH_COLUMNS.filter((column) => column.key !== 'actions'),
                loadRows: () => batchRows.map((row) => ({
                  product: row.product_name ?? row.product_code ?? '-',
                  batch: row.batch ?? '-',
                  transactions: row.transactions,
                  tickets: row.tickets,
                  gross: Number(row.gross_amount),
                  tunai: Number(row.tunai),
                  transfer: Number(row.transfer),
                  qris: Number(row.qris),
                  attendance: row.checked_in_tickets,
                })),
              }}
            >
              {batchRows.map((row) => (
                <TableRow key={`${row.product_code ?? ''}|${row.batch ?? ''}`}>
                  <TableCell>{row.product_name ?? row.product_code ?? '-'}</TableCell>
                  <TableCell>{row.batch ?? '-'}</TableCell>
                  <TableCell align="right">{formatCount(row.transactions)}</TableCell>
                  <TableCell align="right">{formatCount(row.tickets)}</TableCell>
                  <TableCell align="right">{formatMoney(row.gross_amount)}</TableCell>
                  <TableCell align="right">{formatMoney(row.tunai)}</TableCell>
                  <TableCell align="right">{formatMoney(row.transfer)}</TableCell>
                  <TableCell align="right">{formatMoney(row.qris)}</TableCell>
                  <TableCell align="right">{formatCount(row.checked_in_tickets)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="secondary" onClick={() => setSelected(row)}>Lihat Sesi</Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableTotalRow>
                <TableCell>Total</TableCell>
                <TableCell>{''}</TableCell>
                <TableCell align="right">{formatCount(summary?.transactions ?? 0)}</TableCell>
                <TableCell align="right">{formatCount(summary?.tickets ?? 0)}</TableCell>
                <TableCell align="right">{formatMoney(summary?.gross_amount ?? 0)}</TableCell>
                <TableCell align="right">{formatMoney(summary?.tunai ?? 0)}</TableCell>
                <TableCell align="right">{formatMoney(summary?.transfer ?? 0)}</TableCell>
                <TableCell align="right">{formatMoney(summary?.qris ?? 0)}</TableCell>
                <TableCell align="right">{formatCount(summary?.checked_in_tickets ?? 0)}</TableCell>
                <TableCell>{''}</TableCell>
              </TableTotalRow>
            </DataTable>
            {!loading && report !== null && batchRows.length === 0 ? (
              <p className="border-t border-line px-3 py-8 text-center text-ink-soft">Belum ada transaksi OTS pada filter ini.</p>
            ) : null}
          </Card>
        )}
      </div>

      <Drawer
        open={selected !== null}
        title={selected === null ? 'Rincian Sesi' : `Sesi — ${selected.product_name ?? selected.product_code ?? '-'} · Batch ${selected.batch ?? '-'}`}
        onClose={() => setSelected(null)}
      >
        {selectedSessions.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Belum ada rincian sesi.</p>
        ) : (
          <DataTable columns={SESSION_COLUMNS} stickyHeader={false}>
            {selectedSessions.map((row) => (
              <TableRow key={`${row.session ?? ''}|${row.city ?? ''}`}>
                <TableCell>{row.session ?? '-'}</TableCell>
                <TableCell>{row.city ?? '-'}</TableCell>
                <TableCell align="right">{formatCount(row.transactions)}</TableCell>
                <TableCell align="right">{formatCount(row.tickets)}</TableCell>
                <TableCell align="right">{formatMoney(row.gross_amount)}</TableCell>
                <TableCell align="right">{formatCount(row.checked_in_tickets)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </Drawer>
    </>
  )
}
