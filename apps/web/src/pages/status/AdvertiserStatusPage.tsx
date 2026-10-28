import { useMemo, useState } from 'react'
import { hasAllProductAccess, hasPermission } from '../../lib/roles'
import { useSession } from '../../lib/useSession'
import { supabaseRpc, supabaseSelect } from '../../lib/supabase-rest'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { SearchInput, Select } from '../../ui/Field'
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import {
  ADVERTISER_STATUS_OPTIONS,
  MappingBadges,
  advertiserStatusTone,
  type AdvertiserStatus,
  type MappingItem,
} from './StatusShared'

/**
 * A52: Status Pengiklan.
 *
 * Resign menutup akses semua akun login advertiser; status aktif kembali
 * langsung membuka akses (permintaan pengguna 28 Okt 2026).
 * Mapping produk hanya label.
 */
type AdvertiserStatusRow = {
  id: string
  code: string
  name: string
  status: AdvertiserStatus
  active: boolean
  products: MappingItem[]
}

type ProductChoice = { id: string; code: string; name: string; status: string }

const COLUMNS: readonly TableColumn[] = [
  { key: 'advertiser', header: 'Pengiklan', minWidth: 190 },
  { key: 'products', header: 'Produk yang dipegang', minWidth: 230 },
  { key: 'status', header: 'Status', minWidth: 150 },
  { key: 'actions', header: 'Aksi', minWidth: 160 },
]

