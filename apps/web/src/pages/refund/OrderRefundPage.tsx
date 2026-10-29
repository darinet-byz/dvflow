import { useState } from 'react'
import { collectPages } from '../../lib/export'
import { ApiError } from '../../lib/api'
import { EMPTY_COMMON_FILTERS, type CommonFilters } from '../../lib/filters'
import { formatCount, formatDateTime, formatMoney, formatText } from '../../lib/format'
import {
  fetchRefundPage,
  type RefundRow,
  type RefundSortKey,
  type SortDirection,
} from '../../lib/queries'
import { hasPermission } from '../../lib/roles'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { useSession } from '../../lib/useSession'
import { PageHeader } from '../../layout/PageHeader'
import { Badge, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, KpiCard } from '../../ui/Card'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { SearchInput, TextInput } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { Pagination } from '../../ui/Pagination'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import { useFilterState } from '../shared/useFilterState'
import { StandardFilterBar } from '../shared/StandardFilterBar'

/**
 * Order Refund (A58).
 *
 * Halaman kontrol, bukan tempat menandai refund: refund/reschedule ditandai dari
 * drawer Presensi/Order. Filter tanggal di sini memakai TANGGAL REFUND, bukan
 * tanggal order, karena pertanyaannya "refund apa yang terjadi pada periode ini".
 */
const COLUMNS: readonly TableColumn[] = [
  { key: 'order_id', header: 'Order ID', sortKey: 'order_id', minWidth: 110 },
  { key: 'name', header: 'Nama', sortKey: 'name', minWidth: 140 },
  { key: 'phone', header: 'No WA', minWidth: 120 },
  { key: 'product_name', header: 'Produk', sortKey: 'product_name', minWidth: 150 },
  { key: 'batch', header: 'Batch', sortKey: 'batch', minWidth: 70 },
  { key: 'session', header: 'Sesi', sortKey: 'session', minWidth: 70 },
  { key: 'city', header: 'Kota', sortKey: 'city', minWidth: 100 },
  { key: 'advertiser_name', header: 'Pengiklan', minWidth: 110 },
  { key: 'event_type', header: 'Seminar / Webinar', minWidth: 130 },
  { key: 'quantity', header: 'Tiket', align: 'right', minWidth: 70 },
  { key: 'refund_amount', header: 'Nominal Refund', align: 'right', sortKey: 'amount', minWidth: 130 },
  { key: 'refunded_at', header: 'Tanggal Refund', sortKey: 'refunded_at', minWidth: 150 },
  { key: 'refund_reason', header: 'Alasan', minWidth: 180 },
  { key: 'refunded_by_name', header: 'Oleh', minWidth: 120 },
  { key: 'actions', header: 'Aksi', minWidth: 130 },
]

function defaultDirection(key: RefundSortKey): SortDirection {
  return key === 'refunded_at' || key === 'amount' ? 'desc' : 'asc'
}

