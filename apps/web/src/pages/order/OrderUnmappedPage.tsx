import { useState, useMemo } from 'react'
import {
  validateProductNameInput,
  type ProductAliasItem,
  type UnmappedOrderItem,
} from '@dvflow/shared'
import { PageHeader } from '../../layout/PageHeader'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput, SearchInput, Select } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableRow, TableCell } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

const columns = [
  { key: 'select', header: '' },
  { key: 'order_id', header: 'Order ID' },
  { key: 'name', header: 'Nama Peserta' },
  { key: 'product_raw', header: 'Produk di OrderOnline' },
  { key: 'amount', header: 'Nominal' },
  { key: 'status', header: 'Status' },
  { key: 'created_at', header: 'Waktu Order' },
]

export function OrderUnmappedPage() {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Field input remap
  const [targetMode, setTargetMode] = useState<'builder' | 'alias'>('builder')
  const [productCode, setProductCode] = useState('')
  const [advertiserCode, setAdvertiserCode] = useState('')
  const [typeCode, setTypeCode] = useState('')
  const [sessionCode, setSessionCode] = useState('')
  const [batch, setBatch] = useState('')
  const [city, setCity] = useState('')
  const [selectedAliasId, setSelectedAliasId] = useState('')
  const [aliasName, setAliasName] = useState('')
  const [saveAlias, setSaveAlias] = useState(true)

  const toast = useToast()
  const { lists } = useConfigLists()

  const { data, loading, error, reload } = useAsyncData(
    () => authorizedRequest<{ rows: UnmappedOrderItem[] }>(`/api/orders/unmapped?search=${encodeURIComponent(search.trim())}`),
    [search],
  )

  const { data: aliasData, reload: reloadAliases } = useAsyncData(
    () => authorizedRequest<{ rows: ProductAliasItem[] }>('/api/product-aliases'),
    [],
  )

  const rows = data?.rows ?? []
  const aliases = aliasData?.rows ?? []

  // Check all helpers
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.order_id))
  const someSelected = rows.some((r) => selectedIds.has(r.order_id))

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(rows.map((r) => r.order_id)))
    }
  }

  function toggleSelectRow(orderId: string) {
    const next = new Set(selectedIds)
    if (next.has(orderId)) next.delete(orderId)
    else next.add(orderId)
    setSelectedIds(next)
  }

  // Preview target kanonik
  const canonicalPreview = useMemo(() => {
    if (targetMode === 'alias') {
      const found = aliases.find((a) => a.id === selectedAliasId)
      return found?.canonical_target ?? ''
    }
    const val = validateProductNameInput({
      productCode,
      advertiserCode,
      typeCode,
      sessionCode,
      batch,
      city,
    })
    return val.ok ? val.value : ''
  }, [targetMode, selectedAliasId, aliases, productCode, advertiserCode, typeCode, sessionCode, batch, city])

  function openRemapModal() {
    if (selectedIds.size === 0) return

    // Temukan nama produk raw yang paling umum di antara baris terpilih
    const selectedRows = rows.filter((r) => selectedIds.has(r.order_id))
    const firstRaw = selectedRows[0]?.product_raw ?? ''
    setAliasName(firstRaw)
    setModalOpen(true)
  }

  async function handleBatchRemap() {
    if (!canonicalPreview) {
      toast.show('Konfigurasi target belum lengkap / tidak valid.', 'danger')
      return
    }

    setBusy(true)
    try {
      const result = await authorizedRequest<{ success: boolean; updated_count: number; alias_saved: boolean }>(
        '/api/orders/batch-remap',
        {
          method: 'POST',
          body: {
            orderIds: Array.from(selectedIds),
            canonicalTarget: canonicalPreview,
            saveAlias,
            aliasName: saveAlias ? aliasName.trim() : null,
          },
        },
      )

      toast.show(
        `Berhasil memetakan ${result.updated_count} order!${result.alias_saved ? ' Alias baru otomatis tersimpan.' : ''}`,
        'success',
      )

      setSelectedIds(new Set())
      setModalOpen(false)
      reload()
      reloadAliases()
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Gagal memetakan order.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Order Unmapped"
        description="Daftar pesanan dengan nama produk tidak standar yang menunggu pemetaan ke format kanonik resmi DVFLOW."
      />

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 max-w-md">
              <SearchInput
                id="search-unmapped"
                value={search}
                onChange={setSearch}
                placeholder="Cari produk di OrderOnline, nama, atau Order ID..."
              />
            </div>

            {selectedIds.size > 0 ? (
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-medium text-primary">
                  {selectedIds.size} order terpilih
                </span>
                <Button variant="primary" onClick={openRemapModal}>
                  🔗 Petakan Terpilih ({selectedIds.size})
                </Button>
              </div>
            ) : null}
          </div>

          {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}

          {loading && !data ? (
            <SkeletonRows rows={4} />
          ) : (
            <DataTable
              columns={columns}
              exportConfig={{
                filename: 'order-unmapped',
                disabled: loading || error !== null,
                columns: columns.filter((c) => c.key !== 'select'),
                loadRows: () =>
                  rows.map((r) => ({
                    order_id: r.order_id,
                    name: r.name ?? '-',
                    product_raw: r.product_raw ?? '-',
                    amount: r.gross_amount.toLocaleString('id-ID'),
                    status: r.app_status,
                    created_at: new Date(r.created_at).toLocaleString('id-ID'),
                  })),
              }}
            >
              {rows.length > 0 ? (
                <tr className="border-b border-line bg-soft/30 text-[12px] font-semibold text-ink-muted">
                  <td className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected && !allSelected
                      }}
                      onChange={toggleSelectAll}
                      aria-label="Pilih semua order"
                    />
                  </td>
                  <td colSpan={6} className="px-3 py-2">
                    {someSelected ? `${selectedIds.size} dari ${rows.length} dipilih` : 'Pilih Semua di Halaman Ini'}
                  </td>
                </tr>
              ) : null}

              {rows.map((row) => {
                const isSelected = selectedIds.has(row.order_id)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="w-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectRow(row.order_id)}
                        aria-label={`Pilih order ${row.order_id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-[12px] font-medium text-ink">
                      {row.order_id}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-ink">{row.name || 'Tanpa Nama'}</span>
                        <span className="text-[11px] text-ink-muted">{row.phone || row.email || '-'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-block max-w-[280px] truncate rounded bg-amber-500/10 px-2 py-0.5 text-[12px] font-medium text-amber-700 dark:text-amber-400" title={row.product_raw ?? ''}>
                        {row.product_raw || '(Nama Produk Kosong)'}
                      </span>
                    </TableCell>
                    <TableCell>
                      Rp {Number(row.gross_amount).toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex rounded-full bg-soft px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                        {row.app_status}
                      </span>
                    </TableCell>
                    <TableCell className="text-[11px] text-ink-muted">
                      {new Date(row.created_at).toLocaleString('id-ID')}
                    </TableCell>
                  </TableRow>
                )
              })}
            </DataTable>
          )}

          {!loading && !error && rows.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[15px] font-semibold text-ink">Semua order sudah terpetakan!</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                Tidak ada order dengan status invalid yang menunggu pemetaan saat ini.
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      <Modal
        open={modalOpen}
        title={`Petakan ${selectedIds.size} Order Terpilih`}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button onClick={() => setModalOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!canonicalPreview}
              onClick={() => void handleBatchRemap()}
            >
              Petakan Sekarang
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-left">
          <div className="flex gap-2 border-b border-line pb-2">
            <button
              type="button"
              onClick={() => setTargetMode('builder')}
              className={`rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${
                targetMode === 'builder' ? 'bg-primary text-white' : 'text-ink-soft hover:text-ink'
              }`}
            >
              Susun Konfigurasi DVFLOW
            </button>
            <button
              type="button"
              onClick={() => setTargetMode('alias')}
              className={`rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${
                targetMode === 'alias' ? 'bg-primary text-white' : 'text-ink-soft hover:text-ink'
              }`}
            >
              Pilih dari Template Alias
            </button>
          </div>

          {targetMode === 'builder' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                id="remap-product"
                label="Produk"
                value={productCode}
                onChange={setProductCode}
                options={[
                  { value: '', label: '-- Pilih Produk --' },
                  ...(lists?.products ?? []),
                ]}
              />
              <Select
                id="remap-adv"
                label="Pengiklan"
                value={advertiserCode}
                onChange={setAdvertiserCode}
                options={[
                  { value: '', label: '-- Pilih Pengiklan --' },
                  ...(lists?.advertisers ?? []),
                ]}
              />
              <Select
                id="remap-type"
                label="Tipe Acara"
                value={typeCode}
                onChange={setTypeCode}
                options={[
                  { value: '', label: '-- Pilih Tipe --' },
                  ...(lists?.eventTypes ?? []),
                ]}
              />
              <Select
                id="remap-session"
                label="Sesi"
                value={sessionCode}
                onChange={setSessionCode}
                options={[
                  { value: '', label: '-- Pilih Sesi --' },
                  ...(lists?.sessions ?? []),
                ]}
              />
              <TextInput
                id="remap-batch"
                label="Batch"
                value={batch}
                onChange={setBatch}
                placeholder="Contoh: 392"
              />
              <TextInput
                id="remap-city"
                label="Kota Acara"
                value={city}
                onChange={setCity}
                placeholder="Contoh: Solo"
              />
            </div>
          ) : (
            <div>
              <Select
                id="remap-alias-select"
                label="Pilih Template Alias yang Tersedia"
                value={selectedAliasId}
                onChange={setSelectedAliasId}
                options={[
                  { value: '', label: '-- Pilih Alias Tersimpan --' },
                  ...aliases.map((a) => ({
                    value: a.id,
                    label: `${a.alias_name}  =>  ${a.canonical_target}`,
                  })),
                ]}
              />
            </div>
          )}

          <div className="rounded border border-primary/20 bg-primary/5 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Target Konfigurasi Resmi:
            </span>
            <p className="mt-1 font-mono text-[13px] font-bold text-ink">
              {canonicalPreview || '(Lengkapi pilihan di atas untuk melihat preview)'}
            </p>
          </div>

          <div className="border-t border-line pt-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={saveAlias}
                onChange={(e) => setSaveAlias(e.target.checked)}
              />
              Simpan sebagai Alias baru secara permanen
            </label>
            {saveAlias ? (
              <div className="mt-1">
                <TextInput
                  id="remap-alias-name"
                  label="Nama Alias di OrderOnline"
                  value={aliasName}
                  onChange={setAliasName}
                  placeholder="Contoh: Workshop Kuliner Solo VIP"
                />
                <p className="mt-1 text-[11px] text-ink-muted">
                  Order baru berikutnya dari OrderOnline dengan nama ini akan langsung otomatis 100% Valid tanpa perlu dipetakan manual lagi.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  )
}