export function AdvertiserStatusPage() {
  const session = useSession()
  const toast = useToast()
  const canEdit = hasPermission(session.profile, 'operasional.advertiser_status') && hasAllProductAccess(session.profile)
  const [search, setSearch] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [pendingResign, setPendingResign] = useState<AdvertiserStatusRow | null>(null)
  const [mapping, setMapping] = useState<AdvertiserStatusRow | null>(null)
  const [choices, setChoices] = useState<ProductChoice[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mappingSearch, setMappingSearch] = useState('')
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappingSaving, setMappingSaving] = useState(false)

  const { data, loading, error, reload } = useAsyncData(
    () => supabaseRpc<AdvertiserStatusRow[]>('advertiser_status_list', {}),
    [],
  )

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (term === '') return data ?? []
    return (data ?? []).filter((row) =>
      `${row.code} ${row.name}`.toLowerCase().includes(term),
    )
  }, [data, search])

  async function changeStatus(row: AdvertiserStatusRow, status: AdvertiserStatus): Promise<void> {
    if (savingId !== null) return
    setSavingId(row.id)
    try {
      await supabaseRpc('set_advertiser_status', { p_advertiser_id: row.id, p_status: status })
      setPendingResign(null)
      reload()
      toast.show(`Status ${row.code} menjadi ${status}.`, 'success')
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal mengubah status pengiklan.', 'danger')
    } finally {
      setSavingId(null)
    }
  }

  function requestStatus(row: AdvertiserStatusRow, status: AdvertiserStatus): void {
    if (status === 'Resign') {
      setPendingResign(row)
      return
    }
    void changeStatus(row, status)
  }

  async function openMapping(row: AdvertiserStatusRow): Promise<void> {
    setMapping(row)
    setMappingSearch('')
    setSelected(new Set(row.products.map((item) => item.id).filter((id): id is string => typeof id === 'string')))
    setMappingLoading(true)
    try {
      const rowsChoice = await supabaseSelect<ProductChoice>(
        'products',
        { order: 'code.asc' },
        'id,code,name,status',
      )
      setChoices(rowsChoice)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal memuat produk.', 'danger')
    } finally {
      setMappingLoading(false)
    }
  }

  async function saveMapping(): Promise<void> {
    if (mapping === null || mappingSaving) return
    setMappingSaving(true)
    try {
      await supabaseRpc('set_advertiser_products', {
        p_advertiser_id: mapping.id,
        p_product_ids: [...selected],
      })
      setMapping(null)
      reload()
      toast.show('Mapping produk diperbarui.', 'success')
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal menyimpan mapping.', 'danger')
    } finally {
      setMappingSaving(false)
    }
  }

  const visibleChoices = useMemo(() => {
    const term = mappingSearch.trim().toLowerCase()
    if (term === '') return choices
    return choices.filter((choice) => `${choice.code} ${choice.name}`.toLowerCase().includes(term))
  }, [choices, mappingSearch])

  const columns = canEdit ? COLUMNS : COLUMNS.filter((column) => column.key !== 'actions')

  return (
    <>
      <PageHeader
        title="Status Pengiklan"
        description="Status operasional semua pengiklan. Resign menutup akses akun login; data report/order tetap utuh."
      />

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput
            id="search-status-advertiser"
            value={search}
            onChange={setSearch}
            placeholder="Cari pengiklan atau kode"
          />
          <span className="text-[12px] text-ink-muted">{rows.length} pengiklan</span>
        </div>

        {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
        {loading && data === null ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState title="Belum ada pengiklan" description="Tambahkan pengiklan di Konfigurasi Produk." />
        ) : (
          <DataTable columns={columns} stickyHeader={false}>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="font-mono text-[11px] text-ink-muted">{row.code}</span>
                  <span className="block font-medium text-ink">{row.name}</span>
                </TableCell>
                <TableCell><MappingBadges items={row.products} /></TableCell>
                <TableCell>
                  {canEdit ? (
                    <Select
                      id={`status-advertiser-${row.id}`}
                      ariaLabel={`Status ${row.code}`}
                      className="w-[145px]"
                      value={row.status}
                      options={ADVERTISER_STATUS_OPTIONS}
                      disabled={savingId !== null}
                      onChange={(value) => requestStatus(row, value as AdvertiserStatus)}
                    />
                  ) : (
                    <Badge tone={advertiserStatusTone(row.status)}>{row.status}</Badge>
                  )}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <Button size="sm" variant="secondary" disabled={mappingSaving} onClick={() => void openMapping(row)}>
                      Atur Produk
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </DataTable>
        )}
      </Card>

      <Modal
        open={pendingResign !== null}
        title="Ubah Status Menjadi Resign"
        onClose={() => (savingId === null ? setPendingResign(null) : undefined)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPendingResign(null)} disabled={savingId !== null}>Batal</Button>
            <Button
              variant="danger"
              loading={savingId !== null}
              onClick={() => pendingResign !== null && void changeStatus(pendingResign, 'Resign')}
            >
              Simpan Resign
            </Button>
          </>
        )}
      >
        <p>
          Status <strong>Resign</strong> akan menonaktifkan semua akun login milik pengiklan{' '}
          <strong>{pendingResign ? `${pendingResign.code} — ${pendingResign.name}` : ''}</strong> dan mencabut sesinya.
          Data report/order tetap utuh. Jika status diubah kembali aktif, akun login akan dibuka lagi.
        </p>
      </Modal>

      <Modal
        open={mapping !== null}
        title={mapping === null ? 'Atur Produk' : `Produk untuk ${mapping.code} — ${mapping.name}`}
        onClose={() => (mappingSaving ? undefined : setMapping(null))}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMapping(null)} disabled={mappingSaving}>Batal</Button>
            <Button variant="primary" loading={mappingSaving} onClick={() => void saveMapping()}>Simpan</Button>
          </>
        )}
      >
        <p className="mb-3 text-[12px] text-ink-muted">
          Mapping ini hanya label di halaman status; tidak mengubah akses, order, atau report.
        </p>
        <SearchInput
          id="search-mapping-produk"
          value={mappingSearch}
          onChange={setMappingSearch}
          placeholder="Cari produk"
        />
        <div className="mt-3 grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
          {mappingLoading ? <SkeletonRows rows={4} /> : visibleChoices.length === 0 ? (
            <p className="text-[12px] text-ink-muted">Tidak ada produk.</p>
          ) : visibleChoices.map((choice) => {
            const checked = selected.has(choice.id)
            return (
              <label key={choice.id} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-[12px] hover:bg-soft">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = new Set(selected)
                    if (event.target.checked) next.add(choice.id)
                    else next.delete(choice.id)
                    setSelected(next)
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-line text-primary focus:ring-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{choice.code} — {choice.name}</span>
                  <span className="block text-[11px] text-ink-muted">{choice.status}</span>
                </span>
              </label>
            )
          })}
        </div>
      </Modal>
    </>
  )
}
