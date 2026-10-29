import { collectPages } from '../../lib/export'
import { useState } from 'react'
import { TIMESTAMP_DISPLAY_LIMIT } from '@dvflow/shared'
import { EMPTY_PRESENSI_FILTERS, toCommonFilters, type PresensiFilters } from '../../lib/filters'
import { formatCount, formatRate, formatText, formatTime } from '../../lib/format'
import {
  fetchPresensiPage,
  fetchPresensiSummary,
  type PresensiRow,
  type PresensiSortKey,
  type SortDirection,
} from '../../lib/queries'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { PageHeader } from '../../layout/PageHeader'
import { Badge, attendanceTone, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, KpiCard } from '../../ui/Card'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { FilterChip } from '../../ui/Filters'
import { SearchInput, Select } from '../../ui/Field'
import { Pagination } from '../../ui/Pagination'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useFilterState } from '../shared/useFilterState'
import { CONTROL_WIDTH } from '../shared/FilterControls'
import { StandardFilterBar } from '../shared/StandardFilterBar'
import { PresensiDetailDrawer } from './PresensiDetailDrawer'
import { isOtsOrder } from '../../lib/access-link'
import { useFieldAppMode } from '../../lib/field-app'
import { activeCommonFilters } from '../../lib/filters'

/**
 * Presensi Acara (PRD §102–§112).
 *
 * Webinar dan Seminar tampil dalam SATU tabel; filter dipakai untuk memisahkan.
 *
 * Dua keputusan yang perlu dicatat:
 *   * kolom timestamp tetap T1..T10 (PRD §103/§105) meskipun database
 *     row-based — `timestamps` dari RPC sudah 10 terbaru;
 *   * KPI Hadir/Belum Hadir/Attendance Rate dihitung dari filter yang sama
 *     TANPA filter Hadir/Belum Hadir. Filter itu adalah pemilih BARIS, bukan
 *     filter KPI: kalau ia ikut menyaring KPI, memilih "Hadir" akan selalu
 *     menampilkan "Belum Hadir = 0" dan angkanya kehilangan arti.
 */
