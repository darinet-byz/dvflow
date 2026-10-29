import { useState } from 'react'
import type { CommonFilters } from '../../lib/filters'
import { formatCount, formatText } from '../../lib/format'
import {
  fetchDashboardSessionSummary,
  type SessionAdvertiser,
  type SessionSummaryRow,
} from '../../lib/queries'
import { useAsyncData, useDebouncedValue } from '../../lib/useAsyncData'
import { Badge, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, CardHeader, DetailList } from '../../ui/Card'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Drawer } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, TableTotalRow, type TableColumn } from '../../ui/Table'

/**
 * A59: isi Resume Batch dipindahkan ke Dashboard sebagai kartu "Data per Sesi".
 *
 * Produk + batch wajib dipilih supaya sesi tidak tercampur antar batch. Selama
 * belum lengkap, tabel tetap tampil kosong dengan instruksi yang jelas. Setelah
 * lengkap, SELURUH filter Dashboard ikut berlaku (tanggal, pencarian, pengiklan,
 * jenis acara, sesi, kota).
 */
const COLUMNS: readonly TableColumn[] = [
  { key: 'city', header: 'Kota', minWidth: 140 },
  { key: 'session', header: 'Sesi', minWidth: 90 },
  { key: 'event_type', header: 'Jenis', minWidth: 130 },
  { key: 'advertisers', header: 'Pengiklan', align: 'right', minWidth: 100 },
  { key: 'tickets', header: 'Tiket Paid', align: 'right', minWidth: 110 },
]

/** Order OTS tidak punya pengiklan (A29); order tanpa kode pengiklan lainnya ditandai apa adanya. */
export function advertiserLabel(item: SessionAdvertiser): string {
  if (item.ots) return 'OTS (bayar di lokasi)'
  if (item.advertiser_code === null) return 'Tanpa pengiklan'
  return item.advertiser_name ? `${item.advertiser_name} (${item.advertiser_code})` : item.advertiser_code
}

export function sessionLabel(row: Pick<SessionSummaryRow, 'session' | 'city'>): string {
  return [row.session ?? 'Tanpa sesi', row.city].filter(Boolean).join(' · ')
}

export function SessionSummaryCard({ filters }: { filters: CommonFilters }) {
  // Batch & kota diketik bebas: tunda sebentar supaya tidak memanggil RPC per huruf.
  const batch = useDebouncedValue(filters.batch.trim())
  const city = useDebouncedValue(filters.city.trim())
  const ready = filters.productCode.trim() !== '' && batch !== ''
  const [selected, setSelected] = useState<SessionSummaryRow | null>(null)

  const { data, loading, error, reload } = useAsyncData(
    () =>
      ready
        ? fetchDashboardSessionSummary({ ...filters, batch, city })
        : Promise.resolve(null),
    [
      ready,
      filters.productCode,
      filters.advertiserCode,
      filters.eventType,
      filters.session,
      filters.dateFrom,
      filters.dateTo,
      filters.search,
      batch,
      city,
    ],
  )

  const summary = data?.summary
  const rows = data?.rows ?? []

  return (
    <Card>
      <CardHeader
        title="Data per Sesi"
        description="Tiket Paid per sesi dan kota, mengikuti filter di atas. Produk dan batch wajib dipilih."
        action={
          <span className="text-[12px] font-semibold text-ink-soft">
            {ready && summary !== undefined
              ? `${formatCount(summary.tickets)} tiket · ${formatCount(summary.sessions)} sesi`
              : '—'}
          </span>
        }
      />

      {!ready ? (
        <SessionTable rows={[]} emptyMessage="Pilih spesifik produk dan batch" onSelect={setSelected} />
      ) : error !== null ? (
        <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
      ) : loading && data === null ? (
        <SkeletonRows rows={5} />
      ) : (
        <>
          <SessionTable
            rows={rows}
            emptyMessage="Belum ada tiket Paid untuk filter ini."
            onSelect={setSelected}
          />
          <Drawer
            open={selected !== null}
            title={selected === null ? 'Rincian Sesi' : `Sesi ${sessionLabel(selected)}`}
            onClose={() => setSelected(null)}
          >
            {selected === null ? null : (
              <div className="flex flex-col gap-4">
                <DetailList
                  items={[
                    { label: 'Sesi', value: selected.session ?? 'Tanpa sesi' },
                    { label: 'Kota', value: formatText(selected.city) },
                    { label: 'Jenis', value: formatText(selected.event_type) },
                    { label: 'Tiket Paid', value: formatCount(selected.tickets) },
                  ]}
                />
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold text-ink">Per pengiklan</h3>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {selected.advertisers.map((item) => (
                      <li
                        key={`${item.ots ? 'ots' : ''}|${item.advertiser_code ?? ''}`}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span className="min-w-0 truncate">{advertiserLabel(item)}</span>
                        <span className="font-semibold">{formatCount(item.tickets)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Drawer>
        </>
      )}
    </Card>
  )
}

function SessionTable({
  rows,
  emptyMessage,
  onSelect,
}: {
  rows: SessionSummaryRow[]
  emptyMessage: string
  onSelect: (row: SessionSummaryRow) => void
}) {
  const total = rows.reduce((sum, row) => sum + row.tickets, 0)
  return (
    <DataTable rowNumbers maxRows={null} columns={COLUMNS} className="max-h-[420px] overflow-y-auto">
      {rows.length === 0 ? (
        <tr>
          <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-ink-soft">
            {emptyMessage}
          </td>
        </tr>
      ) : (
        rows.map((row) => (
          <TableRow key={`${row.session ?? ''}|${row.city ?? ''}|${row.event_type ?? ''}`}>
            <TableCell>{formatText(row.city)}</TableCell>
            <TableCell>
              <button
                type="button"
                onClick={() => onSelect(row)}
                className="font-semibold text-primary hover:underline"
              >
                {row.session ?? 'Tanpa sesi'}
              </button>
            </TableCell>
            <TableCell>
              {row.event_type === null ? '-' : <Badge tone={eventTypeTone(row.event_type)}>{row.event_type}</Badge>}
            </TableCell>
            <TableCell align="right">{formatCount(row.advertisers.length)}</TableCell>
            <TableCell align="right" className="font-semibold">{formatCount(row.tickets)}</TableCell>
          </TableRow>
        ))
      )}
      {rows.length === 0 ? null : (
        <TableTotalRow>
          <TableCell>Total</TableCell>
          <TableCell>{''}</TableCell>
          <TableCell>{''}</TableCell>
          <TableCell>{''}</TableCell>
          <TableCell align="right">{formatCount(total)}</TableCell>
        </TableTotalRow>
      )}
    </DataTable>
  )
}