export function OrderRefundPage() {
  const profile = useSession().profile
  const toast = useToast()
  const state = useFilterState<CommonFilters>(EMPTY_COMMON_FILTERS)
  const { lists } = useConfigLists()
  const [sort, setSort] = useState<{ key: RefundSortKey; direction: SortDirection }>({
    key: 'refunded_at',
    direction: 'desc',
  })
  const [selected, setSelected] = useState<RefundRow | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const appliedKey = JSON.stringify(state.applied)
  const { data, loading, error, reload } = useAsyncData(
    () =>
      fetchRefundPage(state.applied, {
        sort: sort.key,
        direction: sort.direction,
        page: state.page,
        pageSize: state.pageSize,
      }),
    [appliedKey, sort.key, sort.direction, state.page, state.pageSize],
  )

  function toggleSort(key: string): void {
    const typed = key as RefundSortKey
    setSort((current) =>
      current.key === typed
        ? { key: typed, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key: typed, direction: defaultDirection(typed) },
    )
    state.setPage(1)
  }

  function openCancel(row: RefundRow): void {
    setReason('')
    setDialogError(null)
    setSelected(row)
  }

  async function cancelRefund(): Promise<void> {
    if (selected === null || busy) return
    setBusy(true)
    setDialogError(null)
    try {
      await authorizedRequest(`/api/orders/${encodeURIComponent(selected.order_id)}/refund/cancel`, {
        method: 'POST',
        body: { reason: reason.trim() },
      })
      toast.show('Refund dibatalkan; order kembali ke status sebelumnya.', 'success')
      setSelected(null)
      reload()
    } catch (cause) {
      setDialogError(cause instanceof ApiError ? cause.message : 'Pembatalan refund gagal. Silakan coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  const summary = data?.summary
  const canCancel = hasPermission(profile, 'action.refund')

  return (
    <>
      <PageHeader
        title="Order Refund"
        description="Daftar order yang direfund. Filter tanggal memakai tanggal refund; batch/sesi/kota memakai acara asal (penjualan)."
      />

      <StandardFilterBar
        filters={state.filters}
        lists={lists}
        update={state.update}
        removeFilter={state.removeFilter}
        clearAll={state.clearAll}
        search={
          <SearchInput
            id="refund-search"
            value={state.filters.search}
            onChange={(value) => state.update('search', value)}
            placeholder="Cari Order ID, nama, No WA, atau alasan"
          />
        }
      />

      {error === null ? null : (
        <div className="mt-4">
          <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
        </div>
      )}

      {data === null ? null : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard label="Order Refund" value={formatCount(summary?.total ?? 0)} highlight />
          <KpiCard label="Tiket Refund" value={formatCount(summary?.tickets ?? 0)} />
          <KpiCard label="Nominal Refund" value={formatMoney(summary?.amount ?? 0)} />
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
              exportConfig={{
                filename: 'order-refund',
                columns: COLUMNS.filter((column) => column.key !== 'actions'),
                loadRows: async () => {
                  const rows = await collectPages((page) =>
                    fetchRefundPage(state.applied, {
                      sort: sort.key,
                      direction: sort.direction,
                      page,
                      pageSize: 100,
                      exporting: true,
                    }),
                  )
                  return rows.map((row) => ({ ...row }))
                },
              }}
              columns={COLUMNS}
              sort={{ key: sort.key, direction: sort.direction }}
              onSortChange={toggleSort}
            >
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.order_id}>
                  <TableCell mono>
                    <span className="font-semibold text-ink">{row.order_id}</span>
                    {row.rescheduled ? <Badge tone="warning" className="ml-1.5">Reschedule</Badge> : null}
                  </TableCell>
                  <TableCell>{formatText(row.name)}</TableCell>
                  <TableCell>{formatText(row.phone)}</TableCell>
                  <TableCell>{formatText(row.product_name)}</TableCell>
                  <TableCell>{formatText(row.batch)}</TableCell>
                  <TableCell>{formatText(row.session)}</TableCell>
                  <TableCell>{formatText(row.city)}</TableCell>
                  <TableCell>{formatText(row.advertiser_name)}</TableCell>
                  <TableCell>
                    {row.event_type === null ? '-' : <Badge tone={eventTypeTone(row.event_type)}>{row.event_type}</Badge>}
                  </TableCell>
                  <TableCell align="right">{formatCount(row.quantity)}</TableCell>
                  <TableCell align="right" className="font-semibold">{formatMoney(row.refund_amount)}</TableCell>
                  <TableCell>{formatDateTime(row.refunded_at)}</TableCell>
                  <TableCell>
                    <span className="line-clamp-2 max-w-[220px]">{formatText(row.refund_reason)}</span>
                  </TableCell>
                  <TableCell>{formatText(row.refunded_by_name)}</TableCell>
                  <TableCell>
                    {canCancel ? (
                      <Button size="sm" variant="danger" onClick={() => openCancel(row)}>
                        Batalkan
                      </Button>
                    ) : (
                      <span className="text-[12px] text-ink-muted">-</span>
                    )}
                  </TableCell>
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
                Belum ada order refund pada filter ini.
              </p>
            ) : null}
          </Card>
        )}
      </div>

      <Modal
        open={selected !== null}
        title="Batalkan Refund"
        onClose={() => {
          if (!busy) setSelected(null)
        }}
        footer={
          <>
            <Button onClick={() => setSelected(null)} disabled={busy}>Batal</Button>
            <Button variant="primary" loading={busy} onClick={() => void cancelRefund()}>
              Batalkan Refund
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-line bg-page p-2.5 text-[12px] text-ink-soft">
            <strong className="text-ink">{selected?.order_id}</strong>
            {selected?.name ? ` · ${formatText(selected.name)}` : ''}
            {selected?.refund_amount !== undefined ? ` · ${formatMoney(selected.refund_amount)}` : ''}
          </p>
          <p className="text-[12px] text-ink-soft">
            Order akan kembali ke status provider terakhir dan dihitung lagi pada laporan Paid. Riwayat refund
            tetap tersimpan.
          </p>
          <TextInput
            id="refund-cancel-reason"
            label="Alasan pembatalan (opsional)"
            value={reason}
            onChange={setReason}
            placeholder="mis. salah menandai order"
            maxLength={500}
          />
          {dialogError === null ? null : <p className="text-[12px] text-danger">{dialogError}</p>}
        </div>
      </Modal>
    </>
  )
}