const ATTENDANCE_OPTIONS = [
  { value: 'Hadir', label: 'Hadir' },
  { value: 'Belum Hadir', label: 'Belum Hadir' },
  { value: 'Reschedule', label: 'Reschedule' },
  { value: 'Refund', label: 'Refund' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Cancelled', label: 'Cancelled' },
]

/** Kolom timestamp diturunkan dari batas tampil dokumen, bukan ditulis 10 kali. */
const TIMESTAMP_COLUMNS: readonly TableColumn[] = Array.from(
  { length: TIMESTAMP_DISPLAY_LIMIT },
  (_, index) => ({ key: `t${index + 1}`, header: `T${index + 1}`, minWidth: 92 }),
)

const COLUMNS: readonly TableColumn[] = [
  { key: 'order_id', header: 'Order ID', sortKey: 'order_id', minWidth: 110 },
  { key: 'name', header: 'Nama', sortKey: 'name', minWidth: 140 },
  { key: 'phone', header: 'No WA', minWidth: 120 },
  { key: 'product_name', header: 'Produk', sortKey: 'product_name', minWidth: 150 },
  { key: 'batch', header: 'Batch', sortKey: 'batch', minWidth: 70 },
  { key: 'session', header: 'Sesi', sortKey: 'session', minWidth: 70 },
  { key: 'city', header: 'Kota', sortKey: 'city', minWidth: 100 },
  { key: 'advertiser_name', header: 'Pengiklan', minWidth: 110 },
  { key: 'event_type', header: 'Seminar / Webinar', minWidth: 140 },
  { key: 'attendance_status', header: 'Status', minWidth: 110 },
  { key: 'total_activity', header: 'Total Activity', align: 'right', sortKey: 'total_activity', minWidth: 110 },
  ...TIMESTAMP_COLUMNS,
]

/** Default 01 §6: aktivitas terbaru lebih dulu. */
function defaultDirection(key: PresensiSortKey): SortDirection {
  return key === 'total_activity' || key === 'latest_activity' ? 'desc' : 'asc'
}

export function PresensiPage() {
  const state = useFilterState<PresensiFilters>(EMPTY_PRESENSI_FILTERS)
  // A30: Tampilan Apps Lapangan — filter dilipat, tabel menjadi kartu.
  const fieldMode = useFieldAppMode()
  const [showFilters, setShowFilters] = useState(false)
  const activeFilterCount = activeCommonFilters(state.filters).length + (state.filters.attendanceStatus === '' ? 0 : 1)
  const { lists } = useConfigLists()
  const [sort, setSort] = useState<{ key: PresensiSortKey; direction: SortDirection }>({
    key: 'latest_activity',
    direction: 'desc',
  })
  const [selected, setSelected] = useState<PresensiRow | null>(null)

  const appliedKey = JSON.stringify(state.applied)
  const table = useAsyncData(
    () =>
      fetchPresensiPage(state.applied, {
        sort: sort.key,
        direction: sort.direction,
        page: state.page,
        pageSize: state.pageSize,
      }),
    [appliedKey, sort.key, sort.direction, state.page, state.pageSize],
  )

  /**
   * KPI dari `presensi_summary` (A23: cukup izin Presensi; dashboard_summary butuh izin
   * Dashboard). Dipisah dari tabel supaya pergantian halaman tidak memuat ulang KPI.
   */
  const summary = useAsyncData(
    () => fetchPresensiSummary(toCommonFilters(state.applied)),
    [`${appliedKey}:kpi`],
  )

  function toggleSort(key: string): void {
    const typed = key as PresensiSortKey
    setSort((current) =>
      current.key === typed
        ? { key: typed, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key: typed, direction: defaultDirection(typed) },
    )
    state.setPage(1)
  }


  return (
    <>
      {fieldMode ? null : <PageHeader title="Presensi Acara" />}

      {fieldMode ? (
        <div className="mb-1 flex items-center gap-2">
          <SearchInput id="presensi-search-field" value={state.filters.search} onChange={(value) => state.update('search', value)} />
          <Button onClick={() => setShowFilters((open) => !open)} aria-expanded={showFilters}>
            {showFilters ? 'Tutup filter' : `Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
          </Button>
        </div>
      ) : null}
      {!fieldMode || showFilters ? (
        <StandardFilterBar
          filters={state.filters}
          lists={lists}
          update={state.update}
          removeFilter={state.removeFilter}
          clearAll={state.clearAll}
          search={
            <SearchInput
              id="presensi-search"
              value={state.filters.search}
              onChange={(value) => state.update('search', value)}
            />
          }
          extra={
            <Select
              id="filter-presensi-status"
              ariaLabel="Filter status presensi"
              className={CONTROL_WIDTH}
              value={state.filters.attendanceStatus}
              placeholder="Semua status"
              options={ATTENDANCE_OPTIONS}
              onChange={(value) => state.update('attendanceStatus', value)}
            />
          }
          extraChips={
            state.filters.attendanceStatus === '' ? null : (
              <FilterChip
                label={`Presensi: ${state.filters.attendanceStatus}`}
                onRemove={() => state.removeFilter('attendanceStatus')}
              />
            )
          }
        />
      ) : null}

      {summary.error === null ? null : (
        <div className="mt-4">
          <ErrorState message={summary.error} action={<Button onClick={summary.reload}>Coba lagi</Button>} />
        </div>
      )}

      {summary.data === null ? null : (
        <div className={fieldMode ? 'mt-3 grid grid-cols-3 gap-2' : 'mt-4 grid grid-cols-1 gap-3 md:grid-cols-3'}>
          <KpiCard label="Hadir" value={formatCount(summary.data.sudah_hadir)} highlight />
          <KpiCard label="Belum Hadir" value={formatCount(summary.data.belum_hadir)} />
          <KpiCard
            label={fieldMode ? 'Rate' : 'Attendance Rate'}
            value={formatRate(summary.data.attendance_rate)}
            hint={fieldMode ? undefined : summary.data.paid === 0 ? 'Belum ada order Paid' : 'Hadir ÷ Paid'}
          />
        </div>
      )}

      {table.error === null ? null : (
        <div className="mt-4">
          <ErrorState message={table.error} action={<Button onClick={table.reload}>Coba lagi</Button>} />
        </div>
      )}

      <div className="mt-4">
        {table.loading && table.data === null ? (
          <Card>
            <SkeletonRows rows={8} />
          </Card>
        ) : (
          <Card padding="none">
            {fieldMode ? (
              <PresensiCards rows={table.data?.rows ?? []} onSelect={setSelected} />
            ) : (
              <DataTable
                exportConfig={{ filename: 'presensi', columns: [...COLUMNS, { key: 'app_status', header: 'Status order' }, { key: 'rescheduled', header: 'Reschedule' }, { key: 'original_batch', header: 'Batch asal' }, { key: 'original_session', header: 'Sesi asal' }, { key: 'original_city', header: 'Kota asal' }], loadRows: async () => {
                  const rows = await collectPages(page => fetchPresensiPage(state.applied, { sort: sort.key, direction: sort.direction, page, pageSize: 100, exporting: true }))
                  return rows.map(row => ({ ...row, ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i + 1}`, row.timestamps?.[i] ?? ''])) }))
                } }} columns={COLUMNS} sort={{ key: sort.key, direction: sort.direction }} onSortChange={toggleSort}>
                {(table.data?.rows ?? []).map((row) => (
                  <TableRow key={row.order_id}>
                    <TableCell mono>
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className="font-semibold text-primary hover:underline"
                      >
                        {row.order_id}
                      </button>
                      {isOtsOrder(row.order_id) ? <Badge tone="primary" className="ml-1.5">OTS</Badge> : null}
                    </TableCell>
                    <TableCell>{formatText(row.name)}</TableCell>
                    <TableCell>{formatText(row.phone)}</TableCell>
                    <TableCell>{formatText(row.product_name)}</TableCell>
                    <TableCell>{formatText(row.batch)}</TableCell>
                    <TableCell>{formatText(row.session)}</TableCell>
                    <TableCell>{formatText(row.city)}</TableCell>
                    <TableCell>{formatText(row.advertiser_name)}</TableCell>
                    <TableCell>
                      {row.event_type === null ? (
                        '-'
                      ) : (
                        <Badge tone={eventTypeTone(row.event_type)}>
                          {row.event_type === 'Seminar Offline' ? 'Seminar' : row.event_type === 'Hybrid' ? 'Hybrid' : 'Webinar'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge tone={attendanceTone(row.attendance_status)}>{row.attendance_status}</Badge>
                    </TableCell>
                    <TableCell align="right">{formatCount(row.total_activity)}</TableCell>
                    {Array.from({ length: TIMESTAMP_DISPLAY_LIMIT }, (_, index) => (
                      <TableCell key={index} mono>
                        {formatTime(row.timestamps?.[index])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </DataTable>
            )}

            {table.loading || table.data === null ? null : (
              <Pagination
                page={state.page}
                pageSize={state.pageSize}
                total={table.data.total}
                onPageChange={state.setPage}
                onPageSizeChange={state.setPageSize}
              />
            )}

            {!table.loading && table.data !== null && table.data.rows.length === 0 ? (
              <p className="border-t border-line px-3 py-8 text-center text-ink-soft">
                Tidak ada order yang cocok dengan filter aktif.
              </p>
            ) : null}
          </Card>
        )}
      </div>

      <PresensiDetailDrawer
        row={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setSelected(null)
          table.reload()
          summary.reload()
        }}
      />
    </>
  )
}

/** Daftar kartu Presensi untuk Tampilan Apps Lapangan (A30): yang penting di meja registrasi saja. */
function PresensiCards({ rows, onSelect }: { rows: PresensiRow[]; onSelect: (row: PresensiRow) => void }) {
  if (rows.length === 0) return <p className="p-4 text-center text-[13px] text-ink-soft">Tidak ada peserta untuk filter ini.</p>
  return (
    <ul className="divide-y divide-line" data-testid="presensi-cards">
      {rows.map((row) => (
        <li key={row.order_id}>
          <button type="button" onClick={() => onSelect(row)} className="flex w-full items-start gap-3 px-3 py-3 text-left active:bg-soft">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-ink">{formatText(row.name)}</p>
              <p className="truncate font-mono text-[11px] text-ink-soft">
                {row.order_id}
                {isOtsOrder(row.order_id) ? ' · OTS' : ''}
              </p>
              <p className="truncate text-[12px] text-ink-soft">
                {[row.product_name, row.batch ? `Batch ${row.batch}` : null, row.session, row.city].filter(Boolean).join(' · ') || '-'}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge tone={attendanceTone(row.attendance_status)}>{row.attendance_status}</Badge>
              {row.latest_activity ? <span className="text-[11px] text-ink-soft">{formatTime(row.latest_activity)}</span> : null}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
