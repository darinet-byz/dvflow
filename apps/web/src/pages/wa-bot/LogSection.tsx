import { useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { formatDateTime } from '../../lib/format'
import type { PageSize } from '../../lib/filters'
import { useAsyncData } from '../../lib/useAsyncData'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { Pagination } from '../../ui/Pagination'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import { WA_STATUS_LABEL, type WaLog, type WaLogsPage, type WaOverview } from './types'

const COLUMNS: readonly TableColumn[] = [
  { key: 'time', header: 'Waktu', minWidth: 140 },
  { key: 'target', header: 'Pengiklan / Produk', minWidth: 200 },
  { key: 'group', header: 'Grup', minWidth: 130 },
  { key: 'status', header: 'Status', minWidth: 100 },
  { key: 'error', header: 'Keterangan', minWidth: 170 },
  { key: 'actions', header: 'Aksi', minWidth: 150 },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Semua status' },
  { value: 'sent', label: 'Terkirim' },
  { value: 'failed', label: 'Gagal' },
  { value: 'queued', label: 'Menunggu' },
]

export function LogSection({ overview, canSend }: { overview: WaOverview; canSend: boolean }) {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(50)
  const [status, setStatus] = useState('')
  const [advertiser, setAdvertiser] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [viewing, setViewing] = useState<WaLog | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (status !== '') params.set('status', status)
  if (advertiser !== '') params.set('advertiser', advertiser)
  if (dateFrom !== '') params.set('date_from', dateFrom)
  if (dateTo !== '') params.set('date_to', dateTo)

  const query = params.toString()
  const { data, loading, error, reload } = useAsyncData(
    () => authorizedRequest<WaLogsPage>(`/api/wa-bot/logs?${query}`),
    [query, refresh],
  )

  function changeFilter(setter: (value: string) => void) {
    return (value: string) => { setter(value); setPage(1) }
  }

  async function resend(row: WaLog) {
    if (resendingId !== null) return
    setResendingId(row.id)
    try {
      const result = await authorizedRequest<{ sent: boolean; error: string | null }>(`/api/wa-bot/logs/${row.id}/resend`, { method: 'POST' })
      toast.show(result.sent ? 'Pesan dikirim ulang.' : `Gagal mengirim ulang: ${result.error ?? 'tidak diketahui'}`, result.sent ? 'success' : 'danger')
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal mengirim ulang.', 'danger')
    } finally {
      setResendingId(null)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Riwayat Pengiriman</h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">Satu baris = satu pesan untuk satu produk. Disimpan 90 hari.</p>
        </div>
        <Button onClick={reload}>Muat ulang</Button>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select id="wa-log-status" ariaLabel="Status pengiriman" value={status} options={STATUS_OPTIONS} onChange={changeFilter(setStatus)} />
        <Select
          id="wa-log-advertiser"
          ariaLabel="Pengiklan"
          value={advertiser}
          options={[{ value: '', label: 'Semua pengiklan' }, ...overview.advertisers.map((row) => ({ value: row.code, label: `${row.code} — ${row.name}` }))]}
          onChange={changeFilter(setAdvertiser)}
        />
        <TextInput id="wa-log-from" ariaLabel="Tanggal awal" type="date" value={dateFrom} onChange={changeFilter(setDateFrom)} />
        <TextInput id="wa-log-to" ariaLabel="Tanggal akhir" type="date" value={dateTo} onChange={changeFilter(setDateTo)} />
      </div>

      {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
      {loading && !data ? (
        <SkeletonRows rows={4} />
      ) : (
        <DataTable columns={COLUMNS} maxRows={null}>
          {(data?.rows ?? []).map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap text-[12px]">{formatDateTime(row.created_at)}</TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium text-ink">{row.advertiser_name}</span>
                  <span className="text-[11px] text-ink-soft">{row.product_name ?? row.product_code}</span>
                </div>
              </TableCell>
              <TableCell className="break-all text-[12px]">{row.group_id}</TableCell>
              <TableCell>
                <Badge tone={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'}>
                  {WA_STATUS_LABEL[row.status]}
                </Badge>
                {row.attempts > 1 ? <span className="ml-1 text-[11px] text-ink-soft">({row.attempts}×)</span> : null}
              </TableCell>
              <TableCell className="max-w-[240px] break-words text-[12px] text-ink-soft">{row.error ?? '-'}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => setViewing(row)}>Lihat</Button>
                  {canSend && row.status === 'failed' ? (
                    <Button size="sm" variant="primary" loading={resendingId === row.id} onClick={() => void resend(row)}>
                      Kirim Ulang
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      )}
      {!loading && !error && (data?.rows.length ?? 0) === 0 ? (
        <p className="py-4 text-[13px] text-ink-soft">Belum ada riwayat pengiriman pada filter ini.</p>
      ) : null}

      {data ? (
        <Pagination
          page={data.page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
        />
      ) : null}

      <Modal
        open={viewing !== null}
        title="Isi Pesan"
        onClose={() => setViewing(null)}
        footer={<Button onClick={() => setViewing(null)}>Tutup</Button>}
      >
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-ink-soft">
            {viewing?.advertiser_name} · {viewing?.product_name ?? viewing?.product_code} · {WA_STATUS_LABEL[viewing?.status ?? 'queued']}
          </p>
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-sm border border-line bg-soft p-2.5 text-[12px] text-ink">
            {viewing?.message ?? ''}
          </pre>
        </div>
      </Modal>
    </Card>
  )
}
