import { useState } from 'react'
import { activeCommonFilters, clearAllFilters, clearFilter, EMPTY_COMMON_FILTERS, type CommonFilters } from '../../lib/filters'
import { formatCount, formatText } from '../../lib/format'
import { supabaseRpc } from '../../lib/supabase-rest'
import { useAsyncData, useDebouncedValue } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { PageHeader } from '../../layout/PageHeader'
import { Badge, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, DetailList, KpiCard } from '../../ui/Card'
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/Feedback'
import { FilterChip } from '../../ui/Filters'
import { Drawer } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { BatchFilter, EventTypeFilter, ProductFilter } from '../shared/FilterControls'

/**
 * Resume Batch (A39).
 *
 * Satu batch berisi beberapa sesi (seminar: beberapa kota; webinar: beberapa sesi). Halaman ini
 * menampilkan jumlah TIKET Paid per sesi + kota (sum quantity, definisi A25), gabungan semua
 * pengiklan dan OTS. Klik baris membuka rincian per pengiklan. Angka dihitung live oleh RPC
 * `batch_session_summary`; akun Advertiser tetap hanya melihat ordernya sendiri (A20).
 */
export type BatchAdvertiser = {
  advertiser_code: string | null
  advertiser_name: string | null
  ots: boolean
  tickets: number
}

export type BatchSessionRow = {
  session: string | null
  city: string | null
  event_type: string | null
  tickets: number
  advertisers: BatchAdvertiser[]
}

type BatchSummary = {
  summary: { tickets: number; sessions: number }
  rows: BatchSessionRow[]
}

const COLUMNS: readonly TableColumn[] = [
  { key: 'session', header: 'Sesi', minWidth: 90 },
  { key: 'city', header: 'Kota', minWidth: 140 },
  { key: 'event_type', header: 'Jenis', minWidth: 130 },
  { key: 'advertisers', header: 'Pengiklan', align: 'right', minWidth: 100 },
  { key: 'tickets', header: 'Tiket Paid', align: 'right', minWidth: 110 },
]

/** Order OTS tidak punya pengiklan (A29); order tanpa kode pengiklan lainnya ditandai apa adanya. */
export function advertiserLabel(item: BatchAdvertiser): string {
  if (item.ots) return 'OTS (bayar di lokasi)'
  if (item.advertiser_code === null) return 'Tanpa pengiklan'
  return item.advertiser_name ? `${item.advertiser_name} (${item.advertiser_code})` : item.advertiser_code
}

export function sessionLabel(row: Pick<BatchSessionRow, 'session' | 'city'>): string {
  return [row.session ?? 'Tanpa sesi', row.city].filter(Boolean).join(' · ')
}

export function ResumeBatchPage() {
  const { lists } = useConfigLists()
  const [filters, setFilters] = useState<CommonFilters>(EMPTY_COMMON_FILTERS)
  const [selected, setSelected] = useState<BatchSessionRow | null>(null)
  // Batch diketik: tunggu sebentar supaya tidak memanggil RPC per huruf.
  const batch = useDebouncedValue(filters.batch.trim())
  const ready = filters.productCode !== '' && batch !== ''

  const { data, loading, error, reload } = useAsyncData(
    () => (ready
      ? supabaseRpc<BatchSummary>('batch_session_summary', {
          p_product_code: filters.productCode,
          p_batch: batch,
          p_event_type: filters.eventType === '' ? null : filters.eventType,
        })
      : Promise.resolve(null)),
    [ready, filters.productCode, batch, filters.eventType],
  )

  const update = (key: keyof CommonFilters, value: string): void => setFilters((current) => ({ ...current, [key]: value }))
  const controls = { filters, lists, update }
  const productLabel = lists?.products.find((item) => item.value === filters.productCode)?.label
  const chips = activeCommonFilters(filters, productLabel === undefined ? {} : { product: productLabel })
  const rows = data?.rows ?? []
  const summary = data?.summary

  return (
    <>
      <PageHeader title="Resume Batch" description="Jumlah tiket Paid per sesi dalam satu batch, gabungan semua pengiklan." />

      <div className="filter-bar flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-card p-3.5">
        <div className="filter-row flex min-w-0 flex-wrap items-center gap-2.5">
          <ProductFilter {...controls} />
          <BatchFilter {...controls} />
          <EventTypeFilter {...controls} />
        </div>
        {chips.length === 0 ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} onRemove={() => setFilters((current) => clearFilter(current, chip.key))} />
            ))}
            <button
              type="button"
              onClick={() => setFilters((current) => clearAllFilters(current))}
              className="ml-auto text-[12px] font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {!ready ? (
        <div className="mt-4">
          <EmptyState title="Pilih produk dan isi batch" description="Resume menampilkan semua sesi dalam satu batch." />
        </div>
      ) : error !== null ? (
        <div className="mt-4">
          <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
        </div>
      ) : loading && data === null ? (
        <div className="mt-4">
          <Card>
            <SkeletonRows rows={6} />
          </Card>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <KpiCard size="lg" label="Total Tiket Paid" value={formatCount(summary?.tickets ?? 0)} highlight />
            <KpiCard size="lg" label="Jumlah Sesi" value={formatCount(summary?.sessions ?? 0)} />
          </div>

          <div className="mt-4">
            {rows.length === 0 ? (
              <EmptyState title="Belum ada tiket Paid" description="Belum ada order Paid untuk produk dan batch ini." />
            ) : (
              <Card padding="none">
                <DataTable columns={COLUMNS}>
                  {rows.map((row) => (
                    <TableRow key={`${row.session ?? ''}|${row.city ?? ''}|${row.event_type ?? ''}`}>
                      <TableCell>
                        <button type="button" onClick={() => setSelected(row)} className="font-semibold text-primary hover:underline">
                          {row.session ?? 'Tanpa sesi'}
                        </button>
                      </TableCell>
                      <TableCell>{formatText(row.city)}</TableCell>
                      <TableCell>
                        {row.event_type === null ? '-' : <Badge tone={eventTypeTone(row.event_type)}>{row.event_type}</Badge>}
                      </TableCell>
                      <TableCell align="right">{formatCount(row.advertisers.length)}</TableCell>
                      <TableCell align="right" className="font-semibold">{formatCount(row.tickets)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell>{''}</TableCell>
                    <TableCell>{''}</TableCell>
                    <TableCell>{''}</TableCell>
                    <TableCell align="right" className="font-semibold">{formatCount(summary?.tickets ?? 0)}</TableCell>
                  </TableRow>
                </DataTable>
              </Card>
            )}
          </div>
        </>
      )}

      <Drawer open={selected !== null} title={selected === null ? 'Rincian Sesi' : `Sesi ${sessionLabel(selected)}`} onClose={() => setSelected(null)}>
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
                  <li key={`${item.ots ? 'ots' : ''}|${item.advertiser_code ?? ''}`} className="flex items-center justify-between gap-3 px-3 py-2">
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
  )
}
