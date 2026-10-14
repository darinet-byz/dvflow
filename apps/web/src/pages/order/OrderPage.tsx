import { collectPages } from '../../lib/export'
import { useState } from 'react'
import { EMPTY_ORDER_FILTERS, activeCommonFilters, type OrderFilters } from '../../lib/filters'
import { formatCount, formatDateTime, formatMoney, formatText } from '../../lib/format'
import { fetchOrdersPage, type OrderRow, type OrderSortKey, type SortDirection } from '../../lib/queries'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { PageHeader } from '../../layout/PageHeader'
import { Badge, appStatusTone, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, KpiCard } from '../../ui/Card'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { FilterBar, FilterChip } from '../../ui/Filters'
import { Select, SearchInput, TextInput } from '../../ui/Field'
import { Pagination } from '../../ui/Pagination'
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
import { OrderDetailDrawer } from './OrderDetailDrawer'

/**
 * Order — Master Table (PRD §44–§48).
 *
 * Aturan yang dijaga:
 *   * `1 Order ID = 1 row` ditegakkan database; halaman ini hanya membacanya;
 *   * kolom persis urutan PRD §45, dan tabel boleh menggulir horizontal;
 *   * filter terstruktur digabung dengan AND; chip filter aktif selalu terlihat;
 *   * `Clear All` tidak menghapus teks pencarian (PRD §37);
 *   * sort hanya pada kolom yang diizinkan (01 §6) dan dikerjakan server;
 *   * klik baris membuka drawer read-only — tanpa tombol edit/delete, karena
 *     keduanya belum ditentukan dokumen (PRD §49–§50).
 */
