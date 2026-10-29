import { useMemo, useState } from 'react'
import { hasPermission } from '../../lib/roles'
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
  MappingBadges,
  PRODUCT_STATUS_OPTIONS,
  productStatusTone,
  type MappingItem,
  type ProductStatus,
} from './StatusShared'

/**
 * A52: Status Produk.
 *
 * Mapping pengiklan di kolom kedua HANYA label (tabel product_advertisers);
 * tidak mempengaruhi akses, order, report, atau filter.
 */
type ProductStatusRow = {
  id: string
  code: string
  name: string
  status: ProductStatus
  active: boolean
  advertisers: MappingItem[]
}

type AdvertiserChoice = { id: string; code: string; name: string; status: string }

const COLUMNS: readonly TableColumn[] = [
  { key: 'product', header: 'Produk', minWidth: 190 },
  { key: 'advertisers', header: 'Pengiklan yang pegang', minWidth: 230 },
  { key: 'status', header: 'Status', minWidth: 150 },
  { key: 'actions', header: 'Aksi', minWidth: 160 },
]

export function ProductStatusPage() {
  const session = useSession()
  const toast = useToast()
  const canEdit = hasPermission(session.profile, 'operasional.product_status')
  const [search, setSearch] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [mapping, setMapping] = useState<ProductStatusRow | null>(null)
  const [choices, setChoices] = useState<AdvertiserChoice[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mappingSearch, setMappingSearch] = useState('')
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappingSaving, setMappingSaving] = useState(false)

  const { data, loading, error, reload } = useAsyncData(
    () => supabaseRpc<ProductStatusRow[]>('product_status_list', {}),
    [],
  )

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (term === '') return data ?? []
    return (data ?? []).filter((row) =>
      `${row.code} ${row.name}`.toLowerCase().includes(term),
    )
  }, [data, search])

  async function changeStatus(row: ProductStatusRow, status: ProductStatus): Promise<void> {
    if (savingId !== null) return
    setSavingId(row.id)
    try {
      await supabaseRpc('set_product_status', { p_product_id: row.id, p_status: status })
      reload()
      toast.show(`Status ${row.code} menjadi ${status}.`, 'success')
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal mengubah status produk.', 'danger')
    } finally {
      setSavingId(null)
    }
  }

  async function openMapping(row: ProductStatusRow): Promise<void> {
    setMapping(row)
    setMappingSearch('')
    setSelected(new Set(row.advertisers.map((item) => item.id).filter((id): id is string => typeof id === 'string')))
    setMappingLoading(true)
    try {
      const rowsChoice = await supabaseSelect<AdvertiserChoice>(
        'advertisers',
        { order: 'code.asc' },
        'id,code,name,status',
      )
      setChoices(rowsChoice)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Gagal memuat pengiklan.', 'danger')
    } finally {
      setMappingLoading(false)
    }
  }

  async function saveMapping(): Promise<void> {
    if (mapping === null || mappingSaving) return
    setMappingSaving(true)
    try {
      await supabaseRpc('set_product_advertisers', {
        p_product_id: mapping.id,
        p_advertiser_ids: [...selected],
      })
      setMapping(null)
      reload()
      toast.show('Mapping pengiklan diperbarui.', 'success')
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
        title="Status Produk"
        description="Status operasional semua produk. Pengiklan di kolom kedua hanya label mapping."
      />

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput
            id="search-status-produk"
            value={search}
            onChange={setSearch}
            placeholder="Cari produk atau kode"
          />
          <span className="text-[12px] text-ink-muted">{rows.length} produk</span>
        </div>

        {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
        {loading && data === null ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState title="Belum ada produk" description="Tambahkan produk di Konfigurasi Produk." />
        ) : (
          <DataTable rowNumbers columns={columns} stickyHeader={false}>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="font-mono text-[11px] text-ink-muted">{row.code}</span>
                  <span className="block font-medium text-ink">{row.name}</span>
                </TableCell>
                <TableCell><MappingBadges items={row.advertisers} label="name" /></TableCell>
                <TableCell>
                  {canEdit ? (
                    <Select
                      id={`status-produk-${row.id}`}
                      ariaLabel={`Status ${row.code}`}
                      className="w-[145px]"
                      value={row.status}
                      options={PRODUCT_STATUS_OPTIONS}
                      disabled={savingId !== null}
                      onChange={(value) => void changeStatus(row, value as ProductStatus)}
                    />
                  ) : (
                    <Badge tone={productStatusTone(row.status)}>{row.status}</Badge>
                  )}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <Button size="sm" variant="secondary" disabled={mappingSaving} onClick={() => void openMapping(row)}>
                      Atur Pengiklan
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </DataTable>
        )}
      </Card>

      <Modal
        open={mapping !== null}
        title={mapping === null ? 'Atur Pengiklan' : `Pengiklan untuk ${mapping.code} — ${mapping.name}`}
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
          id="search-mapping-pengiklan"
          value={mappingSearch}
          onChange={setMappingSearch}
          placeholder="Cari pengiklan"
        />
        <div className="mt-3 grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
          {mappingLoading ? <SkeletonRows rows={4} /> : visibleChoices.length === 0 ? (
            <p className="text-[12px] text-ink-muted">Tidak ada pengiklan.</p>
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