const STATUS_OPTIONS = [
  { value: 'Paid', label: 'Paid' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Cancelled', label: 'Cancelled' },
]

/** Urutan kolom mengikuti PRD §45. */
const COLUMNS: readonly TableColumn[] = [
  { key: 'order_id', header: 'Order ID', sortKey: 'order_id', minWidth: 110 },
  { key: 'name', header: 'Nama', sortKey: 'name', minWidth: 140 },
  { key: 'phone', header: 'No WA', minWidth: 120 },
  { key: 'email', header: 'Email', minWidth: 180 },
  { key: 'product_name', header: 'Produk', minWidth: 150 },
  { key: 'advertiser_name', header: 'Pengiklan', minWidth: 110 },
  { key: 'event_type', header: 'Seminar / Webinar', minWidth: 130 },
  { key: 'batch', header: 'Batch', minWidth: 70 },
  { key: 'session', header: 'Sesi', minWidth: 70 },
  { key: 'city', header: 'Kota', minWidth: 100 },
  { key: 'app_status', header: 'Status', sortKey: 'app_status', minWidth: 90 },
  { key: 'payment_method', header: 'Payment Method', minWidth: 130 },
  { key: 'payment_provider', header: 'Provider', minWidth: 110 },
  { key: 'gross_amount', header: 'Gross', align: 'right', sortKey: 'gross_amount', minWidth: 110 },
  { key: 'tax_amount', header: 'Tax', align: 'right', sortKey: 'tax_amount', minWidth: 100 },
  { key: 'net_amount', header: 'Net', align: 'right', sortKey: 'net_amount', minWidth: 110 },
  { key: 'created_at', header: 'Created At', sortKey: 'created_at', minWidth: 150 },
  { key: 'paid_at', header: 'Paid At', sortKey: 'paid_at', minWidth: 150 },
  { key: 'updated_at', header: 'Updated At', sortKey: 'updated_at', minWidth: 150 },
]

/** Default PRD/01 §6: created_at DESC. Kolom tanggal lain juga turun. */
function defaultDirection(key: OrderSortKey): SortDirection {
  return key === 'order_id' || key === 'name' || key === 'app_status' ? 'asc' : 'desc'
}

export function OrderPage() {
  const state = useFilterState<OrderFilters>(EMPTY_ORDER_FILTERS)
  const { lists } = useConfigLists()
  const [sort, setSort] = useState<{ key: OrderSortKey; direction: SortDirection }>({
    key: 'created_at',
    direction: 'desc',
  })
  const [moreFilters, setMoreFilters] = useState(false)
  const [selected, setSelected] = useState<OrderRow | null>(null)

  const appliedKey = JSON.stringify(state.applied)
  const { data, loading, error, reload } = useAsyncData(
    () =>
      fetchOrdersPage(state.applied, {
        sort: sort.key,
        direction: sort.direction,
        page: state.page,
        pageSize: state.pageSize,
      }),
    [appliedKey, sort.key, sort.direction, state.page, state.pageSize],
  )

  function toggleSort(key: string): void {
    const typed = key as OrderSortKey
    setSort((current) =>
      current.key === typed
        ? { key: typed, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key: typed, direction: defaultDirection(typed) },
    )
    state.setPage(1)
  }

  const chips = activeCommonFilters(state.filters)
  const hasPaymentMethod = state.filters.paymentMethod.trim() !== ''

  return (
    <>
      <PageHeader
        title="Order"
        description="Satu Order ID selalu menjadi satu baris Master Order."
      />

      <FilterBar
        search={<SearchInput id="order-search" value={state.filters.search} onChange={(value) => state.update('search', value)} />}
        filters={
          <>
            <ProductFilter filters={state.filters} lists={lists} update={state.update} />
            <AdvertiserFilter filters={state.filters} lists={lists} update={state.update} />
            <EventTypeFilter filters={state.filters} lists={lists} update={state.update} />
            <Select
              id="filter-status"
              ariaLabel="Filter status"
              className="w-[150px]"
              value={state.filters.appStatus}
              placeholder="Semua status"
              options={STATUS_OPTIONS}
              onChange={(value) => state.update('appStatus', value)}
            />
          </>
        }
        actions={
          <Button size="sm" onClick={() => setMoreFilters((open) => !open)}>
            {moreFilters ? 'Sembunyikan filter' : 'More Filters'}
          </Button>
        }
        activeFilters={
          <>
            {chips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} onRemove={() => state.removeFilter(chip.key)} />
            ))}
            {hasPaymentMethod ? (
              <FilterChip
                label={`Payment: ${state.filters.paymentMethod.trim()}`}
                onRemove={() => state.removeFilter('paymentMethod')}
              />
            ) : null}
            {state.filters.appStatus === '' ? null : (
              <FilterChip label={`Status: ${state.filters.appStatus}`} onRemove={() => state.removeFilter('appStatus')} />
            )}
          </>
        }
        onClearAll={state.clearAll}
      />

      {moreFilters ? (
        <div className="mt-2 flex flex-wrap gap-2.5 rounded-lg border border-line bg-card p-3.5">
          <BatchFilter filters={state.filters} lists={lists} update={state.update} />
          <SessionFilter filters={state.filters} lists={lists} update={state.update} />
          <CityFilter filters={state.filters} lists={lists} update={state.update} />
          {/* Payment method diketik bebas dengan saran dari identifier fee rule:
              nilainya berasal dari provider, dan rule tax-lah yang membuatnya
              bermakna. Saran ditampilkan supaya tidak perlu menebak ejaannya. */}
          <TextInput
            id="filter-payment"
            ariaLabel="Filter payment method"
            className="w-[190px]"
            value={state.filters.paymentMethod}
            placeholder="Payment method (mis. bank_transfer)"
            onChange={(value) => state.update('paymentMethod', value)}
          />
          <DateRangeFilters filters={state.filters} lists={lists} update={state.update} />
          {lists === null || lists.paymentMethods.length === 0 ? null : (
            <p className="w-full text-[11px] text-ink-soft">
              Identifier fee rule yang terdaftar: {lists.paymentMethods.join(', ')}
            </p>
          )}
        </div>
      ) : null}

      {error === null ? null : (
        <div className="mt-4">
          <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
        </div>
      )}

      {data === null ? null : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard label="Total Result" value={formatCount(data.summary.total)} />
          <KpiCard label="Paid" value={formatCount(data.summary.paid)} highlight />
          <KpiCard label="Pending" value={formatCount(data.summary.pending)} />
        </div>
      )}

      <div className="mt-4">
        {loading && data === null ? (
          <Card>
            <SkeletonRows rows={8} />
          </Card>
        ) : (
          <Card padding="none">
            <DataTable
              exportConfig={{ filename: 'order', loadRows: async () => {
                const rows = await collectPages(page => fetchOrdersPage(state.applied, { sort: sort.key, direction: sort.direction, page, pageSize: 100, exporting: true }))
                return rows.map(row => ({ ...row }))
              } }}
              columns={COLUMNS}
              sort={{ key: sort.key, direction: sort.direction }}
              onSortChange={toggleSort}
            >
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell mono>
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      className="font-semibold text-primary hover:underline"
                    >
                      {row.order_id}
                    </button>
                  </TableCell>
                  <TableCell>{formatText(row.name)}</TableCell>
                  <TableCell>{formatText(row.phone)}</TableCell>
                  <TableCell>{formatText(row.email)}</TableCell>
                  <TableCell>{formatText(row.product_name)}</TableCell>
                  <TableCell>{formatText(row.advertiser_name)}</TableCell>
                  <TableCell>
                    {row.event_type === null ? (
                      '-'
                    ) : (
                      <Badge tone={eventTypeTone(row.event_type)}>{row.event_type}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatText(row.batch)}</TableCell>
                  <TableCell>{formatText(row.session)}</TableCell>
                  <TableCell>{formatText(row.city)}</TableCell>
                  <TableCell>
                    <Badge tone={appStatusTone(row.app_status)}>{row.app_status}</Badge>
                  </TableCell>
                  <TableCell>{formatText(row.payment_method)}</TableCell>
                  <TableCell>{formatText(row.payment_provider)}</TableCell>
                  <TableCell align="right">{formatMoney(row.gross_amount)}</TableCell>
                  <TableCell align="right">{formatMoney(row.tax_amount)}</TableCell>
                  <TableCell align="right">{formatMoney(row.net_amount)}</TableCell>
                  <TableCell>{formatDateTime(row.created_at)}</TableCell>
                  <TableCell>{formatDateTime(row.paid_at)}</TableCell>
                  <TableCell>{formatDateTime(row.updated_at)}</TableCell>
                </TableRow>
              ))}
            </DataTable>

            {loading || data === null ? null : (
              <Pagination
                page={state.page}
                pageSize={state.pageSize}
                total={data.total}
                onPageChange={state.setPage}
                onPageSizeChange={state.setPageSize}
              />
            )}

            {!loading && data !== null && data.rows.length === 0 ? (
              <p className="border-t border-line px-3 py-8 text-center text-ink-soft">
                Tidak ada order yang cocok dengan filter aktif.
              </p>
            ) : null}
          </Card>
        )}
      </div>

      <OrderDetailDrawer order={selected} onClose={() => setSelected(null)} />
    </>
  )
}
